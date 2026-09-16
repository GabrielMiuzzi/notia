import { describe, expect, it } from 'vitest'
import { normalizeTaskManagerPublicationPreferences } from './taskManagerPublicationSettingsStorage'

describe('normalizeTaskManagerPublicationPreferences', () => {
  it('keeps only board names and publication limits', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      publishedBoardNames: [' Equipo ', 'equipo'],
      port: 52471,
    })).toEqual({
      publishedBoardNames: ['equipo'],
      maxClients: 64,
      port: 52471,
    })
  })

  it('ignores legacy publication passwords', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      publishedBoardNames: [],
      passwordHash: 'mi-contraseña',
    })).toEqual({ publishedBoardNames: [], port: 52471, maxClients: 64 })
  })

  it('ignores legacy publication users', () => {
    expect(normalizeTaskManagerPublicationPreferences({
      accessUsers: [
        { username: ' Ana ', passwordHash: '$notia-pbkdf2-sha256$v=1$i=210000$salt$hash' },
        { username: 'Bruno', passwordHash: 'secreto-en-claro' },
      ],
    })).toEqual({ publishedBoardNames: [], port: 52471, maxClients: 64 })
  })

  it('bounds the configurable number of simultaneous clients', () => {
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 120 }).maxClients).toBe(64)
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 0 }).maxClients).toBe(64)
    expect(normalizeTaskManagerPublicationPreferences({ maxClients: 3 }).maxClients).toBe(3)
  })
})
