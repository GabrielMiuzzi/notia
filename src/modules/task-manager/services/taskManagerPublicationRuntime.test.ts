import { describe, expect, it } from 'vitest'
import { buildTaskManagerPublicationPayload } from './taskManagerPublicationRuntime'

describe('buildTaskManagerPublicationPayload', () => {
  it('includes only explicitly published active board tasks', () => {
    const payload = buildTaskManagerPublicationPayload(
      [{ name: 'equipo', color: '#123', activityHoursPerDay: 24 }, { name: 'privado', color: '#456', activityHoursPerDay: 24 }],
      [{ name: 'Sprint', color: '#111', board: 'equipo' }],
      [
        { filePath: 'tasks/equipo/a.md', fileName: 'a.md', title: 'Visible', detail: '', state: 'Pendiente', startDate: '', endDate: '', dynamicEndDate: false, board: 'equipo', group: 'Sprint', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 2, preview: '' },
        { filePath: 'tasks/privado/b.md', fileName: 'b.md', title: 'Oculta', detail: '', state: 'Pendiente', startDate: '', endDate: '', dynamicEndDate: false, board: 'privado', group: '', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 1, preview: '' },
        { filePath: 'tasks/equipo/finished/c.md', fileName: 'c.md', title: 'Finalizada', detail: '', state: 'Finalizada', startDate: '', endDate: '', dynamicEndDate: false, board: 'equipo', group: '', priority: '', dedicatedHours: 0, estimatedHours: 0, deviationHours: 0, parentTaskName: '', order: 0, preview: '' },
      ],
      ['equipo'],
      'C:/vault',
      'light',
      '$notia-pbkdf2-sha256$test',
      { ollamaUrl: 'https://ollama.example', apiKey: 'secret', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      [],
      52471,
    )

    expect(payload).toEqual({
      vaultPath: 'C:/vault',
      theme: 'light',
      passwordHash: '$notia-pbkdf2-sha256$test',
      approvedDevices: [],
      port: 52471,
      aiPreferences: { ollamaUrl: 'https://ollama.example', apiKey: 'secret', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      settings: expect.objectContaining({ boards: [expect.objectContaining({ name: 'equipo' })] }),
      boards: [{ name: 'equipo', color: '#123', groups: [{ name: 'Sprint', color: '#111' }], tasks: [expect.objectContaining({ title: 'Visible' })] }],
    })
  })

  it('restores case-insensitively persisted board selections', () => {
    const payload = buildTaskManagerPublicationPayload(
      [{ name: 'Equipo', color: '#123', activityHoursPerDay: 24 }],
      [],
      [],
      ['equipo'],
      'C:/vault',
      'dark',
      '$notia-pbkdf2-sha256$test',
      { ollamaUrl: 'https://ollama.example', apiKey: '', selectedModel: 'qwen3', thinkingEnabled: true, thinkingLevel: 'medium' },
      [],
      52471,
    )

    expect(payload.boards).toHaveLength(1)
    expect(payload.settings.activeTab).toBe('Equipo')
  })
})
