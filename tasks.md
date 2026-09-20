# Optimización global de rendimiento, memoria e I/O

> Estado: Fase 1 implementada según el estado preexistente; las fases 2–7 tienen implementación parcial y validaciones automatizadas en curso. Se cerró la reconciliación transaccional del inventario y la invalidación de cambios conocidos, pero siguen pendientes las validaciones manuales de plataforma y varios criterios de medición.
>
> Este plan reemplaza el plan anterior del motor global de IA por decisión explícita de la persona usuaria.

## Objetivo

Reducir al máximo los renders innecesarios, las lecturas repetidas del filesystem y el consumo de memoria de Notia en toda la aplicación, priorizando el Explorer/árbol y Android. La aplicación debe seguir funcionando con bibliotecas extremadamente grandes y conservar un inventario lógico completo sin materializar simultáneamente todo el árbol, todas las entradas planas y todo el contenido en la memoria del WebView.

## Decisiones confirmadas

- Incluir toda la aplicación, con prioridad en Explorer/árbol y Android.
- Evaluar `useMemo`, `React.memo`, `useCallback`, selectores Redux memoizados, `useDeferredValue`, `startTransition`, virtualización y mecanismos equivalentes.
- Se permiten cachés en memoria, siempre que tengan propietario, límites, TTL o generación e invalidación explícitos.
- El inventario lógico de la biblioteca debe ser completo y consultable.
- El inventario completo no debe mantenerse necesariamente entero en Redux o RAM; puede residir en un índice persistente y consultarse por lotes.
- Mantener las capacidades actuales de búsqueda, Graph View, edición, mutaciones, watcher de escritorio y refresco Android.
- Priorizar un funcionamiento estable en dispositivos Android con al menos 8 GB de RAM.
- No asumir que una biblioteca tiene un tamaño máximo pequeño.
- El código fuente del plugin Android `DirectoryPickerPlugin` no está presente en este repositorio; su frontera Rust y cualquier dependencia externa deben quedar documentadas y validadas cuando sea posible.

## Fuera de alcance

- Cambiar capacidades funcionales sin justificación y validación explícita.
- Eliminar el inventario completo para resolver el consumo de memoria.
- Cargar datos privados, rutas privadas o contenido de bibliotecas en servicios externos.
- Ejecutar builds de release, firma, publicación o instalación en dispositivos sin solicitud explícita.
- Editar documentación funcional o técnica durante la planificación. La documentación se actualizará al finalizar la implementación mediante el flujo obligatorio.

## Hallazgos iniciales

- `NotiaMenu` concentra muchos selectores Redux, hooks, callbacks y contextos; cambios locales pueden provocar renders en gran parte de la aplicación.
- `NotiaActionsContext` es monolítico. `useNotiaAction` estabiliza la función devuelta, pero los consumidores siguen suscritos al valor completo del contexto.
- `toggleFolderNodeExpanded` y `setFolderExpandedByPath` reconstruyen más nodos de los necesarios; esto reduce el beneficio de `React.memo` en `TreeRow`.
- `FileTree` ya usa virtualización, pero los cambios de identidad del árbol, el estado de drag and drop y el scroll pueden producir renders adicionales.
- `useLibraryTreeSync` coordina la carga del árbol, estructuras auxiliares, SQLite, watcher, firma, búsqueda y lista plana; hay oportunidades de coalescer operaciones.
- El runtime de biblioteca deduplica lecturas en vuelo, pero no mantiene un caché finalizado común con generaciones e invalidación por subárbol.
- En Android, la activación inicial puede leer estructuras auxiliares, el árbol visible y una lista plana recursiva completa; la lista plana se guarda además en Redux.
- `librarySearchGraphIndex` puede mantener descriptores y contenido completo por biblioteca, duplicando memoria con `treeNodes`, `flatFileList` y `graphSourcesByPath`.
- `ensureChatLibraryStructure` y `ensureAgentPromptFile` realizan comprobaciones y lecturas auxiliares durante el cambio de biblioteca que deben coordinarse con el bootstrap general.
- La regeneración de `linkCache.md` puede volver a cargar fuentes y construir modelos completos en segundo plano.
- La implementación Android de `DirectoryPickerPlugin` no aparece en el árbol del repositorio; solo está disponible la integración nativa Rust.

## Contratos y criterios transversales

- Una lectura debe tener una única fuente de verdad por sesión de biblioteca y una generación identificable.
- Una respuesta de filesystem asociada a una generación obsoleta no puede sobrescribir el estado actual.
- Las mutaciones deben invalidar únicamente la ruta o subárbol afectado cuando sea seguro; las operaciones que no puedan acotarse deben invalidar la generación completa.
- Las lecturas concurrentes idénticas deben compartir la misma promesa.
- Las lecturas ya finalizadas deben reutilizarse cuando su TTL o generación continúe vigente.
- Toda caché debe tener límites de memoria, política de expulsión y dueño claro.
- El inventario completo debe poder consultarse sin exponerlo entero al estado global del WebView.
- Las operaciones largas deben ser cancelables, tener timeout, cleanup y descarte de resultados obsoletos.
- Las optimizaciones no deben confiar únicamente en memoización: primero deben medirse renders, identidad de referencias, I/O, tiempos y memoria.
- No se deben registrar contenidos, secretos, credenciales ni rutas privadas en métricas o logs.

## Fase 1 — Baseline, instrumentación y contratos

- [x] Revisar los consumidores de `treeNodes`, `flatFileList`, `indexRevision`, `activeLibrary` y `NotiaActionsContext`.
- [x] Inventariar todos los puntos que leen árboles, directorios, listas planas, firmas y contenidos.
- [x] Medir renders con React Profiler en Explorer, workspace, panel derecho, Graph View, chat y vistas pesadas.
- [x] Contabilizar lecturas por operación: cambio de biblioteca, expansión, búsqueda, apertura, mutación, Graph View y regeneración del cache de enlaces.
- [x] Medir duración, cantidad de nodos, cantidad de entradas, tamaño de payloads y memoria aproximada sin registrar datos privados.
- [x] Definir escenarios reproducibles con bibliotecas pequeñas, grandes, muchas carpetas y estructuras profundamente anidadas.
- [x] Definir el contrato de generación, invalidación y cancelación del futuro runtime de inventario.
- [x] Registrar el baseline antes de alterar comportamiento.

## Fase 2 — Reducción de renders en la aplicación

- [ ] Separar `NotiaMenu` en contenedores de Explorer, workspace, panel derecho, toolbar y modales cuando el profiling demuestre beneficio.
- [ ] Reducir suscripciones amplias a Redux mediante selectores específicos y `createSelector` con igualdad de resultado.
- [x] Dividir `NotiaActionsContext` por dominios o introducir un mecanismo selector-based sin añadir una dependencia innecesaria.
- [ ] Revisar comparadores de `React.memo` en `NotiaSidebar`, `NotiaWorkspace`, `FileTree`, `TreeRow`, `WindowTitleBar`, panel derecho y vistas pesadas.
- [ ] Estabilizar arrays, sets, objetos de contexto y callbacks enviados como props.
- [ ] Aplicar `useMemo` solo a transformaciones costosas y con dependencias reales; eliminar memoizaciones que no aporten valor.
- [ ] Revisar `useDeferredValue` y `startTransition` para que búsqueda, Graph View y cambios pesados no bloqueen el hilo de interfaz.
- [x] Actualizar el scroll de `useVirtualList` de forma agrupada con `requestAnimationFrame` y evitar actualizaciones redundantes.
- [ ] Conservar estados de carga, error, vacío, foco, selección, cancelación y accesibilidad.
- [ ] Agregar pruebas o mediciones de regresión para demostrar qué componentes dejan de renderizarse.

## Fase 3 — Structural sharing del árbol y virtualización

- [x] Reescribir `toggleFolderNodeExpanded` para clonar únicamente el camino hasta la carpeta objetivo.
- [x] Reescribir `setFolderExpandedByPath` con la misma estrategia de referencias compartidas.
- [ ] Revisar `setAllFoldersExpanded`, selección, renombrado, movimientos, inserción de hijos y decoración de búsqueda.
- [ ] Mantener idénticas las referencias de nodos y ramas no afectadas.
- [ ] Evitar que una expansión o selección reconstruya toda la lista visible si no cambió su contenido.
- [x] Revisar las props de `TreeRow` y, si corresponde, agregar un comparador observable que ignore cambios irrelevantes.
- [ ] Mantener la virtualización para árboles grandes y ajustar overscan con mediciones en Android.
- [ ] Agregar pruebas de identidad referencial y comportamiento para expandir, contraer, seleccionar, buscar y mover nodos.

## Fase 4 — Runtime único de inventario y lecturas de filesystem

- [x] Diseñar un runtime de inventario por biblioteca que centralice lecturas, caché, generaciones, deduplicación, timeout y cancelación.
- [x] Añadir caché de resultados finalizados para árbol visible, directorios y metadatos, con TTL o generación explícita.
- [x] Coalescer lecturas concurrentes de la misma biblioteca, carpeta o archivo.
- [ ] Compartir resultados entre bootstrap, Explorer, búsqueda, Graph View, chat y estructuras auxiliares cuando el contrato lo permita.
- [x] Evitar que `readLibraryTreeSignature` provoque un recorrido completo como fallback sin una decisión de coste documentada.
- [x] Coordinar `ensureChatLibraryStructure`, `ensureAgentPromptFile`, SQLite y carga del Explorer para evitar lecturas repetidas durante el cambio de biblioteca.
- [x] Invalidar únicamente el subárbol afectado por crear, renombrar, eliminar, copiar o mover.
- [x] Invalidar por generación completa cuando una operación externa no aporte una ruta fiable.
- [x] Descartar resultados de bibliotecas anteriores o requests canceladas.
- [ ] Mantener compatibilidad entre Windows, macOS, Linux y Android.
- [x] Agregar pruebas de deduplicación, TTL, invalidación, generaciones, errores, timeout y cancelación.

## Fase 5 — Inventario completo persistente y acotado en memoria

- [x] Definir el DTO estable del inventario completo: ruta, tipo, nombre, padre, metadatos disponibles, revisión y generación.
- [x] Elegir la persistencia nativa adecuada, priorizando la base SQLite existente y evitando duplicar formatos sin necesidad.
- [ ] Crear una migración versionada, idempotente y reversible para el inventario.
- [x] Implementar sincronización inicial incremental y transaccional por lotes.
- [x] Implementar upsert y eliminación por subárbol después de mutaciones o cambios externos.
- [x] Permitir consultas completas, filtradas, ordenadas y paginadas desde el runtime sin cargar toda la respuesta en Redux.
- [x] Mantener en Redux solo la proyección visible del árbol, selección, expansión y resultados necesarios para la pantalla activa.
- [ ] Evitar mantener simultáneamente el inventario completo en `flatFileList`, el árbol Redux y varios índices JavaScript.
- [x] Diseñar límites para colas, lotes, buffers y operaciones concurrentes.
- [ ] Cubrir interrupción del proceso, base incompleta, migración fallida, reanudación y cambio de biblioteca.

## Fase 6 — Android SAF y frontera nativa

- [x] Mantener el árbol Android lazy por carpeta expandida, sin leer recursivamente toda la biblioteca para pintar el Explorer.
- [x] Sustituir la carga inicial completa de `read_android_flat_file_list` en Redux por sincronización del inventario persistente.
- [ ] Evitar recorridos repetidos de `readTree` y reutilizar la caché de URI existente.
- [ ] Resolver solo rutas Android desconocidas y conservar las rutas ya resueltas mientras la generación sea válida.
- [ ] Actualizar inventario y caché de URI después de crear, eliminar, renombrar, copiar y mover.
- [ ] Verificar el contrato real de `DirectoryPickerPlugin` o registrar formalmente la dependencia externa si no puede incorporarse al repositorio.
- [ ] Revisar límites JNI, tamaño de payloads, locks, cleanup y errores SAF.
- [ ] Validar manualmente en Android 8 GB o documentar explícitamente la falta de dispositivo disponible.

## Fase 7 — Búsqueda, Graph View e índices de contenido

- [x] Hacer que la búsqueda consulte el inventario completo sin materializar toda la biblioteca en JavaScript.
- [ ] Mantener cobertura completa de nombres, rutas y contenido permitido mediante consultas o índices por lotes.
- [ ] Evitar que cada búsqueda reconstruya el índice completo.
- [ ] Revisar `librarySearchGraphIndex` para limitar entradas, contenido crudo, contenido normalizado y duplicaciones.
- [x] Compartir descriptores y resultados entre búsqueda y Graph View sin retener buffers innecesarios.
- [ ] Construir modelos de Graph View por lotes y liberar fuentes temporales después de procesarlas.
- [ ] Mantener el grafo completo cuando el usuario lo solicite, documentando que el modelo visual final crece con nodos y enlaces.
- [x] Evitar que cambios de UI o renders disparen `linkCache.md` nuevamente.
- [x] Mantener la regeneración del cache de enlaces cancelable, debounced y basada en una generación estable.
- [ ] Agregar pruebas de cobertura completa, cambios incrementales, archivos faltantes, contenido grande, cancelación y memoria.

## Fase 8 — Validación funcional, rendimiento y multiplataforma

- [x] Ejecutar pruebas unitarias y de integración de los módulos modificados.
- [x] Ejecutar `npm test -- --run`.
- [x] Ejecutar `npx tsc --noEmit`.
- [x] Ejecutar `npm run lint`.
- [x] Ejecutar `npm run build -- --minify=false`.
- [x] Ejecutar `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [x] Ejecutar `cargo check --manifest-path src-tauri/Cargo.toml --tests`.
- [x] Ejecutar `git diff --check`.
- [ ] Comparar renders, lecturas, duración y memoria contra el baseline.
- [ ] Validar cambio de biblioteca, expansión repetida, búsqueda, Graph View, mutaciones, watcher y recuperación.
- [ ] Validar Android/SAF con biblioteca grande, pérdida de foco, suspensión, cancelación y reanudación.
- [ ] Registrar plataformas no disponibles y no afirmar validaciones manuales no ejecutadas.

## Fase 9 — Política permanente para futuros desarrollos

- [x] Actualizar `AGENTS.md` con reglas obligatorias para preservar esta política:
  - [x] Medir renders, lecturas, tiempos y memoria antes de optimizar.
  - [x] Evitar suscripciones Redux amplias y renders derivados innecesarios.
  - [x] Usar `useMemo`, `React.memo`, `useCallback` y selectores memoizados solo con dependencias y beneficio justificados.
  - [x] Mantener structural sharing en árboles y estados anidados.
  - [x] No cargar inventarios completos en memoria cuando puedan consultarse desde un índice persistente.
  - [x] Usar cachés con propietario, límites, TTL, generación e invalidación explícitos.
  - [x] Coalescer lecturas y evitar I/O repetido.
  - [x] Diseñar para presión de memoria, SAF, Android, suspensión, pérdida de foco y recuperación.
  - [x] Agregar regresiones para renders, cachés, invalidación, cancelación y límites.
  - [x] Registrar baseline, métricas, validaciones ejecutadas y pendientes.
- [x] Revisar que las nuevas reglas no contradigan `README-TECH.md` ni `AGENTS-DOC.md`.

## Fase 10 — Documentación y entrega

- [ ] Revisar el diff completo y preservar cambios preexistentes.
- [ ] Verificar que no existan logs temporales, archivos accidentales, secretos ni artefactos generados.
- [ ] Actualizar `README-TECH.md` con la arquitectura de inventario, cachés, generaciones, límites, contratos, migraciones y validaciones reales.
- [ ] Actualizar `README.md` si cambia el comportamiento visible del Explorer, búsqueda o Graph View.
- [ ] Actualizar `FUNCIONALIDADES.md` únicamente si cambia una capacidad visible.
- [ ] Agregar exactamente una línea nueva a `CHANGELOG.md` con fecha, hora, zona horaria y resumen.
- [ ] Solicitar al subagente documentador la sincronización final con resumen de cambios, archivos y validaciones.
- [ ] Revisar el resultado del subagente documentador y corregir contradicciones.
- [ ] Marcar en este archivo únicamente tareas implementadas y verificadas.

## Criterios de aceptación

- [ ] Una expansión no relee innecesariamente el mismo subárbol.
- [ ] Las lecturas idénticas concurrentes y recientemente completadas se reutilizan.
- [ ] Las mutaciones invalidan solo los datos afectados cuando existe una ruta fiable.
- [ ] El inventario completo continúa disponible aunque no esté entero en Redux o RAM.
- [ ] Explorer no carga simultáneamente árbol completo, lista plana completa y contenido completo duplicado.
- [ ] Los componentes no afectados no se renderizan ante cambios locales del Explorer.
- [ ] Búsqueda y Graph View conservan cobertura completa del inventario.
- [ ] Las respuestas obsoletas o canceladas no sobrescriben el estado vigente.
- [ ] El comportamiento visible actual se conserva.
- [ ] El consumo de memoria y la cantidad de lecturas mejoran respecto del baseline, especialmente en Android.
- [ ] Todas las validaciones aplicables pasan y las pendientes quedan documentadas.

## Riesgos, límites y bloqueos conocidos

- [ ] Graph View completo puede requerir memoria proporcional a la cantidad final de nodos y enlaces; el procesamiento debe ser incremental, pero no puede eliminar el coste del modelo visual que se muestra.
- [ ] Una biblioteca ilimitada en la práctica requiere límites operativos para colas, lotes, contenido simultáneo y renderizado, aunque el inventario lógico siga siendo completo.
- [ ] La precisión de cambios externos depende de los eventos disponibles en cada plataforma.
- [ ] SAF puede no ofrecer eventos fiables; Android necesitará refresco por generación, intervalo o acción manual según el contrato vigente.
- [ ] El plugin Android `DirectoryPickerPlugin` no está disponible en el repositorio, por lo que su validación completa queda bloqueada hasta localizarlo o documentar su fuente.
- [ ] No se debe afirmar validación física de Android mientras no exista un dispositivo disponible.
