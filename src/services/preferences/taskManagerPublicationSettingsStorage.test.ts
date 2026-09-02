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
      approvedDevices: [],
      port: 52471,
    })
  })

  it('never treats a plaintext password as a persisted hash', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      publishedBoardNames: [],
      passwordHash: 'mi-contraseña',
    }).passwordHash).toBeNull()
  })
})
