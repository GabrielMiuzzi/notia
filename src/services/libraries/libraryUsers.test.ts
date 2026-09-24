import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())
vi.mock('../transport', () => ({ callBackend: invokeMock }))

import { createLibraryRole, createLibraryUser, findLibraryUser, listLibraryRoles, resolveLibraryTelegramUser, updateLibraryUserContexts } from './libraryUsers'

describe('libraryUsers service', () => {
  beforeEach(() => invokeMock.mockReset())

  it('serializes the context and role creation payload', async () => {
    invokeMock.mockResolvedValueOnce([{ id: 'role-custom', name: 'Child' }])
    const context = { libraryPath: 'C:/library', androidDirectoryUri: 'content://library' }
    await createLibraryRole(context, ' Child ')
    expect(invokeMock).toHaveBeenCalledWith('create_library_role', {
      payload: { context: { libraryPath: 'C:/library', androidDirectoryUri: 'content://library' }, name: ' Child ' },
    })
  })

  it('serializes user creation with the selected role', async () => {
    invokeMock.mockResolvedValueOnce([])
    await createLibraryUser({ libraryPath: '/library' }, 'Ana', 'role-family')
    expect(invokeMock).toHaveBeenCalledWith('create_library_user', {
      payload: { context: { libraryPath: '/library', androidDirectoryUri: undefined }, name: 'Ana', roleId: 'role-family' },
    })
  })

  it('serializes Telegram lookup payloads with the nested library context', async () => {
    invokeMock.mockResolvedValueOnce(null)
    await resolveLibraryTelegramUser({ libraryPath: '/library' }, 123, 456)
    expect(invokeMock).toHaveBeenCalledWith('resolve_library_telegram_user', {
      payload: { context: { libraryPath: '/library', androidDirectoryUri: undefined }, telegramUserId: 123, telegramChatId: 456 },
    })

    invokeMock.mockResolvedValueOnce(null)
    await findLibraryUser({ libraryPath: '/library' }, 'Ana')
    expect(invokeMock).toHaveBeenCalledWith('find_library_user', {
      payload: { context: { libraryPath: '/library', androidDirectoryUri: undefined }, name: 'Ana' },
    })
  })

  it('serializes allowed user contexts', async () => {
    invokeMock.mockResolvedValueOnce([])
    await updateLibraryUserContexts({ libraryPath: '/library' }, 'user-child', ['#Laboral', '#Confidencial'])
    expect(invokeMock).toHaveBeenCalledWith('update_library_user_contexts', {
      payload: {
        context: { libraryPath: '/library', androidDirectoryUri: undefined },
        userId: 'user-child',
        contextTags: ['#Laboral', '#Confidencial'],
      },
    })
  })

  it('exposes structured native errors without leaking payload details', async () => {
    invokeMock.mockRejectedValueOnce({ code: 'duplicate', message: 'Ya existe.' })
    await expect(listLibraryRoles({ libraryPath: '/library' })).rejects.toMatchObject({ code: 'duplicate', message: 'Ya existe.' })
  })
})
