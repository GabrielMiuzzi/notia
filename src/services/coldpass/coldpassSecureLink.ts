const COLDPASS_KDF_ITERATIONS = 120_000
const COLDPASS_SALT_LENGTH = 16
const COLDPASS_IV_LENGTH = 16

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function deriveAesKey(passkey: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = window.crypto.subtle
  const encoder = new TextEncoder()
  const baseKey = await subtle.importKey('raw', encoder.encode(passkey), 'PBKDF2', false, ['deriveKey'])

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: COLDPASS_KDF_ITERATIONS,
    },
    baseKey,
    {
      name: 'AES-CBC',
      length: 256,
    },
    false,
    ['encrypt'],
  )
}

async function encryptPayload(plaintext: string, passkey: string): Promise<{ saltHex: string; ivHex: string; cipherHex: string }> {
  const encoder = new TextEncoder()
  const salt = window.crypto.getRandomValues(new Uint8Array(COLDPASS_SALT_LENGTH))
  const iv = window.crypto.getRandomValues(new Uint8Array(COLDPASS_IV_LENGTH))
  const key = await deriveAesKey(passkey, salt)
  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-CBC',
      iv: toArrayBuffer(iv),
    },
    key,
    encoder.encode(plaintext),
  )

  return {
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    cipherHex: bytesToHex(new Uint8Array(cipherBuffer)),
  }
}

export async function createColdPassEncryptedPacket(kind: 'AUTH' | 'MSG', plaintext: string, passkey: string): Promise<string> {
  const normalizedPasskey = passkey.trim()
  if (!normalizedPasskey) {
    throw new Error('La passkey no puede estar vacia.')
  }

  const { saltHex, ivHex, cipherHex } = await encryptPayload(plaintext, normalizedPasskey)
  return [kind, String(COLDPASS_KDF_ITERATIONS), saltHex, ivHex, cipherHex].join('|')
}
