# Optimización del motor global de IA y experiencia conversacional

> Estado: Fases 1–13 implementadas y verificadas; quedan validaciones manuales de entorno.
>
> Este plan reemplaza el plan anterior de Multichat, por decisión explícita de la persona usuaria.

## Objetivo

Optimizar el motor global de IA para que Notia se comporte como un asistente simpático, inteligente, natural y prudente en el chat principal, chats desplegables, Finanzas, Telegram, Meeting, publicación y demás superficies que usan el motor global, dejando Multichat fuera por utilizar un flujo plano independiente.

El agente debe responder de forma directa y humana, usar el contexto y las herramientas correctas, no inventar datos, evitar rondas repetitivas, distinguir consultas simples de análisis compuestos y conservar las confirmaciones y autorizaciones existentes para toda mutación.

## Decisiones confirmadas

- Incluir todas las superficies del motor global salvo Multichat.
- Usar un tono cálido, claro, directo y español rioplatense.
- No imponer un resumen fijo con “qué cambió”, “pendiente” y “próximo paso” en cada respuesta.
- No usar “Listo” ni estructuras operativas artificiales cuando solo se consultaron datos.
- Mostrar únicamente la información relevante para la pregunta; ampliar solo cuando aporte valor o el usuario lo pida.
- Resolver “mis últimos sueldos” mostrando los últimos 3 recibos ordenados por fecha de cobro y período.
- Permitir cambios de prompt, flujo, runtime, contratos y descripciones de tools cuando sean necesarios para corregir el comportamiento.
- Mantener autorización por actor, contextos y permisos.
- Mantener confirmaciones visibles para todas las mutaciones y no auto-confirmar escrituras.
- Las búsquedas web no requieren confirmación de ningún tipo.
- Las búsquedas web mantienen sanitización, bloqueo de datos privados, contenido público solamente y citas con URLs devueltas.
- Una operación puede ejecutar hasta 6 búsquedas web únicas.
- Las consultas web duplicadas no vuelven a ejecutarse ni consumen red ni cuota.
- Mantener `DEFAULT_AGENT_PROMPT` embebido como fuente del default; conservar cualquier `default.md` legacy sin leerlo ni sobrescribirlo.

## Problemas observados que deben resolverse

- El prompt default obliga a cerrar respuestas simples con un resumen operativo, lo que vuelve artificial el diálogo.
- Telegram expone demasiado lenguaje técnico de progreso, como rondas, construcción de contexto y estados genéricos de operación.
- La lectura de salarios puede convertirse prematuramente en una respuesta terminal e impedir combinar salarios con IPC, cotizaciones u otros datos.
- “Últimos sueldos” puede devolver todo el historial en vez de una selección acotada.
- El modelo puede elegir tools financieras demasiado amplias o encadenar lecturas repetidas.
- Las APIs `create_*` y `save_*` financieras tienen solapamientos y descripciones extensas que dificultan la elección correcta.
- Algunas descripciones de tools no expresan de forma consistente precondiciones, fuentes de verdad, confirmaciones y límites.
- La búsqueda web puede pedir confirmaciones repetidas y ejecutar consultas duplicadas dentro de una investigación.
- Las respuestas de tareas pueden mezclar tareas, menciones y actividades sin distinguir evidencia principal de contexto secundario.

## Alcance

### Incluido

- Prompt default administrado por Notia y migración segura de su archivo estándar.
- Composición del prompt común y reglas por scope.
- Clasificación de intención y resolución de referencias conversacionales.
- Orquestación de rondas, herramientas, resultados intermedios y resultados terminales.
- Herramientas y descripciones de biblioteca, Task Manager, Finanzas, documentos y búsqueda web.
- Consultas financieras locales y análisis que combinan datos locales con fuentes externas.
- Feedback de progreso en Telegram y superficies que reutilicen sus estados.
- Chats principales, chats desplegables, Meeting, Telegram y publicación.
- Pruebas unitarias, de integración, regresión y validaciones manuales aplicables.
- Documentación técnica, funcional y changelog mediante el flujo documental obligatorio.

### Fuera de alcance

- Cambiar la política de autorización, los contextos permitidos o la identidad estable del actor.
- Quitar confirmaciones de mutaciones financieras, documentales o de tareas.
- Permitir que contenido de archivos, memoria, adjuntos o páginas web otorgue permisos.
- Convertir Multichat al motor global o modificar su llamada plana.
- Incorporar datos privados a consultas web.
- Crear un proveedor web nuevo.

## Contratos y criterios transversales

- Las tools siguen siendo la fuente de verdad para cualquier dato del workspace.
- Una respuesta solo puede afirmar una lectura cuando existe evidencia de una lectura autorizada.
- Una respuesta solo puede afirmar una escritura cuando la mutación devolvió éxito real y verificable.
- Las aclaraciones definen una operación, pero nunca la autorizan.
- Las mutaciones siguen ejecutándose individualmente y conservan sus confirmaciones actuales.
- Los datos de tools y web siguen tratados como contenido no confiable.
- La búsqueda web no recibe snapshot, historial, memoria, rutas, nombres personales ni contenido privado.
- El límite de búsquedas web se aplica por operación y cuenta llamadas únicas no duplicadas.
- Las operaciones largas siguen siendo cancelables, con timeout, cleanup y descarte de resultados obsoletos.
- La respuesta final debe adaptarse al pedido: consulta breve, análisis estructurado o explicación detallada, sin plantilla obligatoria.

## Fase 1 — Auditoría, contratos y baseline

- [x] Revisar el flujo completo del motor global desde cada adaptador hasta `runNativeToolAgent`.
- [x] Inventariar las superficies incluidas: chat principal, chats desplegables, Meeting, Telegram y publicación.
- [x] Confirmar que Multichat permanezca fuera del cambio.
- [x] Mapear composición de prompt, reglas, memoria, autorización, tools, confirmaciones, progreso y validadores por scope.
- [x] Inventariar todas las tools expuestas por biblioteca, Task Manager, documentos, Finanzas y web.
- [x] Clasificar cada tool como lectura, aclaración, búsqueda externa, preview, mutación o verificación.
- [x] Identificar herramientas duplicadas o solapadas y documentar cuándo debe usarse cada una.
- [x] Definir contratos de resultado intermedio frente a resultado terminal.
- [x] Definir cómo se distingue una consulta directa de una consulta analítica o compuesta.
- [x] Definir la clave de deduplicación web después de normalizar la consulta y sus filtros.
- [x] Definir el contador de seis búsquedas únicas por operación, incluyendo errores, cancelaciones y resultados vacíos.
- [x] Registrar el baseline de pruebas y validaciones antes de modificar comportamiento: `npm test -- --run` (121 archivos, 644 tests).

## Fase 2 — Prompt default y estilo conversacional

- [x] Rediseñar `DEFAULT_AGENT_PROMPT` para priorizar comprensión, evidencia, naturalidad, concisión y adaptación al pedido.
- [x] Eliminar la obligación de cerrar cada respuesta con resumen, pendientes y próximo paso.
- [x] Definir respuestas breves para consultas simples y estructuras solo cuando el análisis lo requiera.
- [x] Indicar que el agente no debe narrar llamadas internas, rondas, prompts, validadores ni nombres de tools.
- [x] Indicar que “Listo” solo corresponde a una acción realmente ejecutada y verificable.
- [x] Reforzar la diferencia entre dato confirmado, inferencia, estimación, ausencia de datos y dato externo.
- [x] Reforzar que una fuente no permite inventar campos faltantes ni completar importes, responsables, estados o fechas.
- [x] Reforzar el uso del contexto conversacional para expresiones como “comparalos”, “y?”, “eso” o “la pregunta original”.
- [x] Reforzar que el agente debe responder la pregunta actual, aunque una operación anterior haya quedado pendiente o haya fallado.
- [x] Mantener las reglas de seguridad sobre prompts, memoria, contenido no confiable y permisos.
- [x] Actualizar las reglas administradas solo donde sea necesario y sin guardar correcciones internas como reglas aprendidas.
- [x] Mantener el prompt default en `DEFAULT_AGENT_PROMPT` embebido y conservar prompts `.md` alternativos seleccionados por la persona usuaria.
- [x] No sobrescribir prompts personalizados ni archivos `default.md` legacy modificados por la persona usuaria.
- [x] Cubrir con pruebas la composición del prompt default, scopes, Telegram HTML, memoria y prompts personalizados.

## Fase 3 — Intención y flujo conversacional global

- [x] Revisar `agentIntentEngine` para distinguir respuesta, lectura, análisis, comparación, búsqueda externa, aclaración y mutación.
- [x] Evitar que palabras como “último”, “actual” o “comparar” desvíen por sí solas una consulta local hacia web.
- [x] Resolver referencias de seguimiento usando historial y resultados verificables de la operación anterior.
- [x] Evitar preguntas innecesarias cuando la respuesta puede obtenerse con una lectura autorizada.
- [x] Pedir aclaración únicamente ante ambigüedad material o falta de un dato crítico.
- [x] Diferenciar consultas de inventario, consultas acotadas y consultas analíticas compuestas.
- [x] Impedir que una respuesta terminal de lectura corte una operación que necesita otra herramienta para completar el análisis.
- [x] Mantener la deduplicación de tools y mejorar la corrección interna para reutilizar resultados ya obtenidos.
- [x] Revisar el límite de rondas para que corte ciclos sin impedir flujos legítimos de lectura, análisis y confirmación.
- [x] Cubrir lectura seguida de análisis, aclaración, cancelación, fallo, reintento válido y continuación desde historial.

## Fase 4 — Finanzas locales y análisis sin alucinaciones

- [x] Cambiar “últimos sueldos” para consultar `list_finance_salaries` y devolver solo los 3 recibos más recientes por `paymentDate` y luego `period`.
- [x] Permitir filtros explícitos de período cuando el usuario pida un rango, año o comparación concreta.
- [x] Evitar presentar todo el historial salvo que el usuario lo solicite.
- [x] Hacer que la lectura salarial permanezca disponible para rondas posteriores cuando la consulta pida análisis.
- [x] Resolver “¿le estoy ganando a la inflación?” combinando salarios locales con `get_finance_inflation_indices` o la fuente externa autorizada correspondiente.
- [x] Distinguir salario neto, bruto, pagos extraordinarios, IPC mensual, inflación acumulada e inflación interanual.
- [x] Marcar explícitamente inferencias, meses atípicos y datos faltantes de conceptos.
- [x] Resolver escenarios de presupuesto usando primero datos financieros locales y luego datos externos solo cuando el usuario los pida.
- [x] No presentar saldos, gastos o compromisos como completos si las colecciones están truncadas o faltan categorías de consumo.
- [x] Revisar si `get_finance_full_snapshot`, `list_finance_records` o tools específicas son la mejor herramienta para cada consulta.
- [x] Auditar los solapamientos entre `create_*` y `save_*` y documentar una preferencia clara para el modelo.
- [x] Simplificar y normalizar descripciones de lectura, escritura, preview, auditoría, conciliación y extracción.
- [x] Alinear todas las descripciones con la confirmación real del canal, especialmente Telegram.
- [x] Eliminar frases que permitan interpretar que una confianza alta salta una confirmación obligatoria.
- [x] Mantener autorización `#Confidencial`, confirmaciones individuales, idempotencia y verificación posterior.
- [x] Agregar regresiones para sueldos directos, sueldos + inflación, presupuestos, datos faltantes, monedas separadas y colecciones truncadas.

## Fase 5 — Búsqueda web segura y natural

- [x] Eliminar la solicitud de confirmación previa para `search_web` en todos los canales donde esté disponible.
- [x] Mantener la sanitización final antes de cualquier red, sin delegar la protección al prompt.
- [x] Mantener el bloqueo de secretos, PII, datos laborales, financieros, médicos, legales, rutas, memoria y contenido privado.
- [x] Permitir varias búsquedas públicas dentro de una investigación lógica, con máximo 6 llamadas únicas por operación.
- [x] Deduplicar consultas normalizadas incluyendo dominios, frescura y límites relevantes.
- [x] Reutilizar resultados duplicados sin ejecutar una segunda llamada al proveedor.
- [x] Detener la investigación al alcanzar el límite y comunicar qué parte quedó sin verificar.
- [x] Evitar búsquedas automáticas para datos locales de Finanzas.
- [x] Mantener búsquedas obligatorias para pedidos explícitos de información pública o actualidad cuando el catálogo las permita.
- [x] Mantener citas exclusivamente con URLs devueltas por la búsqueda.
- [x] Separar hechos recuperados, inferencias y límites de evidencia.
- [x] Cubrir múltiples consultas, duplicados, límite, error del proveedor, cancelación, resultados vacíos y consulta bloqueada.
- [x] Revisar los mensajes de error para que una búsqueda cancelada o fallida no aparezca como una mutación incompleta.

## Fase 6 — Tools y descripciones

- [x] Revisar las descripciones de todas las tools del catálogo global por claridad, brevedad y lenguaje accionable.
- [x] Explicitar en cada lectura qué fuente consulta, qué devuelve y qué no permite afirmar.
- [x] Explicitar en cada mutación precondiciones, campos obligatorios, confirmación, idempotencia y resultado esperado.
- [x] Explicitar cuándo una tool requiere una lectura previa y cuál lectura exacta debe usar.
- [x] Separar claramente `request_user_clarification` de confirmación y autorización.
- [x] Reducir instrucciones contradictorias entre prompt, descripción de tool y validadores runtime.
- [x] Revisar el catálogo filtrado por scope y evitar ofrecer capacidades que el canal no puede ejecutar.
- [x] Revisar herramientas de planes para que solo se utilicen en solicitudes realmente compuestas.
- [x] Revisar tools de Task Manager para distinguir búsqueda de tickets, lectura completa, contexto RAG y actividades/menciones.
- [x] Hacer que respuestas sobre personas agrupen tickets únicos y separen evidencia de menciones incidentales.
- [x] Revisar descripciones de edición documental para evitar promesas de escritura sin preview, confirmación y verificación.
- [x] Agregar pruebas de contrato que validen nombres, descripciones críticas, parámetros y filtrado por scope.

## Fase 7 — Progreso, errores y adaptadores

- [x] Reducir por defecto el feedback técnico visible en Telegram.
- [x] Reemplazar lenguaje de rondas y construcción interna por estados breves orientados al usuario.
- [x] Mantener progreso detallado como opción explícita, sin exponer thinking crudo ni nombres internos.
- [x] Evitar enviar mensajes de “Listo” para una lectura antes de que exista una respuesta final natural.
- [x] Unificar los estados de espera de aclaración, espera de confirmación, búsqueda, lectura, ejecución y verificación.
- [x] Evitar mensajes de error genéricos cuando el resultado concreto sea cancelación, ausencia de datos, búsqueda bloqueada o falta de evidencia.
- [x] Mantener un solo mensaje de progreso editable cuando la preferencia del usuario lo indique.
- [x] Verificar que chat principal, chats desplegables, Telegram, Meeting y publicación reciban respuestas consistentes sin perder su formato específico.
- [x] Cubrir cola, cancelación, timeout, pérdida de foco, resultado obsoleto y error de transporte.

## Fase 8 — Pruebas de regresión y validación

- [x] Agregar pruebas del tono y composición del prompt sin depender de un modelo real.
- [x] Agregar pruebas de intención local frente a web y de continuidad conversacional.
- [x] Agregar pruebas de terminalidad condicional de herramientas financieras.
- [x] Agregar pruebas de “últimos 3 sueldos”.
- [x] Agregar pruebas de comparación salarial contra inflación y de análisis compuesto.
- [x] Agregar pruebas de presupuesto con datos locales incompletos y datos externos.
- [x] Agregar pruebas de búsqueda web sin confirmación, sanitización, deduplicación y límite de 6.
- [x] Agregar pruebas de una mutación que sigue requiriendo confirmación y autorización.
- [x] Agregar pruebas de Telegram HTML y progreso natural.
- [x] Agregar pruebas de chats desplegables y publicación.
- [x] Agregar regresiones para consultas de tareas, personas, actividades y documentos.
- [x] Ejecutar `npm test -- --run` (121 archivos, 677 tests).
- [x] Ejecutar `npx tsc --noEmit`.
- [x] Ejecutar `npm run lint`.
- [x] Ejecutar `npm run build -- --minify=false`.
- [x] Ejecutar `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [x] Ejecutar `cargo check --manifest-path src-tauri/Cargo.toml --tests`.
- [x] Ejecutar `git diff --check`.
- [ ] Validar manualmente Telegram con consultas locales, análisis financiero, búsquedas web y una mutación confirmada.
- [ ] Validar manualmente un chat desplegable con contexto activo y una consulta compuesta.
- [x] Registrar explícitamente validaciones de Android y cualquier plataforma no disponible: no hay dispositivo Android/Telegram real disponible en este entorno; queda pendiente la validación manual.

> Validaciones manuales pendientes por disponibilidad del entorno: Telegram real y chat desplegable con UI real. La cobertura determinista de sus adaptadores y el flujo común sí está verificada por tests.

## Fase 9 — Documentación y entrega

- [x] Revisar el diff completo y preservar cambios preexistentes.
- [x] Verificar que no existan logs temporales, archivos accidentales, secretos ni artefactos generados.
- [x] Actualizar `README-TECH.md` con el nuevo prompt, flujo, terminalidad, tools, búsqueda web, límite, seguridad y validaciones reales.
- [x] Actualizar `README.md` con el comportamiento visible y el uso de búsquedas web sin confirmación.
- [x] Actualizar `FUNCIONALIDADES.md` si el cambio altera una capacidad visible.
- [x] Agregar exactamente una línea nueva a `CHANGELOG.md` con fecha, hora, zona horaria y resumen.
- [x] Solicitar al subagente documentador la sincronización final con resumen de cambios, archivos y validaciones.
- [x] Revisar el resultado del subagente documentador y corregir contradicciones.
- [x] Marcar en este archivo únicamente las tareas implementadas y verificadas.

## Criterios de aceptación

- [x] Una consulta simple recibe una respuesta simple, natural y basada en evidencia.
- [x] Las respuestas no incluyen resúmenes, pendientes o próximos pasos artificiales cuando no corresponden.
- [x] “Mis últimos sueldos” devuelve exactamente los 3 recibos más recientes sin búsqueda web.
- [x] Una pregunta sobre inflación no devuelve solamente la lista salarial: combina las fuentes necesarias y explica sus límites.
- [x] Una consulta sobre presupuesto distingue datos registrados de estimaciones externas.
- [x] Las búsquedas web nunca piden confirmación y nunca envían datos privados.
- [x] Una investigación puede ejecutar hasta 6 búsquedas únicas y no repite consultas.
- [x] Las fuentes web se citan con URLs reales devueltas por el proveedor.
- [x] Las escrituras continúan requiriendo autorización, preview y confirmación según el canal.
- [x] Telegram no muestra rondas, prompts, nombres internos ni thinking crudo por defecto.
- [x] El agente no afirma tareas, movimientos, documentos, salarios, fuentes o cambios que no estén respaldados.
- [x] Los chats principales, desplegables, Telegram, Meeting y publicación comparten el comportamiento global corregido.
- [x] Multichat conserva su flujo plano independiente.
- [x] Todas las validaciones aplicables pasan y las pendientes quedan documentadas.

## Riesgos y límites

- [x] Modelos distintos pueden interpretar de forma diferente prompts y descripciones; las reglas críticas deben permanecer en runtime.
- [x] Un límite de 6 búsquedas reduce ciclos, pero puede ser insuficiente para investigaciones muy amplias; el agente debe declarar el límite.
- [x] Quitar confirmaciones web no elimina riesgos de contenido externo; sanitización y aislamiento siguen siendo obligatorios.
- [x] Reducir instrucciones puede mejorar naturalidad, pero no debe eliminar reglas de evidencia, autorización o confirmación.
- [x] La migración del prompt default debe preservar personalizaciones y ser reversible.
- [x] Los análisis financieros dependen de la calidad, cobertura y fecha de los datos locales y externos.
- [x] La validación manual real de Telegram, Android y publicación puede quedar limitada por el entorno disponible.

## Fase 10 — Prompt default del sistema y prompts seleccionables

### Objetivo

Evitar que el agente global y Telegram usen `.agent/promps/default.md` como fuente del prompt default. El prompt default debe permanecer embebido en el sistema de Notia; solo un prompt `.md` distinto, seleccionado explícitamente desde `.agent/promps/`, debe incorporarse como prompt del agente.

- [x] Usar siempre `DEFAULT_AGENT_PROMPT` para la selección `default.md`, sin leerlo ni sobrescribirlo desde filesystem.
- [x] Mantener la creación de la estructura `.agent/` sin generar ni actualizar `default.md` automáticamente.
- [x] Mantener disponibles los prompts `.md` personalizados y cargarlos únicamente cuando sean seleccionados explícitamente.
- [x] Mantener `default.md` como opción virtual de la lista para volver al prompt del sistema, sin tratar su contenido persistido como fuente de verdad.
- [x] Cubrir con regresiones el default embebido, la preservación de archivos personalizados y la carga de un prompt alternativo.
- [x] Verificar que Telegram, chat principal, Meeting y publicación respeten la selección y que Multichat no pierda sus prompts elegibles mediante el runtime común y sus adaptadores.
- [x] Ejecutar `npm test -- --run` (121 archivos, 678 tests), `npx tsc --noEmit`, `npm run lint`, `npm run build -- --minify=false` y `git diff --check`.
- [x] Actualizar la documentación mediante el flujo obligatorio y registrar la validación real.

## Fase 11 — Sincronización visual de `default.md`

### Objetivo

Mantener `.agent/promps/default.md` como una representación visible del prompt default embebido, sin convertirlo en fuente de ejecución. Al inicializar la biblioteca, Notia debe crearlo si falta o sobrescribirlo si su contenido difiere de `DEFAULT_AGENT_PROMPT`; los demás prompts `.md` deben permanecer intactos.

- [x] Crear `default.md` con `DEFAULT_AGENT_PROMPT` cuando no exista.
- [x] Sobrescribir `default.md` cuando su contenido sea distinto al prompt default del sistema.
- [x] Continuar ignorando `default.md` como fuente de ejecución y usar siempre `DEFAULT_AGENT_PROMPT` para la selección default.
- [x] No sobrescribir ni modificar prompts `.md` alternativos.
- [x] Agregar regresiones para archivo ausente, archivo desactualizado, archivo sincronizado y prompt alternativo personalizado.
- [x] Ejecutar `npm test -- --run` (121 archivos, 679 tests), `npx tsc --noEmit`, `npm run lint`, `npm run build -- --minify=false` y `git diff --check` aplicables.
- [x] Actualizar la documentación mediante el flujo obligatorio y registrar la validación real.

## Fase 12 — Continuidad en escenarios de presupuesto desde Telegram

### Objetivo

Evitar que una consulta de factibilidad presupuestaria que menciona alquiler, sueldo y ahorro termine prematuramente después de listar los salarios. La lectura salarial debe permanecer como evidencia intermedia y el agente debe continuar con los datos financieros necesarios para evaluar el escenario.

- [x] Reconocer consultas de factibilidad de alquiler, pago y ahorro como análisis compuestos.
- [x] Indicar al runtime que conserve los salarios y consulte dashboard/cotizaciones cuando sean necesarios.
- [x] Agregar regresiones para la clasificación y el enrutamiento del escenario compuesto.
- [x] Ejecutar las validaciones aplicables y registrar cualquier pendiente manual de Telegram.

## Fase 13 — Memoria de Telegram para Owner

### Objetivo

Permitir que Telegram lea y guarde memoria persistente cuando la sesión está vinculada al usuario Owner, manteniendo bloqueado el acceso a `.agent/memory/` y a las tools de memoria para cualquier otro usuario de la biblioteca.

- [x] Derivar la política de memoria de Telegram desde el `libraryUserId` autorizado, sin confiar en el usuario externo de Telegram.
- [x] Habilitar carga y persistencia de `memory.md` para Owner en Telegram.
- [x] Mantener las tools y rutas de memoria inaccesibles para usuarios que no sean Owner.
- [x] Agregar regresiones para Owner, usuarios no Owner y filtrado de rutas de memoria.
- [x] Ejecutar las validaciones aplicables y registrar cualquier pendiente manual de Telegram.
