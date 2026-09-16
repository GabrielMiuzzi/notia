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
