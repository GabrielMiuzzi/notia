# Tarea: Edición interactiva de líneas (edges) en el visualizador Mermaid

## Objetivo
Implementar en el hover-toolbar de una línea seleccionada del diagrama Mermaid tres acciones editables:
1. **Cambiar tipo de línea** (rueda ⚙): abrir un-submenu con los tipos de flecha/línea soportados por Mermaid; al hacer click, modificar el código fuente para reflejar el nuevo tipo.
2. **Cambiar color de línea** (paleta 🎨): abrir un submenú con una paleta de colores; al seleccionar, aplicar `linkStyle <index> stroke:<color>` al código fuente.
3. **Editar texto de la línea** (texto 🔤): abrir un pequeño editor inline; al confirmar, insertar o modificar el label en la flecha del código fuente.

## Contexto
- El proyecto ya tiene un `MermaidEdgeToolbar` (3 botones sin handlers conectados) y un hook `useMermaidEdgeInteraction` que expone `EdgeInfo` (con `fromNodeId`, `toNodeId`, posición del click).
- El código Mermaid vive como string en `MermaidView` (`code` / `setCode`); los cambios se persisten con debounce 800 ms.
- La app usa `NotiaSubmenuPanel` + `useSubmenuEngine` para submenús flotantes (ya se usa en Shapes e Icons).
- Los tipos de línea en Mermaid Flowchart v11 son: flecha (`-->`), abierta (`---`), punteada (`-.->` / `-.-`), gruesa (`==>` / `===`), círculo (`--o`), cruz (`--x`), invisible (`~~~`).
- Para color se usará `linkStyle <index> stroke:<color>;` donde `<index>` se calcula contando las líneas-edge que preceden a la flecha objetivo.
- Para texto/label la sintaxis es `A -->|label| B` o `A -. label .-> B` o `A == label ==> B` según el tipo de flecha.

## AGENTS.md relevante
- **Frontend** usa React 19 + TypeScript, MUI, Emotion; estado global con Redux; submenús con `useSubmenuEngine`.
- **Lógica en `services/` o `engines/`**, nunca en componentes. Los `engines/` son puros (sin side-effects).
- **Components**: PascalCase, hooks `use` prefix, eventos `notia:` kebab-case.
- **Convención**: siempre usar `useAppDispatch` / `useAppSelector` tipados; no duplicar estado en Redux y `useState`.
- **Estilos**: en `modules/mermaid/styles/mermaid.css`; submenús reutilizan `.notia-submenu-panel`.

## Estado actual
- `MermaidEdgeToolbar.tsx` renderiza 3 botones (Settings, Palette, Type) con callbacks vacíos `onSettings`, `onColor`, `onText`.
- `MermaidCanvas.tsx` instancia el toolbar pasando solo `visible`, `x`, `y`; no pasa callbacks.
- `mermaidEngine.ts` tiene funciones puras para modificar labels de **nodos** (`updateNodeLabelInCode`) pero **no de edges**.
- No existen componentes de submenú para edge type, edge color ni edge label.

## Archivos involucrados (crear o modificar)
| # | Archivo | Acción | Rol |
|---|---|---|---|
| 1 | `src/modules/mermaid/types/mermaidTypes.ts` | Modificar | Agregar `MermaidEdgeType`, `MermaidEdgeInfo`, extend interfaces |
| 2 | `src/modules/mermaid/engines/mermaidEngine.ts` | Modificar | Agregar parseo y edición de edges (`parseEdgeLines`, `updateEdgeTypeInCode`, `updateEdgeLabelInCode`, `updateEdgeColorInCode`, `getEdgeIndexInCode`) |
| 3 | `src/modules/mermaid/components/MermaidEdgeTypeMenu.tsx` | Crear | Submenú flotante con los 7 tipos de línea Mermaid |
| 4 | `src/modules/mermaid/components/MermaidEdgeColorMenu.tsx` | Crear | Submenú flotante con grid de colores preset |
| 5 | `src/modules/mermaid/components/MermaidEdgeLabelEditor.tsx` | Crear | Input inline/popover para editar label del edge |
| 6 | `src/modules/mermaid/components/MermaidEdgeToolbar.tsx` | Modificar | Conectar submenús a los 3 botones; gestionar estado de apertura |
| 7 | `src/modules/mermaid/components/MermaidCanvas.tsx` | Modificar | Extender props con `onEdgeTypeChange`, `onEdgeColorChange`, `onEdgeLabelChange`; pasarlas al toolbar |
| 8 | `src/components/notia/views/mermaid/MermaidView.tsx` | Modificar | Implementar handlers que invocan engines y llaman `setCode` |
| 9 | `src/modules/mermaid/styles/mermaid.css` | Modificar | Estilos para submenús de edge y label-input |

## Plan por fases

### Fase 1: Tipos y Engine puro para edges
- [x] Agregar en `mermaidTypes.ts`:
  - `MermaidEdgeType = 'arrow' | 'open' | 'dotted' | 'dottedArrow' | 'thick' | 'thickArrow' | 'circle' | 'cross' | 'invisible'`
  - Interface `ParsedEdgeLine { index: number; from: string; to: string; type: MermaidEdgeType; label?: string; raw: string }`
- [x] Implementar `parseEdgeLines(code: string): ParsedEdgeLine[]` en `mermaidEngine.ts` (regex por línea que detecte flechas y extraiga from/to/type/label).
- [x] Implementar `getEdgeIndexInCode(code, fromNodeId, toNodeId): number` (usa `parseEdgeLines` y retorna el `index` de la primera coincidencia, o `-1`).
- [x] Implementar `updateEdgeTypeInCode(code, fromNodeId, toNodeId, newType): string` (reemplaza la sintaxis de flecha manteniendo label si existe).
- [x] Implementar `updateEdgeLabelInCode(code, fromNodeId, toNodeId, newLabel): string` (añade/modifica `|label|` o sintaxis inline según el tipo).
- [x] Implementar `updateEdgeColorInCode(code, fromNodeId, toNodeId, color): string` (calcula índice con `getEdgeIndexInCode`; agrega o actualiza `linkStyle N stroke:color;` en una línea separada al final del diagrama, evitando duplicados para el mismo índice).

### Fase 2: Submenús de UI (Tipos y Colores)
- [x] Crear `MermaidEdgeTypeMenu.tsx`: usa `NotiaSubmenuPanel` y se posiciona absolutamente cerca del botón. Lista de items clickeables con icono miniatura + nombre (Flecha, Abierta, Punteada, Punteada con flecha, Gruesa, Gruesa con flecha, Círculo, Cruz, Invisible). Disparar `onSelect(type)`.
- [x] Crear `MermaidEdgeColorMenu.tsx`: grid de colores preset (12-16 swatches) + posibilidad de input `#hex`. Disparar `onSelect(color)`.
- [x] Crear `MermaidEdgeLabelEditor.tsx`: input de texto con botón Confirmar + botón Cancelar. Disparar `onConfirm(label)` / `onCancel()`.

### Fase 3: Toolbar integrado
- [x] Modificar `MermaidEdgeToolbar.tsx`:
  - Agregar estado local para `openMenu: 'type' | 'color' | 'label' | null`.
  - Usar refs de botón para posicionar submenús relativos al clickeado.
  - Conectar botón rueda → abrir `MermaidEdgeTypeMenu`.
  - Conectar botón paleta → abrir `MermaidEdgeColorMenu`.
  - Conectar botón texto → abrir `MermaidEdgeLabelEditor`.

### Fase 4: Canvas y View
- [x] Extender `MermaidCanvasProps` con `onEdgeTypeChange`, `onEdgeColorChange`, `onEdgeLabelChange`.
- [x] Pasar callbacks desde `MermaidCanvas` al `MermaidEdgeToolbar`.
- [x] En `MermaidView.tsx`, implementar los 3 handlers invocando engines y llamando `setCode(nextCode)`.

### Fase 5: Estilos y pulido
- [x] Agregar en `mermaid.css` estilos para `.mermaid-edge-type-menu`, `.mermaid-edge-color-menu`, `.mermaid-edge-label-editor`.
- [x] `tsc --noEmit` pasa sin errores.

## Validación
- [x] Al seleccionar una línea y hacer click en ⚙, aparece el submenú de tipos de línea posicionado cerca.
- [x] Seleccionar un tipo de línea modifica el código fuente; al re-renderizar el diagrama la flecha refleja el nuevo tipo.
- [x] Click en 🎨 abre paleta de colores; seleccionar un color modifica/agrega `linkStyle` y la línea cambia de color en el SVG.
- [x] Click en 🔤 abre input de texto; escribir y confirmar inserta/modifica el label en la línea del código.
- [x] Todos los cambios se persisten automáticamente tras 800 ms (debounce existente en `MermaidView`).
- [x] No hay errores de TypeScript (`npm run build` / `tsc --noEmit` pasa).
- [x] Los submenús se cierran al hacer click fuera o presionar Escape.

## Riesgos y mitigaciones
| Riesgo | Mitigación |
|---|---|
| **Indexación incorrecta con `linkStyle`**: si el usuario reordena líneas o hay comentarios, el índice puede desfasarse. | Parsear edge-lines ignorando comentarios (`%%`) y directives; contar solo líneas que son edges. Si un `linkStyle` ya existe para ese índice, actualizarlo en lugar de agregar uno nuevo. |
| **Múltiples edges entre mismos nodos**: `getEdgeIndexInCode` puede devolver el índice del primero, no del clickeado. | Es una limitación conocida. En MVP usar primera coincidencia. Documentar mejora futura (asignar IDs explícitos `e1@-->`). |
| **Sintaxis Mermaid legacy vs v11**: v11 permite `A@{ shape: rect }`, pero edges no cambian de sintaxis. | Mantener regex que soporte ambas sintaxis de edges (legacy y v11). Las flechas siguen siendo `-->`, `-.->`, etc. |
| **Label con caracteres especiales**: comillas, pipes, etc. | Sanitizar label envolviendo en comillas si contiene caracteres especiales (`\|`, `"`). |
| **Colisión de posicionamiento** del submenú si el toolbar está cerca de un borde. | Usar posicionamiento absoluto simple; si sobra tiempo, agregar clamp a viewport. |

## Criterios de aceptación
- [x] El usuario puede cambiar el tipo de línea de una flecha seleccionada vía submenú interactivo con al menos 7 tipos.
- [x] El usuario puede cambiar el color de una flecha seleccionada vía paleta de colores interactiva.
- [x] El usuario puede editar o añadir texto a una flecha seleccionada vía input inline.
- [x] Los cambios se reflejan inmediatamente en el diagrama renderizado y en el panel de código.
- [x] Ningún archivo fuera del módulo `mermaid/` ni de la vista `MermaidView.tsx` se modifica innecesariamente.
- [x] El código sigue las convenciones de naming y arquitectura definidas en `AGENTS.md`.

---

## Resumen de implementación

### Qué se logró
Se implementó la edición interactiva completa de líneas (edges) en el visualizador Mermaid. Al seleccionar una flecha, el `MermaidEdgeToolbar` ahora permite: (1) cambiar el tipo de línea entre 9 variantes soportadas por Mermaid v11, (2) aplicar color vía `linkStyle <index> stroke:<color>;`, y (3) editar/añadir el label de la flecha directamente. Todos los cambios modifican el string de código fuente en tiempo real y se persisten automáticamente con el debounce de 800 ms existente.

### Archivos clave modificados o creados
- `src/modules/mermaid/types/mermaidTypes.ts` — Nuevos tipos `MermaidEdgeType` y `ParsedEdgeLine`.
- `src/modules/mermaid/engines/mermaidEngine.ts` — Funciones puras para parsear y editar edges en el código fuente.
- `src/modules/mermaid/components/MermaidEdgeTypeMenu.tsx` — Submenú selector de tipo de línea (creado).
- `src/modules/mermaid/components/MermaidEdgeColorMenu.tsx` — Submenú paleta de colores (creado).
- `src/modules/mermaid/components/MermaidEdgeLabelEditor.tsx` — Input inline para label (creado).
- `src/modules/mermaid/components/MermaidEdgeToolbar.tsx` — Integración de los 3 submenús en el toolbar.
- `src/modules/mermaid/components/MermaidCanvas.tsx` — Extensión de props y paso de callbacks al toolbar.
- `src/components/notia/views/mermaid/MermaidView.tsx` — Handlers que orquestan engines → `setCode`.
- `src/modules/mermaid/hooks/useMermaidEdgeInteraction.ts` — Campo `label` opcional en `EdgeInfo`.
- `src/modules/mermaid/styles/mermaid.css` — Estilos de los nuevos submenús y componentes.

### Pendientes o notas sugeridas
- **Múltiples edges entre mismos nodos**: la lógica usa la primera coincidencia de `from → to`. Si hay más de una flecha entre los mismos nodos, solo se editará la primera. Para resolverlo, Mermaid v11 permite asignar IDs explícitos (`e1@-->`) que deberían extraerse del SVG para identificación exacta.
- **Posicionamiento de submenús cerca de bordes**: actualmente se posiciona fijo relativo al botón. Considerar clamping a viewport en futuras iteraciones.
- **Tests unitarios**: agregar tests para `parseEdgeLines`, `updateEdgeTypeInCode`, `updateEdgeColorInCode` y `updateEdgeLabelInCode` en `engines/` (son funciones puras, fáciles de testear).
