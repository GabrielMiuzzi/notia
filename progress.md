# Progreso: Edición interactiva de líneas (edges) en Mermaid

## Fase 1 completada ✅
- Tipos `MermaidEdgeType`, `ParsedEdgeLine` agregados a `mermaidTypes.ts`.
- Funciones puras de engine implementadas: `parseEdgeLines`, `getEdgeIndexInCode`, `updateEdgeTypeInCode`, `updateEdgeLabelInCode`, `updateEdgeColorInCode`.
- `tsc --noEmit` validado sin errores.

## Fases 2–5 completadas ✅
- Submenús creados: `MermaidEdgeTypeMenu`, `MermaidEdgeColorMenu`, `MermaidEdgeLabelEditor`.
- Toolbar integrado con estado `openMenu`, refs para posicionamiento, y cierre al click fuera.
- Canvas y View extendidos con handlers `onEdgeTypeChange`, `onEdgeColorChange`, `onEdgeLabelChange`.
- Estilos CSS agregados para todos los nuevos componentes.
- `tsc --noEmit` validado nuevamente sin errores.

### Estado final
Todas las fases del plan están completas. La funcionalidad permite:
1. Seleccionar tipo de línea (9 opciones).
2. Cambiar color vía `linkStyle`.
3. Editar texto de la flecha inline.

### Pendientes documentados
- Múltiples edges entre mismos nodos: usa primera coincidencia.
- Posicionamiento de submenús cerca de bordes sin clamping.
- Tests unitarios para funciones puras del engine.
