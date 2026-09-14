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
