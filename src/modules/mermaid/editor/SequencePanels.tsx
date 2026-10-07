import { useState } from 'react'
import { ArrowLeftRight, Check, ChevronDown, MessageSquarePlus, MoreHorizontal, Plus, StickyNote, Trash2, Zap } from 'lucide-react'
import { CommitInput, EmptyInspector, Field, Glyph, InspectorHeader, Section, Segmented, SyntaxBox } from './editorParts'
import { ACTIVATIONS, MESSAGE_TIPS } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { Message, MessageLine, Participant, ParticipantKind, SequenceModel } from './mermaidEditorTypes'

/* Sequence diagrams: inspector and floating menus (canvas board «Secuencia»). */

const LINES: Array<{ id: MessageLine; name: string }> = [
  { id: 'solid', name: 'Continua' },
  { id: 'dotted', name: 'Punteada' },
]
const KINDS: Array<{ id: ParticipantKind; name: string }> = [
  { id: 'participant', name: 'Participante' },
  { id: 'actor', name: 'Actor' },
]

function messageSyntax(message: Message) {
  return `${message.from}${message.op}${message.to}: ${message.text}`
}

function ParticipantInspector({ api, participant }: { api: EditorApi<SequenceModel>; participant: Participant }) {
  return (
    <>
      <Section>
        <Field label="Nombre visible">
          <CommitInput value={participant.label} label="Nombre visible" onCommit={(label) => void api.edit('setParticipantLabel', { alias: participant.alias, label })} />
        </Field>
        <Field label="Alias en el código"><SyntaxBox text={participant.alias} /></Field>
        <Field label="Tipo">
          <Segmented label="Tipo de participante" options={KINDS} value={participant.kind} onChange={(kind) => void api.edit('setParticipantKind', { alias: participant.alias, kind })} />
        </Field>
        <div className="mmd-stat-cards">
          <div><strong>{participant.sends}</strong><span>Envía</span></div>
          <div><strong>{participant.receives}</strong><span>Recibe</span></div>
        </div>
        <button type="button" className="mmd-dashed-button" onClick={() => api.startLink(participant.alias)}>
          <Plus size={14} aria-hidden="true" />Nuevo mensaje desde {participant.label}
        </button>
      </Section>
      <Section>
        <button type="button" className="mmd-ghost-button" onClick={() => void api.edit('addNote', { alias: participant.alias })}><StickyNote size={14} aria-hidden="true" />Agregar nota</button>
        <button type="button" className="mmd-ghost-button" onClick={() => void api.edit('activateParticipant', { alias: participant.alias })}><Zap size={14} aria-hidden="true" />Activación</button>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteParticipant', { alias: participant.alias }).then((done) => done && api.select(null))}>
          <Trash2 size={14} aria-hidden="true" />Eliminar participante y sus mensajes
        </button>
      </Section>
    </>
  )
}

function MessageInspector({ api, message }: { api: EditorApi<SequenceModel>; message: Message }) {
  const tip = MESSAGE_TIPS.find((candidate) => candidate.id === message.tip) ?? MESSAGE_TIPS[0]
  const ends = (from: string, to: string) => void api.edit('setMessageEnds', { index: message.index, from, to })
  return (
    <>
      <Section>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 8, alignItems: 'end' }}>
          <Field label="Desde">
            <select className="mmd-select" style={{ height: 36 }} value={message.from} aria-label="Desde" onChange={(event) => ends(event.target.value, message.to)}>
              {api.model.participants.map((participant) => <option key={participant.alias} value={participant.alias}>{participant.label}</option>)}
            </select>
          </Field>
          <button type="button" className="mmd-icon-button" style={{ height: 36 }} aria-label="Invertir sentido" title="Invertir sentido" onClick={() => void api.edit('swapMessage', { index: message.index })}>
            <ArrowLeftRight size={15} aria-hidden="true" />
          </button>
          <Field label="Hacia">
            <select className="mmd-select" style={{ height: 36 }} value={message.to} aria-label="Hacia" onChange={(event) => ends(message.from, event.target.value)}>
              {api.model.participants.map((participant) => <option key={participant.alias} value={participant.alias}>{participant.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Texto">
          <CommitInput value={message.text} label="Texto del mensaje" placeholder="Sin texto" onCommit={(text) => void api.edit('setMessageText', { index: message.index, text })} />
        </Field>
        <Field label="Línea">
          <Segmented label="Línea" options={LINES} value={message.lineStyle} onChange={(lineStyle) => void api.edit('setMessageLine', { index: message.index, lineStyle })} />
        </Field>
        <Field label={<>Punta · <strong>{tip.name}</strong></>}>
          <div className="mmd-cards mmd-cards--five">
            {MESSAGE_TIPS.map((option) => (
              <button key={option.id} type="button" className="mmd-card" aria-pressed={message.tip === option.id} aria-label={option.name} title={option.name} onClick={() => void api.edit('setMessageTip', { index: message.index, tip: option.id })}>
                <Glyph d={option.glyph} width={26} />
              </button>
            ))}
          </div>
        </Field>
      </Section>
      <Section title="Activación">
        {ACTIVATIONS.map((activation) => {
          const on = message.activation === activation.id
          return (
            <button
              key={activation.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              className="mmd-check-row"
              onClick={() => void api.edit('setActivation', { index: message.index, activation: on ? 'none' : activation.id })}
            >
              <i aria-hidden="true">{on ? <Check size={11} strokeWidth={3} /> : null}</i>
              {activation.name}
              <small>{activation.suffix}</small>
            </button>
          )
        })}
        <span className="mmd-subtle">
          Dentro de {message.block ? <strong className="mmd-mono" style={{ color: 'var(--color-heading-text)' }}>{message.block.keyword} · {message.block.label}</strong> : 'ningún bloque'}
        </span>
      </Section>
      <Section>
        <Field label="Sintaxis"><SyntaxBox text={messageSyntax(message)} /></Field>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteMessage', { index: message.index }).then((done) => done && api.select(null))}>
          <Trash2 size={14} aria-hidden="true" />Eliminar mensaje
        </button>
      </Section>
    </>
  )
}

export function SequenceInspector({ api }: { api: EditorApi<SequenceModel> }) {
  const alias = selectionIs(api.selection, 'participant')
  const index = selectionIs(api.selection, 'message')
  const participant = alias ? api.model.participants.find((candidate) => candidate.alias === alias) : undefined
  const message = index !== null ? api.model.messages[Number(index)] : undefined
  return (
    <>
      <InspectorHeader title={message ? `Mensaje ${message.index + 1}` : participant ? 'Participante' : 'Propiedades'} onClear={participant || message ? () => api.select(null) : undefined} />
      {participant ? <ParticipantInspector key={participant.alias} api={api} participant={participant} />
        : message ? <MessageInspector key={message.index} api={api} message={message} />
          : (
            <EmptyInspector
              text="Hacé clic en un mensaje o en un participante para editarlo. Para enlazar, usá la herramienta Mensaje y tocá los dos participantes."
              counts={[{ label: 'Participantes', value: api.model.participants.length }, { label: 'Mensajes', value: api.model.messages.length }]}
            />
          )}
    </>
  )
}

export function SequenceContextMenu({ api }: { api: EditorApi<SequenceModel> }) {
  const [open, setOpen] = useState<'tip' | 'more' | null>(null)
  const alias = selectionIs(api.selection, 'participant')
  const index = selectionIs(api.selection, 'message')
  const participant = alias ? api.model.participants.find((candidate) => candidate.alias === alias) : undefined
  const message = index !== null ? api.model.messages[Number(index)] : undefined
  if (participant) {
    return (
      <>
        <div className="mmd-segmented" role="group" aria-label="Tipo" style={{ padding: 2 }}>
          {KINDS.map((kind) => (
            <button key={kind.id} type="button" aria-pressed={participant.kind === kind.id} onClick={() => void api.edit('setParticipantKind', { alias: participant.alias, kind: kind.id })}>{kind.name}</button>
          ))}
        </div>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-context-text" aria-label="Nuevo mensaje desde este participante" onClick={() => api.startLink(participant.alias)}><MessageSquarePlus size={15} aria-hidden="true" />Mensaje</button>
        <button type="button" className="mmd-icon-button" aria-label="Agregar nota" title="Nota" onClick={() => void api.edit('addNote', { alias: participant.alias })}><StickyNote size={15} aria-hidden="true" /></button>
        <button type="button" className="mmd-icon-button" aria-label="Activación" title="Activación" onClick={() => void api.edit('activateParticipant', { alias: participant.alias })}><Zap size={15} aria-hidden="true" /></button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Más acciones" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal size={15} aria-hidden="true" /></button>
          {open === 'more' ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('deleteParticipant', { alias: participant.alias }).then((done) => done && api.select(null)) }}><Trash2 size={14} aria-hidden="true" />Eliminar</button>
            </div>
          ) : null}
        </div>
      </>
    )
  }
  if (message) {
    const tip = MESSAGE_TIPS.find((candidate) => candidate.id === message.tip) ?? MESSAGE_TIPS[0]
    return (
      <>
        <CommitInput value={message.text} label="Texto del mensaje" placeholder="Texto del mensaje…" onCommit={(text) => void api.edit('setMessageText', { index: message.index, text })} />
        <span className="mmd-bar-divider" />
        {LINES.map((line) => (
          <button key={line.id} type="button" className="mmd-icon-button" style={{ width: 34 }} aria-pressed={message.lineStyle === line.id} aria-label={line.name} title={line.name} onClick={() => void api.edit('setMessageLine', { index: message.index, lineStyle: line.id })}>
            <Glyph d="M2 6h18" width={22} dash={line.id === 'dotted' ? '3 3' : undefined} />
          </button>
        ))}
        <span className="mmd-bar-divider" />
        <div className="mmd-menu">
          <button type="button" className="mmd-context-text" aria-haspopup="menu" aria-expanded={open === 'tip'} aria-label={`Punta: ${tip.name}`} title="Punta" onClick={() => setOpen(open === 'tip' ? null : 'tip')}>
            <Glyph d={tip.glyph} /><ChevronDown size={12} aria-hidden="true" />
          </button>
          {open === 'tip' ? (
            <div className="mmd-menu-list" role="menu" aria-label="Punta del mensaje">
              {MESSAGE_TIPS.map((option) => (
                <button key={option.id} type="button" role="menuitemradio" aria-checked={message.tip === option.id} onClick={() => { setOpen(null); void api.edit('setMessageTip', { index: message.index, tip: option.id }) }}>
                  <Glyph d={option.glyph} />{option.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button type="button" className="mmd-icon-button" aria-label="Invertir sentido" title="Invertir sentido" onClick={() => void api.edit('swapMessage', { index: message.index })}><ArrowLeftRight size={15} aria-hidden="true" /></button>
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" data-danger="true" aria-label="Eliminar" title="Eliminar" onClick={() => void api.edit('deleteMessage', { index: message.index }).then((done) => done && api.select(null))}><Trash2 size={15} aria-hidden="true" /></button>
      </>
    )
  }
  return null
}
