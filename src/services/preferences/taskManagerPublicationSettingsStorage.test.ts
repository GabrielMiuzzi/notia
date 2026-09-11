import { describe, expect, it } from 'vitest'
import { normalizeTaskManagerPublicationPreferences } from './taskManagerPublicationSettingsStorage'

describe('normalizeTaskManagerPublicationPreferences', () => {
  it('keeps only a PBKDF2 password hash and normalized board names', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      publishedBoardNames: [' Equipo ', 'equipo'],
      passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash',
      port: 52471,
    })).toEqual({
      publishedBoardNames: ['equipo'],
      passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash',
      accessUsers: [],
      approvedDevices: [],
      maxClients: 64,
      port: 52471,
    })
  })

  it('never treats a plaintext password as a persisted hash', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      publishedBoardNames: [],
      passwordHash: 'mi-contraseña',
    }).passwordHash).toBeNull()
  })

  it('accepts user access hashes but rejects plaintext user passwords', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      accessUsers: [
        { username: ' Ana ', passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash' },
        { username: 'Bruno', passwordHash: 'secreto-en-claro' },
      ],
    }).accessUsers).toEqual([
      { username: 'Ana', passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash' },
    ])
  })

  it('bounds the configurable number of simultaneous clients', () => {
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 120 }).maxClients).toBe(64)
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 0 }).maxClients).toBe(64)
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 3 }).maxClients).toBe(3)
  })
})
