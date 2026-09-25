import { useCallback, useEffect, useState } from 'react'
import { MessageSquare, ReceiptText, Search } from 'lucide-react'
import type { NotiaLibrary } from '../../../types/notia'
import { getFinanceProducts } from '../services/financeService'
import { useFinanceResource } from '../hooks/useFinanceResource'
import { formatAmount, formatMoney, formatShortDate, formatShortMonth, formatSignedPercent, plural } from '../engines/financeFormat'
import type { FinanceProducts, ProductDetail, ProductSort, TicketRow, TicketStatus } from '../types/financeScreen'
import { FinanceReviewCard } from './FinanceReviewSection'
import { FinanceStatus } from './FinanceStatus'

const SEARCH_DELAY_MS = 250
const SORTS: Array<{ id: ProductSort; label: string }> = [
  { id: 'recent', label: 'Recientes' },
  { id: 'rising', label: 'Más subieron' },
  { id: 'az', label: 'A–Z' },
]

interface Props {
  library: NotiaLibrary
  ticketPrompt: string
  onOpenChat: (prompt: string) => void
}

export function FinanceProductsTab({ library, ticketPrompt, onOpenChat }: Props) {
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [sort, setSort] = useState<ProductSort>('recent')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search), SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const load = useCallback(() => getFinanceProducts(library, { search: appliedSearch, sort, selectedId }), [appliedSearch, library, selectedId, sort])
  const { data, error, isLoading, reload } = useFinanceResource(load, 'No se pudieron cargar los productos.')
  if (!data) return <FinanceStatus isLoading={isLoading} error={error} onRetry={reload} />
  if (data.totalCount === 0) return <ProductsEmpty data={data} onSendTicket={() => onOpenChat(ticketPrompt)} />
  return <div className="finance-products">
    {error && <FinanceStatus isLoading={false} error={error} onRetry={reload} />}
    <div className="finance-products__layout">
      <section className="finance-card finance-products__list" aria-label="Lista de productos">
        <label className="finance-search finance-search--elevated">
          <Search size={16} aria-hidden="true" />
          <span className="finance-visually-hidden">Buscar producto</span>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Leche, yerba…" />
        </label>
        <div className="finance-chips" role="group" aria-label="Ordenar productos">
          {SORTS.map((option) => <button key={option.id} type="button" className="finance-chip finance-chip--small" aria-pressed={sort === option.id} onClick={() => setSort(option.id)}>{option.label}</button>)}
        </div>
        <p className="finance-card__sub">{plural(data.products.length, 'producto')} con precio registrado</p>
        <div className="finance-products__items">
          {data.products.map((product) => <button key={product.id} type="button" className="finance-product" aria-pressed={data.selected?.id === product.id} onClick={() => setSelectedId(product.id)}>
            <span className="finance-product__main">
              <span className="finance-product__name">{product.name}</span>
              <span className="finance-card__sub">{plural(product.merchantCount, 'comercio')} · última compra {formatShortDate(product.lastDate)}</span>
            </span>
            <span className="finance-product__price">
              <strong>{product.merchantCount > 1 ? 'desde ' : ''}{formatMoney(product.fromPrice, 0)}</strong>
              {product.changePercent !== null && <span className={product.changePercent > 0 ? 'finance-warn-text finance-small' : 'finance-teal finance-small'}>{formatSignedPercent(product.changePercent)} desde {formatShortMonth(product.firstDate)}</span>}
            </span>
          </button>)}
          {data.products.length === 0 && <p className="finance-empty">Ningún producto coincide. Probá con otra palabra o preguntale al asistente.</p>}
        </div>
      </section>
      {data.selected && <ProductDetailCard detail={data.selected} onOpenChat={onOpenChat} />}
    </div>
    <TicketsCard tickets={data.tickets} />
  </div>
}

function ProductDetailCard({ detail, onOpenChat }: { detail: ProductDetail; onOpenChat: (prompt: string) => void }) {
  const { best, worst } = detail
  return <section className="finance-card finance-product-detail" aria-label="Detalle del producto">
    <div className="finance-card__head">
      <div>
        <h2 className="finance-product-detail__title">{detail.name}</h2>
        <span className="finance-card__sub">{detail.aliases.length > 0 ? `También figura como ${detail.aliases.join(' y ')}` : 'Sin otros nombres'}</span>
      </div>
      <button type="button" className="finance-button finance-button--quiet-outline finance-button--small" onClick={() => onOpenChat(detail.correctPrompt)}>Corregir en el chat</button>
    </div>
    <div className="finance-product-detail__stats">
      <div className="finance-stat finance-stat--teal">
        <span>Más barato hoy</span>
        <strong>{formatAmount(best.price, detail.currency, 0)}</strong>
        <small>{best.merchant} · {formatShortDate(best.date)}</small>
      </div>
      <div className="finance-stat">
        <span>Diferencia con el más caro</span>
        <strong>{worst?.difference ? formatAmount(worst.difference, detail.currency, 0) : '—'}</strong>
        <small>{worst ? `${worst.merchant} cobra ${formatSignedPercent(worst.differencePercent ?? 0)} más` : `Solo se compró en ${best.merchant}`}</small>
      </div>
      <div className="finance-stat">
        <span>Variación desde la primera compra</span>
        <strong className={detail.changePercent === null ? undefined : detail.changePercent > 0 ? 'finance-warn-text' : 'finance-teal'}>{detail.changePercent === null ? '—' : formatSignedPercent(detail.changePercent)}</strong>
        <small>{detail.changeMerchant ? `En ${detail.changeMerchant}, el comercio con más compras` : 'Hace falta una segunda compra'}</small>
      </div>
    </div>
    <PriceChart detail={detail} />
    <div className="finance-table-scroll">
      <table className="finance-table">
        <thead><tr><th scope="col">Comercio</th><th scope="col" className="is-number">Último precio</th><th scope="col">Fecha</th><th scope="col" className="is-number">Contra el más barato</th></tr></thead>
        <tbody>{detail.rows.map((row) => <tr key={row.merchant}>
          <td><span className="finance-legend-item__label"><i className={`finance-swatch finance-series--${seriesIndex(detail, row.merchant)}`} aria-hidden="true" />{row.merchant}</span></td>
          <td className="is-number finance-strong">{formatAmount(row.price, detail.currency, 0)}</td>
          <td className="finance-muted">{formatShortDate(row.date)}</td>
          <td className={`is-number ${row.cheapest ? 'finance-teal' : 'finance-soft-text'}`}>{row.cheapest ? 'el más barato' : `+ ${formatAmount(row.difference ?? '0', detail.currency, 0)} (${formatSignedPercent(row.differencePercent ?? 0)})`}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {detail.similar && <FinanceReviewCard card={detail.similar} onOpenChat={onOpenChat} tone="note" />}
  </section>
}

function seriesIndex(detail: ProductDetail, merchant: string): number {
  return Math.max(0, detail.series.findIndex((series) => series.merchant === merchant)) % 6
}

const CHART_WIDTH = 840
const CHART_HEIGHT = 200
const CHART_LABELS = 6

/** Price of the product at each merchant over time. */
function PriceChart({ detail }: { detail: ProductDetail }) {
  const points = detail.series.flatMap((series) => series.points)
  const times = points.map((point) => Date.parse(point.date))
  const prices = points.map((point) => Number(point.price))
  const [first, last] = [Math.min(...times), Math.max(...times)]
  const low = Math.min(...prices) * 0.97
  const high = Math.max(...prices) * 1.03
  const x = (date: string) => 12 + (last === first ? 0.5 : (Date.parse(date) - first) / (last - first)) * (CHART_WIDTH - 24)
  const y = (price: string) => CHART_HEIGHT - ((Number(price) - low) / (high - low || 1)) * (CHART_HEIGHT - 20) - 10
  const dates = [...new Set(points.map((point) => point.date))].sort()
  const labels = dates.length <= CHART_LABELS ? dates : Array.from({ length: CHART_LABELS }, (_, index) => dates[Math.round((index * (dates.length - 1)) / (CHART_LABELS - 1))])
  return <div className="finance-price-chart">
    <div className="finance-split-row">
      <h3>Precio por comercio</h3>
      <div className="finance-price-chart__legend">{detail.series.map((series, index) => <span key={series.merchant}><i className={`finance-swatch finance-swatch--round finance-series--${index % 6}`} aria-hidden="true" />{series.merchant}</span>)}</div>
    </div>
    <div className="finance-price-chart__plot">
      <span className="finance-price-chart__y finance-price-chart__y--top">{formatAmount(high, detail.currency, 0)}</span>
      <span className="finance-price-chart__y finance-price-chart__y--bottom">{formatAmount(low, detail.currency, 0)}</span>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={detail.series.map((series) => `${series.merchant}: ${series.points.map((point) => `${formatShortDate(point.date)} ${formatAmount(point.price, detail.currency, 0)}`).join(', ')}`).join('; ')}>
        <line x1="0" x2={CHART_WIDTH} y1="1" y2="1" className="finance-price-chart__grid" />
        <line x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT / 2} y2={CHART_HEIGHT / 2} className="finance-price-chart__grid" />
        {detail.series.map((series, index) => <polyline key={series.merchant} points={series.points.map((point) => `${x(point.date).toFixed(1)},${y(point.price).toFixed(1)}`).join(' ')} className={`finance-price-chart__line finance-series--${index % 6}`} />)}
      </svg>
      {/* Dots are HTML so they stay round when the plot stretches. */}
      {detail.series.flatMap((series, index) => series.points.map((point, pointIndex) => <span
        key={`${series.merchant}-${pointIndex}`}
        className={`finance-price-chart__dot finance-series--${index % 6}`}
        style={{ left: `${(x(point.date) / CHART_WIDTH) * 100}%`, top: `${y(point.price)}px` }}
        title={`${series.merchant} · ${formatShortDate(point.date)} · ${formatAmount(point.price, detail.currency, 0)}`}
      />))}
    </div>
    <div className="finance-split-row finance-card__sub finance-small">{labels.map((date) => <span key={date}>{formatShortDate(date)}</span>)}</div>
  </div>
}

const TICKET_STATUS: Record<TicketStatus, string> = {
  'card-unpaid': 'En tarjeta, a pagar',
  'paid-in-statement': 'Pagado en resumen',
  confirmed: 'Confirmado',
  pending: 'Pendiente',
  discarded: 'Descartado',
}

function TicketsCard({ tickets }: { tickets: TicketRow[] }) {
  return <section className="finance-card finance-tickets" aria-labelledby="finance-tickets-title">
    <div className="finance-card__head finance-card__head--baseline">
      <h2 id="finance-tickets-title">Tickets</h2>
      <span className="finance-card__sub">Los pagados con tarjeta cuentan recién cuando llega el resumen.</span>
    </div>
    {tickets.length === 0
      ? <p className="finance-empty">Sin tickets registrados.</p>
      : <div className="finance-table-scroll">
        <table className="finance-table finance-tickets__table">
          <thead><tr><th scope="col">Fecha</th><th scope="col">Comercio</th><th scope="col">Productos</th><th scope="col">Pago</th><th scope="col">Estado</th><th scope="col" className="is-number">Total</th></tr></thead>
          <tbody>{tickets.map((ticket) => <tr key={ticket.id}>
            <td className="finance-muted">{formatShortDate(ticket.date)}</td>
            <td>{ticket.merchant}</td>
            <td>{ticket.itemCount}</td>
            <td>{ticket.payment}</td>
            <td><span className={`finance-pill finance-pill--${ticket.status}`}>{TICKET_STATUS[ticket.status]}</span></td>
            <td className="is-number finance-strong">{formatMoney(ticket.total)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>
}

function ProductsEmpty({ data, onSendTicket }: { data: FinanceProducts; onSendTicket: () => void }) {
  const steps = [
    { title: 'Mandás el ticket', text: 'Por el chat de Notia o por Telegram, en el momento de la compra.' },
    { title: 'Lo confirmás', text: 'El asistente te muestra lo que leyó y te pregunta si un producto parecido es el mismo.' },
    { title: 'Ves los precios', text: 'Último precio por comercio e historial. Si pagaste con tarjeta, se une solo a la línea del resumen.' },
  ]
  return <div className="finance-products">
    <section className="finance-card finance-products-empty">
      <div className="finance-products-empty__icon" aria-hidden="true"><ReceiptText size={34} strokeWidth={1.8} /></div>
      <div className="finance-products-empty__copy">
        <h2>Todavía no hay productos</h2>
        <p>Mandale al asistente una foto o el PDF de un ticket. Lee cada producto con su precio y el comercio, y acá vas a poder comparar dónde conviene comprar y cómo cambian los precios.</p>
      </div>
      <ol className="finance-products-empty__steps">
        {steps.map((step, index) => <li key={step.title}><span className="finance-mono-label finance-teal">{index + 1}</span><strong>{step.title}</strong><span>{step.text}</span></li>)}
      </ol>
      <button type="button" className="finance-button finance-button--primary finance-button--large" onClick={onSendTicket}><MessageSquare size={18} aria-hidden="true" />Abrir el chat para mandar un ticket</button>
    </section>
    {data.tickets.length === 0
      ? <section className="finance-card" aria-labelledby="finance-tickets-title">
        <h2 id="finance-tickets-title">Tickets</h2>
        <p className="finance-card__sub">Sin tickets registrados. Van a aparecer acá con su comercio, forma de pago y si ya se pagaron en un resumen.</p>
      </section>
      : <TicketsCard tickets={data.tickets} />}
  </div>
}
