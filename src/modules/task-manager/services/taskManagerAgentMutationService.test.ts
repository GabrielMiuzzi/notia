import { describe, expect, it } from 'vitest'
import { resolveTaskManagerAgentGroups } from './taskManagerAgentMutationService'

describe('resolveTaskManagerAgentGroups', () => {
  it('returns only configured groups from the active board', () => {
    const groups = resolveTaskManagerAgentGroups([
      { name: 'Del Q', color: '#111111', board: 'default' },
      { name: 'Anotadores', color: '#222222', board: 'default' },
      { name: 'Otro tablero', color: '#333333', board: 'producto' },
      { name: 'Legacy default', color: '#444444' },
    ], 'default')

    expect(groups).toEqual(['Anotadores', 'Del Q', 'Legacy default'])
  })

  it('returns no groups without an active board', () => {
    expect(resolveTaskManagerAgentGroups([
      { name: 'Del Q', color: '#111111', board: 'default' },
    ], null)).toEqual([])
  })
})
