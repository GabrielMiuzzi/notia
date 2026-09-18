# Multichat con dinámicas y agentes múltiples

> Estado: llamada plana a Ollama y streaming de Multichat implementados y validados; pruebas UI/accesibilidad y validaciones manuales de plataforma pendientes por falta de entorno dedicado.

## Objetivo

Agregar una vista principal **Multichat**, ubicada en la barra izquierda inmediatamente debajo de **Calendario**, donde el usuario pueda crear una sala efímera seleccionando una dinámica Markdown, un contexto adicional opcional y entre uno y seis agentes Markdown. El orquestador debe coordinar turnos secuenciales entre el usuario y los agentes mediante llamadas planas al adaptador existente de Ollama, sin tools de IA ni búsquedas automáticas, conservar los últimos 40 mensajes con identificación explícita del hablante, mostrar el thinking y la respuesta en streaming y permitir que el chat desplegable derecho consulte la conversación activa como contexto auxiliar.

## Decisiones confirmadas

- La funcionalidad se implementará para Windows y Android.
- La carpeta de dinámicas será `.agent/dynamics/`, dentro de la biblioteca activa.
- Los agentes se seleccionan desde `.agent/promps/`, respetando la estructura existente del proyecto.
- Las dinámicas y los prompts son archivos Markdown de texto libre; el frontmatter se ignora al cargar su contenido.
- La aplicación debe garantizar `.agent/dynamics/` aunque la carpeta todavía no exista.
- Una sala requiere una dinámica válida y entre uno y seis agentes válidos. Si falta cualquiera de ellos, la sala no puede iniciarse.
- Los agentes seleccionados quedan fijos durante toda la sala y nunca pueden participar agentes que no hayan sido seleccionados para esa sala.
- La sala comienza vacía y espera el primer mensaje del usuario.
- Las sesiones son efímeras: no se guardan como chats ni se recuperan del historial; al cerrar la pestaña de Multichat se pierde su estado.
- Al crear la sala se puede incluir un contexto adicional libre; queda fijo durante la sala y se reenvía a cada agente junto con la dinámica y su prompt en todos los turnos.
- Los agentes no reciben tools de IA, no pueden iniciar mutaciones ni búsquedas web y no requieren confirmaciones.
- La sala no ejecuta el motor global de agentes: cada turno usa una llamada plana al adaptador local existente de Ollama, con cancelación y errores compartidos.
- La selección de turnos debe limitarse al conjunto de agentes de la sala. Cada ronda elige un subconjunto no vacío y un orden aleatorio dentro de ese conjunto, salvo que la dinámica nombre agentes concretos o indique explícitamente que deben participar todos.
- Las respuestas de una ronda son secuenciales para que cada agente pueda recibir las respuestas anteriores en el contexto.
- Los agentes pueden iniciar turnos entre ellos de forma automática. Si el usuario no interviene, la cadena automática debe detenerse después de un límite aleatorio de entre una y cuatro rondas y esperar nuevamente al usuario; una dinámica puede pedir explícitamente esperar al usuario.
- Cada agente recibe como historial conversacional los últimos 40 mensajes, con el hablante identificado como usuario o agente concreto.
- Cada agente debe recibir la dinámica seleccionada, su propio prompt y el contexto adicional fijo de la sala.
- Cada agente debe ejecutarse mediante una llamada plana al adaptador existente de Ollama, sin catálogo de tools ni búsqueda web.
- Cada agente se muestra con nombre derivado de su archivo, icono diferenciado y color asignado automáticamente desde una paleta fija.
- El panel derecho conserva sus permisos normales de chat y no recibe tools ni capacidades de la sala Multichat.
- Cuando el panel derecho se abre desde Multichat, debe conocer que el contexto activo es una sala Multichat y poder consultar la conversación activa como contexto, pero no debe convertirse en un participante ni publicar mensajes dentro de la sala.

## Fuera de alcance

- Persistir salas Multichat o agregarlas al historial de chats.
- Permitir cambiar la dinámica o los agentes después de iniciar una sala.
- Permitir que agentes no seleccionados entren en una sala.
- Crear un motor de IA separado del motor global existente.
- Agregar un canal nuevo para Telegram o la URL pública.
- Cambiar los permisos normales del panel derecho.
- Permitir que el panel derecho participe automáticamente en los turnos del Multichat.

## Fase 1 — Contratos, arquitectura y estado efímero

- [x] Inventariar el flujo vigente de pestañas especiales, barra izquierda, workspace principal y panel derecho.
- [x] Definir el contrato tipado de una sala: dinámica, agentes seleccionados, mensajes, hablante, estado de ronda, contador/límite de rondas automáticas y cancelación.
- [x] Definir el contrato de mensaje Multichat con `user` o identificador estable de agente como hablante, sin perder el nombre visible del agente.
- [x] Definir el contexto adicional de la sala como contenido textual fijo, serializable y separado del historial de mensajes.
- [x] Definir el límite exacto de 40 mensajes para cada solicitud de agente y la transformación serializable del historial.
- [x] Definir estados observables: configuración, sala vacía, turno del usuario, turno de agentes, espera del usuario, carga, error, cancelación y agente sin respuesta.
- [x] Definir una política de sesión efímera que no escriba archivos de chat ni localStorage y elimine el estado al cerrar la pestaña de Multichat.
- [x] Definir cómo el estado activo queda disponible para el panel derecho mientras la sala está montada.
- [x] Definir el contrato de la llamada plana a Ollama, sin scope de tools, actor ni autorización de mutaciones.
- [x] Definir el streaming separado de thinking y respuesta, incluyendo cancelación y cleanup.
- [x] Documentar los contratos de cancelación, resultados obsoletos, timeout y cleanup para rondas secuenciales.

## Fase 2 — Estructura `.agent/dynamics` y carga segura de archivos

- [x] Extender la inicialización existente de `.agent` para garantizar `.agent/dynamics/` sin modificar ni reemplazar dinámicas creadas por el usuario.
- [x] Crear un servicio tipado para listar dinámicas `.md` directamente dentro de `.agent/dynamics/`.
- [x] Crear un servicio tipado para cargar el contenido de una dinámica seleccionada.
- [x] Reutilizar el cargador de `.agent/promps/` para listar y leer prompts de agentes, filtrando únicamente archivos Markdown válidos.
- [x] Ignorar frontmatter al componer dinámicas y prompts, sin alterar los archivos del usuario.
- [x] Validar nombres de archivo, extensiones, rutas y pertenencia a las carpetas permitidas para impedir traversal o lecturas fuera de la biblioteca.
- [x] Rechazar archivos ausentes, vacíos, ilegibles o selecciones que hayan cambiado antes de iniciar la sala.
- [x] Definir mensajes de error seguros para carpeta inexistente, dinámica inválida, prompt inválido y ausencia de agentes.
- [x] Cubrir con pruebas deterministas la creación idempotente de la carpeta, el filtrado Markdown, la extracción del cuerpo sin frontmatter y los límites de selección.

## Fase 3 — Motor de orquestación Multichat

- [x] Implementar un motor puro para seleccionar participantes únicamente entre los agentes fijados en la sala.
- [x] Implementar la interpretación de la política indicada por la dinámica para elegir un subconjunto o todos los agentes de la sala, con orden aleatorio y subconjunto no vacío por defecto.
- [x] Implementar la selección aleatoria con una fuente inyectable para pruebas deterministas.
- [x] Implementar la secuencia de respuestas: cada agente recibe el historial actualizado después de la respuesta anterior.
- [x] Implementar la creación de rondas automáticas entre agentes y el límite aleatorio de una a cuatro rondas sin intervención del usuario.
- [x] Reiniciar el contador de rondas automáticas cuando el usuario interviene.
- [x] Impedir respuestas automáticas cuando la dinámica o el estado de la sala requieren esperar al usuario.
- [x] Construir para cada agente un prompt compuesto por dinámica, prompt individual, contexto fijo y política de participación, sin conceder capacidades externas.
- [x] Incluir el contexto adicional fijo de la sala en cada solicitud de agente junto con la dinámica y el prompt individual.
- [x] Incorporar los últimos 40 mensajes con etiquetas explícitas del tipo `Usuario` o nombre del agente.
- [x] Ejecutar cada ronda a través del adaptador plano de streaming de Ollama y no mediante llamadas directas desde la vista.
- [x] Garantizar que la llamada plana no envíe catálogo de tools ni habilite búsqueda web o mutaciones.
- [x] Mantener dinámica, prompt, contexto e historial acotado consistentes durante cada turno.
- [x] Manejar cancelación de la sala, cancelación de una respuesta, timeout, error de un agente y resultados obsoletos sin continuar la cadena automáticamente.
- [x] Definir si un agente que devuelve una respuesta vacía se omite con error visible o detiene la ronda, respetando el comportamiento seguro del runtime global.
- [x] Agregar pruebas de selección, exclusión de agentes no seleccionados, orden secuencial, ventana de 40 mensajes, límite automático, cancelación y streaming sin tools.

## Fase 4 — Vista Multichat y creación de salas

- [x] Agregar la acción de barra izquierda **Multichat** inmediatamente debajo de **Calendario**, con icono accesible y estado activo.
- [x] Extender los tipos de UI, pestañas especiales, selectores, navegación, títulos de pestañas y cierre de pestaña para la nueva vista.
- [x] Crear el flujo de configuración inicial de una sala con selección obligatoria de una dinámica y de uno a seis agentes.
- [x] Agregar un textbox accesible para contexto adicional opcional y conservarlo inmutable al iniciar la sala.
- [x] Mostrar nombres sin `.md`, indicar archivos vacíos o inválidos y bloquear el inicio hasta tener una configuración válida.
- [x] Eliminar la configuración de permisos de sala porque el runtime no ofrece tools ni mutaciones.
- [x] Mantener dinámica y agentes inmutables una vez creada la sala.
- [x] Iniciar la vista con una conversación vacía y un compositor para el primer mensaje del usuario.
- [x] Renderizar mensajes de usuario y agentes en orden cronológico, mostrando nombre, icono, color y estado de participación.
- [x] Mostrar estados de espera del usuario, thinking y respuesta incremental por agente, turnos automáticos, error individual, cancelación y reintento seguro.
- [x] Permitir cancelar una cadena de respuestas sin dejar turnos obsoletos ejecutándose.
- [x] Eliminar el estado de la sala al cerrar su pestaña, sin guardar historial ni rehidratarla al volver a abrir Multichat.
- [x] Diseñar controles semánticos, labels, foco visible, navegación por teclado, touch, tamaños reducidos, textos largos y teclado virtual.
- [x] Asignar iconos y colores de forma determinista mediante una paleta fija, sin requerir metadata adicional en los `.md`.
- [ ] Verificar que la interfaz siga funcionando con uno y seis agentes, respuestas largas y mensajes intercalados.

## Fase 5 — Llamada plana y streaming de Ollama

- [x] Conectar cada agente al adaptador plano existente de Ollama sin catálogo de tools ni búsqueda web.
- [x] Mostrar deltas de thinking y respuesta separados mientras el agente responde.
- [x] Cancelar y limpiar el stream activo sin guardar thinking ni resultados obsoletos.
- [x] Mantener el prompt de dinámica, agente, contexto e historial acotado fuera de cualquier catálogo de capacidades.

## Fase 6 — Contexto del panel derecho

- [x] Extender la resolución de contexto del panel derecho para reconocer la vista Multichat.
- [x] Exponer una etiqueta clara de contexto activo indicando que el panel está consultando una sala Multichat.
- [x] Pasar al panel derecho la conversación activa con sus últimos 40 mensajes y hablantes identificados.
- [x] Hacer disponible la dinámica y la composición de agentes como contexto descriptivo cuando corresponda, sin convertir el panel en participante.
- [x] Hacer disponible el contexto adicional de la sala al panel derecho como información auxiliar, sin convertirlo en participante.
- [x] Mantener el chat del panel derecho como un único asistente auxiliar que responde normalmente al usuario.
- [x] Mantener los permisos normales del panel derecho aunque Multichat no tenga tools.
- [x] No persistir la conversación Multichat por el hecho de abrir o usar el panel derecho.
- [x] Invalidar el contexto del panel cuando se cierre la sala, cambie la biblioteca o se destruya la pestaña.
- [x] Cubrir con pruebas el contexto presente, la conversación truncada a 40 mensajes, el aislamiento tras cerrar la sala y la independencia del panel derecho.

## Fase 7 — Validación multiplataforma y pruebas

- [x] Agregar pruebas unitarias del motor de selección, aleatoriedad inyectable, ventanas de contexto, turnos, streaming y ausencia de tools.
- [x] Agregar pruebas de servicios de dinámicas y prompts sin filesystem real ni datos privados.
- [x] Agregar pruebas de integración del runtime plano con varios agentes y ejecución secuencial simulada.
- [ ] Agregar pruebas de UI para configuración, validaciones, conversación vacía, mensajes diferenciados, cancelación y cierre efímero.
- [ ] Agregar pruebas de accesibilidad para la acción de barra, selector de dinámica, selección múltiple, compositor, streaming y mensajes.
- [ ] Verificar Windows con archivos locales y watcher de biblioteca.
- [ ] Verificar Android con SAF, lectura de `.agent/dynamics/`, prompts, creación de sala, cancelación y cierre de pestaña.
- [x] Ejecutar `npm test -- --run`.
- [x] Ejecutar `npx tsc --noEmit`.
- [x] Ejecutar `npm run lint`.
- [x] Ejecutar `npm run build -- --minify=false`.
- [x] Ejecutar `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [x] Ejecutar `cargo check --manifest-path src-tauri/Cargo.toml --tests`.
- [x] Ejecutar `git diff --check`.
- [x] Registrar explícitamente las validaciones manuales pendientes de Android físico, si no hubiera dispositivo disponible.

## Fase 8 — Documentación y entrega

- [x] Revisar el diff completo y preservar cualquier cambio preexistente.
- [x] Verificar que no se hayan creado logs temporales, archivos accidentales, secretos ni artefactos generados.
- [x] Marcar en este archivo únicamente las tareas implementadas y verificadas.
- [x] Actualizar `README-TECH.md` con arquitectura, llamada plana, streaming, ausencia de tools, ciclo efímero, orquestación, contexto del panel, límites y validaciones reales mediante el flujo documental obligatorio.
- [x] Actualizar `README.md` con el uso visible de Multichat, streaming y ausencia de tools mediante el flujo documental obligatorio.
- [x] Actualizar `FUNCIONALIDADES.md` con la funcionalidad visible, manteniendo el archivo como lista breve.
- [x] Agregar exactamente una línea nueva a `CHANGELOG.md` con fecha, hora, zona horaria y resumen del cambio.
- [x] Solicitar obligatoriamente al subagente documentador la sincronización final con el resumen de cambios, archivos modificados y validaciones ejecutadas.
- [x] Revisar el resultado del subagente documentador y corregir contradicciones documentales antes de entregar.

## Criterios de aceptación

- [x] Existe un acceso **Multichat** debajo de Calendario en la barra izquierda.
- [x] La aplicación garantiza `.agent/dynamics/` y permite elegir dinámicas Markdown creadas por el usuario.
- [x] El usuario puede seleccionar una dinámica y entre uno y seis agentes de `.agent/promps/`.
- [x] La sala no inicia si la dinámica o algún prompt seleccionado está vacío, ilegible o inválido.
- [x] Multichat no ofrece tools, búsquedas web, mutaciones ni selección de permisos de sala.
- [x] La sala comienza vacía y el primer mensaje siempre lo escribe el usuario.
- [x] El usuario puede incluir contexto adicional al crear la sala y cada agente lo recibe junto con la dinámica y su prompt en cada turno.
- [x] Solo participan agentes seleccionados para esa sala.
- [x] Las respuestas son secuenciales y cada agente recibe los últimos 40 mensajes identificados por hablante.
- [x] Las rondas automáticas entre agentes son posibles, pero se detienen después de un límite aleatorio de una a cuatro rondas sin usuario, salvo que la dinámica pida esperar.
- [x] Cada agente muestra thinking y respuesta mediante streaming del adaptador plano de Ollama.
- [x] Cada agente se identifica visualmente por nombre, icono y color.
- [x] La sala no se persiste y se pierde al cerrar la pestaña Multichat.
- [x] El contexto de la sala se incluye en cada llamada plana; la sala no usa tools ni memoria global del agente.
- [x] El panel derecho reconoce el contexto Multichat y puede consultar la conversación activa, pero responde como asistente único y no participa en la sala.
- [x] El panel derecho conserva sus permisos normales aunque Multichat no tenga tools.
- [ ] El comportamiento funciona en Windows y Android dentro de las limitaciones de plataforma documentadas.

## Riesgos y límites que deben documentarse

- [x] La aleatoriedad debe ser reproducible en pruebas y no debe permitir participantes fuera del conjunto seleccionado.
- [x] La ejecución secuencial puede aumentar la latencia y el consumo de tokens con seis agentes.
- [x] La ventana de 40 mensajes debe respetarse aunque la conversación total crezca; el estado visual puede conservar más mensajes mientras el contexto enviado se acota.
- [x] El contenido de dinámicas, prompts y contexto es una instrucción del usuario, pero no habilita tools ni búsquedas.
- [x] El stream puede aumentar la latencia y el consumo de tokens con seis agentes; la cancelación debe descartar resultados obsoletos.
- [x] Si una llamada plana o un agente falla durante una cadena automática, el runtime debe detener la continuación automática y mostrar un estado recuperable.
