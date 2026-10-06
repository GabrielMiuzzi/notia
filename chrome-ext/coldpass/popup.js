// Popup: unlocks ColdPass with the Owner's password and shows the state.
// The password goes to the background worker, which sends it to Notia and
// keeps only the session token; nothing here stores it.

const $ = (id) => document.getElementById(id)

function show({ unlocked, offline, library, port, username }) {
  $('unlock').hidden = Boolean(unlocked)
  $('unlocked').hidden = !unlocked
  $('state').dataset.state = unlocked ? 'unlocked' : offline ? 'offline' : 'locked'
  $('state').textContent = unlocked ? 'Desbloqueado' : offline ? 'Sin conexión' : 'Bloqueado'
  $('library').textContent = unlocked && library ? `Biblioteca: ${library}` : 'Notia'
  $('host').textContent = port || ''
  if (!unlocked) {
    if (!$('port').value) $('port').value = port || ''
    if (!$('username').value) $('username').value = username || ''
    ;($('username').value ? $('password') : $('username')).focus()
  }
}

function showError(result) {
  const offline = Boolean(result?.unreachable)
  $('error').textContent = offline
    ? 'No se pudo conectar. Revisá que Notia esté abierto en esta computadora, en modo Host y con ese puerto.'
    : result?.error || 'No se pudo desbloquear ColdPass.'
  $('error').hidden = false
  $('state').dataset.state = offline ? 'offline' : 'locked'
  $('state').textContent = offline ? 'Sin conexión' : 'Bloqueado'
}

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' })
  show({ ...(result?.data || {}), offline: Boolean(result?.unreachable) })
}

$('unlock').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('error').hidden = true
  $('submit').disabled = true
  $('submit').textContent = 'Desbloqueando…'
  const result = await chrome.runtime.sendMessage({
    type: 'unlock',
    port: $('port').value,
    username: $('username').value,
    password: $('password').value,
  })
  $('password').value = ''
  $('submit').disabled = false
  $('submit').textContent = 'Desbloquear'
  if (result?.data) await refresh()
  else showError(result)
})

$('lock').addEventListener('click', async () => {
  $('lock').disabled = true
  await chrome.runtime.sendMessage({ type: 'lock' })
  $('lock').disabled = false
  await refresh()
})

void refresh()
