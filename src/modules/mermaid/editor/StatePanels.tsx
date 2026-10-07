import { useState } from 'react'
import { ArrowLeft, ArrowLeftRight, ArrowRight, ChevronDown, CircleDot, MoreHorizontal, Plus, StickyNote, Trash2, Zap } from 'lucide-react'
import { CommitInput, EmptyInspector, Field, InspectorHeader, Section, Segmented, Swatches, SyntaxBox } from './editorParts'
import { STATE_KINDS, STATE_SWATCHES } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { StateModel, StateNode, Transition } from './mermaidEditorTypes'

/* State diagrams: inspector and floating menus (canvas board «Estados»). */

const PSEUDO = '[*]'

const labelOf = (model: StateModel, id: string) => (id === PSEUDO ? PSEUDO : model.states.find((state) => state.id === id)?.label ?? id)
const colorOf = (model: StateModel, id: string) => (id === PSEUDO ? 'var(--color-muted-text)' : model.states.find((state) => state.id === id)?.color ?? STATE_SWATCHES[0].color)

function syntaxOf(transition: Transition) {
  return `${transition.from} --> ${transition.to}${transition.event ? ` : ${transition.event}` : ''}`
}

function StateChip({ api, id }: { api: EditorApi<StateModel>; id: string }) {
  return (
    <button
      type="button"
      className="mmd-chip"
      style={{ boxShadow: `inset 3px 0 0 ${colorOf(api.model, id)}` }}
      disabled={id === PSEUDO}
      onClick={() => api.select({ kind: 'state', key: id })}
    >
      {labelOf(api.model, id)}
    </button>
  )
}

function StateInspectorBody({ api, state }: { api: EditorApi<StateModel>; state: StateNode }) {
  const swatch = STATE_SWATCHES.find((candidate) => candidate.color.toUpperCase() === state.color?.toUpperCase())
  const incoming = api.model.transitions.filter((transition) => transition.to === state.id)
  const outgoing = api.model.transitions.filter((transition) => transition.from === state.id)
  return (
    <>
      <Section>
        <Field label="Nombre">
          <CommitInput value={state.label} label="Nombre del estado" onCommit={(label) => void api.edit('setStateLabel', { id: state.id, label })} />
        </Field>
        <span className="mmd-id-row">id: {state.id}</span>
        <Field label={<>Color · <strong>{swatch?.name ?? 'Sin color'}</strong></>}>
          <Swatches swatches={STATE_SWATCHES} value={state.color} onChange={(color) => void api.edit('setStateColor', { id: state.id, color })} />
        </Field>
        <Field label="Tipo">
          <Segmented label="Tipo de estado" options={STATE_KINDS} value={state.kind} onChange={(kind) => void api.edit('setStateKind', { id: state.id, kind })} />
        </Field>
      </Section>
      <Section title="Transiciones">
        {[...incoming.map((transition) => ({ transition, incoming: true })), ...outgoing.map((transition) => ({ transition, incoming: false }))].map(({ transition, incoming: from }) => (
          <button key={transition.index} type="button" className="mmd-row-button" onClick={() => api.select({ kind: 'transition', key: String(transition.index) })}>
            {from ? <ArrowLeft size={14} aria-hidden="true" /> : <ArrowRight size={14} aria-hidden="true" />}
            <span className="mmd-subtle">{from ? 'desde' : 'hacia'}</span>
            <span>{labelOf(api.model, from ? transition.from : transition.to)}</span>
            <small>{transition.event}</small>
          </button>
        ))}
        <button type="button" className="mmd-dashed-button" onClick={() => api.startLink(state.id)}><Plus size={14} aria-hidden="true" />Nueva transición</button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="mmd-ghost-button" style={{ flex: 1 }} onClick={() => void api.edit('addStart', { to: state.id })}>Desde inicio</button>
          <button type="button" className="mmd-ghost-button" style={{ flex: 1 }} onClick={() => void api.edit('addEnd', { from: state.id })}>Hacia fin</button>
        </div>
      </Section>
      <Section>
        <button type="button" className="mmd-ghost-button" onClick={() => void api.edit('addNote', { id: state.id })}><StickyNote size={14} aria-hidden="true" />Agregar nota</button>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteState', { id: state.id }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar estado</button>
      </Section>
    </>
  )
}

function TransitionInspector({ api, transition }: { api: EditorApi<StateModel>; transition: Transition }) {
  return (
    <>
      <Section>
        <div className="mmd-chip-row">
          <StateChip api={api} id={transition.from} />
          <ArrowRight size={14} aria-hidden="true" style={{ color: 'var(--color-muted-text)', flexShrink: 0 }} />
          <StateChip api={api} id={transition.to} />
        </div>
      </Section>
      <Section>
        <Field label="Evento">
          <CommitInput value={transition.event} label="Evento" placeholder="Sin evento" onCommit={(event) => void api.edit('setTransitionEvent', { index: transition.index, event })} />
        </Field>
        <button type="button" className="mmd-ghost-button" onClick={() => void api.edit('swapTransition', { index: transition.index })}><ArrowLeftRight size={14} aria-hidden="true" />Invertir sentido</button>
        <Field label="Sintaxis"><SyntaxBox text={syntaxOf(transition)} /></Field>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteTransition', { index: transition.index }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar transición</button>
      </Section>
    </>
  )
}

export function StateInspector({ api }: { api: EditorApi<StateModel> }) {
  const id = selectionIs(api.selection, 'state')
  const index = selectionIs(api.selection, 'transition')
  const state = id ? api.model.states.find((candidate) => candidate.id === id) : undefined
  const transition = index !== null ? api.model.transitions[Number(index)] : undefined
  return (
    <>
      <InspectorHeader title={transition ? 'Transición' : state ? 'Estado' : 'Propiedades'} onClear={state || transition ? () => api.select(null) : undefined} />
      {state ? <StateInspectorBody key={state.id} api={api} state={state} />
        : transition ? <TransitionInspector key={transition.index} api={api} transition={transition} />
          : (
            <EmptyInspector
              text="Hacé clic en un estado o en una transición para editarlo."
              counts={[{ label: 'Estados', value: api.model.states.length }, { label: 'Transiciones', value: api.model.transitions.length }]}
            />
          )}
    </>
  )
}

export function StateContextMenu({ api }: { api: EditorApi<StateModel> }) {
  const [open, setOpen] = useState<'color' | 'more' | null>(null)
  const id = selectionIs(api.selection, 'state')
  const index = selectionIs(api.selection, 'transition')
  const state = id ? api.model.states.find((candidate) => candidate.id === id) : undefined
  const transition = index !== null ? api.model.transitions[Number(index)] : undefined
  if (state) {
    return (
      <>
        <div className="mmd-menu">
          <button type="button" className="mmd-context-text" title="Color" aria-expanded={open === 'color'} onClick={() => setOpen(open === 'color' ? null : 'color')}>
            <span className="mmd-swatch" style={{ background: state.color ?? STATE_SWATCHES[0].color }} /><ChevronDown size={12} aria-hidden="true" />
          </button>
          {open === 'color' ? (
            <div className="mmd-menu-list" role="menu" style={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(4, 28px)', gap: 6, padding: 8 }}>
              {STATE_SWATCHES.map((swatch) => (
                <button
                  key={swatch.color}
                  type="button"
                  role="menuitemradio"
                  aria-checked={state.color?.toUpperCase() === swatch.color}
                  aria-label={swatch.name}
                  style={{ width: 28, minHeight: 28, padding: 0, background: swatch.color }}
                  onClick={() => { setOpen(null); void api.edit('setStateColor', { id: state.id, color: swatch.color }) }}
                />
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="mmd-context-text" aria-label="Nueva transición" onClick={() => api.startLink(state.id)}><ArrowRight size={15} aria-hidden="true" />Transición</button>
        <button type="button" className="mmd-icon-button" aria-label="Agregar nota" title="Nota" onClick={() => void api.edit('addNote', { id: state.id })}><StickyNote size={15} aria-hidden="true" /></button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Más acciones" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal size={15} aria-hidden="true" /></button>
          {open === 'more' ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('addStart', { to: state.id }) }}><CircleDot size={14} aria-hidden="true" />Transición desde el inicio</button>
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('addEnd', { from: state.id }) }}><CircleDot size={14} aria-hidden="true" />Transición hacia el fin</button>
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('deleteState', { id: state.id }).then((done) => done && api.select(null)) }}><Trash2 size={14} aria-hidden="true" />Eliminar</button>
            </div>
          ) : null}
        </div>
      </>
    )
  }
  if (transition) {
    return (
      <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Zap size={13} aria-hidden="true" style={{ color: 'var(--color-muted-text)' }} />
          <CommitInput value={transition.event} label="Evento" placeholder="Evento…" onCommit={(event) => void api.edit('setTransitionEvent', { index: transition.index, event })} />
        </label>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" aria-label="Invertir sentido" title="Invertir sentido" onClick={() => void api.edit('swapTransition', { index: transition.index })}><ArrowLeftRight size={15} aria-hidden="true" /></button>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" data-danger="true" aria-label="Eliminar" title="Eliminar" onClick={() => void api.edit('deleteTransition', { index: transition.index }).then((done) => done && api.select(null))}><Trash2 size={15} aria-hidden="true" /></button>
      </>
    )
  }
  return null
}
