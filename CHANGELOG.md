[2026-09-18 00:51:12 -03:00] Se sincronizó la documentación con el contrato global de IA, Finanzas, conciliación y la vista de Servicios.
[2026-09-18 00:03:50 -03:00] Se hizo idempotente por centavos el replay nativo de ocurrencias y se sincronizó el vínculo de la compra asociada.
[2026-09-17 23:42:39 -03:00] Se normalizó por centavos el matching local de pagos y la recuperación de ocurrencias.
[2026-09-17 23:34:33 -03:00] Se hizo resiliente la carga de Servicios y se normalizaron por centavos los vínculos e idempotencia financiera.
[2026-09-17 22:50:40 -03:00] Se limitó Telegram Finanzas a una confirmación por mutación y se vinculó de forma segura el pago local único de las ocurrencias.
[2026-09-17 22:16:58 -03:00] Se reforzó el alta de ocurrencias de servicios y se hicieron terminales seguras sus respuestas de éxito, cancelación y error.
[2026-09-17 21:47:25 -03:00] Se fijó esbuild 0.27.7 para estabilizar el build multipágina de desarrollo en Windows.
[2026-09-17 20:19:47 -03:00] Se evitó el panic de la auditoría financiera ante ocurrencias impagas cubiertas por evidencia de tarjeta y se reforzó el manejo de datos incompletos.
[2026-09-17 19:21:59 -03:00] Se precisó que las ambigüedades financieras no se aplican automáticamente, pero admiten resolución manual explícita por chat y Telegram con confirmación reforzada.
[2026-09-17 16:20:27 -03:00] Se incorporó el control integral de Finanzas mediante snapshot, lecturas paginadas y CRUD con confirmaciones reforzadas en las tools de IA.
[2026-09-17 15:11:37 -03:00] Se integraron Servicios debajo del dashboard de Home y se reparan columnas de servicio en bases SQLite v19 incompletas.
[2026-09-17 13:39:14 -03:00] Se corrigió useTelegramAgentBridge para propagar explícitamente la política efímera sin memoria al construir el agente.
[2026-09-17 03:30:10 -03:00] Se reforzó la auditoría financiera con acciones estructuradas permitidas, aplicación transaccional nativa, huella vigente, actor/contexto y confirmación individual.
[2026-09-17 03:04:12 -03:00] Se documentaron los servicios mensuales, las facturas y la auditoría asistida de Finanzas con su migración, contratos, seguridad y límites reales.
[2026-09-16 23:36:06 -03:00] Se eliminó la referencia documental a la auto-confirmación financiera de Telegram y se mantuvo el ciclo común de confirmación reforzada.
[2026-09-16 23:19:46 -03:00] Se sincronizó la documentación con el motor global de IA, la autenticación vigente de Task Manager, la autorización financiera por #Confidencial y las validaciones realmente ejecutadas.
[2026-09-16 19:53:28 -03:00] Se incorporó el motor global de IA versionado con actor estable por biblioteca, autorización exacta por contexto, proyección segura para URL pública/Telegram, memoria exclusiva del Owner y auditoría de actor en Finanzas.
[2026-09-16 01:20:51 -03:00] Se implementaron roles y usuarios persistidos por biblioteca, contraseñas con PBKDF2, vinculación segura de Telegram y login del Task Manager publicado contra usuarios de SQLite.
[2026-09-15 22:48:01 -03:00] Graph View volvió a priorizar el contexto vigente del tablero y recalcula su configuración al cambiar de vista, evitando aplicar un contexto antiguo del frontmatter.
[2026-09-15 22:36:04 -03:00] Graph View ahora respeta el contexto explícito de los tickets en frontmatter y usa el contexto del tablero solo cuando el archivo no declara uno.
[2026-09-15 22:29:14 -03:00] La leyenda de Graph View ahora muestra todos los contextos configurados, incluso cuando todavía no hay notas asociadas.
[2026-09-15 22:22:43 -03:00] La configuración de contextos ahora separa el alta en un formulario superior y muestra los contextos en una tabla con acciones de color y eliminación.
[2026-09-15 14:19:01 -03:00] Graph View ajustó los títulos del canvas 2D a una tipografía más pequeña y liviana para reducir la saturación visual y el solapamiento entre etiquetas.
[2026-09-15 13:52:21 -03:00] Graph View migró de `react-force-graph-3d` a `react-force-graph-2d`; los nodos y títulos se dibujan en canvas 2D y se retiraron las dependencias de Three.js.
[2026-09-15 02:47:26 -03:00] Se redujo el costo visual de Graph View: se eliminó el bloom y el filtro CSS del canvas, se atenuaron halos y partículas, se bajó la resolución de nodos y enlaces y se desactivó el antialiasing para mejorar la fluidez.
[2026-09-15 02:41:48 -03:00] Graph View incorporó estética de red neuronal: bloom WebGL, halo CSS, materiales aditivos, partículas en las conexiones activas y resaltado de vecinos al hacer hover.
[2026-09-15 02:31:56 -03:00] Graph View ahora muestra títulos persistentes en cada nodo 3D mediante `three-spritetext`; el path se eliminó tanto de las etiquetas visibles como del tooltip.
[2026-09-15 02:27:55 -03:00] Se eliminó el auto-fit del callback de finalización del layout 3D para que el zoom, la órbita y el paneo manuales no vuelvan a la posición inicial; el ajuste queda en la acción explícita de centrado.
[2026-09-15 02:20:35 -03:00] Se corrigió el zoom de Graph View: el auto-fit inicial ya no usa una transición que sobrescriba la cámara y se desactiva cuando el usuario empieza a interactuar.
[2026-09-15 02:10:20 -03:00] Graph View migró a `react-force-graph-3d`/`ForceGraph3D`, con controles Orbit, cámara 3D y una simulación de fuerzas más estable para evitar saltos y movimiento continuo.
[2026-09-15 01:57:28 -03:00] Se estabilizaron los launchers de desarrollo de Tauri: generan los assets multipágina sin minificar para evitar el crash intermitente de esbuild en Windows durante el empaquetado local; el build de producción mantiene la minificación.
[2026-09-15 02:01:11 -03:00] Graph View usa el entrypoint `react-force-graph-2d` para evitar que la distribución completa cargue componentes VR/AR que requieren el global `AFRAME`.
[2026-09-15 01:08:50 -03:00] Se reemplazó el renderer Mermaid de Graph View por `react-force-graph`/`ForceGraph2D`, conservando búsqueda, selección de contexto, navegación, colores y persistencia del viewport.
[2026-09-14 20:02:29 -03:00] Se corrigió el formato de respuestas de Telegram para convertir listas HTML del modelo en viñetas compatibles, sin mostrar etiquetas `<ul>` o `<li>` como texto.
[2026-09-14 19:53:09 -03:00] Se agregó un filtro final para impedir que el agente exponga reglas internas, prompts, correcciones de validación o nombres internos de herramientas.
[2026-09-14 19:39:03 -03:00] Se evitó que el validador financiero de Telegram interrumpa consultas documentales como reuniones e historiales de sincros, manteniendo la validación en solicitudes financieras y comprobantes.
[2026-09-14 19:24:29 -03:00] Se corrigió el scope de Telegram para consultar transversalmente la biblioteca, los tickets de Task Manager y Finanzas sin quedar limitado por el módulo activo.
[2026-09-12 12:38:12 -03:00] Se establecieron las reglas para mantener FUNCIONALIDADES.md y CHANGELOG.md después de cada iteración y se crearon ambos archivos.
[2026-09-12 12:41:52 -03:00] Se volvió genérico AGENTS-DOC.md y se trasladó la nota técnica de concurrencia de Task Manager publicado a README-TECH.md.
[2026-09-12 12:42:58 -03:00] Se volvió genérico AGENTS.md para separar las reglas de trabajo de la información técnica específica del producto.
[2026-09-12 13:49:51 -03:00] Se definió que las notas nuevas usen #Personal por defecto y que Graph View coloree los nodos según su contexto.
[2026-09-12 13:52:57 -03:00] Se agregó la herencia de contexto desde los tableros de Task Manager para sus archivos Markdown y la selección de contexto en crear/editar tablero.
[2026-09-12 13:55:43 -03:00] Se revisó tasks.md contra README.md, README-TECH.md y FUNCIONALIDADES.md y se aclararon fuentes de verdad, herencia, edición manual y renderizado de Graph View.
[2026-09-12 14:27:01 -03:00] Se implementaron contextos por biblioteca, frontmatter `contexto`, colores en Graph View, contexto heredado por tableros de Task Manager y defaults #Laboral/#Personal/#Academico.
[2026-09-12 18:49:12 -03:00] Se corrigió la edición del contexto de tableros de Task Manager para conservarla después de la sincronización y actualizar los archivos `.md` asociados.
[2026-09-12 20:09:19 -03:00] Se corrigió la creación de tarjetas desde el navegador publicado evitando recrear carpetas de tableros ya existentes.
[2026-09-12 22:11:45 -03:00] Se corrigió la eliminación de grupos/columnas en el Task Manager publicado sincronizando la configuración con el host.
[2026-09-12 22:27:40 -03:00] Se evitó crear subtareas huérfanas en la URL publicada validando y canonicalizando la tarea padre antes de escribir el archivo.
[2026-09-12 22:35:31 -03:00] Se corrigió la publicación del contexto de los tableros y se separó explícitamente la creación de tareas principales de la creación de subtareas para evitar herencias accidentales.
[2026-09-13 00:38:55 -03:00] Se mejoró el feedback del agente de Telegram: el acuse quedó integrado al progreso editable, se actualiza al iniciar el thinking y las confirmaciones distinguen búsquedas web de cambios en la biblioteca.
[2026-09-13 00:55:06 -03:00] Se evitó que Telegram invente noticias o fuentes: las consultas actuales se enrutan al scope con búsqueda web, se exige ejecutar la herramienta y se validan los enlaces citados contra sus resultados.
[2026-09-16 01:40:13 -03:00] El Task Manager publicado usa la autenticación de usuarios de la biblioteca, revoca sesiones al cambiar o eliminar usuarios y elimina la autorización manual heredada de Telegram y publicación.

[2026-09-16 02:24:00 -03:00] Se completaron los pendientes de implementación: protección contra respuestas obsoletas al cambiar de biblioteca, layout responsive y controles táctiles de Configuraciones, backoff del enlace de Telegram y retiro del sistema de credenciales duplicadas de la publicación.

[2026-09-16 02:35:04 -03:00] Se corrigio el desplazamiento del menu y del contenido de Configuraciones para evitar que las secciones queden recortadas.

[2026-09-16 02:48:29 -03:00] Los desplegables de Configuraciones ahora reutilizan el engine global de submenús con navegación por teclado y cierre consistente.

[2026-09-16 02:55:07 -03:00] Se corrigio el enlace inicial de Telegram: los chats sin usuario ahora reciben la indicacion de iniciar sesion con `/start` en lugar de un error de verificacion.

[2026-09-16 03:01:43 -03:00] Se corrigio el alta de contrasena durante el primer enlace de Telegram para usuarios cuyo hash todavia es NULL.
[2026-09-16 03:08:48 -03:00] El launcher de desarrollo de Tauri para Windows reintenta una vez el build de assets cuando esbuild se detiene de forma transitoria.
[2026-09-16 15:14:29 -03:00] Telegram valida y sanea el HTML de las respuestas y reintenta como texto plano cuando la API rechaza entidades mal formadas.
[2026-09-16 15:37:00 -03:00] Se reforzó el prompt específico de Telegram para impedir Markdown escapado y etiquetas HTML con atributos no compatibles.
[2026-09-16 17:20:11 -03:00] Telegram ahora muestra el detalle concreto de cada confirmación y entrega las respuestas del agente directamente en el formato del canal.
[2026-09-16 17:57:01 -03:00] Las acciones de Usuarios usan iconos compactos y los modales del motor global ocupan el 75% de la ventana.
[2026-09-16 18:20:12 -03:00] Usuarios admite contextos permitidos con Owner de acceso total; se agrega #Confidencial en rojo y se aplica a la configuración de .agent y chat.
[2026-09-16 20:57:10 -03:00] Se completó la integración pendiente del contrato global: Android valida el sobre antes del plugin, Finanzas autentica actor/contexto en Tauri, Graph View usa chat en memoria y la URL pública recibe la lista de tableros aprobados desde Rust; `tasks.md` quedó completamente marcado.
[2026-09-17 00:19:59 -03:00] Se corrigió el chat lateral de Finanzas para reutilizar el historial global y reintentar respuestas nativas vacías transitorias después de tools.
[2026-09-17 19:57:58 -03:00] Se ajustó la conciliación de servicios con descriptores identificados y el flujo seguro de propuestas de auditoría financiera.
