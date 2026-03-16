const ENCRYPTED_HEADER = '<!-- NOTIA_COLDPASS_AES256_PBKDF2_V1 -->'
const PBKDF2_ITERATIONS = 250_000
const SALT_LENGTH = 16
const IV_LENGTH = 12

interface ColdPassEncryptedPayload {
  salt: string
  iv: string
  ciphertext: string
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function deriveAesKey(passkey: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passkey),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  )
}

function parseEncryptedMarkdown(content: string): ColdPassEncryptedPayload {
  const normalized = content.trim()
  if (!normalized.startsWith(ENCRYPTED_HEADER)) {
    throw new Error('ColdPass file is not encrypted with the expected format.')
  }

  const lines = normalized.split(/\r?\n/).slice(1)
  const payload = new Map<string, string>()
  for (const line of lines) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    payload.set(key, value)
  }

  const salt = payload.get('salt')
  const iv = payload.get('iv')
  const ciphertext = payload.get('ciphertext')
  if (!salt || !iv || !ciphertext) {
    throw new Error('ColdPass encrypted payload is incomplete.')
  }

  return { salt, iv, ciphertext }
}

export async function encryptColdPassMarkdown(plaintext: string, passkey: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveAesKey(passkey, salt)
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
    },
    key,
    encoder.encode(plaintext),
  )

  return [
    ENCRYPTED_HEADER,
    `salt: ${encodeBase64(salt)}`,
    `iv: ${encodeBase64(iv)}`,
    `ciphertext: ${encodeBase64(new Uint8Array(ciphertext))}`,
  ].join('\n')
}

export async function decryptColdPassMarkdown(content: string, passkey: string): Promise<string> {
  const decoder = new TextDecoder()
  const payload = parseEncryptedMarkdown(content)

  try {
    const salt = decodeBase64(payload.salt)
    const iv = decodeBase64(payload.iv)
    const ciphertext = decodeBase64(payload.ciphertext)
    const key = await deriveAesKey(passkey, salt)
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
      },
      key,
      toArrayBuffer(ciphertext),
    )

    return decoder.decode(decrypted)
  } catch {
    throw new Error('Invalid passkey or corrupted ColdPass file.')
  }
}
