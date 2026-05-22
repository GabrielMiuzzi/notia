# Registro de Cambios (changes.md)

> Archivo generado automáticamente durante la implementación de tasks.md.

## Fase 1 — Tipos y Engine puro para edges
- `src/modules/mermaid/types/mermaidTypes.ts` — Agregados `MermaidEdgeType`, `ParsedEdgeLine` y tipos auxiliares para parseo de edges.
- `src/modules/mermaid/engines/mermaidEngine.ts` — Agregadas funciones puras `parseEdgeLines`, `getEdgeIndexInCode`, `updateEdgeTypeInCode`, `updateEdgeLabelInCode`, `updateEdgeColorInCode` para editar flechas en el código fuente Mermaid.

## Fases 2–5 — Submenús, toolbar, canvas, view y estilos
- `src/modules/mermaid/components/MermaidEdgeTypeMenu.tsx` — Creado submenú flotante con 9 tipos de línea Mermaid (flecha, abierta, punteada, punteada con flecha, gruesa, gruesa con flecha, círculo, cruz, invisible).
- `src/modules/mermaid/components/MermaidEdgeColorMenu.tsx` — Creado submenú flotante con paleta de 16 colores preset + input personalizado `#RRGGBB`.
- `src/modules/mermaid/components/MermaidEdgeLabelEditor.tsx` — Creado input inline/popover con Confirmar/Cancelar para editar texto de la flecha.
- `src/modules/mermaid/components/MermaidEdgeToolbar.tsx` — Modificado para integrar los 3 submenús, gestionar estado de apertura (`type`/`color`/`label`) y delegar callbacks `onTypeChange`, `onColorChange`, `onLabelChange`.
- `src/modules/mermaid/components/MermaidCanvas.tsx` — Extendidos props con `onEdgeTypeChange`, `onEdgeColorChange`, `onEdgeLabelChange` y pasados al toolbar junto con `selectedEdge`.
- `src/components/notia/views/mermaid/MermaidView.tsx` — Implementados 3 handlers (`handleEdgeTypeChange`, `handleEdgeColorChange`, `handleEdgeLabelChange`) que invocan engines y actualizan `code` vía `setCode`; callbacks conectados a ambas instancias de `MermaidCanvas` (mobile y desktop).
- `src/modules/mermaid/hooks/useMermaidEdgeInteraction.ts` — Extendida `EdgeInfo` con campo opcional `label`.
- `src/modules/mermaid/styles/mermaid.css` — Agregados estilos para `.mermaid-edge-type-menu`, `.mermaid-edge-color-menu`, `.mermaid-edge-color-grid`, `.mermaid-edge-color-swatch`, `.mermaid-edge-label-editor`, `.mermaid-edge-label-input` y `.mermaid-edge-label-btn`.

## Validación
- `tsc --noEmit` ejecutado tras Fase 1 y tras la integración completa — ambos sin errores de compilación.
