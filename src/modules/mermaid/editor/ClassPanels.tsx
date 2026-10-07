import { useState } from 'react'
import { ArrowRight, ChevronDown, MoreHorizontal, Plus, Trash2, X } from 'lucide-react'
import { CommitInput, EmptyInspector, Field, Glyph, InspectorHeader, Section, Segmented, SyntaxBox } from './editorParts'
import { MULTIPLICITIES, RELATION_KINDS, STEREOTYPES, VISIBILITY_NAMES } from './diagramMeta'
import { selectionIs, type EditorApi } from './editorApi'
import type { ClassMember, ClassModel, ClassNode, ClassRelation } from './mermaidEditorTypes'

/* Class diagrams: inspector and floating menus (canvas board «Clases»). */

function relationSyntax(relation: ClassRelation) {
  const multA = relation.multA ? ` "${relation.multA}"` : ''
  const multB = relation.multB ? ` "${relation.multB}"` : ''
  return `${relation.a}${multA} ${relation.op}${multB} ${relation.b}${relation.label ? ` : ${relation.label}` : ''}`
}

function MemberRow({ api, owner, member, kind, index, enumValue }: { api: EditorApi<ClassModel>; owner: string; member: ClassMember; kind: 'attribute' | 'method'; index: number; enumValue: boolean }) {
  const visibility = VISIBILITY_NAMES[member.visibility] ?? member.visibility
  return (
    <div className="mmd-member-row">
      <button
        type="button"
        className="mmd-visibility"
        data-v={member.visibility}
        disabled={enumValue}
        title={`Visibilidad: ${visibility}`}
        aria-label={`Cambiar visibilidad, ahora ${visibility}`}
        onClick={() => void api.edit('cycleVisibility', { name: owner, kind, index })}
      >
        {enumValue ? '·' : member.visibility || '·'}
      </button>
      {kind === 'attribute' ? (
        <>
          {member.typeName ? <span>{member.typeName}</span> : null}
          <span style={{ color: 'var(--color-heading-text)' }}>{member.name}</span>
        </>
      ) : (
        <>
          <span style={{ color: 'var(--color-heading-text)' }}>{member.name}({member.args})</span>
          <span>{member.typeName}</span>
        </>
      )}
      <button type="button" className="mmd-icon-button" aria-label={`Quitar ${member.name}`} title="Quitar" onClick={() => void api.edit('deleteMember', { name: owner, kind, index })}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

function ClassInspectorBody({ api, node }: { api: EditorApi<ClassModel>; node: ClassNode }) {
  const enumeration = node.stereotype === 'enumeration'
  return (
    <>
      <Section>
        <Field label="Nombre">
          <CommitInput value={node.name} label="Nombre de la clase" onCommit={(newName) => void api.edit('renameClass', { name: node.name, newName })} />
        </Field>
        <Field label="Estereotipo">
          <Segmented label="Estereotipo" options={STEREOTYPES} value={node.stereotype} onChange={(stereotype) => void api.edit('setStereotype', { name: node.name, stereotype })} />
        </Field>
      </Section>
      <Section
        title={enumeration ? 'Valores' : 'Atributos'}
        action={<button type="button" className="mmd-icon-button" aria-label="Agregar" onClick={() => void api.edit('addMember', { name: node.name, kind: 'attribute' })}><Plus size={14} aria-hidden="true" /></button>}
      >
        {node.attributes.length === 0 ? <span className="mmd-subtle">Sin {enumeration ? 'valores' : 'atributos'}.</span> : null}
        {node.attributes.map((member, index) => (
          <MemberRow key={`${member.line}-${member.name}`} api={api} owner={node.name} member={member} kind="attribute" index={index} enumValue={enumeration} />
        ))}
      </Section>
      {enumeration ? null : (
        <Section
          title="Métodos"
          action={<button type="button" className="mmd-icon-button" aria-label="Agregar método" onClick={() => void api.edit('addMember', { name: node.name, kind: 'method' })}><Plus size={14} aria-hidden="true" /></button>}
        >
          {node.methods.length === 0 ? <span className="mmd-subtle">Sin métodos.</span> : null}
          {node.methods.map((member, index) => (
            <MemberRow key={`${member.line}-${member.name}`} api={api} owner={node.name} member={member} kind="method" index={index} enumValue={false} />
          ))}
        </Section>
      )}
      <Section>
        <button type="button" className="mmd-dashed-button" onClick={() => api.startLink(node.name)}><Plus size={14} aria-hidden="true" />Nueva relación</button>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteClass', { name: node.name }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar clase</button>
      </Section>
    </>
  )
}

function RelationInspector({ api, relation }: { api: EditorApi<ClassModel>; relation: ClassRelation }) {
  const kind = RELATION_KINDS.find((candidate) => candidate.id === relation.kind) ?? RELATION_KINDS[0]
  return (
    <>
      <Section>
        <div className="mmd-chip-row">
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'class', key: relation.a })}>{relation.a}</button>
          <span style={{ color: 'var(--color-accent-text)', flexShrink: 0 }}><Glyph d={kind.glyph} dash={kind.dashed ? '3 3' : undefined} /></span>
          <button type="button" className="mmd-chip" onClick={() => api.select({ kind: 'class', key: relation.b })}>{relation.b}</button>
        </div>
      </Section>
      <Section>
        <Field label={<>Tipo · <strong>{kind.name}</strong></>}>
          <div className="mmd-cards mmd-cards--four">
            {RELATION_KINDS.map((option) => (
              <button key={option.id} type="button" className="mmd-card" aria-pressed={relation.kind === option.id} aria-label={option.name} title={option.name} onClick={() => void api.edit('setRelationKind', { index: relation.index, kind: option.id })}>
                <Glyph d={option.glyph} dash={option.dashed ? '3 3' : undefined} />
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label={`Mult. ${relation.a}`}>
            <CommitInput value={relation.multA} label={`Multiplicidad en ${relation.a}`} placeholder="—" mono onCommit={(value) => void api.edit('setMultiplicity', { index: relation.index, side: 'a', value })} />
          </Field>
          <Field label={`Mult. ${relation.b}`}>
            <CommitInput value={relation.multB} label={`Multiplicidad en ${relation.b}`} placeholder="—" mono onCommit={(value) => void api.edit('setMultiplicity', { index: relation.index, side: 'b', value })} />
          </Field>
        </div>
        <div className="mmd-chips">
          {MULTIPLICITIES.map((value) => (
            <button key={value} type="button" className="mmd-mono" aria-pressed={relation.multB === value} title={`Usar ${value} en ${relation.b}`} onClick={() => void api.edit('setMultiplicity', { index: relation.index, side: 'b', value })}>{value}</button>
          ))}
        </div>
        <Field label="Etiqueta">
          <CommitInput value={relation.label} label="Etiqueta" placeholder="Sin etiqueta" onCommit={(label) => void api.edit('setRelationLabel', { index: relation.index, label })} />
        </Field>
        <Field label="Sintaxis"><SyntaxBox text={relationSyntax(relation)} /></Field>
        <button type="button" className="mmd-danger-button" onClick={() => void api.edit('deleteRelation', { index: relation.index }).then((done) => done && api.select(null))}><Trash2 size={14} aria-hidden="true" />Eliminar relación</button>
      </Section>
    </>
  )
}

export function ClassInspector({ api }: { api: EditorApi<ClassModel> }) {
  const name = selectionIs(api.selection, 'class')
  const index = selectionIs(api.selection, 'relation')
  const node = name ? api.model.classes.find((candidate) => candidate.name === name) : undefined
  const relation = index !== null ? api.model.relations[Number(index)] : undefined
  return (
    <>
      <InspectorHeader title={relation ? 'Relación' : node ? 'Clase' : 'Propiedades'} onClear={node || relation ? () => api.select(null) : undefined} />
      {node ? <ClassInspectorBody key={node.name} api={api} node={node} />
        : relation ? <RelationInspector key={relation.index} api={api} relation={relation} />
          : (
            <EmptyInspector
              text="Hacé clic en una clase o en una relación para editarla."
              counts={[{ label: 'Clases', value: api.model.classes.length }, { label: 'Relaciones', value: api.model.relations.length }]}
            />
          )}
    </>
  )
}

export function ClassContextMenu({ api }: { api: EditorApi<ClassModel> }) {
  const [open, setOpen] = useState<'kind' | 'more' | null>(null)
  const name = selectionIs(api.selection, 'class')
  const index = selectionIs(api.selection, 'relation')
  const node = name ? api.model.classes.find((candidate) => candidate.name === name) : undefined
  const relation = index !== null ? api.model.relations[Number(index)] : undefined
  if (node) {
    return (
      <>
        <button type="button" className="mmd-context-text" onClick={() => void api.edit('addMember', { name: node.name, kind: 'attribute' })}><Plus size={14} aria-hidden="true" />Atributo</button>
        {node.stereotype === 'enumeration' ? null : (
          <button type="button" className="mmd-context-text" onClick={() => void api.edit('addMember', { name: node.name, kind: 'method' })}><Plus size={14} aria-hidden="true" />Método</button>
        )}
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-context-text" aria-label="Nueva relación" onClick={() => api.startLink(node.name)}><ArrowRight size={15} aria-hidden="true" />Relación</button>
        <div className="mmd-menu">
          <button type="button" className="mmd-icon-button" aria-label="Más acciones" aria-expanded={open === 'more'} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal size={15} aria-hidden="true" /></button>
          {open === 'more' ? (
            <div className="mmd-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setOpen(null); void api.edit('deleteClass', { name: node.name }).then((done) => done && api.select(null)) }}><Trash2 size={14} aria-hidden="true" />Eliminar</button>
            </div>
          ) : null}
        </div>
      </>
    )
  }
  if (relation) {
    const kind = RELATION_KINDS.find((candidate) => candidate.id === relation.kind) ?? RELATION_KINDS[0]
    return (
      <>
        <CommitInput className="mmd-input mmd-input--small" value={relation.multA} label={`Multiplicidad en ${relation.a}`} placeholder="—" onCommit={(value) => void api.edit('setMultiplicity', { index: relation.index, side: 'a', value })} />
        <div className="mmd-menu">
          <button type="button" className="mmd-context-text" aria-haspopup="menu" aria-expanded={open === 'kind'} aria-label={`Tipo: ${kind.name}`} title="Tipo de relación" onClick={() => setOpen(open === 'kind' ? null : 'kind')}>
            <Glyph d={kind.glyph} dash={kind.dashed ? '3 3' : undefined} /><ChevronDown size={12} aria-hidden="true" />
          </button>
          {open === 'kind' ? (
            <div className="mmd-menu-list" role="menu" aria-label="Tipo de relación">
              {RELATION_KINDS.map((option) => (
                <button key={option.id} type="button" role="menuitemradio" aria-checked={relation.kind === option.id} onClick={() => { setOpen(null); void api.edit('setRelationKind', { index: relation.index, kind: option.id }) }}>
                  <Glyph d={option.glyph} dash={option.dashed ? '3 3' : undefined} />{option.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <CommitInput className="mmd-input mmd-input--small" value={relation.multB} label={`Multiplicidad en ${relation.b}`} placeholder="—" onCommit={(value) => void api.edit('setMultiplicity', { index: relation.index, side: 'b', value })} />
        <span className="mmd-bar-divider" />
        <CommitInput value={relation.label} label="Etiqueta" placeholder="Etiqueta…" onCommit={(label) => void api.edit('setRelationLabel', { index: relation.index, label })} />
        <span className="mmd-bar-divider" />
        <button type="button" className="mmd-icon-button" data-danger="true" aria-label="Eliminar" title="Eliminar" onClick={() => void api.edit('deleteRelation', { index: relation.index }).then((done) => done && api.select(null))}><Trash2 size={15} aria-hidden="true" /></button>
      </>
    )
  }
  return null
}
