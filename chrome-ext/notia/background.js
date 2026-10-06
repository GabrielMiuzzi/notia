// NotIA: sends who is speaking in a Microsoft Teams call to Notia's Meeting
// while it records, through the Host mode server on this computer (plain
// HTTP on 127.0.0.1, which Notia serves that way only to this computer).
// The session token lives in chrome.storage.session: only the extension's
// own pages and this worker read it, and Chrome clears it when it closes.

const DEFAULT_PORT = 52480
const KEEPALIVE_ALARM = 'notia-call-keepalive'
// Notia ends a session after 12 h without use; this renews it while Chrome is open.
const KEEPALIVE_MINUTES = 30
// How long a known recording is trusted before asking Notia again.
const STATUS_TTL_MS = 5000

async function hostPort() {
  const { port } = await chrome.storage.local.get('port')
  return Number(port) || DEFAULT_PORT
}

function validPort(value) {
  const port = Number(String(value || '').trim())
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null
}

/** POSTs to Notia's NotIA routes: `{ data }`, `{ locked }`, `{ unreachable }` or `{ error }`. */
async function call(path, body = {}) {
  const isLogin = path === '/api/meeting-call/login'
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
  await chrome.storage.session.remove(['token', 'library', 'recording'])
  await chrome.alarms.clear(KEEPALIVE_ALARM)
}

/** The recording Notia is making now, asked again after a few seconds. */
async function recording(fresh = false) {
  const { recording: known } = await chrome.storage.session.get('recording')
  if (known && !fresh && Date.now() - known.at < STATUS_TTL_MS) return known
  const result = await call('/api/meeting-call/status')
  const next = result.data
    ? { recording: Boolean(result.data.recording), meetingId: result.data.meetingId || null, title: result.data.title || '', at: Date.now() }
    : { recording: false, meetingId: null, title: '', at: Date.now(), locked: Boolean(result.locked), unreachable: Boolean(result.unreachable) }
  await chrome.storage.session.set({ recording: next })
  return next
}

async function connect({ port, username, password }) {
  const chosen = validPort(port)
  if (!chosen) return { error: 'El puerto tiene que ser un número entre 1 y 65535.' }
  await chrome.storage.local.set({ port: chosen, username: String(username || '').trim() })
  const result = await call('/api/meeting-call/login', { username: String(username || '').trim(), password: String(password || '') })
  if (!result.data) return result
  await chrome.storage.session.set({ token: result.data.token, library: result.data.library || '' })
  await chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES })
  return { data: { ok: true } }
}

async function disconnect() {
  await call('/api/meeting-call/logout')
  await endSession()
  return { data: { ok: true } }
}

/** What the popup shows: the connection, Notia's recording and the call of each Teams tab. */
async function popupStatus() {
  const { username } = await chrome.storage.local.get('username')
  const { token, library } = await chrome.storage.session.get(['token', 'library'])
  const calls = Object.values(await chrome.storage.session.get(null))
    .filter((value) => value && value.kind === 'call')
    .sort((a, b) => b.at - a.at)
  const base = { port: await hostPort(), username: username || '', call: calls[0] || null }
  if (!token) return { data: { ...base, connected: false } }
  const now = await recording(true)
  if (now.locked) return { data: { ...base, connected: false } }
  return { data: { ...base, connected: !now.unreachable, unreachable: now.unreachable, library, recording: now } }
}

/** A Teams tab reports who spoke: sent to the recording in progress, if any. */
async function speech(sender, items) {
  const clean = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item.name === 'string' && Number.isFinite(item.startedAt) && Number.isFinite(item.endedAt))
    .slice(0, 200)
  if (clean.length === 0) return { data: { recording: false } }
  let now = await recording()
  if (!now.recording) return { data: { recording: false } }
  let result = await call('/api/meeting-call/speech', { meetingId: now.meetingId, speech: clean })
  if (result.data && !result.data.recording) {
    // That recording ended; another may have started.
    now = await recording(true)
    if (now.recording) result = await call('/api/meeting-call/speech', { meetingId: now.meetingId, speech: clean })
  }
  return result.data ? { data: { recording: Boolean(result.data.recording) } } : result
}

async function callState(sender, message) {
  const key = `call:${sender.tab.id}`
  if (!message.inCall) {
    await chrome.storage.session.remove(key)
    return { data: { ok: true } }
  }
  await chrome.storage.session.set({
    [key]: { kind: 'call', source: message.source || null, speaker: message.speaker || '', at: Date.now() },
  })
  return { data: { ok: true } }
}

const fromPopup = {
  status: () => popupStatus(),
  connect: (message) => connect(message),
  disconnect: () => disconnect(),
}

const fromPage = {
  speech: (sender, message) => speech(sender, message.items),
  'call-state': (sender, message) => callState(sender, message),
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false
  const ownPage = String(sender.url || '').startsWith(chrome.runtime.getURL(''))
  const handler = ownPage ? fromPopup[message.type] : sender.tab ? fromPage[message.type] : null
  if (!handler) return false
  Promise.resolve(ownPage ? handler(message) : handler(sender, message))
    .then(reply, () => reply({ error: 'La extensión no pudo completar la operación.' }))
  return true
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) void call('/api/meeting-call/status')
})

chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`call:${tabId}`)
})
