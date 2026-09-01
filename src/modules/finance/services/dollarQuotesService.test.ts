import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDollarQuotes } from './dollarQuotesService'

describe('dollarQuotesService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('maps the official, blue and card quotes from DolarApi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { casa: 'blue', nombre: 'Blue', compra: 1390, venta: 1410, fechaActualizacion: '2026-09-01T12:00:00Z' },
      { casa: 'oficial', nombre: 'Oficial', compra: 1320, venta: 1360, fechaActualizacion: '2026-09-01T12:00:00Z' },
      { casa: 'tarjeta', nombre: 'Tarjeta', compra: 1320, venta: 1768, fechaActualizacion: '2026-09-01T12:00:00Z' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(getDollarQuotes()).resolves.toEqual([
      { kind: 'oficial', name: 'Oficial', buy: 1320, sell: 1360, updatedAt: '2026-09-01T12:00:00Z' },
      { kind: 'blue', name: 'Blue', buy: 1390, sell: 1410, updatedAt: '2026-09-01T12:00:00Z' },
      { kind: 'tarjeta', name: 'Tarjeta', buy: 1320, sell: 1768, updatedAt: '2026-09-01T12:00:00Z' },
    ])
  })

  it('rejects an incomplete API response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { casa: 'oficial', nombre: 'Oficial', compra: 1320, venta: 1360, fechaActualizacion: 'now' },
    ]), { status: 200 })))

    await expect(getDollarQuotes()).rejects.toThrow('no devolvió la cotización blue')
  })
})
