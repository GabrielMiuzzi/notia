import { describe, expect, it } from 'vitest'
import { rebaseMarkdownFrontmatter } from './frontmatterEngine'

const baseSource = `---
estado: "Pendiente"
prioridad: "Media"
---

Contenido original
`

describe('rebaseMarkdownFrontmatter', () => {
  it('keeps an unrelated remote field while applying the local field', () => {
    const result = rebaseMarkdownFrontmatter(
      baseSource,
      `---
estado: "En progreso"
prioridad: "Media"
---

Contenido remoto
`,
      { prioridad: 'Alta' },
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.content).toContain('estado: "En progreso"')
      expect(result.content).toContain('prioridad: "Alta"')
      expect(result.content).toContain('Contenido remoto')
    }
  })

  it('rejects a field changed by both authors', () => {
    expect(rebaseMarkdownFrontmatter(
      baseSource,
      `---
estado: "Finalizada"
prioridad: "Media"
---

Contenido remoto
`,
      { estado: 'Cancelada' },
    )).toEqual({ ok: false, conflictingFields: ['estado'] })
  })

  it('treats an already applied value as idempotent', () => {
    expect(rebaseMarkdownFrontmatter(
      baseSource,
      `---
estado: "Pendiente"
prioridad: "Alta"
---

Contenido remoto
`,
      { prioridad: 'Alta' },
    )).toMatchObject({ ok: true })
  })

  it('detects a conflict when a field is added independently by both authors', () => {
    expect(rebaseMarkdownFrontmatter(
      baseSource,
      `---
estado: "Pendiente"
prioridad: "Media"
tags: ["remota"]
---

Contenido remoto
`,
      { tags: ['local'] },
    )).toEqual({ ok: false, conflictingFields: ['tags'] })
  })

  it('deep-compares array fields while rebasing', () => {
    const source = `---
estado: "Pendiente"
tags: ["uno", "dos"]
---

Contenido
`

    expect(rebaseMarkdownFrontmatter(
      source,
      source.replace('Contenido', 'Contenido remoto'),
      { tags: ['uno', 'tres'] },
    )).toMatchObject({ ok: true })

    expect(rebaseMarkdownFrontmatter(
      source,
      source.replace('tags: ["uno", "dos"]', 'tags: ["uno", "remoto"]'),
      { tags: ['uno', 'tres'] },
    )).toEqual({ ok: false, conflictingFields: ['tags'] })
  })
})
