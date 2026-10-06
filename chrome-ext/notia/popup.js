// Popup: connects NotIA with the Owner's password and shows whether Notia is
// recording and whether a Teams call is being followed. The password goes to
// the background worker, which keeps only the session token.

const $ = (id) => document.getElementById(id)

const SOURCES = {
  captions: 'Hablantes por los subtítulos de Teams.',
  tiles: 'Hablantes por el contorno de los participantes. Activá los subtítulos para nombres exactos.',
}

function setState(state, text) {
  $('state').dataset.state = state
  $('state').textContent = text
}

function show(status) {
  const { connected, unreachable, library, recording, call, port, username } = status
  $('connect').hidden = Boolean(connected)
  $('connected').hidden = !connected
  $('library').textContent = connected && library ? `Biblioteca: ${library}` : 'Hablantes de Teams en Meeting'
  if (!connected) {
    setState(unreachable ? 'offline' : 'off', unreachable ? 'Sin conexión' : 'Desconectado')
    if (!$('port').value) $('port').value = port || ''
    if (!$('username').value) $('username').value = username || ''
    ;($('username').value ? $('password') : $('username')).focus()
    return
  }
  const isRecording = Boolean(recording?.recording)
  setState(isRecording ? 'on' : 'idle', isRecording ? 'Marcando' : 'Conectado')
  $('recording-dot').dataset.on = String(isRecording)
  $('recording').textContent = isRecording ? `Grabando: ${recording.title}` : 'Sin grabación en curso'
  $('recording-hint').textContent = isRecording
    ? 'Cada vez que alguien habla queda marcado con su nombre.'
    : 'Empezá a grabar en Meeting para que se marquen los hablantes.'
  $('call-dot').dataset.on = String(Boolean(call))
  $('call').textContent = call ? (call.speaker ? `En llamada · habla ${call.speaker}` : 'En llamada de Teams') : 'Sin llamada de Teams'
  $('call-hint').textContent = call
    ? SOURCES[call.source] || 'Todavía no se detectó a nadie hablando.'
    : 'Abrí la reunión en Teams para la web, en Chrome.'
}

function showError(result) {
  $('error').textContent = result?.unreachable
    ? 'No se pudo conectar. Revisá que Notia esté abierto en esta computadora, en modo Host y con ese puerto.'
    : result?.error || 'No se pudo conectar con Notia.'
  $('error').hidden = false
  setState(result?.unreachable ? 'offline' : 'off', result?.unreachable ? 'Sin conexión' : 'Desconectado')
}

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' })
  show(result?.data || {})
}

$('connect').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('error').hidden = true
  $('submit').disabled = true
  $('submit').textContent = 'Conectando…'
  const result = await chrome.runtime.sendMessage({
    type: 'connect',
    port: $('port').value,
    username: $('username').value,
    password: $('password').value,
  })
  $('password').value = ''
  $('submit').disabled = false
  $('submit').textContent = 'Conectar'
  if (result?.data) await refresh()
  else showError(result)
})

$('disconnect').addEventListener('click', async () => {
  $('disconnect').disabled = true
  await chrome.runtime.sendMessage({ type: 'disconnect' })
  $('disconnect').disabled = false
  await refresh()
})

void refresh()
setInterval(() => void refresh(), 3000)
