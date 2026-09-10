#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import net from 'node:net'
import { performance } from 'node:perf_hooks'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import tls from 'node:tls'

const PROTOCOL_VERSION = 1
const DEFAULT_CLIENT_COUNT = 3
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_CLIENT_COUNT = 64

function usage() {
  return `
Uso:
  NOTIA_PUBLICATION_URL=https://HOST:52471/task-manager \
  NOTIA_PUBLICATION_PASSWORD='…' \
  node scripts/task-manager-publication-e2e.mjs --insecure --clients 3

Opciones:
  --url URL                 URL base de la publicación.
  --clients N               Cantidad de clientes WebSocket (1-${MAX_CLIENT_COUNT}).
  --load-mutations N        Ejecuta N mutaciones secuenciales y mide p50/p95/p99 (1-48).
  --file ALIAS              Archivo lógico, por ejemplo published-vault/task-mannager/equipo/a.md.
  --append-comment TEXTO    Ejecuta una mutación real y valida su propagación.
  --concurrent-conflict     Envía dos comentarios con la misma revisión base.
  --reconnect               Desconecta un cliente antes de la mutación y valida replay.
  --insecure                Acepta el certificado autofirmado para una prueba LAN explícita.
  --status                  Imprime las mÃ©tricas agregadas autenticadas del host.
  --timeout-ms N             Timeout por handshake/ack/evento (default: ${DEFAULT_TIMEOUT_MS}).
  --help                    Muestra esta ayuda.

Para usar actores ya aprobados, definir NOTIA_PUBLICATION_DEVICE_IDS como una lista separada por comas.
La contraseña se lee desde NOTIA_PUBLICATION_PASSWORD o se solicita de forma interactiva.
`
}

function parseArgs(argv) {
  const options = {
    url: process.env.NOTIA_PUBLICATION_URL,
    clients: Number.parseInt(process.env.NOTIA_PUBLICATION_CLIENTS ?? `${DEFAULT_CLIENT_COUNT}`, 10),
    file: undefined,
    appendComment: undefined,
    loadMutations: Number.parseInt(process.env.NOTIA_PUBLICATION_LOAD_MUTATIONS ?? '0', 10),
    concurrentConflict: false,
    reconnect: false,
    status: false,
    insecure: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const next = () => {
      index += 1
      const value = argv[index]
      if (!value) throw new Error(`Falta un valor para ${argument}.`)
      return value
    }
    if (argument === '--help' || argument === '-h') {
      options.help = true
    } else if (argument === '--insecure') {
      options.insecure = true
    } else if (argument === '--concurrent-conflict') {
      options.concurrentConflict = true
    } else if (argument === '--load-mutations') {
      options.loadMutations = Number.parseInt(next(), 10)
    } else if (argument === '--reconnect') {
      options.reconnect = true
    } else if (argument === '--status') {
      options.status = true
    } else if (argument === '--url') {
      options.url = next()
    } else if (argument === '--clients') {
      options.clients = Number.parseInt(next(), 10)
    } else if (argument === '--file') {
      options.file = next()
    } else if (argument === '--append-comment') {
      options.appendComment = next()
    } else if (argument === '--timeout-ms') {
      options.timeoutMs = Number.parseInt(next(), 10)
    } else if (argument.startsWith('--url=')) {
      options.url = argument.slice('--url='.length)
    } else if (argument.startsWith('--clients=')) {
      options.clients = Number.parseInt(argument.slice('--clients='.length), 10)
    } else if (argument.startsWith('--file=')) {
      options.file = argument.slice('--file='.length)
    } else if (argument.startsWith('--append-comment=')) {
      options.appendComment = argument.slice('--append-comment='.length)
    } else if (argument.startsWith('--load-mutations=')) {
      options.loadMutations = Number.parseInt(argument.slice('--load-mutations='.length), 10)
    } else if (argument.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number.parseInt(argument.slice('--timeout-ms='.length), 10)
    } else {
      throw new Error(`Argumento desconocido: ${argument}`)
    }
  }

  if (!Number.isInteger(options.clients) || options.clients < 1 || options.clients > MAX_CLIENT_COUNT) {
    throw new Error(`--clients debe estar entre 1 y ${MAX_CLIENT_COUNT}.`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000) {
    throw new Error('--timeout-ms debe estar entre 1000 y 120000.')
  }
  if (!Number.isInteger(options.loadMutations) || options.loadMutations < 0 || options.loadMutations > 48) {
    throw new Error('--load-mutations debe estar entre 0 y 48 para respetar el rate limit de mutaciones.')
  }
  if (options.concurrentConflict && options.clients < 2) {
    throw new Error('--concurrent-conflict requiere al menos dos clientes.')
  }
  if (options.appendComment !== undefined && !options.file) {
    throw new Error('--append-comment requiere --file.')
  }
  if (options.loadMutations > 0 && !options.file) {
    throw new Error('--load-mutations requiere --file.')
  }
  if (options.loadMutations > 0 && options.appendComment === undefined) {
    throw new Error('--load-mutations requiere --append-comment como prefijo del comentario.')
  }
  if (options.concurrentConflict && !options.file) {
    throw new Error('--concurrent-conflict requiere --file.')
  }
  if (options.concurrentConflict && options.appendComment === undefined) {
    throw new Error('--concurrent-conflict requiere --append-comment.')
  }
  if (options.reconnect && options.appendComment === undefined) {
    throw new Error('--reconnect requiere --append-comment.')
  }
  if (options.reconnect && options.clients < 2) {
    throw new Error('--reconnect requiere al menos dos clientes.')
  }
  if (options.reconnect && options.concurrentConflict) {
    throw new Error('--reconnect no se combina con --concurrent-conflict.')
  }
  if (options.loadMutations > 0 && (options.concurrentConflict || options.reconnect)) {
    throw new Error('--load-mutations no se combina con --concurrent-conflict ni --reconnect.')
  }
  return options
}

function normalizeBaseUrl(value) {
  if (!value) throw new Error('Definí NOTIA_PUBLICATION_URL o pasá --url.')
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('La URL debe usar http o https.')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (!url.pathname) throw new Error('La URL debe incluir la ruta /task-manager.')
  url.search = ''
  url.hash = ''
  return url
}

function endpoint(baseUrl, suffix) {
  return new URL(`${baseUrl.pathname}${suffix}`, baseUrl.origin).toString()
}

function websocketEndpoint(baseUrl) {
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${baseUrl.host}${baseUrl.pathname}/ws`
}

function requestHeaders(cookie, origin, extra = {}) {
  return {
    origin,
    ...(cookie ? { cookie } : {}),
    ...extra,
  }
}

async function readPassword() {
  if (process.env.NOTIA_PUBLICATION_PASSWORD) return process.env.NOTIA_PUBLICATION_PASSWORD
  const readline = createInterface({ input, output })
  try {
    return await readline.question('Contraseña de la publicación: ')
  } finally {
    readline.close()
  }
}

async function parseJsonResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`La publicación devolvió una respuesta no JSON (HTTP ${response.status}).`)
  }
}

function responseError(response, body) {
  const detail = body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`
  return new Error(`La publicación rechazó la solicitud: ${detail}`)
}

async function registerDevice(baseUrl, deviceId, deviceName) {
  const response = await fetch(endpoint(baseUrl, '/device'), {
    method: 'POST',
    headers: requestHeaders(undefined, baseUrl.origin, { 'content-type': 'application/json' }),
    body: JSON.stringify({ deviceId, deviceName }),
  })
  const body = await parseJsonResponse(response)
  if (!response.ok) throw responseError(response, body)
  return body.approved === true
}

function sessionCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  const cookie = cookies.find((value) => value.startsWith('notia_task_session='))
  return cookie?.split(';', 1)[0]
}

async function loginDevice(baseUrl, deviceId, password) {
  const response = await fetch(endpoint(baseUrl, '/login'), {
    method: 'POST',
    headers: requestHeaders(undefined, baseUrl.origin, {
      'content-type': 'application/json',
      'x-notia-device-id': deviceId,
    }),
    body: JSON.stringify({ password }),
  })
  const body = await parseJsonResponse(response)
  if (!response.ok) throw responseError(response, body)
  const cookie = sessionCookie(response)
  if (!cookie) throw new Error('El login no devolvió una cookie de sesión.')
  return cookie
}

async function fetchJson(baseUrl, suffix, cookie, init = {}) {
  const response = await fetch(endpoint(baseUrl, suffix), {
    ...init,
    headers: requestHeaders(cookie, baseUrl.origin, init.headers),
  })
  const body = await parseJsonResponse(response)
  if (!response.ok) throw responseError(response, body)
  return body
}

function createDeviceIds(clientCount) {
  const configured = (process.env.NOTIA_PUBLICATION_DEVICE_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  if (configured.length > 0) {
    if (configured.length < clientCount) {
      throw new Error('NOTIA_PUBLICATION_DEVICE_IDS no contiene suficientes dispositivos.')
    }
    return configured.slice(0, clientCount)
  }
  return Array.from({ length: clientCount }, () => `notia-e2e-${randomUUID().replaceAll('-', '')}`)
}

function messageId() {
  return randomUUID()
}

function textByteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function eventEntry(message, receivedAt = performance.now()) {
  return { message, receivedAt }
}

class PublicationProbeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url, { cookie, origin, insecure = false } = {}) {
    this.url = new URL(url)
    this.cookie = cookie
    this.origin = origin
    this.insecure = insecure
    this.readyState = PublicationProbeSocket.CONNECTING
    this.listeners = new Map()
    this.transport = null
    this.readBuffer = Buffer.alloc(0)
    this.handshakeBuffer = Buffer.alloc(0)
    this.handshakeKey = randomBytes(16).toString('base64')
    this.fragmentOpcode = null
    this.fragmentParts = []
    this.closeSent = false
    this.closeEmitted = false
    this.start()
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      try {
        listener(event)
      } catch (error) {
        queueMicrotask(() => { throw error })
      }
    }
  }

  start() {
    const options = {
      host: this.url.hostname,
      port: Number(this.url.port) || (this.url.protocol === 'wss:' ? 443 : 80),
    }
    const onConnected = () => {
      this.transport?.setNoDelay?.(true)
      this.sendHandshake()
    }
    const onData = (chunk) => {
      if (this.readyState === PublicationProbeSocket.CLOSED) return
      if (!this.handshakeComplete) {
        this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, chunk])
        this.consumeHandshake()
        return
      }
      this.readBuffer = Buffer.concat([this.readBuffer, chunk])
      this.consumeFrames()
    }
    const onError = (error) => {
      if (this.readyState !== PublicationProbeSocket.CLOSED) this.emit('error', error)
    }
    const onClose = () => this.finishClose()

    this.handshakeComplete = false
    this.transport = this.url.protocol === 'wss:'
      ? tls.connect({ ...options, rejectUnauthorized: !this.insecure }, onConnected)
      : net.createConnection(options, onConnected)
    this.transport.on('data', onData)
    this.transport.on('error', onError)
    this.transport.on('close', onClose)
  }

  sendHandshake() {
    const host = this.url.host
    const headers = [
      `GET ${this.url.pathname}${this.url.search} HTTP/1.1`,
      `Host: ${host}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${this.handshakeKey}`,
      `Origin: ${this.origin}`,
      `Cookie: ${this.cookie}`,
      '\r\n',
    ]
    this.transport?.write(headers.join('\r\n'))
  }

  consumeHandshake() {
    const headerEnd = this.handshakeBuffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return
    const headerBytes = this.handshakeBuffer.subarray(0, headerEnd)
    this.handshakeBuffer = this.handshakeBuffer.subarray(headerEnd + 4)
    const headers = headerBytes.toString('latin1').split('\r\n')
    const status = headers[0] ?? ''
    const acceptedKey = headers.find((line) => line.toLowerCase().startsWith('sec-websocket-accept:'))
      ?.split(':', 2)[1]?.trim()
    const expectedKey = createHash('sha1')
      .update(`${this.handshakeKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')
    if (!status.includes(' 101 ') || acceptedKey !== expectedKey) {
      this.emit('error', new Error(`Handshake WebSocket rechazado: ${status}`))
      this.closeTransport()
      return
    }
    this.handshakeComplete = true
    this.readyState = PublicationProbeSocket.OPEN
    this.emit('open')
    this.readBuffer = Buffer.concat([this.readBuffer, this.handshakeBuffer])
    this.handshakeBuffer = Buffer.alloc(0)
    this.consumeFrames()
  }

  consumeFrames() {
    while (this.readBuffer.length >= 2) {
      const first = this.readBuffer[0]
      const second = this.readBuffer[1]
      const isFinal = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const isMasked = (second & 0x80) !== 0
      let payloadLength = second & 0x7f
      let offset = 2
      if (payloadLength === 126) {
        if (this.readBuffer.length < offset + 2) return
        payloadLength = this.readBuffer.readUInt16BE(offset)
        offset += 2
      } else if (payloadLength === 127) {
        if (this.readBuffer.length < offset + 8) return
        const length = this.readBuffer.readBigUInt64BE(offset)
        if (length > BigInt(2 * 1024 * 1024)) {
          this.emit('error', new Error('Frame WebSocket demasiado grande.'))
          this.closeTransport()
          return
        }
        payloadLength = Number(length)
        offset += 8
      }
      const maskLength = isMasked ? 4 : 0
      if (this.readBuffer.length < offset + maskLength + payloadLength) return
      const mask = isMasked ? this.readBuffer.subarray(offset, offset + 4) : null
      offset += maskLength
      const payload = Buffer.from(this.readBuffer.subarray(offset, offset + payloadLength))
      this.readBuffer = this.readBuffer.subarray(offset + payloadLength)
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4]
      }
      this.consumeFrame({ isFinal, opcode, payload })
    }
  }

  consumeFrame({ isFinal, opcode, payload }) {
    if (opcode === 0x9) {
      this.sendFrame(0xA, payload)
      return
    }
    if (opcode === 0xA) return
    if (opcode === 0x8) {
      if (!this.closeSent) this.sendFrame(0x8, payload)
      this.closeTransport()
      return
    }
    if (opcode === 0x1 && isFinal) {
      this.emit('message', { data: payload.toString('utf8') })
      return
    }
    if (opcode === 0x1 && !isFinal) {
      this.fragmentOpcode = opcode
      this.fragmentParts = [payload]
      return
    }
    if (opcode === 0x0 && this.fragmentOpcode !== null) {
      this.fragmentParts.push(payload)
      if (isFinal) {
        const complete = Buffer.concat(this.fragmentParts)
        if (this.fragmentOpcode === 0x1) this.emit('message', { data: complete.toString('utf8') })
        this.fragmentOpcode = null
        this.fragmentParts = []
      }
    }
  }

  sendFrame(opcode, payload) {
    if (this.readyState !== PublicationProbeSocket.OPEN && opcode !== 0x8) {
      throw new Error('El WebSocket del probe no está abierto.')
    }
    const body = Buffer.from(payload)
    const mask = randomBytes(4)
    const maskedBody = Buffer.from(body)
    for (let index = 0; index < maskedBody.length; index += 1) maskedBody[index] ^= mask[index % 4]
    let header
    if (maskedBody.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | maskedBody.length])
    } else if (maskedBody.length <= 0xffff) {
      header = Buffer.alloc(4)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 126
      header.writeUInt16BE(maskedBody.length, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x80 | opcode
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(maskedBody.length), 2)
    }
    this.transport?.write(Buffer.concat([header, mask, maskedBody]))
  }

  send(value) {
    this.sendFrame(0x1, Buffer.from(value, 'utf8'))
  }

  close() {
    if (this.readyState === PublicationProbeSocket.CLOSED) return
    if (this.readyState === PublicationProbeSocket.OPEN) {
      this.readyState = PublicationProbeSocket.CLOSING
      if (!this.closeSent) {
        this.closeSent = true
        this.sendFrame(0x8, Buffer.alloc(0))
      }
    }
    this.closeTransport()
  }

  closeTransport() {
    this.transport?.end()
    this.transport?.destroy()
  }

  finishClose() {
    if (this.closeEmitted) return
    this.closeEmitted = true
    this.readyState = PublicationProbeSocket.CLOSED
    this.emit('close')
  }
}

class PublicationProbe {
  constructor({ baseUrl, cookie, deviceId, timeoutMs, insecure }) {
    this.baseUrl = baseUrl
    this.cookie = cookie
    this.deviceId = deviceId
    this.timeoutMs = timeoutMs
    this.insecure = insecure
    this.publicationEpoch = ''
    this.sequence = 0
    this.revision = 0
    this.socket = null
    this.entries = []
    this.waiters = []
    this.sentBytes = 0
    this.receivedBytes = 0
    this.resyncRequired = 0
  }

  async connect() {
    const socket = new PublicationProbeSocket(websocketEndpoint(this.baseUrl), {
      cookie: this.cookie,
      origin: this.baseUrl.origin,
      insecure: this.insecure,
    })
    this.socket = socket
    let welcomed = false
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        socket.close()
        reject(new Error(`Timeout esperando welcome para ${this.deviceId}.`))
      }, this.timeoutMs)
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      socket.addEventListener('open', () => {
        this.send({
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          messageId: messageId(),
          publicationEpoch: this.publicationEpoch || undefined,
          lastSequence: this.sequence,
        })
      })
      socket.addEventListener('message', (event) => {
        void this.handleMessage(event.data).then((message) => {
          if (message?.type === 'welcome') {
            welcomed = true
            finish()
          }
        }).catch(finish)
      })
      socket.addEventListener('error', () => {
        if (!welcomed) finish(new Error(`Falló el WebSocket de ${this.deviceId}.`))
      })
      socket.addEventListener('close', () => {
        if (!welcomed) finish(new Error(`El WebSocket de ${this.deviceId} se cerró durante el handshake.`))
      })
    })
  }

  async handleMessage(data) {
    const raw = typeof data === 'string' ? data : await data.text()
    this.receivedBytes += textByteLength(raw)
    const message = JSON.parse(raw)
    const entry = eventEntry(message)
    this.entries.push(entry)
    if (typeof message.publicationEpoch === 'string' && message.publicationEpoch) {
      this.publicationEpoch = message.publicationEpoch
    }
    if (Number.isSafeInteger(message.sequence) && message.sequence >= this.sequence) {
      this.sequence = message.sequence
    }
    if (Number.isSafeInteger(message.revision) && message.revision >= this.revision) {
      this.revision = message.revision
    }
    if (message.type === 'resync-required') this.resyncRequired += 1
    const pending = this.waiters.filter((waiter) => waiter.predicate(message))
    this.waiters = this.waiters.filter((waiter) => !pending.includes(waiter))
    pending.forEach((waiter) => {
      clearTimeout(waiter.timer)
      waiter.resolve(entry)
    })
    return message
  }

  send(message) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error(`El WebSocket de ${this.deviceId} no está abierto.`)
    }
    const serialized = JSON.stringify(message)
    this.sentBytes += textByteLength(serialized)
    this.socket.send(serialized)
  }

  waitFor(predicate, label) {
    const existing = this.entries.find((entry) => predicate(entry.message))
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter.resolve !== resolve)
        reject(new Error(`Timeout esperando ${label} en ${this.deviceId}.`))
      }, this.timeoutMs)
      this.waiters.push({ predicate, resolve, reject, timer })
    })
  }

  sendMutation(command, args, operationId = messageId()) {
    const ack = this.waitFor(
      (message) => message.type === 'ack' && message.operationId === operationId,
      `ack ${operationId}`,
    )
    this.send({
      type: 'mutate',
      protocolVersion: PROTOCOL_VERSION,
      messageId: messageId(),
      operationId,
      baseRevision: this.revision,
      command,
      args,
    })
    return ack
  }

  close() {
    this.socket?.close()
    this.socket = null
  }
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message)
}

function printServerStatus(status, label) {
  console.log(`Estado host (${label}): sesiones=${status.authenticatedSessions}, websockets=${status.websocketSessions}, revision=${status.revision}, sequence=${status.sequence}, bytesIn=${status.websocketBytesReceived}, bytesOut=${status.websocketBytesSent}, resync=${status.resyncRequired}, conflictos=${status.conflicts}, mutaciones=${status.mutationsApplied}, errores=${status.mutationErrors}, p95Mutacion=${status.mutationLatencyP95Ms ?? 'n/a'}ms, recovery=${status.recoveryRequired}.`)
}

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function verifyConvergence(baseUrl, probes, file) {
  const bootstraps = await Promise.all(probes.map((probe) => (
    fetchJson(baseUrl, '/bootstrap', probe.cookie, { cache: 'no-store' })
  )))
  const revisions = new Set(bootstraps.map((bootstrap) => bootstrap.revision))
  assertOk(revisions.size === 1, `Los clientes no convergieron en revision: ${[...revisions].join(', ')}.`)

  if (!file) return { revision: bootstraps[0]?.revision ?? 0 }
  const results = await Promise.all(probes.map((probe) => fetchJson(baseUrl, '/invoke', probe.cookie, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'read_library_file', args: { payload: { filePath: file } } }),
  })))
  assertOk(results.every((body) => body.result?.ok === true), 'La lectura convergente fue rechazada por el servidor.')
  const contents = results.map((body) => body.result?.content)
  assertOk(contents.every((content) => typeof content === 'string'), 'La lectura convergente no devolvió contenido.')
  const hashes = new Set(contents.map((content) => sha256(content)))
  assertOk(hashes.size === 1, 'Los clientes no convergieron en el contenido del archivo.')
  return {
    revision: bootstraps[0]?.revision ?? 0,
    fileRevision: results[0]?.result?.revision ?? null,
    contentHash: [...hashes][0],
  }
}

async function runMutation(probes, file, comment, timeoutMs, reconnectProbe) {
  const operationId = `e2e-${randomUUID()}`
  reconnectProbe?.close()
  const onlineProbes = probes.filter((probe) => probe !== reconnectProbe)
  const eventWaits = onlineProbes.map((probe) => probe.waitFor(
    (message) => message.type === 'changed' && message.operationId === operationId,
    `changed ${operationId}`,
  ))
  const startedAt = performance.now()
  const ack = await probes[0].sendMutation('append_task_comment', {
    payload: { filePath: file, comment },
  }, operationId)
  assertOk(ack.message.ok === true, `La mutación E2E fue rechazada: ${ack.message.error ?? 'error desconocido'}.`)
  const events = await Promise.all(eventWaits)
  if (reconnectProbe) {
    const replayWait = reconnectProbe.waitFor(
      (message) => message.type === 'changed' && message.operationId === operationId,
      `replay ${operationId}`,
    )
    await reconnectProbe.connect()
    events.push(await replayWait)
  }
  assertOk(events.length === probes.length, 'No todos los clientes recibieron el cambio aplicado.')
  assertOk(probes.every((probe) => (
    probe.entries.filter((entry) => entry.message.type === 'changed' && entry.message.operationId === operationId).length === 1
  )), 'Algún cliente recibió el cambio más de una vez.')
  const propagationMs = events.map((event) => event.receivedAt - startedAt)
  assertOk(propagationMs.every((value) => value <= timeoutMs), 'Un cliente superó el timeout de propagación.')
  return { ack: ack.message, events, propagationMs }
}

async function runConcurrentConflict(probes, file, comment, timeoutMs) {
  const operationIds = [`e2e-${randomUUID()}`, `e2e-${randomUUID()}`]
  const eventWaits = probes.map((probe) => probe.waitFor(
    (message) => message.type === 'changed' && operationIds.includes(message.operationId),
    `changed concurrente ${operationIds.join(',')}`,
  ))
  const firstComment = `${comment} [actor-0]`
  const secondComment = `${comment} [actor-1]`
  const first = probes[0].sendMutation('append_task_comment', {
    payload: { filePath: file, comment: firstComment },
  }, operationIds[0])
  const second = probes[1].sendMutation('append_task_comment', {
    payload: { filePath: file, comment: secondComment },
  }, operationIds[1])
  const [firstAck, secondAck] = await Promise.all([first, second])
  const applied = [firstAck.message, secondAck.message].filter((ack) => ack.ok === true)
  const conflicts = [firstAck.message, secondAck.message].filter((ack) => ack.ok === false && ack.conflict)
  assertOk(applied.length === 1, `La concurrencia esperaba una sola mutación aplicada y obtuvo ${applied.length}.`)
  assertOk(conflicts.length === 1, 'La concurrencia no devolvió exactamente un conflicto recuperable.')
  const events = await Promise.all(eventWaits)
  const appliedOperationId = applied[0]?.operationId
  assertOk(typeof appliedOperationId === 'string', 'La mutación aplicada no devolvió operationId.')
  assertOk(probes.every((probe) => (
    probe.entries.filter((entry) => entry.message.type === 'changed' && entry.message.operationId === appliedOperationId).length === 1
  )), 'Algún cliente recibió el cambio concurrente más de una vez.')
  const propagationMs = events.map((event) => event.receivedAt - Math.min(firstAck.receivedAt, secondAck.receivedAt))
  assertOk(propagationMs.every((value) => value <= timeoutMs), 'Un cliente superó el timeout de propagación concurrente.')
  return { first: firstAck.message, second: secondAck.message, events, propagationMs }
}

async function runLoad(probes, file, commentPrefix, mutationCount, timeoutMs) {
  const propagationMs = []
  for (let index = 0; index < mutationCount; index += 1) {
    const operationId = `e2e-load-${randomUUID()}`
    const eventWaits = probes.map((probe) => probe.waitFor(
      (message) => message.type === 'changed' && message.operationId === operationId,
      `changed ${operationId}`,
    ))
    const probe = probes[index % probes.length]
    const startedAt = performance.now()
    const ack = await probe.sendMutation('append_task_comment', {
      payload: { filePath: file, comment: `${commentPrefix} #${index + 1}` },
    }, operationId)
    assertOk(ack.message.ok === true, `La mutacion de carga ${index + 1} fue rechazada: ${ack.message.error ?? 'error desconocido'}.`)
    const events = await Promise.all(eventWaits)
    const samples = events.map((event) => event.receivedAt - startedAt)
    assertOk(samples.every((value) => value <= timeoutMs), `La mutacion de carga ${index + 1} supero el timeout de propagacion.`)
    propagationMs.push(...samples)
  }
  return { propagationMs }
}

function processResourceSnapshot() {
  const memory = process.memoryUsage()
  const usage = process.resourceUsage()
  return {
    rssMb: memory.rss / 1024 / 1024,
    heapUsedMb: memory.heapUsed / 1024 / 1024,
    cpuUserMs: usage.userCPUTime / 1000,
    cpuSystemMs: usage.systemCPUTime / 1000,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    console.warn('ADVERTENCIA: se deshabilitó la validación TLS solo para esta prueba explícita.')
  }

  const baseUrl = normalizeBaseUrl(options.url)
  const password = await readPassword()
  assertOk(password.length > 0, 'La contraseña no puede estar vacía.')
  const deviceIds = createDeviceIds(options.clients)
  const probes = []
  try {
    const registrations = await Promise.all(deviceIds.map((deviceId, index) => (
      registerDevice(baseUrl, deviceId, `notia-e2e-client-${index}`)
    )))
    const pending = deviceIds.filter((_deviceId, index) => !registrations[index])
    if (pending.length > 0) {
      throw new Error(`Dispositivos pendientes de aprobación: ${pending.join(', ')}. Aprobá esos IDs en Notia y repetí la prueba.`)
    }
    const cookies = await Promise.all(deviceIds.map((deviceId) => loginDevice(baseUrl, deviceId, password)))
    const bootstraps = await Promise.all(cookies.map((cookie) => (
      fetchJson(baseUrl, '/bootstrap', cookie, { cache: 'no-store' })
    )))
    const initialServerStatus = options.status
      ? await fetchJson(baseUrl, '/status', cookies[0], { cache: 'no-store' })
      : null
    cookies.forEach((cookie, index) => {
      probes.push(new PublicationProbe({
        baseUrl,
        cookie,
        deviceId: deviceIds[index],
        timeoutMs: options.timeoutMs,
        insecure: options.insecure,
      }))
    })
    await Promise.all(probes.map((probe) => probe.connect()))
    assertOk(probes.every((probe) => probe.publicationEpoch === bootstraps[0]?.publicationEpoch), 'Los clientes no comparten la misma publicationEpoch.')
    console.log(`Conectados ${probes.length} clientes; epoch=${probes[0]?.publicationEpoch} revision=${probes[0]?.revision}.`)
    if (options.status) printServerStatus(initialServerStatus, 'inicial')

    if (options.appendComment !== undefined) {
      if (options.concurrentConflict) {
        const result = await runConcurrentConflict(probes, options.file, options.appendComment, options.timeoutMs)
        const metrics = result.propagationMs
        console.log(`Conflicto concurrente verificado: applied=${result.first.ok ? result.first.operationId : result.second.operationId}, conflict=${result.first.ok ? result.second.operationId : result.first.operationId}.`)
        console.log(`Propagación WebSocket (sin render): p50=${percentile(metrics, 0.5).toFixed(1)}ms p95=${percentile(metrics, 0.95).toFixed(1)}ms p99=${percentile(metrics, 0.99).toFixed(1)}ms.`)
      } else if (options.loadMutations > 0) {
        const startedResources = processResourceSnapshot()
        const result = await runLoad(probes, options.file, options.appendComment, options.loadMutations, options.timeoutMs)
        const endedResources = processResourceSnapshot()
        const metrics = result.propagationMs
        console.log(`Carga colaborativa verificada: mutaciones=${options.loadMutations}, muestras=${metrics.length}.`)
        console.log(`Propagacion WebSocket (sin render): p50=${percentile(metrics, 0.5).toFixed(1)}ms p95=${percentile(metrics, 0.95).toFixed(1)}ms p99=${percentile(metrics, 0.99).toFixed(1)}ms.`)
        console.log(`Recursos del probe: rss=${endedResources.rssMb.toFixed(1)}MB heap=${endedResources.heapUsedMb.toFixed(1)}MB cpuUser=${(endedResources.cpuUserMs - startedResources.cpuUserMs).toFixed(1)}ms cpuSystem=${(endedResources.cpuSystemMs - startedResources.cpuSystemMs).toFixed(1)}ms.`)
      } else {
        const result = await runMutation(
          probes,
          options.file,
          options.appendComment,
          options.timeoutMs,
          options.reconnect ? probes.at(-1) : undefined,
        )
        console.log(`Mutación aplicada: operationId=${result.ack.operationId}, revision=${result.ack.revision}.`)
        console.log(`Propagación WebSocket (sin render): p50=${percentile(result.propagationMs, 0.5).toFixed(1)}ms p95=${percentile(result.propagationMs, 0.95).toFixed(1)}ms p99=${percentile(result.propagationMs, 0.99).toFixed(1)}ms.`)
        if (options.reconnect) console.log('Reconexión con replay verificada.')
      }
      const convergence = await verifyConvergence(baseUrl, probes, options.file)
      console.log(`Convergencia verificada: revision=${convergence.revision}, fileRevision=${convergence.fileRevision}, sha256=${convergence.contentHash}.`)
    }

    const sentBytes = probes.reduce((total, probe) => total + probe.sentBytes, 0)
    const receivedBytes = probes.reduce((total, probe) => total + probe.receivedBytes, 0)
    const resyncs = probes.reduce((total, probe) => total + probe.resyncRequired, 0)
    console.log(`Métricas del probe: sentBytes=${sentBytes}, receivedBytes=${receivedBytes}, resyncRequired=${resyncs}.`)
    if (options.status) {
      const finalServerStatus = await fetchJson(baseUrl, '/status', cookies[0], { cache: 'no-store' })
      printServerStatus(finalServerStatus, 'final')
    }
  } finally {
    probes.forEach((probe) => probe.close())
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
