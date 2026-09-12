# Contextos para bibliotecas y archivos Markdown

> Estado de implementación: base completada y validada con lint, tests y build. Las casillas restantes del plan corresponden a endurecimientos futuros, como migraciones masivas con progreso/cancelación y pruebas E2E de UI.

## Objetivo

La implementación base ya está incorporada; la nota de propuesta anterior se conserva como historial del plan y no invalida el estado indicado arriba.

Agregar en **Configuraciones → Contextos** un apartado para crear, editar y eliminar contextos de la biblioteca activa. Cada contexto tiene un color asociado y cada archivo `.md` debe poder tener una propiedad de frontmatter `contexto` cuyo valor sea un tag con el formato `#contexto`.

La primera versión administra y asigna contextos, hereda el contexto desde los tableros de Task Manager y visualiza sus colores en Graph View. No cambia todavía el filtrado de la biblioteca ni el contexto enviado a los chats de IA.

## Contrato funcional

- Los contextos pertenecen a la biblioteca activa y no se comparten entre bibliotecas.
- La configuración se persiste junto con el resto de la configuración de la biblioteca en `.notia/notiaConfig.json`.
- El catálogo de contextos vive en la configuración de la biblioteca; el contexto de cada tablero vive junto con la metadata compartida de Task Manager en `.notia-task-manager.json`, no únicamente en `localStorage`.
- Cada contexto persiste un color asociado en formato hexadecimal `#RRGGBB`; la UI debe mostrarlo como chip/indicador y permitir cambiarlo.
- Una biblioteca nueva se inicializa con estos contextos, cada uno con un color distinto y accesible: `#Laboral`, `#Personal` y `#Academico`.
- Las notas Markdown nuevas se crean con `contexto: "#Personal"` por defecto, salvo que se creen dentro de un tablero con otro contexto asignado.
- Cada tablero de Task Manager tiene un contexto obligatorio; una biblioteca existente sin contexto de tablero se migra inicialmente a `#Personal`.
- La clave de frontmatter es `contexto`.
- El valor persistido es un string con un único prefijo `#`; por ejemplo:

  ```md
  ---
  contexto: "#trabajo"
  ---
  ```

- Un archivo existente sin contexto recibe `contexto: "#Personal"` cuando se normaliza; un valor explícitamente vacío se conserva hasta que la persona lo cambie.
- En la interfaz se puede introducir `trabajo` o `#trabajo`, pero se normaliza y se muestra siempre como `#trabajo`.
- Los contextos no pueden repetirse ignorando mayúsculas/minúsculas ni el prefijo `#`.
- El valor debe ser un tag válido, sin espacios ni un segundo `#`. La validación debe mostrar un error accionable.
- Graph View usa el color del contexto asignado para pintar cada nodo Markdown. Un archivo sin contexto o con un contexto desconocido usa un color neutral de la vista.
- Cambiar el color de un contexto debe actualizar los nodos asociados sin modificar los archivos Markdown.
- Todos los archivos `.md` ubicados dentro de la carpeta de un tablero deben tener el contexto asignado a ese tablero. Esto incluye tareas, subtareas y cualquier otro Markdown descendiente del tablero.
- Para archivos dentro de un tablero, el contexto del tablero es la fuente de verdad y la propiedad manual del archivo no puede elegir otro contexto. El panel puede mostrarla como heredada/bloqueada; la edición libre de `contexto` solo aplica a Markdown fuera de tableros.
- Cambiar el contexto de un tablero actualiza la propiedad `contexto` de todos sus `.md`; la operación debe conservar el resto del frontmatter y del cuerpo.
- Eliminar un contexto no debe borrar silenciosamente la propiedad de los archivos. Si todavía hay archivos que lo usan, la UI debe impedir el borrado o pedir una acción explícita para desasignarlos.
- No se deben sobrescribir otras propiedades, el cuerpo Markdown ni el formato de saltos de línea al crear o actualizar `contexto`.

## Alcance técnico

### 1. Persistencia y contrato de configuración

- [ ] Extender `NotiaLibraryConfig` con la colección de contextos y definir su forma serializable (`id`, nombre visible, tag normalizado y `color`, o equivalente mínimo).
- [ ] Definir los colores iniciales de `#Laboral`, `#Personal` y `#Academico` usando tokens de la interfaz y comprobar contraste en tema claro y oscuro.
- [ ] Actualizar la normalización de `src/services/libraries/libraryConfig.ts` para que una configuración existente sin contextos cargue con los tres contextos predeterminados, y para que cada entrada tenga un color válido.
- [ ] Actualizar `useLibraryConfigSync` para cargar y guardar los contextos de la biblioteca activa, sin filtrar datos de una biblioteca anterior.
- [ ] Mantener compatibilidad con configuraciones existentes y descartar entradas inválidas sin hacer fallar la apertura de la biblioteca.
- [ ] Definir una estrategia de versión/migración compatible antes de escribir el nuevo campo.
- [ ] Cubrir lectura, escritura, configuración ausente, defaults, colores inválidos, entradas duplicadas y datos malformados con pruebas unitarias.

### 2. Motor de contextos y frontmatter

- [ ] Crear una utilidad pura para normalizar, validar y comparar tags de contexto.
- [ ] Reutilizar `src/engines/markdown/frontmatterEngine.ts` para leer y escribir `contexto`; al serializar un valor que empieza con `#`, conservar las comillas necesarias para que YAML no lo trate como comentario.
- [ ] Añadir operaciones tipadas para asignar, cambiar, desasignar y consultar el contexto de un documento.
- [ ] Garantizar que los archivos nuevos incluyan `contexto: "#Personal"` en su frontmatter. Para archivos existentes sin la propiedad, definir una migración/backfill acotada que agregue `contexto: ""` sin bloquear la carga de la biblioteca ni sobrescribir cambios externos.
- [ ] Mantener una única propiedad `contexto` por archivo. Si se encuentran valores antiguos inválidos o múltiples representaciones, conservar el contenido y reportar el estado para que pueda corregirse desde la UI.
- [ ] Agregar pruebas para frontmatter inexistente, valor predeterminado `#Personal`, propiedad vacía, tag válido, tag inválido, valores con `#`, CRLF, otras propiedades y cuerpo Markdown.

### 3. Apartado `Contextos` en el modal de configuración

- [ ] Agregar `Contextos` al tipo, listado y validación de secciones de `src/components/notia/SettingsModal.tsx`.
- [ ] Mostrar el listado de contextos de la biblioteca activa, con estado vacío cuando todavía no exista ninguno.
- [ ] Mostrar el color asociado a cada contexto y permitir elegirlo mediante un control accesible; validar y normalizar siempre a `#RRGGBB`.
- [ ] Permitir crear un contexto con nombre/tag y color, validar antes de guardar y mostrar errores sin cerrar el modal.
- [ ] Permitir editar el nombre/tag o el color manteniendo la identidad del contexto y actualizar las asignaciones afectadas de forma explícita.
- [ ] Permitir eliminar un contexto solo después de resolver las notas que lo utilizan, mostrando cuántos archivos serían afectados.
- [ ] Contemplar biblioteca no seleccionada, carga, guardado, error de filesystem, cancelación y reintento.
- [ ] Mantener objetivos táctiles de al menos 48×48 CSS px, foco visible, navegación por teclado, labels accesibles y controles equivalentes en Android.
- [ ] Verificar el layout en modal angosto/ancho, orientación vertical/horizontal, split-screen y con teclado virtual abierto.

### 4. Edición de la propiedad en archivos `.md`

- [ ] Integrar el campo `contexto` en `MarkdownPropertiesPanel` usando el catálogo de contextos de la biblioteca activa.
- [ ] Mostrar un selector o control equivalente para elegir un contexto existente, con opción visible para dejar el archivo sin contexto.
- [ ] Permitir corregir una propiedad `contexto` huérfana que ya exista en disco, sin perder su valor original antes de confirmar el cambio.
- [ ] Hacer que la edición use el mismo flujo de guardado/precondición que las demás propiedades del documento y reporte conflictos de revisión de forma accionable.
- [ ] Evitar que el usuario escriba un tag que no exista en la configuración, salvo un flujo explícito para crear el contexto desde ese punto.
- [ ] Exponer la propiedad como `#contexto` en la vista de propiedades y conservar la edición manual compatible cuando corresponda.
- [ ] Detectar si el archivo pertenece a un tablero; en ese caso mostrar el contexto heredado del tablero y bloquear una asignación manual incompatible. Fuera de un tablero, permitir la selección/desasignación normal.
- [ ] Cubrir creación, selección, cambio, desasignación, cancelación, error de guardado y conflicto concurrente desde la perspectiva del usuario.

### 5. Graph View coloreado por contexto

- [ ] Extender el modelo de grafo para conservar el contexto normalizado de cada archivo Markdown y resolver su color desde el catálogo de la biblioteca activa.
- [ ] Integrar la resolución en `src/engines/graph/libraryGraphEngine.ts`, `useLibraryGraphData`, `buildLinkCacheMermaidCode` y `MermaidCanvas`, sin duplicar lógica de normalización ni crear un renderer paralelo.
- [ ] Pintar cada nodo según el color del contexto asignado y mantener un estilo neutral para archivos sin contexto, con contexto inexistente o con frontmatter inválido.
- [ ] Para un archivo dentro de un tablero, resolver visualmente el color desde el contexto del tablero mientras exista una propiedad desactualizada pendiente de reconciliación; mostrar el estado de inconsistencia de forma accesible.
- [ ] Mostrar una leyenda, etiqueta o tooltip accesible que permita identificar el contexto además del color; no depender únicamente del color para comunicar la información.
- [ ] Actualizar Graph View cuando cambie la propiedad `contexto`, se cree/renombre un contexto o se modifique su color, invalidando las cachés necesarias sin perder zoom, selección ni navegación.
- [ ] Validar los colores antes de incorporarlos al código Mermaid/SVG y conservar contraste suficiente en tema claro y oscuro, respetando el pipeline visual compartido documentado en `README-TECH.md`.
- [ ] Cubrir nodos con cada contexto predeterminado, contexto personalizado, sin contexto, contexto huérfano, cambio de color y actualización externa del archivo.

### 6. Contexto heredado por tableros de Task Manager

- [ ] Extender `Board` y los DTOs/serialización de Task Manager con el tag de contexto normalizado del tablero, manteniendo compatibilidad con tableros persistidos sin ese campo.
- [ ] Mantener una sola fuente de verdad para el contexto del tablero: `Board.contexto` en la metadata compartida persistida en `.notia-task-manager.json`; los DTOs publicados deben transportarlo y `localStorage` no debe ser fuente autoritativa.
- [ ] Hacer que `BoardDialog` muestre un selector de contexto tanto en **Nuevo tablero** como en **Editar tablero**, usando el catálogo de la biblioteca activa y seleccionando `#Personal` por defecto cuando no exista un valor previo.
- [ ] Validar que el contexto elegido exista y que el formulario no pueda guardar un tablero sin contexto.
- [ ] Al crear un tablero, persistir su contexto antes de generar o aceptar archivos Markdown y aplicar ese contexto a todas las notas que se creen dentro de su carpeta.
- [ ] Al editar el contexto de un tablero, ejecutar una operación acotada y recuperable que recorra recursivamente todos sus `.md` y escriba la propiedad `contexto` correspondiente.
- [ ] Definir el alcance como todos los `.md` descendientes de la raíz lógica del tablero, incluidos subdirectorios y subtareas, sin modificar archivos fuera de esa raíz ni metadata de la biblioteca.
- [ ] Preservar propiedades, enlaces, cuerpo, saltos de línea y revisiones de cada archivo; ante conflicto externo, no sobrescribir silenciosamente y mostrar qué archivos requieren reintento.
- [ ] Definir progreso, cancelación y resultado parcial para tableros grandes, sin bloquear el hilo de UI ni cargar todos los documentos completos en memoria.
- [ ] Cuando una tarea o archivo se mueva a otro tablero, sincronizar su `contexto` con el tablero destino; aplicar la misma regla a subtareas y archivos Markdown relacionados que estén dentro de la carpeta movida.
- [ ] Al renombrar o cambiar el color de un contexto, conservar el tag del tablero y actualizar únicamente los colores derivados; al renombrar el tag, actualizar tableros y archivos afectados mediante la operación segura existente.
- [ ] Impedir eliminar un contexto utilizado por tableros o pedir una acción explícita que reasigne primero los tableros y sus archivos.
- [ ] Sincronizar el contexto del tablero y las mutaciones masivas de archivos con la publicación LAN/cliente remoto de Task Manager cuando la publicación esté activa.
- [ ] Cubrir migración de tableros existentes, creación, edición, cambio de contexto, movimiento entre tableros, conflicto, cancelación y operación parcial.

### 7. Integración con creación, carga y cambios externos

- [ ] Identificar todos los casos de creación de archivos Markdown y aplicar `contexto: "#Personal"` sin duplicar la propiedad si ya existe.
- [ ] Hacer que los casos de creación dentro de un tablero usen el contexto del tablero en lugar de `#Personal`.
- [ ] Ejecutar la migración de tableros existentes sin contexto al inicializar su metadata o antes de exponerlos para edición, y reconciliar sus `.md` con `#Personal` o con el contexto elegido por la persona usuaria.
- [ ] Revisar el watcher/recarga de biblioteca para que un cambio externo en `contexto` se refleje sin resetear el editor ni el catálogo de contextos.
- [ ] Evitar escrituras masivas durante el arranque; cualquier backfill debe ser cancelable, acotado y seguro para Android/SAF.
- [ ] Si se elimina o renombra un contexto mientras otra vista edita una nota, conservar la revisión y mostrar la necesidad de resincronizar en vez de sobrescribir silenciosamente.

### 8. Pruebas y documentación

- [ ] Agregar pruebas unitarias del normalizador y del motor de frontmatter.
- [ ] Agregar pruebas de integración del contrato de configuración por biblioteca.
- [ ] Agregar pruebas de UI del modal: defaults, crear, editar color, duplicado, tag/color inválidos, eliminación con archivos asignados y estados de error.
- [ ] Agregar pruebas de UI del panel Markdown: asignar, cambiar, desasignar y conservar otras propiedades/cuerpo.
- [ ] Agregar pruebas del motor y la vista de Graph View para la resolución de colores y los estados neutral/huérfano.
- [ ] Agregar pruebas de `BoardDialog` y del caso de uso de herencia para verificar que crear/editar un tablero exige contexto y actualiza todos sus `.md`.
- [ ] Ejecutar, según el alcance final, `npm run lint`, `npm test` y `npm run build`.
- [ ] Actualizar `README.md`, `README-TECH.md` y `AGENTS-DOC.md` solo cuando la funcionalidad esté implementada, documentando el formato persistido, validaciones, flujo de guardado y comportamiento ante errores.

## Criterios de aceptación

- [ ] En la biblioteca activa se puede abrir **Configuraciones → Contextos**, crear al menos un contexto y verlo después de cerrar y volver a abrir el modal.
- [ ] Una biblioteca nueva muestra inicialmente `#Laboral`, `#Personal` y `#Academico`, cada uno con su color asociado.
- [ ] Los colores se conservan al cerrar/reabrir la configuración y al cambiar de biblioteca, sin mezclarse entre bibliotecas.
- [ ] La configuración de una biblioteca no aparece al cambiar a otra biblioteca.
- [ ] Un `.md` nuevo contiene `contexto: "#Personal"` y puede cambiarse, por ejemplo, a `contexto: "#trabajo"` desde la UI si `#trabajo` existe en el catálogo.
- [ ] **Nuevo tablero** y **Editar tablero** muestran el selector de contexto, y no permiten guardar sin un contexto válido.
- [ ] Todos los `.md` dentro de un tablero recién creado tienen el contexto elegido para ese tablero.
- [ ] Al cambiar el contexto de un tablero, todos sus `.md` se actualizan al nuevo tag sin perder propiedades ni contenido; los conflictos se informan y no se pisan automáticamente.
- [ ] Al mover una tarea a otro tablero, su contexto pasa al del tablero destino.
- [ ] Al recargar la aplicación, el contexto asignado se conserva y se muestra como `#trabajo`.
- [ ] No se aceptan duplicados equivalentes como `trabajo`, `#trabajo` y `#Trabajo` dentro del catálogo normalizado.
- [ ] No se puede eliminar un contexto en uso sin una confirmación/acción explícita que resuelva sus archivos.
- [ ] La actualización de contexto no elimina propiedades, contenido, enlaces ni formato del resto del archivo.
- [ ] Graph View pinta cada archivo con el color de su contexto, mantiene un color neutral para archivos sin contexto/huérfanos y actualiza el color cuando cambia la configuración.
- [ ] Los errores de validación, filesystem y conflictos de revisión son visibles y permiten recuperarse.
- [ ] Mouse, teclado, touch y botón Atrás/cierre en Android ofrecen una ruta equivalente para completar o cancelar la acción.

## Fuera de alcance de esta versión

- Filtrar el explorador por contexto.
- Inyectar automáticamente los archivos de un contexto en un chat de IA.
- Permitir múltiples contextos por archivo mediante una lista.
- Sincronizar contextos entre bibliotecas o servicios externos.
