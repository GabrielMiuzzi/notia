/**
 * Generates a UUID v4 that works in all environments (browser, Tauri, Node.js).
 * Falls back to a manual implementation if crypto.randomUUID is not available.
 */
export function generateUUID(): string {
  // Try crypto.randomUUID first (available in secure contexts)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback: manual UUID v4 generation
  const hexDigits = '0123456789abcdef'
  const randomValues = new Uint8Array(16)

  // Fill with random values
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValues)
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < 16; i++) {
      randomValues[i] = Math.floor(Math.random() * 256)
    }
  }

  // Set version (4) and variant bits
  randomValues[6] = (randomValues[6] & 0x0f) | 0x40 // Version 4
  randomValues[8] = (randomValues[8] & 0x3f) | 0x80 // Variant 10

  // Convert to UUID string
  let uuid = ''
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) {
      uuid += '-'
    }
    uuid += hexDigits[randomValues[i] >> 4]
    uuid += hexDigits[randomValues[i] & 0x0f]
  }

  return uuid
}
