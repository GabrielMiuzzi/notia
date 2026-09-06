import { describe, expect, it } from 'vitest'
import { hasPendingAgentAction } from './pendingAgentActionEngine'

describe('pending agent actions', () => {
  it.each([
    'Voy a analizar el documento e insertar gráficos JSXGraph en los ejercicios.',
    'Aquí está el gráfico:\n```xgraph\nboard.create("point", [1, 2]);\n```\nAhora insertaré este gráfico después del ejemplo del triángulo.',
    '**Ahora, agregaré** el contenido en la nota.',
    'Primero voy a leer el archivo.',
    'Procederé a actualizar el ticket.',
    'Listo el primer paso. Luego guardaré los cambios restantes.',
  ])('rejects an unexecuted promise: %s', (answer) => {
    expect(hasPendingAgentAction(answer)).toBe(true)
  })

  it.each([
    'Agregué el gráfico en la nota.',
    'No pude insertar el gráfico porque se canceló la operación.',
    'No voy a modificar el archivo sin autorización.',
    'Si me lo pedís, voy a insertar el gráfico.',
    'Podés insertar este código en una nota.',
    '> Voy a insertar este gráfico.\nEsa frase anuncia una acción futura.',
    '```text\nAhora insertaré este gráfico.\n```',
    '~~~text\nVoy a modificar el archivo.\n~~~',
    'Voy a explicar cómo funciona un gráfico.',
    '¿En qué ejercicio querés el gráfico?',
  ])('allows an explanation, quotation or terminal result: %s', (answer) => {
    expect(hasPendingAgentAction(answer)).toBe(false)
  })
})
