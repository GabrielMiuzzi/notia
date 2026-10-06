// Notia ColdPass: the only part of the extension that talks to Notia, the
// Host mode server on this computer (plain HTTP on 127.0.0.1: the traffic
// never leaves the machine, and Notia serves these routes that way only to
// this same computer).
// The session token lives in chrome.storage.session (only the extension's
// own pages and this worker can read it; Chrome clears it when it closes),
// so web pages and their content scripts never see it. Notia decides which
// credentials belong to a page from the address Chrome reports for the
// frame that asks (`sender.url`), never from what the page says.

const DEFAULT_PORT = 52480
const KEEPALIVE_ALARM = 'notia-coldpass-keepalive'
// Notia ends a session after 12 h without use; this renews it while Chrome is open.
const KEEPALIVE_MINUTES = 30
const OFFER_TTL_MS = 3 * 60 * 1000
const IDENTIFIER_TTL_MS = 5 * 60 * 1000

async function hostPort() {
  const { port } = await chrome.storage.local.get('port')
  return Number(port) || DEFAULT_PORT
}

function validPort(value) {
  const port = Number(String(value || '').trim())
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/** POSTs to Notia's extension routes: `{ data }`, `{ locked }`, `{ unreachable }` or `{ error }`. */
async function call(path, body = {}) {
  const isLogin = path === '/api/browser/login'
  const { token } = await chrome.storage.session.get('token')
  if (!token && !isLogin) return { locked: true }
  const headers = { 'Content-Type': 'application/json' }
  if (token && !isLogin) headers.Authorization = `Bearer ${token}`
  let response
  try {
    response = await fetch(`http://127.0.0.1:${await hostPort()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
    })
  } catch {
    return { unreachable: true }
  }
  const data = await response.json().catch(() => ({}))
  if (response.status === 401 && !isLogin) {
    await endSession()
    return { locked: true }
  }
  if (!response.ok) return { error: data.error || 'Notia no pudo completar la operación.' }
  return { data }
}

async function endSession() {
  await chrome.storage.session.remove(['token', 'library'])
  await chrome.alarms.clear(KEEPALIVE_ALARM)
}

async function unlock({ port, username, password }) {
  const chosen = validPort(port)
  if (!chosen) return { error: 'El puerto tiene que ser un número entre 1 y 65535.' }
  await chrome.storage.local.set({ port: chosen, username: String(username || '').trim() })
  const result = await call('/api/browser/login', { username: String(username || '').trim(), password: String(password || '') })
  if (!result.data) return result
  await chrome.storage.session.set({ token: result.data.token, library: result.data.library })
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES })
  return { data: { library: result.data.library } }
}

async function lock() {
  await call('/api/browser/logout')
  await endSession()
  return { data: { ok: true } }
}

async function popupStatus() {
  const { username } = await chrome.storage.local.get('username')
  const { token, library } = await chrome.storage.session.get(['token', 'library'])
  const base = { port: await hostPort(), username: username || '' }
  if (!token) return { data: { ...base, unlocked: false } }
  const result = await call('/api/browser/status')
  if (result.data) return { data: { ...base, unlocked: true, library } }
  return { ...result, data: { ...base, unlocked: false } }
}

const offerKey = (tabId) => `offer:${tabId}`
const identifierKey = (tabId) => `identifier:${tabId}`

async function readFresh(key, ttl) {
  const stored = (await chrome.storage.session.get(key))[key]
  if (!stored || Date.now() - stored.at > ttl) {
    if (stored) await chrome.storage.session.remove(key)
    return null
  }
  return stored
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** A sign-in the page just used: Notia says whether to offer saving it. */
async function captured(sender, { username, password }) {
  const tabId = sender.tab.id
  let user = String(username || '').trim()
  if (!user) {
    // Two-step sign-ins ask the user first and the password on the next page.
    user = (await readFresh(identifierKey(tabId), IDENTIFIER_TTL_MS))?.username || ''
  }
  const result = await call('/api/browser/offer', { pageUrl: sender.url, username: user, password })
  if (!result.data?.offer) return { data: { offer: false } }
  const offer = { pageUrl: sender.url, host: hostOf(sender.url), username: user, password, at: Date.now() }
  await chrome.storage.session.set({ [offerKey(tabId)]: offer })
  chrome.tabs.sendMessage(tabId, { type: 'show-offer' }, { frameId: 0 }).catch(() => undefined)
  return { data: { offer: true } }
}

async function pendingOffer(sender) {
  const offer = await readFresh(offerKey(sender.tab.id), OFFER_TTL_MS)
  return { data: offer ? { host: offer.host, username: offer.username } : null }
}

async function answerOffer(sender, { save }) {
  const key = offerKey(sender.tab.id)
  const offer = await readFresh(key, OFFER_TTL_MS)
  await chrome.storage.session.remove(key)
  if (!offer || !save) return { data: { saved: false } }
  const result = await call('/api/browser/save', { pageUrl: offer.pageUrl, username: offer.username, password: offer.password })
  return result.data ? { data: { saved: true } } : result
}

const fromPopup = {
  status: () => popupStatus(),
  unlock: (message) => unlock(message),
  lock: () => lock(),
}

const fromPage = {
  credentials: (sender) => call('/api/browser/credentials', { pageUrl: sender.url }),
  generate: () => call('/api/browser/generate'),
  identifier: async (sender, message) => {
    const username = String(message.username || '').trim()
    if (username) await chrome.storage.session.set({ [identifierKey(sender.tab.id)]: { username, at: Date.now() } })
    return { data: { ok: true } }
  },
  captured: (sender, message) => captured(sender, message),
  'pending-offer': (sender) => (sender.frameId === 0 ? pendingOffer(sender) : { data: null }),
  'answer-offer': (sender, message) => (sender.frameId === 0 ? answerOffer(sender, message) : { data: { saved: false } }),
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false
  // The extension's own pages (the popup, also when opened in a tab) or a
  // content script in a web page.
  const ownPage = String(sender.url || '').startsWith(chrome.runtime.getURL(''))
  const handler = ownPage ? fromPopup[message.type] : sender.tab ? fromPage[message.type] : null
  if (!handler) return false
  Promise.resolve(ownPage ? handler(message) : handler(sender, message))
    .then(reply, () => reply({ error: 'La extensión no pudo completar la operación.' }))
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void call('/api/browser/status')
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove([offerKey(tabId), identifierKey(tabId)])
})
