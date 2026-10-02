import { useEffect, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ImageIcon, Pencil, Plus, Trash2, X } from 'lucide-react'
import { NotiaModalShell } from '../../../components/notia/NotiaModalShell'
import type { NotiaLibrary } from '../../../types/notia'
import { applyCatalogMutation, asGymError, getEquipmentImages, readMedia } from '../services/gymService'
import type { EquipmentRow, EquipmentView, GymMutation, MediaInput } from '../types/gymTypes'
import { PhoneSheet } from './GymPhone'

interface EquipmentScreenProps {
  library: NotiaLibrary
  equipment: EquipmentView
  apply: (mutation: GymMutation) => void
  onBack: () => void
  onNotice: (message: string) => void
  /** Versión celular: sin «Panel de entrenamiento» (está abajo) y el formulario como hoja. */
  phone?: boolean
}

interface FormState {
  editId: string | null
  name: string
  category: string
  photo: MediaInput | null
  preview: string | null
}

/** El formulario: una ventana en la computadora, una hoja que sube en el celular. */
function FormFrame({ phone, label, onClose, children }: { phone: boolean; label: string; onClose: () => void; children: ReactNode }) {
  if (phone) return <PhoneSheet label={label} onClose={onClose}>{children}</PhoneSheet>
  return (
    <NotiaModalShell open onClose={onClose} size="md" panelClassName="gym-modal-panel" panelStyle={{ width: 'min(560px, calc(100vw - 24px))' }}>
      {children}
    </NotiaModalShell>
  )
}

export function EquipmentScreen({ library, equipment, apply, onBack, onNotice, phone = false }: EquipmentScreenProps) {
  const [images, setImages] = useState<Record<string, string>>({})
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const imageKey = equipment.items.filter((item) => item.hasImage).map((item) => item.id).join(',')

  useEffect(() => {
    let current = true
    void getEquipmentImages(library).then((next) => { if (current) setImages(next) }).catch(() => undefined)
    return () => { current = false }
  }, [library, imageKey])

  const builtin = equipment.items.filter((item) => !item.custom)
  const custom = equipment.items.filter((item) => item.custom)

  const save = async () => {
    if (!form || !form.name.trim()) return
    setSaving(true)
    try {
      await applyCatalogMutation(library, { type: 'save-equipment', equipmentId: form.editId, name: form.name, category: form.category }, form.photo)
      setForm(null)
    } catch (reason) {
      onNotice(asGymError(reason).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: EquipmentRow) => {
    try {
      await applyCatalogMutation(library, { type: 'delete-equipment', equipmentId: item.id })
    } catch (reason) {
      onNotice(asGymError(reason).message)
    }
  }

  const card = (item: EquipmentRow) => (
    <div key={item.id} className="gym-equipment-card" data-owned={item.owned || undefined}>
      <button type="button" className="gym-equipment-toggle" aria-pressed={item.owned} aria-label={item.name} onClick={() => apply({ type: 'toggle-equipment', equipmentId: item.id })}>
        <span className="gym-equipment-image">
          {images[item.id] ? <img src={images[item.id]} alt="" /> : <span className="gym-equipment-noimage"><ImageIcon size={26} aria-hidden="true" />Sin foto</span>}
          <span className="gym-equipment-check" aria-hidden="true">{item.owned ? <Check size={14} /> : null}</span>
        </span>
        <span className="gym-equipment-text">
          <span className="gym-muted gym-equipment-category">{item.categoryLabel}</span>
          <span className="gym-equipment-name">{item.name}</span>
          <span className="gym-muted gym-equipment-sub">{item.sub}</span>
        </span>
      </button>
      {item.custom ? (
        <div className="gym-equipment-actions">
          <button type="button" className="gym-icon-button gym-icon-button--boxed" aria-label={`Editar ${item.name}`} onClick={() => setForm({ editId: item.id, name: item.name, category: item.category, photo: null, preview: images[item.id] ?? null })}><Pencil size={15} /></button>
          <button type="button" className="gym-icon-button gym-icon-button--boxed" aria-label={`Quitar ${item.name}`} onClick={() => void remove(item)}><Trash2 size={15} /></button>
        </div>
      ) : null}
    </div>
  )

  return (
    <main className="gym-main gym-equipment">
      <header className="gym-title-block">
        {phone ? null : <button type="button" className="gym-back" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />Panel de entrenamiento</button>}
        <h1 className="gym-h1">Equipamiento</h1>
        <p className="gym-muted gym-lead">
          {phone ? 'Marcá con qué contás. La lista de ejercicios y tus rutinas se ajustan.' : 'Marcá con qué contás para entrenar. La lista de ejercicios y tus rutinas se ajustan a lo que elijas.'}
        </p>
      </header>
      <div role="group" aria-label="Atajos de equipamiento" className="gym-presets">
        <span className="gym-muted">Atajos</span>
        {equipment.presets.map((preset) => (
          <button key={preset.id} type="button" className="gym-chip gym-chip--big" aria-pressed={preset.pressed} onClick={() => apply({ type: 'apply-preset', preset: preset.id })}>{preset.label}</button>
        ))}
      </div>
      <div className="gym-equipment-layout">
        <div role="group" aria-label="Equipamiento disponible" className="gym-equipment-grid">
          {builtin.map(card)}
          {custom.map(card)}
          <button type="button" className="gym-equipment-add" onClick={() => setForm({ editId: null, name: '', category: 'otros', photo: null, preview: null })}>
            <span className="gym-add-icon"><Plus size={20} aria-hidden="true" /></span>
            <strong>Agregar equipamiento</strong>
            <span className="gym-muted">Cargá uno que no esté en la lista, con foto si querés</span>
          </button>
        </div>
        <aside aria-label="Qué podés hacer con este equipamiento" className="gym-equipment-side">
          <section className="gym-card gym-availability">
            <span className="gym-muted">Ejercicios que podés hacer</span>
            <span className="gym-stat-value gym-stat-value--big">{equipment.available}</span>
            <div className="gym-progress-track"><div className="gym-progress-fill" style={{ width: `${equipment.availablePercent}%` }} /></div>
            <span className="gym-muted gym-small">Los ejercicios con peso corporal que no usan nada siempre están disponibles.</span>
          </section>
          <section className="gym-card gym-impact">
            <h2 className="gym-h3">Tus rutinas</h2>
            {equipment.routines.length === 0 ? <span className="gym-muted">Todavía no tenés rutinas.</span> : null}
            {equipment.routines.map((routine) => (
              <div key={routine.name} className="gym-impact-row" data-color={routine.color}>
                <span className="gym-impact-name"><span className="gym-swatch gym-swatch--routine" aria-hidden="true" />{routine.name}</span>
                {routine.ok ? (
                  <span className="gym-ok"><Check size={14} aria-hidden="true" />{routine.status}</span>
                ) : (
                  <>
                    <span className="gym-warn">{routine.status}</span>
                    {routine.issues.map((issue) => (
                      <span key={issue.exercise} className="gym-issue"><span>{issue.exercise}</span><span className="gym-muted">{issue.need}</span></span>
                    ))}
                  </>
                )}
              </div>
            ))}
          </section>
        </aside>
      </div>

      {form ? (
        <FormFrame phone={phone} label={form.editId ? 'Editar equipamiento' : 'Agregar equipamiento'} onClose={() => setForm(null)}>
          <div className="gym-dialog" role="dialog" aria-modal="true" aria-label={form.editId ? 'Editar equipamiento' : 'Agregar equipamiento'}>
            <header className="gym-dialog-head">
              <h2 className="gym-h2">{form.editId ? 'Editar equipamiento' : 'Agregar equipamiento'}</h2>
              <button type="button" className="gym-icon-button gym-icon-button--boxed" aria-label="Cerrar" onClick={() => setForm(null)}><X size={16} /></button>
            </header>
            <div className="gym-dialog-body">
              <label className="gym-field">
                Nombre
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Por ejemplo: Kettlebell de 16 kg" />
              </label>
              <div className="gym-field">
                <span>Categoría</span>
                <div role="group" aria-label="Categoría" className="gym-chips">
                  {equipment.categories.map((category) => (
                    <button key={category.key} type="button" className="gym-chip" aria-pressed={form.category === category.key} onClick={() => setForm({ ...form, category: category.key })}>{category.label}</button>
                  ))}
                </div>
              </div>
              <div className="gym-field">
                <div className="gym-field-row">
                  <span>Foto (opcional)</span>
                  {form.preview ? <button type="button" className="gym-text-button gym-text-button--muted" onClick={() => setForm({ ...form, photo: null, preview: null })}>Quitar foto</button> : null}
                </div>
                {form.preview ? (
                  <img className="gym-photo-preview" src={form.preview} alt="Vista previa de la foto" />
                ) : (
                  <label className="gym-upload">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        void readMedia(file).then((photo) => setForm((current) => current && { ...current, photo, preview: `data:${photo.mediaType};base64,${photo.base64}` }))
                      }}
                    />
                    <ImageIcon size={24} aria-hidden="true" />
                    <strong>Subí una foto de tu equipo</strong>
                    <span className="gym-muted">PNG, JPG o WEBP</span>
                  </label>
                )}
              </div>
              <p className="gym-muted gym-small">Queda marcado como disponible. Para que filtre ejercicios, asignalo en la ficha del ejercicio, en Equipamiento necesario.</p>
            </div>
            <footer className="gym-dialog-foot">
              <button type="button" className="gym-button" onClick={() => setForm(null)}>Cancelar</button>
              <button type="button" className="gym-button gym-button--primary" disabled={!form.name.trim() || saving} onClick={() => void save()}>{form.editId ? 'Guardar cambios' : 'Agregar'}</button>
            </footer>
          </div>
        </FormFrame>
      ) : null}
    </main>
  )
}
