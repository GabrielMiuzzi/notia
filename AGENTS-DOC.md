# Guía de documentación

Este archivo define únicamente la forma de documentar el repositorio. No debe contener información específica del producto, funcionalidades concretas, nombres de módulos, rutas de implementación, decisiones de arquitectura ni notas de estado. Esa información pertenece a la documentación técnica del proyecto.

## Propósito de cada documento

- `README.md`: documentación funcional para usuarios y personas no técnicas. Explica qué hace el producto, cómo se usa, sus requisitos y las soluciones a problemas frecuentes.
- `README-TECH.md`: documentación técnica específica del proyecto. Contiene arquitectura, módulos, contratos, flujos, decisiones, diagramas, validaciones, límites y estado técnico real.
- `AGENTS.md`: reglas generales para trabajar en el repositorio: preparación, edición, pruebas, seguridad, revisión y entrega.
- `AGENTS-DOC.md`: reglas para mantener la documentación sincronizada. No contiene contenido específico del proyecto.
- `FUNCIONALIDADES.md`: únicamente una lista breve de funcionalidades actualmente disponibles.
- `CHANGELOG.md`: una línea acumulativa por cada iteración de desarrollo.

## Flujo documental obligatorio

Antes de iniciar un desarrollo:

1. Consultar `README.md`, `README-TECH.md`, `AGENTS.md` y este archivo.
2. Identificar qué documentos describen el área que se modificará.
3. Revisar si existe documentación previa que deba conservarse o actualizarse.

Después de cada desarrollo, funcionalidad, bugfix, refactor o cambio de contrato:

1. Actualizar `README-TECH.md` con la implementación real, decisiones, contratos, validaciones, errores, límites y pendientes técnicos.
2. Actualizar `README.md` cuando cambien el comportamiento, la configuración, la instalación o el uso visible para las personas usuarias.
3. Actualizar `FUNCIONALIDADES.md` si se agregó, eliminó o modificó una funcionalidad visible. Debe seguir siendo solo una lista, sin explicaciones ni historial.
4. Agregar una línea a `CHANGELOG.md` con el formato `[YYYY-MM-DD HH:mm:ss Z] Descripción breve del cambio.` La fecha y hora deben corresponder al momento de la iteración y las entradas anteriores no se editan ni se eliminan.
5. Revisar que los documentos no se contradigan entre sí.
6. Si un documento no requiere cambios, verificarlo explícitamente y dejar constancia en el resumen de la iteración.

## Reglas de contenido

- Documentar el estado real, no la intención futura ni una tarea pendiente como si ya estuviera implementada.
- Separar claramente comportamiento actual, decisiones, limitaciones, validaciones pendientes y trabajo futuro.
- Mantener ejemplos, nombres, formatos, diagramas y contratos sincronizados con el código.
- Explicar entradas, salidas, validaciones, errores, casos límite y efectos sobre datos persistidos cuando correspondan.
- No registrar secretos, credenciales, tokens, datos personales, rutas privadas ni payloads sensibles.
- Usar lenguaje claro, títulos estables y nomenclatura consistente.
- Evitar duplicar información técnica detallada fuera de `README-TECH.md`.
- No convertir `AGENTS.md` ni `AGENTS-DOC.md` en un inventario de funcionalidades o en un registro de decisiones del producto.

## Documentación técnica

Cuando un desarrollo modifique una vista, flujo, servicio, comando, endpoint, evento, contrato, persistencia o integración:

- describir el flujo de extremo a extremo;
- registrar los contratos de entrada y salida;
- documentar las validaciones y la política de errores;
- incluir ejemplos completos cuando exista un protocolo estructurado;
- actualizar los diagramas afectados;
- indicar las pruebas ejecutadas y las validaciones que quedaron pendientes;
- señalar compatibilidad, migraciones y recuperación cuando se modifiquen datos o contratos.

## Revisión antes de entregar

- Confirmar que `FUNCIONALIDADES.md` contiene solo una lista.
- Confirmar que `CHANGELOG.md` tiene exactamente una nueva línea para la iteración.
- Confirmar que la fecha, hora y zona horaria del changelog son correctas.
- Confirmar que `README.md` y `README-TECH.md` no describen un estado anterior.
- Revisar enlaces, bloques de código, tablas y diagramas.
- Verificar que no se hayan agregado secretos ni detalles sensibles.
