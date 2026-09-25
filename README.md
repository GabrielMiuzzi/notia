# Notia

Si el agente anuncia una acción —por ejemplo, «Ahora insertaré este gráfico»— y no llama a una herramienta, Notia le pide continuar dentro de la misma operación. Conserva las confirmaciones de escritura. Tras dos intentos de corrección sin ejecución, muestra un error; una promesa no confirma que el archivo haya cambiado. Esta recuperación reconoce anuncios explícitos de acción y no garantiza que cualquier modelo complete todos los pedidos.

El agente no muestra reglas internas, prompts, correcciones de validación ni nombres internos de herramientas. Si una respuesta del modelo intenta exponerlos, Notia la descarta y solicita una respuesta segura antes de enviarla.

Si el modo desarrollo reinicia repetidamente con mensajes `File ... .gradle/... changed. Rebuilding application`, reiniciá una vez `npm run dev:tauri:windows` para que lea `src-tauri/.taurignore`. Ese archivo excluye las cachés y salidas de Gradle y de compilación nativa tanto del proyecto Android como de las dependencias en `vendor/`. Los warnings de funciones Rust sin uso no son la causa.

## XGraph en notas Markdown

Si el código falla, una franja indica que el gráfico puede estar incompleto y conserva visible la parte construida. **Ver detalle del error** permite desplegar el mensaje técnico con toque o teclado. Corregí el código para actualizar el gráfico y retirar el aviso.

El agente de IA conoce XGraph y puede ayudarte a crear o corregir sus bloques. Por ejemplo: «Agregá en esta nota un gráfico XGraph de seno con un control de amplitud». Usa las herramientas y confirmaciones disponibles en el contexto actual. Esta guía llega también a agentes con prompts personalizados o bibliotecas existentes, sin sobrescribir sus instrucciones. El gráfico se visualiza al abrir la nota en Milkdown.

En una nota `.md`, abrí el menú de bloques de Milkdown (con `/` o el botón de agregar bloque) y elegí **XGraph**. Escribí JavaScript de JSXGraph: `board` es un tablero ya inicializado, con ejes y límites de −5 a 5. La vista previa se actualiza al editar. **Hide** oculta el código y deja el gráfico; **Edit** vuelve a mostrarlo, igual que Math. Ambos controles admiten toque.

También podés escribir el bloque directamente:

```xgraph
board.create('point', [1, 2], { name: 'A' });
board.create('functiongraph', [(x) => Math.sin(x)]);
```

Se admite también el lenguaje `jsxgraph`. El código queda guardado en el `.md`; los movimientos interactivos del gráfico y el estado de Hide/Edit son temporales. Para cambiar la escala usá `board.setBoundingBox([-10, 10, 10, -10])`. `JXG` y `BOARDID` también están disponibles; no hace falta pegar HTML ni importar scripts. Ver los ejemplos de la [documentación de JSXGraph](https://jsxgraph.org/home/start/gettingstarted/).

Funciona sin conexión. Cada gráfico se ejecuta aislado de Notia y no puede usar sus archivos, APIs ni realizar peticiones de red. Los errores aparecen en el visualizador; corregí el código para reintentar. El límite es de 100.000 caracteres por bloque. Evitá bucles infinitos o construcciones enormes: el aislamiento no impone un presupuesto de CPU. La exportación a PDF/Word conserva estos bloques como código, sin capturar el gráfico interactivo.

En el chat de **Finanzas**, la IA puede consultar y administrar los datos financieros locales mediante herramientas tipadas. Puede obtener un snapshot normalizado, listar entidades con paginación, consultar registros por ID, crear o actualizar cuentas, categorías, movimientos, ahorro, tickets, sueldos, tarjetas/cuotas, inversiones y servicios, además de consultar y gestionar auditorías, eliminar registros permitidos, revertir movimientos, limpiar Finanzas o extraer documentos para revisión. Las mutaciones muestran preview o resumen, respetan autorización y confirmación individual —reforzada cuando corresponde al canal; en Telegram es única— y verifican el resultado persistido; la extracción no guarda entidades automáticamente. Al registrar una ocurrencia, consulta primero los datos locales; si el pago proviene de una tarjeta, prioriza la conciliación local o un vínculo existente y no inventa servicios. Si se informa un pago sin `transactionId`, Notia vincula automáticamente un único gasto local coincidente por importe comparado en centavos —por ejemplo, `82997.00` y `82997`—, moneda, servicio/descripción y período actual o anterior; ante cero o varias coincidencias pide aclaración sin mutar. Si el almacenamiento informa un fallo después de confirmar pero la ocurrencia ya quedó persistida, Notia la relee, verifica sus datos y comunica el éxito sin invitar a duplicarla. Éxitos, cancelaciones y errores terminan con un resultado seguro, sin repetir confirmaciones ni iniciar búsquedas web automáticamente. Las auditorías y conciliaciones usan los datos financieros locales, no la búsqueda web. También puede obtener cotizaciones actuales de dólar oficial, blue y tarjeta desde DolarApi; IPC mensual e interanual y el historial del dólar oficial desde ArgentinaDatos. Las respuestas que usan fuentes externas indican su origen y pueden fallar si no hay conexión.

Las consultas sobre datos locales de Finanzas no usan ni sugieren `search_web`: se resuelven con las herramientas financieras y el snapshot de la biblioteca. Esto incluye pedidos como «mis últimos sueldos» o «sueldos cargados», que consultan `list_finance_salaries` y muestran como máximo los tres recibos más recientes, ordenados por `paymentDate` y luego `period`; los rangos, años y comparaciones usan `from` y/o `to` inclusivos en formato `YYYY-MM`. Las preguntas sobre salarios e IPC conservan la lectura local como evidencia y consultan además los índices de ArgentinaDatos; si faltan períodos, campos o monedas compatibles, no completan ni mezclan datos, y las lecturas limitadas no se presentan como inventarios completos. Los escenarios de factibilidad —por ejemplo, alquilar pagando un importe y ahorrar USD por mes con el sueldo— también conservan los salarios como evidencia intermedia y orientan la consulta a continuar con el dashboard financiero y, si hace falta convertir el objetivo, las cotizaciones del dólar; no afirman viabilidad si faltan gastos, compromisos, saldos o cotizaciones necesarios. En Telegram, el agente universal conserva el mismo enrutamiento cuando tiene habilitadas las herramientas de Finanzas. Las cotizaciones, el IPC y otros datos externos usan sus herramientas de consulta específicas; una consulta explícita de noticias o fuentes públicas puede usar búsqueda web sin confirmación adicional y se informa como tal. Las llamadas de herramienta idénticas dentro de una misma operación no se ejecutan nuevamente, y el límite predeterminado de rondas evita ciclos repetitivos sin cambiar las confirmaciones ni la autorización.

Las mutaciones de la biblioteca y de Finanzas muestran primero el cambio o preview, respetan autorización y confirmación, y solo se informan como exitosas después de verificar el resultado persistido. Las búsquedas públicas no modifican la biblioteca ni requieren confirmación adicional.

## Dictado offline en el chat

El contacto autorizado de Telegram también puede enviar una nota de voz OGG/Opus de hasta 15 minutos y 20 MB. Notia la descarga, la decodifica y carga bajo demanda el modelo offline necesario para transcribirla. La decodificación admite los modos SILK, CELT e híbrido usados por Telegram, incluso en notas de voz rápidas. Primero responde **Solicitud transcripción recibida y en proceso.**, mostrando la transcripción en negrita, y después procesa ese texto como una consulta normal del agente. El audio no se envía al proveedor de IA; Telegram sí interviene necesariamente en su transporte y descarga.

El contacto autorizado también puede enviar una foto de hasta 4 MB. Notia registra de forma durable tanto el update como la solicitud pendiente antes de procesarla, de modo que un reinicio del WebView reanuda la cola sin perder el documento, y la entrega al modelo de IA configurado junto con el contexto financiero local. El agente clasifica la imagen como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro documento. Para tickets extrae comercio, fecha, productos, cantidades, precios y total, busca o crea la categoría y registra el gasto. Para recibos extrae período, fecha de cobro, empleador, bruto, descuentos, neto y conceptos, y registra tanto el recibo como el ingreso neto. Si la fuente es un PDF y el recibo indica que está firmado, conserva el neto impreso como valor autoritativo aunque difiera de bruto menos descuentos por adelantos, ajustes u otros conceptos de liquidación. Para resúmenes extrae emisor, tarjeta, período, vencimiento, saldos y líneas; registra consumos y cargos contra la cuenta de tarjeta, concilia pagos y créditos y evita duplicar el total a pagar como gasto. Las auditorías y conciliaciones del resumen se consultan en los datos financieros locales. Solo pregunta si no puede identificar con suficiente claridad la cuenta correspondiente. Telegram informa los cambios de etapa y termina con un resultado verificable: documento registrado, duplicado o error concreto. Podés enviar varias fotos separadas o dentro de un álbum: Notia mantiene una cola durable de hasta diez solicitudes y las procesa de a una. Esta función requiere un modelo configurado que admita imágenes y herramientas.

Al guardar un resumen, las líneas `purchase` confirmadas se comparan de forma determinista con el nombre o proveedor normalizado de los servicios. El matching acepta el servicio dentro de un descriptor con identificadores cuando aparece como palabra completa —por ejemplo, `MOVISTAR ARGENTINA 82997`—, pero no acepta coincidencias parciales como `Supermovistar`. Una línea se asigna al `statement.period`; si hay exactamente dos consumos del mismo servicio, se ordenan por fecha y se distribuyen entre el período anterior y el período del resumen. Más de dos consumos, coincidencias múltiples, falta de coincidencia, moneda incompatible o destinos ocupados quedan para resolución manual en Auditoría o desde el chat, incluido Telegram: Notia no adivina ni aplica esos grupos automáticamente, pero sí aplica una selección explícita después de confirmarla. Cuando existe un timestamp válido, Finanzas muestra la fecha de carga como `DD/MM/YYYY`; no permite establecerla desde el formulario.

Las asociaciones de una ocurrencia con un gasto comparan los importes por centavos, por lo que formatos equivalentes como `100` y `100.00` no se consideran cambios ni duplican el historial. Al vincularla, también se actualiza la compra asociada cuando existe. Un vínculo con moneda, tipo de transacción, importe o destino incompatible se rechaza.

Notia reconoce la voz localmente con Parakeet TDT 0.6B v3, el único modelo de reconocimiento. Corre en CPU mediante sherpa-onnx, detecta el idioma automáticamente (español incluido) y transcribe mucho más rápido que el tiempo real. En **Configuraciones → Voz** podés activarlo o desactivarlo y elegir el idioma, que sólo ajusta la puntuación del español; para que las frases cortas no se interpreten en otro idioma, cada frase se reconoce junto con los últimos segundos de lo que venías diciendo. Qwen3-ASR ya no está disponible: si lo tenías elegido, Notia pasa a usar Parakeet y conserva si el reconocimiento estaba activo y su idioma.

Si el reconocimiento de voz está activo, Notia carga el modelo elegido en segundo plano apenas se inicia y lo mantiene en memoria mientras la aplicación está abierta, para que el dictado y Meeting empiecen a transcribir sin esperas. La ventana no espera esa carga: si abrís Meeting antes de que termine, verás «Preparando voz al iniciar Notia…» hasta que el modelo esté listo. Parakeet queda listo en pocos segundos. Qwen3-TTS se carga cuando se solicita una síntesis. Al cambiar el idioma, Notia prepara el reconocedor nuevo y descarta de forma segura el anterior.

El compositor incluye un botón de micrófono para dictar sin enviar audio ni texto a servicios externos. Cada respuesta del asistente muestra debajo del avatar una acción para leer ese mensaje con Qwen3-TTS usando la voz, el idioma y la velocidad configurados; una segunda pulsación detiene la reproducción. En Windows y Android arm64, Notia muestra texto parcial en tiempo real y, al detener, diariza el audio completo y vuelve a transcribir cada turno detectado para asignar el texto mediante sus límites temporales, separando intervenciones como `Hablante 1` y `Hablante 2` sin repartir palabras proporcionalmente. El resultado queda editable y nunca se envía automáticamente.

El acceso **Meeting**, ubicado debajo de ColdPass en el panel izquierdo, abre un espacio dedicado para grabar y transcribir reuniones en cuatro pasos:

- **Lista para grabar:** el botón grande inicia la grabación (con teclado, `Ctrl + Shift + R`). Cada fuente tiene su interruptor: el micrófono y, en Windows, el audio de la computadora. **Probar audio** abre las fuentes solo para mostrar sus medidores, durante hasta dos minutos. También elegís el idioma, cuántos hablantes hay (o dejás que Notia lo detecte) y la carpeta de la biblioteca donde se guarda la nota; por defecto es `Meetings`.
- **Grabando:** muestra el tiempo, una onda por fuente y la transcripción en vivo con el minuto de cada frase. **Seguir en vivo** mantiene visible lo último. Podés marcar un momento, pausar, reanudar, finalizar o cancelar. **Respuestas en vivo** viene apagado: al activarlo, cuando alguien hace una pregunta, la IA sugiere una respuesta breve que podés copiar, pedir más corta o fijar a la nota; las anteriores quedan debajo. Las **Notas rápidas** se guardan junto a la transcripción.
- **Separando hablantes:** al finalizar, una barra muestra el avance y la etapa. Podés ver el texto sin separar o cancelar la separación y quedarte con la transcripción por minuto.
- **Finalizada:** cada hablante muestra su porcentaje y su tiempo de habla. Podés renombrarlo o unir dos hablantes que Notia separó de más. La transcripción por turnos se puede buscar y filtrar por hablante. **Pasar por IA** genera lo que elijas: resumen, puntos clave, tareas (que podés enviar a un tablero del Task Manager) y corrección de errores de dictado. **Preguntale a la reunión** propone las preguntas que se hicieron en la reunión, cada una con su minuto, y responde indicando el minuto en que se dijo algo. **Guardar como nota** crea una nota en la carpeta elegida con el resumen, los puntos clave, las tareas, tus notas, los momentos marcados, las respuestas fijadas y la transcripción. Si la guardás de nuevo, se actualiza la misma nota, salvo que la hayas editado. **Exportar** guarda la nota y crea junto a ella un PDF o un Word. **Nueva grabación** descarta la reunión y vuelve al inicio.

Las respuestas en vivo, **Pasar por IA** y las preguntas envían la transcripción al proveedor de IA configurado. La reunión queda en memoria hasta que la guardás, empezás otra o cerrás Notia. Si salís de la pestaña Meeting mientras grabás, la grabación se cancela; mientras separa hablantes, sigue y la ves al volver. El chat lateral usa la transcripción actual como contexto y el mismo runtime agente, prompt, native tool calling y opciones que el resto de los chats; es efímero, no carga ni persiste memoria global y funciona en modo solo lectura para la biblioteca. Si querés modificar una nota desde ese contexto, abrí un chat persistente. En Windows mezcla el micrófono predeterminado con la salida de audio predeterminada mediante captura WASAPI nativa; no requiere dispositivos virtuales ni cambiar la entrada del sistema.

El acceso **Finanzas**, ubicado debajo de **Transcribir meeting** en el panel izquierdo, abre el módulo local de finanzas personales. Permite administrar cuentas, categorías jerárquicas, ingresos, gastos, transferencias, ajustes, reservas de ahorro, tickets y precios históricos, recibos de sueldo, tarjetas/cuotas y valuaciones patrimoniales. El chat lateral de Finanzas puede reutilizar el historial global de chat. Si una respuesta nativa queda vacía transitoriamente después de una ronda de herramientas, Notia reintenta de forma segura antes de mostrar un error. Cada biblioteca comienza con diez categorías de gasto: Alimentación, Vivienda, Servicios, Transporte, Salud, Educación, Entretenimiento, Indumentaria, Impuestos y comisiones, y Otros. Las cuentas de pago solo identifican de dónde entró o salió el dinero y no mantienen saldo. Las reservas de ahorro sí conservan un saldo acumulado a partir de su importe inicial y sus movimientos confirmados. Por Telegram, una compra de moneda para ahorro resuelve la reserva y la cuenta por nombre y registra de manera atómica la salida en moneda de origen como gasto y el aporte en la moneda de la reserva; si hay varias reservas o cuentas posibles, pide aclaración y no persiste nada. Cuando la selección queda resuelta, muestra una sola confirmación y comunica el movimiento y el gasto persistidos. La evolución salarial muestra el historial completo, incluye escalas monetarias en el eje Y y permite consultar el valor exacto de cada período con mouse, teclado o toque; cuando hay muchos períodos admite desplazamiento horizontal. Cada tooltip informa además el cambio frente al punto anterior y si superó el IPC acumulado de ese intervalo. Debajo muestra la variación del último período contra el mismo período de hace doce meses y el promedio mensual móvil en ARS/USD. También contrasta la variación de ambos contra el IPC acumulado y la inflación interanual del mismo período publicados por ArgentinaDatos. La tarjeta **Últimos sueldos** muestra el neto cobrado de cada recibo, sin confundirlo con una variación mensual. Los importes usan centavos exactos y ARS/USD se muestran por separado.

En **Finanzas**, dentro de **Home** y debajo del dashboard, podés crear y editar servicios mensuales, activarlos o pausarlos y consultar, para el mes elegido, el importe esperado, el pago, la diferencia, la factura/boleta asociada y el historial de versiones de la ocurrencia. Dashboard y Servicios forman una única columna con un solo desplazamiento vertical; no hay un scroll interno adicional entre ambas secciones. Los servicios no generan obligaciones futuras automáticamente. La sección **Auditoría del mes** muestra ejecuciones pendientes o fallidas para reintentar y propuestas con sus datos actuales y cambios sugeridos legibles; cada propuesta se revisa y confirma, rechaza o cancela individualmente. El preview de una propuesta solo prepara la revisión; la aplicación posterior conserva la propuesta identificada y su huella vigente antes de pedir la confirmación reforzada. Confirmar solo puede descartar una ocurrencia sin pago conservando su historial, ajustar el importe esperado de esa ocurrencia sin cambiar el gasto o desvincular un gasto de un servicio inexistente sin borrarlo. Rechazar o cancelar no modifica datos. Si aparece un pago, una conciliación o un bloqueo que cambie la evidencia, la propuesta de servicio impago queda obsoleta; si cambia la información antes de decidir, cualquier propuesta queda obsoleta. Si un resumen cubre una ocurrencia todavía sin importe pagado o contiene datos incompletos, la auditoría devuelve un resultado o error recuperable en lugar de cerrar la aplicación.

La pantalla de Servicios conserva la lista de servicios aunque falle una consulta secundaria de ocurrencias, dashboard, auditoría, facturas o resúmenes; muestra un aviso de carga parcial para que puedas reintentar. También se actualiza cuando otro guardado financiero notifica cambios dentro de la aplicación, sin requerir que cierres y vuelvas a abrir Finanzas. Si fallan los propios servicios, se conserva la información anterior disponible y se muestra un error general.

Las facturas o boletas de servicios pueden llegar como texto, voz, imagen o PDF desde el agente. Se registran asociadas al servicio, período, importe, moneda y, cuando corresponde, al gasto y comprobante original; registrar una factura no crea otro gasto genérico. Si elegís extraer visualmente un documento `service_invoice` con LlamaCloud, usá la acción explícita de extracción y configurá `LLAMA_CLOUD_API_KEY` en el entorno nativo.

Debajo de **Finanzas**, el acceso **Calendario** abre una pestaña interna con el calendario mensual de Argentina. Marca con colores distintos los feriados nacionales y bancarios, consultados desde los endpoints de feriados de ArgentinaDatos.

Desde **Configuraciones → Finanzas** podés eliminar todos los datos financieros de la biblioteca activa. Tocá **Eliminar datos…** y escribí el nombre de la biblioteca para confirmar; recién entonces Notia borra cuentas, categorías personalizadas, movimientos, tickets, productos y precios, sueldos, ahorro, cuotas, inversiones, servicios, ocurrencias, facturas y auditorías; al terminar vuelve a crear las diez categorías de gasto iniciales. La acción no elimina la biblioteca ni otros datos de Notia y no se puede deshacer.

Los tickets, recibos y resúmenes de tarjeta mantienen el documento original y sus campos normalizados. La extracción visual opcional usa LlamaCloud desde el backend nativo: configurá `LLAMA_CLOUD_API_KEY` en el entorno donde se inicia Notia. El secreto nunca se envía al WebView, pero el documento sí se transmite a LlamaCloud cuando pulsás **Extraer con LlamaCloud**. Sin esa acción, la carga y corrección permanecen locales.

1. Ejecute `bash scripts/install-speech.sh parakeet` para instalar Parakeet y Silero VAD; el build falla si faltan. La diarización conserva sus modelos ONNX independientes y el runtime documentado en `src-tauri/resources/speech/runtime/README.md`.
2. Abra un chat y pulse **Dictar mensaje sin conexión**.
3. En Android, conceda el permiso de micrófono cuando lo solicite el sistema.
4. Use los controles visibles para pausar, reanudar, finalizar o cancelar. Cancelar restaura el borrador anterior.

En Meeting, Notia mantiene la captura y la transcripción en vivo durante toda la reunión. El audio se conserva temporalmente con memoria acotada y la diarización se ejecuta recién al finalizar, por lo que una reunión de varias horas no se corta cada 15 minutos. El audio temporal se elimina al terminar o cancelar la sesión.

El texto en vivo se actualiza aproximadamente cada medio segundo mientras hablás y cada frase se confirma cuando hay una pausa de medio segundo, o a los 20 segundos de habla continua. En Meeting, el archivo temporal admite hasta 12 horas y la diarización final se procesa en ventanas internas de 15 minutos para mantener acotada la memoria. Las etiquetas de hablante se calculan únicamente al finalizar, con la cantidad elegida (cada ventana de 15 minutos se separa en esa cantidad) o, por defecto, automática, clustering conservador y matching global de embeddings entre ventanas; voces solapadas, ruido y fragmentos breves pueden reducir la precisión. Si no hay evidencia suficiente para hacer matching, se conserva una etiqueta separada para no fusionar hablantes incorrectamente. Si falla únicamente la diarización, se conserva el texto sin etiquetas. Si Android denegó el permiso permanentemente, habilítelo desde Ajustes. En Windows, compruebe el dispositivo predeterminado y los permisos de privacidad.

![Versión](https://img.shields.io/badge/version-1.0.13-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-orange)
![React](https://img.shields.io/badge/React-19-blue)
![Rust](https://img.shields.io/badge/Rust-2021-orange)

**Notia** es una aplicación de gestión de conocimiento **local-first**, **offline-first** y **privacy-first** para escritorio y dispositivos móviles. Permite organizar notas, documentos, diagramas, credenciales cifradas y tareas, todo viviendo en el filesystem del usuario. Sin servidor cloud. Sin suscripciones. Tus datos, siempre bajo tu control.

---

## 📋 Índice

- [Filosofía](#filosofía)
- [Características Principales](#características-principales)
- [Módulos Funcionales](#módulos-funcionales)
- [Consumo de Funcionalidades](#consumo-de-funcionalidades)
- [Guía de Uso](#guía-de-uso)
- [Requisitos de Sistema](#requisitos-de-sistema)
- [Instalación y Desarrollo](#instalación-y-desarrollo)
- [Configuración de Entorno y Preferencias](#configuración-de-entorno-y-preferencias)
- [FAQ y Troubleshooting](#faq-y-troubleshooting)
- [Licencia](#licencia)

---

## 🧭 Filosofía

- **Local-first**: todos tus datos viven en carpetas locales de tu dispositivo. No hay servidor externo que almacene tu información.
- **Offline-first**: la aplicación funciona completamente sin conexión a internet. La integración con IA es opcional y requiere un servicio local (Ollama).
- **Privacy-first**: tus credenciales en ColdPass se cifran con estándares robustos (AES-256-GCM) y nunca salen de tu dispositivo en texto plano.
- **Cross-platform**: disponible para Windows, macOS, Linux y Android. Además, el mismo programa puede correr como servidor sin ventana en Windows o Linux, para usar Notia desde el navegador de otros equipos de tu red.

---

## ✨ Características Principales

- **Librerías de Notas**: organiza carpetas locales del filesystem como bibliotecas de documentos.
- **Editor de Markdown enriquecido**: edición WYSIWYG con soporte para wikilinks (`[[nota]]`), frontmatter y propiedades. Optimizado para baja memoria con memoización selectiva y selectores de acciones.
- **Enlaces secuenciales (Page Links)**: definí relaciones de orden entre notas con `nextPage` y `previousPage` en el frontmatter. Notia actualiza automáticamente el vínculo inverso y ordena las notas conectadas en bloques secuenciales en el explorador.
- **InkMath en Markdown**: dibujá una fórmula desde los bloques Math y obtené su transcripción LaTeX mediante el modelo de visión configurado en Ollama.
- **Diagramas Mermaid**: incrusta y edita diagramas de flujo, arquitectura y más dentro de tus notas. Los diagramas embebidos en Markdown y los archivos `.mmd` comparten el **mismo motor visual**, temas y estilos. Renderizado lazy con `IntersectionObserver`, cancelación vía `AbortSignal` y caché LRU.
- **Graph View**: visualización interactiva de relaciones entre notas mediante nodos y conexiones.
- **Contextos**: **Configuraciones → Contextos** lista cada tag con su color y permite crear nuevos desde la fila superior, renombrarlos, cambiar su color o eliminarlos, salvo el último o uno que use un tablero (`#Laboral`, `#Personal`, `#Academico` y `#Confidencial` rojo por defecto). Las notas nuevas empiezan con `contexto: "#Personal"`; Graph View colorea los tickets según el contexto aplicado a su tablero y muestra todos los contextos configurados en su leyenda.
- **Usuarios y permisos de contexto**: en **Configuraciones → Usuarios** cada usuario puede tener contextos permitidos, que se activan o desactivan con un toque sobre cada uno. Owner tiene todos los contextos por defecto y esa condición queda protegida.
- **AI Chat local**: conversación con modelos de lenguaje ejecutados localmente vía Ollama, con un motor común para el chat principal, chats desplegables, Meeting, Telegram y la publicación. Cada solicitud usa el `libraryUserId` estable de la biblioteca y autorización por contextos; Meeting y la publicación no persisten memoria global. Telegram usa memoria persistente únicamente cuando el vínculo autorizado corresponde al Owner (`libraryUserId: user-owner`); para cualquier otro usuario conserva la política `ephemeral-no-memory`. Finanzas exige `#Confidencial`. Las respuestas nativas vacías transitorias después de una ronda de tools se reintentan de forma segura.
- **Agenda**: calendario mensual, semana en bloques de 15 minutos para agendar tareas con prioridad, anotador rápido del día y próximos eventos, guardados en la biblioteca para cada usuario.
- **Multichat**: sala efímera accesible debajo de Agenda para combinar una dinámica Markdown, un contexto adicional opcional y entre uno y seis agentes de la biblioteca, con turnos secuenciales y respuesta en streaming. Por defecto, cada ronda elige un subconjunto no vacío y un orden aleatorios de los agentes fijados; la dinámica puede nombrar agentes concretos o pedir explícitamente todos. No ofrece tools, búsqueda web, mutaciones, confirmaciones ni permisos propios de sala.
- **ColdPass**: gestor de credenciales cifradas con generador de contraseñas y sincronización segura entre dispositivos vía Bluetooth.
- **Task Manager**: tableros Kanban personalizables con grupos/columnas, tareas con estados, prioridad, subtareas, comentarios y temporizador Pomodoro integrado.
- Task Manager trabaja sobre la biblioteca abierta: crear, editar, mover y ordenar tareas, administrar tableros y grupos y registrar los ciclos Pomodoro se resuelve y valida en el backend de Notia, igual en Windows y Android. Sin una biblioteca abierta, el tablero lo indica y no ofrece elegir otra carpeta. El temporizador Pomodoro lo lleva el backend para cada biblioteca y usuario: sigue corriendo si cerrás y volvés a abrir Notia, y cada persona de un tablero publicado tiene el suyo.
- Cada tablero de Task Manager tiene un contexto seleccionable al crearlo o editarlo; todos sus archivos `.md` se sincronizan con la propiedad `contexto` del tablero.
<!-- La descripción histórica siguiente se conserva fuera de la vista para evitar reintroducir el flujo retirado de contraseña de tablero y aprobación de dispositivos.
- **Publicación de Task Manager en red local (Windows)**: desde **Configuraciones → Publicar** podés seleccionar tableros, configurar una contraseña y abrir el mismo `TaskManagerApp` en un navegador de la red local mediante HTTPS y la ruta estable `/task-manager`, con las vistas Kanban/tabla y las mismas operaciones de tareas, incluida la creación de tarjetas, subtareas, comentarios y movimiento. Las tarjetas nuevas conservan el contexto configurado en su tablero, y el backend de publicación también conserva ese contexto al sanitizar y distribuir los settings. “Nueva tarea” inicia siempre una tarea principal; “Subtarea” es la única acción que precarga un padre. Al crear una subtarea, Notia valida que la tarea padre siga existiendo como tarea principal del mismo tablero antes de crear el archivo; si el estado publicado quedó desactualizado, conserva el tablero y muestra un error para recargar, evitando archivos huérfanos. Los cambios realizados por cualquier navegador autorizado se notifican inmediatamente a los demás navegadores y a la instancia host de Notia. La barra superior publicada permite abrir un chat lateral efímero que usa el mismo runtime y tool calling nativo de la app, mostrando feedback operativo y la respuesta en streaming; puede consultar y modificar únicamente archivos y tickets de los tableros publicados, sin reglas, memorias ni documentos globales de la biblioteca. La página publicada no permite crear, editar ni eliminar tableros; solo expone los elegidos por el anfitrión. En Android, mantené pulsado un ticket y arrastralo con el dedo hasta otra posición o grupo para moverlo; el toque normal conserva las demás acciones visibles. Notia recuerda los tableros, el hash de contraseña y los dispositivos autorizados, y vuelve a publicar automáticamente al iniciar cuando hay una biblioteca activa. Un dispositivo nuevo queda esperando aprobación en esa sección; desde allí se puede aceptar o revocar un acceso ya otorgado, cerrando sus sesiones activas de inmediato. En un navegador autorizado, el checkbox **Recordar contraseña en este dispositivo** conserva la contraseña cifrada para los próximos ingresos en ese mismo navegador. El servidor escucha en la interfaz LAN, exige una sesión autenticada y autoriza el filesystem exclusivamente para los tableros publicados mientras Notia está abierta. Genera y conserva un certificado autofirmado, que cada dispositivo remoto debe aceptar o instalar una vez. La contraseña no se persiste: se conserva únicamente su hash PBKDF2-HMAC-SHA256 con salt.
-->
- **Publicación de Task Manager en red local (Windows)**: desde **Configuraciones → Publicar** seleccioná los tableros que querés exponer y compartí la URL HTTPS estable `/task-manager`. El acceso usa usuario y contraseña de la biblioteca, sin contraseña adicional de tablero ni aprobación de dispositivos. La vista publicada permite consultar y modificar únicamente tickets de los tableros publicados; valida contexto, ticket padre, revisión y conflictos, sincroniza cambios por WebSocket y ofrece chat IA efímero con el motor global. Las sesiones y streams se cierran al vencer o revocar el acceso.
- **Autenticación vigente de la publicación**: la URL `/task-manager` solicita únicamente el usuario y la contraseña de una cuenta de la biblioteca. No hay contraseña adicional de tablero, aprobación de dispositivos ni credenciales guardadas en el navegador; al vencer o revocarse la sesión, se cierran sus conexiones y streams activos.
- **Búsqueda integrada**: búsqueda de archivos por nombre dentro de la librería activa.
- **Temas**: soporte para tema claro y oscuro.
- **Multiplataforma**: Windows, macOS, Linux y Android.
- **Bandeja del sistema en Windows**: al cerrar la ventana principal, Notia continúa ejecutándose en segundo plano y puede restaurarse desde el icono junto al reloj.
- **Backups en Windows**: configurá una carpeta del sistema para comprimir la biblioteca activa cada hora, conservando hasta 48 copias (2 días).
- **Agente por Telegram**: vinculá de forma explícita un chat privado con un usuario de la biblioteca para buscar, leer y modificar la biblioteca activa desde el bot. Cada escritura, incluida una operación financiera, muestra preview, una única confirmación visible y un resultado verificado antes de informarse como exitosa.

Desde Telegram, el agente tiene acceso transversal a la biblioteca activa: puede buscar reuniones y notas, consultar tickets de cualquier tablero de Task Manager y usar las herramientas de Finanzas en la misma conversación. El módulo seleccionado en la interfaz no limita esas consultas; cada lectura y escritura sigue la autorización del usuario y sus contextos, y Finanzas requiere `#Confidencial`. Los pedidos de sueldos ya cargados se resuelven con los datos locales, sin búsqueda web, y las llamadas de herramienta idénticas no se repiten dentro de la misma operación.

Las respuestas del agente en Telegram no usan Markdown. El modelo utiliza texto plano y, cuando hace falta, un subconjunto básico de HTML compatible con Telegram (por ejemplo, negrita, cursiva o código); el resto de los chats conserva su formato habitual.

Mientras una solicitud de Telegram avanza, Notia mantiene un único mensaje de estado editable que comienza como **Solicitud recibida y en proceso**. Cuando llega la primera señal del thinking, ese mismo mensaje cambia a etapas claras como preparación, lectura, organización de pasos, ejecución y verificación. Si la solicitud es compuesta fuera de Finanzas, muestra el TO-DO con el estado de cada paso; cuando Finanzas está habilitada, Telegram no expone herramientas de planes de ejecución y limita cada turno a una mutación financiera confirmada. Las aclaraciones y confirmaciones aparecen en mensajes separados con sus botones. El estado muestra resúmenes breves del avance, nunca el razonamiento interno completo del modelo ni datos privados.

Las preferencias de feedback permiten elegir modo mínimo, estándar, detallado o desactivado, mostrar/ocultar el TO-DO y decidir si Telegram edita un único mensaje de progreso. La búsqueda web pública no requiere confirmación adicional ni modifica la biblioteca. Las consultas de noticias actuales, incluso si mencionan finanzas, se envían al scope con búsqueda pública; el agente no puede finalizar sin ejecutar la búsqueda y, si encuentra fuentes, debe incluir enlaces devueltos por ella. Las búsquedas web sanitizan la consulta y los resultados como contenido no confiable: no envían contexto privado, claves, tokens ni datos personales, y cada operación admite como máximo seis búsquedas únicas normalizadas, contando errores, cancelaciones y respuestas vacías.

Cada biblioteca mantiene además `.agent/memory/` con `rules.md` y `memory.md`. Notia crea automáticamente esa carpeta y esos archivos si no existen. La memoria persistente se carga para el usuario Owner; las reglas operativas se cargan desde la biblioteca según el agente construido. Las superficies efímeras no cargan ni persisten memoria global, excepto Telegram cuando el vínculo autorizado corresponde al Owner; para cualquier otro usuario de la biblioteca Telegram tampoco carga ni persiste memoria. Multichat tampoco carga ni modifica esa memoria, aunque no persiste su sala.
`rules.md` siempre conserva las reglas mínimas de Notia y permite agregar reglas personalizadas sin perderlas durante la inicialización.
Las instrucciones permanentes dadas al agente se guardan automáticamente en su bloque interno de `rules.md`, sin pedir confirmación adicional.
Los datos personales, preferencias y contextos duraderos que mencionás en una conversación los guarda el agente en `.agent/memory/memory.md` en ese mismo turno, sin pedir confirmación, y se reutilizan como contexto en los chats persistentes del Owner y en Telegram cuando está vinculado al Owner. Esto aplica al chat IA principal y a los chats laterales de notas y Task Manager: todos usan las mismas `rules.md` y `memory.md` del motor global. Finanzas y Graph View no guardan memorias.
También garantiza la carpeta `.agent/skills/` para las habilidades del agente.

### Reglas y memoria del agente

Notia garantiza esta estructura de carpetas por biblioteca, sincroniza el visualizador del prompt default y crea únicamente los archivos de memoria faltantes:

```text
.agent/
├── dynamics/
├── promps/
│   ├── default.md (visualizador sincronizado del prompt default)
│   └── (prompts Markdown alternativos opcionales)
├── memory/
│   ├── rules.md
│   └── memory.md
└── skills/
```

`default.md` se crea si falta y se sobrescribe si su contenido difiere del prompt default embebido. Sirve como visualizador sincronizado, no como fuente de ejecución: la opción **default** siempre usa el prompt del sistema de Notia. Los prompts alternativos `.md` se conservan y solo se cargan al seleccionarlos explícitamente.

`rules.md` separa las reglas mínimas administradas por Notia (`NOTIA_DEFAULT_RULES`) de las instrucciones permanentes aprendidas (`NOTIA_IA_RULES`). Si indicás explícitamente “cuando ocurra X, hacé Y” o “a partir de ahora respondé de esta manera”, el agente guarda la instrucción en el segundo bloque sin pedir una confirmación adicional.

`memory.md` conserva hechos duraderos, como nombre, preferencias, empleo o proyectos actuales del Owner. Esos datos no se consideran reglas de comportamiento. El agente los guarda sin confirmación y los incorpora como contexto en conversaciones persistentes del Owner y en Telegram cuando el usuario autorizado es el Owner; Meeting, Graph View, Multichat y la publicación no cargan ni persisten memoria global. Telegram usa `persistencePolicy: 'persistent'` para `user-owner` y `persistencePolicy: 'ephemeral-no-memory'` para cualquier otro usuario de la biblioteca. En el segundo caso tampoco puede exponer ni leer rutas bajo `.agent/memory/` mediante tools.

Cada vez que `memory.md` cambia, Notia pide en segundo plano al modelo configurado que ordene las memorias: une duplicados, resuelve contradicciones quedándose con el dato más reciente y agrupa datos del mismo tema, sin inventar ni perder datos. Esa llamada no tiene herramientas ni recibe la memoria como contexto: solo la lista a ordenar. La conversación no la espera, y si mientras tanto se guardó otra memoria, el resultado se descarta y se ordena de nuevo. Si la respuesta del modelo no es una lista válida, el archivo queda como estaba. `rules.md` no se reorganiza. Si la configuración apunta a Ollama Cloud, la lista de memorias se envía a ese servicio. Cada chat nuevo puede crearse sin memoria desde el panel de contexto de la vista Chat IA; los archivos de chat anteriores que tengan `longTermMemory` en su encabezado se siguen abriendo y esa línea deja de escribirse al guardarlos.

En Telegram, las respuestas finales se transforman al subconjunto HTML permitido por Telegram. Encabezados, listas Markdown o HTML (`ul`/`ol`/`li`), negritas, código y enlaces se normalizan aunque el modelo produzca Markdown; el resto de los chats conserva Markdown. Si un modelo emite accidentalmente una llamada de herramienta XML, Notia intenta recuperarla como tool calling nativo en vez de mostrarla como texto.

En Windows, pulsar la **X** oculta Notia en la bandeja del sistema en vez de finalizarla. Para volver, hacé doble clic izquierdo en el icono de Notia o abrí su menú y elegí **Abrir Notia**. Para terminar completamente la aplicación, elegí **Salir** desde ese mismo menú. Este comportamiento no se aplica en Android, macOS ni Linux.

Para conectar Telegram, creá un bot con BotFather, copiá su token y abrí **Configuraciones → Telegram**. Pegá el token, pulsá **Probar conexión**, activá el interruptor **Bot de Telegram** y enviá `/start` al bot. Notia vincula el chat privado con un usuario de la biblioteca; solo coincidir simultáneamente con el `chat_id` y el identificador de usuario vinculados permite consultar esa biblioteca. Las acciones de creación, reemplazo y eliminación, incluidas las financieras, muestran botones **Confirmar** y **Cancelar** antes de ejecutarse; en Finanzas se muestra una sola confirmación por mutación. Revocá el vínculo desde la misma pantalla cuando ya no lo necesites.

El token se almacena sin cifrar en `.notia/notiaConfig.json`. No compartas ese archivo ni lo subas a un repositorio; si el token se expone, revocalo inmediatamente desde BotFather. El bot funciona únicamente mientras Notia está ejecutándose y requiere conectividad tanto con Telegram como con el backend de IA configurado.

---

## 📦 Módulos Funcionales

### Librerías y Explorador de Archivos

El corazón de Notia son las **librerías**: carpetas locales del filesystem que la app indexa y presenta como un árbol jerárquico interactivo.

Desde el panel izquierdo (Explorador) podés:
- Navegar carpetas y archivos en forma de árbol expandible. El nombre se muestra separado del formato, que se conserva al renombrar.
- Crear carpetas, notas Markdown o diagramas Mermaid.
- Copiar, mover, renombrar y eliminar archivos mediante el **menú contextual** (clic derecho).
- Buscar archivos por título o contenido con **Buscar archivos**, siempre visible arriba del árbol (`Ctrl + O` lo enfoca; `Esc` lo limpia).
- En escritorio, el árbol se actualiza automáticamente cuando detecta cambios externos en el filesystem.
- En Android, podés elegir una carpeta mediante el selector del sistema (SAF) y refrescar manualmente o con intervalo configurable.
  - En Android, al tocar **Agregar nueva libreria**, el modal ignora los `pointerdown` táctiles del fondo y permanece abierto mientras se elige la carpeta, incluso si el WebView reporta el toque sobre el backdrop mientras el dedo sigue sobre el control. La URI `content://` entregada por SAF se conserva como ruta de la librería y al preparar `.notia/notiaConfig.json`, evitando convertirla en una URI inválida. La configuración inicial se crea directamente desde el permiso de la carpeta seleccionada en un solo comando nativo, sin depender de que el listado SAF ya muestre `.notia`; si un intento anterior dejó esa carpeta o el archivo de configuración, Notia los reutiliza sin borrar ni sobrescribir su contenido. Una entrada del mismo nombre pero de tipo incompatible se rechaza. El selector tiene un límite de espera de 60 segundos; si no responde, muestra un error recuperable y podés volver a intentarlo sin agregar una librería incompleta. Si el sistema no puede resolver o guardar la ruta SAF, muestra el error con el mayor detalle disponible y podés reintentar. Una selección válida cierra el modal solo después de configurar y agregar la librería correctamente. La X visible sigue cerrando el modal con touch; el backdrop también lo cierra cuando se usa mouse.

### Editor de Markdown

El editor de Markdown utiliza una experiencia WYSIWYG (lo que ves es lo que obtenés) basada en Milkdown Crepe. Las respuestas del chat también renderizan fórmulas LaTeX con KaTeX, tanto en bloques `$$...$$` como en expresiones inline. Cada fórmula queda encuadrada y el botón con el ícono de ojo permite alternar entre el render y su código LaTeX.

El chat lateral reconoce el bloque o los bloques seleccionados en la nota, incluyendo su tipo y contenido, para responder sobre esa selección. La selección es opcional: también puede leer directamente el archivo Markdown activo, localizar un bloque mencionado por su encabezado, punto o frase, y agregar contenido antes o después o reemplazarlo mediante herramientas con confirmación antes de guardar; el editor abierto recibe el cambio sin cerrar ni volver a abrir la nota. Antes de escribir, Notia comprueba la revisión de la fuente activa más reciente y solo detiene la operación si detecta un cambio real, para no mostrar conflictos por un contexto del chat desactualizado.

Características:
- **Pestañas múltiples**: abrí varios archivos simultáneamente y navegá entre ellos.
- **Guardado automático**: los cambios se guardan automáticamente tras un breve período de inactividad y se persisten de inmediato antes de cerrar, salir o cambiar de biblioteca.
- **Wikilinks**: escribí `[[Nombre de Nota]]` para crear enlaces bidireccionales entre documentos. Al hacer clic en un wikilink, la nota destino se abre en una nueva pestaña.
- **Propiedades**: arriba de cada nota, el panel **Propiedades** muestra sus metadatos y se pliega con un toque; plegado, resume el contexto y la fecha. Cada valor se edita según su tipo: el contexto con los de la biblioteca, las fechas legibles, casillas, etiquetas como chips y los enlaces a otras notas con un buscador que también permite **Crear nota**. **Agregar propiedad** pide el nombre y el tipo (Texto, Etiquetas, Número, Fecha, Nota o Casilla).
- **Barra de formato**: al pasar el mouse sobre un párrafo, título, ítem de lista o cita aparece encima una barra que formatea el bloque entero; al seleccionar texto (o un bloque con su handle), la barra formatea la selección. Sirve para cambiar el tipo de bloque (párrafo, títulos, listas o cita) y aplicar negrita, cursiva, subrayado, tachado, código, color de texto, resaltado, alineación y enlaces, o quitar el formato. El subrayado, el color, el resaltado y la alineación se guardan como HTML dentro del Markdown (`<u>`, `<span data-color>`, `<mark>`, `<div align>`), que GitHub y Obsidian también muestran, salvo el color.
- **Mover bloques**: al pasar sobre un bloque se resalta y muestra su handle (el ícono de seis puntos); arrastralo para moverlo. Una línea teal marca dónde va a quedar. Para agregar bloques, usá Enter o escribí `/`.
- **Bloques dentro de tablas Markdown**: una celda puede combinar texto normal con bloques de código (incluidos XGraph y Mermaid), imágenes y otros bloques compatibles con el editor.
- **Indicadores de estado**: visualización de "Guardando...", "Guardado ✓" o "Error ✗" en la pestaña activa.
- **Imágenes de chats persistidos**: al abrir un chat Markdown que conserva adjuntos, Notia muestra sobre el editor hasta 24 previews de imágenes raster válidas; también las muestra en la vista de documento grande. SVG, formatos no admitidos y datos Base64 que no superan la validación permitida no se renderizan.
- **Zoom de lectura**: ampliá o reducí el contenido con `Ctrl + rueda del mouse` en Windows, con el gesto de pinza de dos dedos en Android o con el deslizador junto al estado de guardado. El porcentaje visible y el botón **Restablecer** permiten consultar o volver rápidamente al 100%.
- **Diagramas Mermaid embebidos**: insertá bloques de código con lenguaje `mermaid` dentro de cualquier nota Markdown. El editor renderiza el diagrama con el **mismo motor visual** que los archivos `.mmd` (temas Notia, zoom/pan interactivo, manejo de errores uniforme). Los diagramas embebidos son de **solo lectura**: se pueden explorar (zoom, paneo, exportar a PNG/SVG) pero no se pueden editar nodos ni flechas desde el editor Markdown. Desde la versión 1.0.13, el renderizado embebido es **lazy** (solo renderiza cuando el diagrama entra en el viewport), cancela renders previos al cambiar de archivo y gestiona la memoria mediante una caché LRU con límite de tamaño.
- **InkMath**: el botón **OCR** de cada bloque Math abre un lienzo compatible con mouse, stylus y touch. Al terminar de escribir, espera el intervalo configurado, rasteriza los trazos y solicita a Ollama la fórmula en LaTeX; una entrada nueva invalida cualquier resultado anterior.
- **Modo página**: en el menú «⋯» de la nota, **Modo página** divide la nota en hojas de tamaño fijo, numeradas, como en un procesador de texto. El tamaño (A3, A4, A5, B5, Carta u Oficio), la orientación, los márgenes y la numeración se eligen en **Configuración** (`Ctrl+,` o **Tamaño de página** en el mismo menú). Los títulos pasan a la hoja siguiente junto con lo que introducen. En pantallas angostas, las hojas se achican para entrar. El chip «A4 · Vertical» de la cabecera abre la misma configuración.
- **Lápiz**: la pestaña **Lápiz** de **Configuración** guarda la herramienta, el color, el grosor, el suavizado y las opciones del lápiz para cuando la escritura a mano esté disponible (**Próximamente**).
- **Exportación**: el menú «⋯» exporta la nota como PDF o como Word (`.docx`, importable en Google Docs), con formato y sin las propiedades de la nota: títulos, negrita, cursiva, colores, listas, tareas, citas, tablas, código y enlaces. Las fórmulas LaTeX quedan escritas, no como imagen: en el PDF, compuestas como en el editor; en Word, como ecuaciones editables. Los dos usan el tamaño de página, los márgenes y la numeración de la configuración. Las imágenes aparecen como «[Imagen: …]» y los emojis, como «?». El PDF solo está disponible con el modo página activo; en modo continuo la opción aparece deshabilitada con la leyenda «Requiere modo página». El agente tampoco exporta a PDF con el modo página apagado. La exportación de Meeting no depende del modo página. El archivo se crea junto a la nota; en Android, dentro de la librería SAF activa. Si no se puede escribir, se muestra el error.

#### Bloques dentro de tablas Markdown

Abrí una nota Markdown, colocá el cursor dentro de una celda y usá el menú de bloques de Milkdown para insertar el bloque que necesites. La celda puede conservar texto antes o después del bloque; al guardar, Notia mantiene el contenido y ajusta los bloques, gráficos, imágenes y previsualizaciones al ancho disponible de la tabla. Las celdas de encabezado también admiten este comportamiento.

La tabla conserva su selector/handle de Milkdown y los bloques dentro de celdas también muestran el suyo, incluso si están anidados en una cita (`blockquote`): podés seleccionarlos, eliminarlos con la acción normal del editor y arrastrarlos entre posiciones o celdas. Los nodos intermedios de la estructura (`table_header_row`, `table_row`, `table_header` y `table_cell`) no muestran handles propios; Milkdown asciende hasta la tabla cuando corresponde.

La compatibilidad se conserva mediante comentarios internos que no se muestran en la vista renderizada. No los elimines con un editor externo: si una herramienta elimina esos comentarios, Notia ya no podrá restaurar los bloques no inline de la celda al volver a abrir la nota.

### Diagramas Mermaid

Integración nativa de diagramas tipo Mermaid dentro del ecosistema de Notia.

- Creá diagramas de flujo, arquitectura de sistemas, mapas mentales y más.
- Los diagramas se guardan como archivos `.mmd` dentro de tu librería.
- Edición visual completa con arrastrar y soltar, conectores, formas y estilos.
- El **Graph View** usa `react-force-graph-2d` para visualizar el grafo de wikilinks de la librería en un canvas 2D interactivo.

### Graph View

Visualización gráfica de las relaciones entre todas tus notas.

- Cada nota es un **nodo**; cada wikilink es una **conexión**.
- Los títulos de las notas se muestran siempre sobre los nodos 3D; las rutas no forman parte de la etiqueta.
- El grafo usa brillo controlado y sombras suaves estilo red neuronal, con efectos optimizados para mantener la fluidez; al pasar el cursor por un nodo, se resaltan también sus conexiones y vecinos directos.
- Navegación interactiva: órbita, zoom, paneo y clic para abrir la nota desde el grafo.
- El layout se calcula como un grafo de fuerzas en 3D, con colores por contexto y centrado manual desde el control del grafo.
- Búsqueda integrada por título y contenido: muestra las notas coincidentes en un desplegable sobre la barra, permite enfocarlas en el grafo, agregarlas al contexto del chat o abrirlas, y resalta sus nodos.
- Los chats laterales de Graph View, Task Manager y archivos comparten el mismo flujo persistente de creación, selección, hidratación y visualización. Cada contexto usa una clave estable y su propio archivo dentro del historial de chats. En Graph View, sin selección consulta la biblioteca mediante RAG local, incluyendo nombres y rutas de carpetas; por ejemplo, preguntar por `chats` recupera los documentos ubicados dentro de esa carpeta. Al seleccionar archivos usa su contenido completo como contexto directo. También puede buscar y leer por título mediante tool calling nativo de Ollama.
- Durante una consulta con herramientas, el panel muestra si está analizando, ejecutando una búsqueda o procesando resultados. Los modelos grandes disponen de un tiempo ampliado para completar las distintas rondas del agente y la operación se puede cancelar desde el compositor.
- Notia mantiene un archivo `linkCache.md` dentro de `.notia/` con el diagrama del grafo, que se regenera automáticamente en segundo plano cuando cambian las notas.

### AI Chat

Chat con inteligencia artificial local via **Ollama**.

La vista **Chat IA** del menú izquierdo se organiza en tres zonas:

- **Historial** (izquierda): botón **Nuevo chat**, búsqueda por título, la lista de chats de `chat/chats` y la librería activa. Cada chat tiene un botón **⋯** con la opción **Eliminar chat**; en escritorio también funciona el clic derecho. El historial se oculta y se vuelve a mostrar desde su propio botón; en pantallas angostas y teléfonos flota sobre la conversación y se cierra solo al elegir un chat.
- **Conversación** (centro): una barra con el título del chat, el modelo activo (tocándolo abre **Configuraciones → IA**) y el botón del panel de contexto. Tus mensajes aparecen a la derecha; las respuestas de Notia ocupan todo el ancho y se pueden copiar con un botón. El compositor reúne adjuntar, el interruptor **Toda la librería**, dictado y enviar. Con el interruptor encendido, la IA puede buscar en toda la librería (RAG); apagado, solo usa los archivos y carpetas que elijas y no busca otros. El menú **+** ofrece **Seleccionar archivo**, **Buscar archivos de la librería** y **Buscar carpetas de la librería**: una carpeta suma todos sus archivos, subcarpetas incluidas. El interruptor, los archivos y las carpetas quedan guardados en el chat. Mientras llega una respuesta, el botón de enviar pasa a **Detener respuesta**.
- **Contexto** (derecha): el alcance actual con los archivos elegidos (se pueden quitar uno por uno), acciones rápidas que completan el mensaje y el interruptor **Memoria persistente del agente**. Con el interruptor apagado, el próximo chat nuevo no lee `memory.md` ni guarda reglas o memorias (las reglas de `rules.md` se siguen aplicando), y la barra superior muestra **Sin memoria**. La elección queda guardada en el chat: con un chat abierto, el interruptor muestra su valor y no se puede cambiar. **Administrar memoria** permite vaciar `memory.md`. En pantallas medianas y teléfonos flota sobre la conversación.

Al abrir la vista no se abre ningún chat anterior: aparece un chat nuevo con **¿En qué trabajamos hoy?**, el compositor en el centro y tres sugerencias para empezar. El primer mensaje crea el chat; para retomar uno anterior, elegilo en el historial.

El chat principal, los chats desplegables, Meeting, Telegram y la publicación usan el motor común y el contrato global versionado: biblioteca, request, actor estable, canal, snapshot, scope solicitado y política de persistencia. El motor verifica el actor y los contextos antes de ofrecer o ejecutar herramientas; Finanzas requiere `#Confidencial` para lecturas y escrituras, y Graph View usa un chat efímero sin archivo. Telegram y la URL pública conservan sus adaptadores de transporte, pero no pueden ampliar permisos mediante `scope`, rutas o IDs enviados por el cliente. Multichat queda fuera de este motor y mantiene una llamada plana sin tools.

- Configurá la URL de tu instancia de Ollama desde **Settings → IA**.
- Funciona con **cualquier modelo de Ollama**, no solo modelos de visión.
- El selector enumera todos los modelos informados por Ollama y marca Thinking, Vision y Tools; para los chats con agente se recomienda elegir uno con **Tools**.
- La búsqueda web opcional usa el endpoint oficial de Ollama Cloud (`https://ollama.com`) y requiere una API Key; una URL local continúa siendo válida para el chat, pero no habilita búsquedas públicas.
- En Task Manager, las consultas temáticas usan RAG; los pedidos exhaustivos como “todos los tickets” activan una lectura completa del corpus y reportan si algún contenido debió truncarse.
- Podés adjuntar archivos y carpetas de la librería como contexto para la conversación. En modo **Directo** la IA recibe el contenido de los archivos (hasta 30.000 caracteres por consulta; los que no entran se nombran como omitidos). En modo **Referencia** recibe nombres y rutas (hasta 50 archivos) y, si la búsqueda en la librería está encendida, puede leerlos. Cada consulta toma hasta 500 archivos entre los elegidos y los de las carpetas.
- En el chat lateral de un archivo abierto, el archivo activo está autorizado como contexto; la IA solicita permiso visible antes de leer cualquier otro archivo.
- Cuando hace falta información actualizada, la IA puede solicitar buscar fuentes públicas mediante Ollama Cloud. La consulta pasa por un filtro que bloquea secretos, datos personales y contenido privado; la API key nunca se incluye en la búsqueda, en la URL, en los mensajes ni en los logs, y la confirmación del usuario no desactiva esa protección.
- La vista principal de chat, los chats desplegables, Meeting, Telegram y la publicación comparten el agente con tool calling nativo, catálogo filtrado por scope, aclaraciones, planes cuando corresponden y confirmaciones individuales. Multichat es la excepción: cada agente usa una llamada plana al adaptador existente de Ollama, sin tools, búsqueda web, mutaciones, confirmaciones ni permisos de sala. Cuando Telegram tiene Finanzas habilitadas, su catálogo no incluye herramientas de planes de ejecución y cada turno admite como máximo una mutación financiera confirmada. El contexto activo solo limita qué archivos están autorizados inicialmente y qué tablero se considera activo.
- Telegram autoriza inicialmente el corpus legible completo de la biblioteca y no hereda el módulo activo de la interfaz: sus consultas pueden combinar documentos, tickets de Task Manager y datos financieros.
- El compositor admite dictado y adjuntos de audio mediante ASR/STT; Qwen3-TTS permanece disponible para superficies que lo integren, pero los chats no exponen un modo llamada ni leen automáticamente las respuestas. La sección **Configuraciones → Voz** concentra las opciones de transcripción y síntesis disponibles.
- Cuando el agente necesita una aclaración abierta, muestra la pregunta dentro del hilo y pausa la ejecución. La respuesta escrita en el compositor reanuda la misma consulta; también puede cancelarse mientras espera.
- Cada librería puede mantener prompts Markdown alternativos en `.agent/promps/`. La carpeta `.agent` es visible y editable desde el explorador de Notia, aunque las demás carpetas ocultas continúan excluidas. `default.md` se crea o sobrescribe para mostrar exactamente el prompt default embebido, pero no es la fuente de ejecución: la opción **default** siempre usa el prompt del sistema. Los prompts alternativos `.md` se cargan únicamente cuando se seleccionan de forma explícita y nunca se sobrescriben durante esta sincronización. El chat lateral muestra el selector superior con `default` y cada archivo adicional —usando su nombre sin `.md`—, recuerda la elección en este dispositivo y vuelve al prompt del sistema si el alternativo no puede leerse o está vacío.
- El selector **Adjuntar archivo → Seleccionar archivo** permite elegir varios archivos locales a la vez. Notia los conserva juntos en el compositor, muestra un chip por archivo y permite quitar cada uno individualmente antes de enviar la consulta. Cuando hay muchos adjuntos, se muestran dentro de un bloque compacto con desplazamiento propio para mantener visible el campo de mensaje. Al enviar, los adjuntos quedan asociados al mensaje de usuario, se conservan al guardar el historial del chat y se rehidratan al volver a cargarlo; sus nombres aparecen en el hilo y pueden reutilizarse en consultas posteriores dentro del contexto conservado.
- La IA mantiene **memoria persistente** en `.agent/memory/memory.md` para las superficies persistentes: el agente guarda con su herramienta de memoria los hechos, preferencias y datos personales duraderos que mencionás, y los usa para personalizar respuestas futuras. Meeting, Graph View, Multichat y las superficies publicadas no cargan ni escriben esa memoria. Telegram la carga y puede guardarla cuando el vínculo autorizado corresponde al Owner; para cualquier otro usuario usa `persistencePolicy: 'ephemeral-no-memory'`, no carga ni persiste memoria y filtra las rutas bajo `.agent/memory/` de sus documentos y tools. Multichat tampoco guarda el historial de su sala.
- Soporte para modelos multimodales: enviá una o varias imágenes (capturas, fotos) para que la IA las analice (requiere modelo con soporte de visión). En el chat lateral de un `.md`, podés adjuntarlas junto con PDF o texto y pedir **"Insertá esto en el documento"**: la IA conserva el orden, transcribe el contenido respetando párrafos, listas y encabezados, convierte las fórmulas en bloques LaTeX `$$...$$`, muestra una vista previa con confirmación y actualiza la nota abierta.
- El botón **Adjuntar archivo** permite seleccionar varios archivos locales —imágenes, PDF y texto— para enviarlos en una misma consulta, además de los archivos de la librería. Los archivos de texto se agregan como bloques de contexto separados; las imágenes y las páginas renderizadas de los PDF se combinan en una colección visual ordenada para Ollama. Notia valida el tipo MIME o la extensión admitida, el tamaño individual y el procesamiento de cada archivo antes de iniciar la consulta: rechaza archivos de texto vacíos o demasiado extensos, archivos individuales de más de 40 MB y PDF que no pueden procesarse. No hay un límite ejecutable de tamaño total del lote ni una cantidad máxima implementada de imágenes, por lo que esas condiciones no provocan por sí solas el rechazo del lote. Al pedir **"Transcribí estos PDF a este archivo .md"**, Notia procesa las páginas en orden, incluidos PDFs escaneados, y puede insertar el resultado en el Markdown activo con texto, listas, tablas y fórmulas en bloques LaTeX `$$...$$`. Los PDF de más de 24 páginas se rechazan antes de enviarse para evitar una transcripción incompleta; se requiere un modelo con soporte de visión cuando el lote incluye imágenes o PDF.
- Generación automática de títulos para las sesiones de chat.
- Streaming progresivo de respuestas en escritorio y Android mediante el bridge nativo. En un navegador conectado a un servidor Notia, las respuestas llegan en vivo desde ese servidor; la página publicada de Task Manager usa su propio canal.
- Cancelación de respuestas en curso.
- Soporte en escritorio, Android y navegador (contra un servidor Notia) a través del mismo backend de Notia; la prueba en dispositivo Android sigue siendo un requisito de plataforma.

### Multichat

El acceso **Multichat** aparece inmediatamente debajo de **Agenda** en la barra izquierda. Permite crear una sala efímera eligiendo una dinámica Markdown de `.agent/dynamics/`, un contexto adicional opcional en un textbox accesible y entre uno y seis agentes Markdown de `.agent/promps/`. Notia crea `.agent/dynamics/` si todavía no existe; los archivos se leen como texto libre y se ignora su frontmatter.

No hay una selección de permisos para la sala: Multichat realiza una llamada plana al adaptador existente de Ollama y no expone tools, búsqueda web, mutaciones ni confirmaciones. La dinámica, el contexto adicional y los agentes quedan fijos e inmutables durante la sala; el contexto es contenido proporcionado por el usuario y se trata como no confiable. Los agentes responden en secuencia dentro de cada ronda y pueden recibir respuestas anteriores. Por defecto, cada ronda selecciona un subconjunto no vacío aleatorio de los agentes fijados y lo ordena aleatoriamente. Si la dinámica nombra agentes concretos, participan esos agentes; si indica explícitamente que participen todos, se usan todos, pero se conserva el orden aleatorio. Si aparecen ambas indicaciones, prevalecen los nombres concretos. Nunca participan agentes fuera de la sala. Las rondas continúan automáticamente por defecto, hasta un límite aleatorio de una a cuatro rondas. Una dinámica puede pedir explícitamente esperar la intervención del usuario; enviar un nuevo mensaje reinicia el contador de rondas. Cada mensaje identifica al usuario o al agente que habló.

La sala comienza vacía y no se guarda como chat ni se recupera al cerrar la pestaña. El contexto adicional fijo se incluye en cada solicitud de cada agente junto con la dinámica y su prompt; se envía separado del historial, que contiene como máximo los últimos 40 mensajes. La sala no carga ni modifica la memoria global. Durante la generación, la interfaz muestra por separado el thinking y la respuesta en streaming; cada respuesta completada queda visible y se incorpora al contexto antes de que transmita el siguiente agente, mientras que el thinking y la respuesta parcial siguen siendo temporales. Solo la respuesta final se agrega al historial. Si un agente no responde, se muestra un error visible y no se continúa la cadena automática; también podés cancelar una ronda en curso.

El chat del panel derecho puede consultar la sala activa como contexto auxiliar —incluidos la dinámica, los agentes, el contexto adicional y los últimos 40 mensajes—, pero funciona como un único asistente y no participa en los turnos ni publica mensajes dentro de la sala. El panel conserva sus permisos normales, independientes de Multichat, y su contexto desaparece al cerrar la sala o cambiar de biblioteca.

### Agenda

El acceso **Agenda** aparece debajo de **Calendario** en la barra izquierda y abre tu agenda personal.

- **Calendario del mes**: tocá un día para ver su semana; **Hoy** vuelve al día actual y las flechas cambian de mes. Los días con tareas agendadas tienen un punto.
- **Semana**: una grilla de lunes a domingo dividida en bloques de 15 minutos, que arranca en las 8:00. Con mouse, hacé clic o arrastrá sobre los bloques; en pantallas táctiles, tocá cada bloque o mantené presionado y deslizá; con teclado, movete con las flechas y seleccioná con Enter o Espacio. Después escribí el nombre, elegí la prioridad (Urgente, Alta, Media o Baja) y tocá **Agendar**. Si elegís bloques separados o de varios días, se crea una tarea por cada tramo seguido.
- **Tareas agendadas**: tocá una para ver su prioridad y horario, y eliminarla con **Eliminar tarea**. No se pueden superponer dos tareas en el mismo horario.
- **Anotador rápido**: una lista de pendientes del día. Las tareas que marcás como hechas quedan tachadas hasta que termina el día; las que siguen pendientes pasan al día siguiente.
- **Próximos eventos**: las próximas 10 tareas que todavía no terminaron; al tocar una, la semana salta a ese día y la muestra.
- **Datos**: se guardan en la base de la biblioteca, separados por usuario.

### Rutina

El acceso **Rutina** aparece debajo de **Multichat** en la barra izquierda y abre un panel para convertir tareas en hábitos.

- **Rutinas**: agrupá las tareas en rutinas con su propio checklist (Mañana, Noche, Fin de semana...). Podés crearlas, renombrarlas y eliminarlas cuando están vacías; siempre queda al menos una.
- **Tareas**: cada tarea tiene nombre, rutina, categoría de la rueda de la vida, días en que aplica (todos o algunos) y una nota opcional. Se pueden pausar sin perder el historial, editar, eliminar con **Deshacer** y ordenar arrastrando el asa o con las flechas del teclado.
- **Seguimiento**: panel de hábitos con la racha de cada tarea, calendario del mes, evolución diaria comparada con el mes pasado, progreso semanal, rueda de la vida con metas por categoría y la semana actual para marcar lo hecho, con la pestaña **Todos** (cada tarea indica su rutina) o una pestaña por rutina. Solo se puede marcar hoy o días anteriores.
- **Datos**: se guardan en la base de la biblioteca, separados por usuario.
- **IA**: desde el chat principal, el chat lateral (también en Finanzas) o Telegram podés hacer lo mismo que en la pantalla: consultar tu rutina, rachas, progreso e informes de este mes o de meses anteriores; crear, renombrar o eliminar rutinas; crear, editar, mover, pausar, reordenar, eliminar o recuperar tareas; marcar hábitos hechos (por ejemplo «ayer hice yoga») y ajustar metas. Cada cambio pide confirmación antes de guardarse. En Telegram, la rutina que ves y modificás es la del usuario de la biblioteca vinculado a tu cuenta.

### ColdPass

Gestor de credenciales cifradas integrado en Notia.

- Tus credenciales se almacenan en un archivo `ColdPass.md` dentro de cada librería, **cifrado con AES-256-GCM**.
- La **passkey** (contraseña maestra) nunca sale del dispositivo: el cifrado y descifrado ocurren localmente en la app.
- Generador de contraseñas seguras integrado.
- **Sincronización Bluetooth**: podés sincronizar tu bóveda de credenciales entre dispositivos de forma segura mediante Bluetooth Low Energy (BLE). El proceso incluye emparejamiento con PIN y autenticación de aplicación.

### Task Manager

Sistema completo de gestión de tareas con tableros Kanban y vista de tabla.

- **Tableros personalizables**: creá múltiples tableros para diferentes áreas de tu vida (trabajo, personal, proyectos). Cada tablero vive como una carpeta dentro de tu librería.
- **Vista Kanban**: organizá tareas en columnas (grupos) con arrastre visual. El tablero se adapta al ancho disponible: cuando los grupos no entran en la pantalla, se apilan en filas hacia abajo en lugar de requerir desplazamiento horizontal. Para reordenar los grupos, arrastrá el encabezado de uno y soltalo en cualquier parte de otro grupo: ocupa su lugar. En pantallas táctiles, mantené pulsado el encabezado y arrastralo con el dedo. Los tickets se mueven igual: arrastralos (o mantenelos pulsados y arrastralos con el dedo) y el hueco resaltado marca exactamente dónde van a quedar; al soltarlos aparecen en su nuevo lugar de inmediato mientras Notia guarda el cambio.
- **Vista de tabla**: alterná a una vista tabular para ver y ordenar tareas por estado, prioridad o fecha de fin.
- **Tareas con subtareas**: cada tarea puede tener subtareas anidadas mediante wikilinks.
- **Estados**: pendiente, en progreso, completada, cancelada.
- **Prioridad**: alta, media, baja.
- **Comentarios**: discusión y notas adjuntas a cada tarea. Cada comentario se agrega al final del ticket como `## Comentario - DD/MM/YYYY HH:MM - Autor`, con la hora local y el nombre del usuario, y el texto debajo. La tarjeta muestra el detalle seguido de los comentarios.
- **Pomodoro integrado**: temporizador de 25/5 minutos con registro histórico de sesiones y estadísticas de productividad.
- **Persistencia transparente**: cada tarea se guarda como un archivo Markdown con metadatos (frontmatter) dentro de la carpeta del tablero correspondiente.
- **Agente contextual**: el chat lateral conoce el panel activo de Task Manager pero no adjunta todos los tickets. Las búsquedas y lecturas quedan limitadas al tablero o panel visible; para consultar otro contexto primero hay que cambiar a ese panel. Usa RAG local para consultas generales y lee archivos completos bajo demanda mediante tool calling nativo de Ollama. Cuando recupera o lee un ticket padre, incorpora automáticamente las subtareas declaradas en `childs` y su contenido, de forma recursiva, para que la respuesta no pierda sus seguimientos.
- **Filtros y organización asistida**: puede buscar por estado, prioridad, grupo, fechas, tags y texto de metadata, y actualizar dependencias y checklist controlados en el frontmatter sin cargar cuerpos innecesarios.
- **Edición asistida y confirmada**: el agente puede crear tickets, reemplazar su contenido Markdown, agregar comentarios o subtareas, moverlos de grupo y cambiar estado o prioridad. También puede consultar y crear grupos, y eliminarlos únicamente cuando no tengan ningún ticket asignado. Consulta las opciones válidas del tablero y, ante cualquier dato faltante, definición imprecisa o coincidencia ambigua, pausa para preguntar en vez de inventar. Toda interacción pendiente aparece en una tarjeta dentro del chat: si encuentra varias opciones, cada alternativa se presenta como una opción clickeable; si necesita autorización, muestra los valores concretos, una vista previa del contenido y las acciones **Confirmar** y **Cancelar**. El runtime impide modificar entidades ambiguas hasta resolver la selección. Rechazar una autorización garantiza que no se escriba nada y una aprobación solo autoriza esa operación individual.
- **Planes para operaciones compuestas**: cuando un pedido requiere dos o más escrituras, el agente crea primero un TO-DO visible dentro del chat. El usuario debe aprobarlo antes de comenzar o puede elegir **Sugerir cambios**, escribir la corrección en el compositor y revisar una nueva versión. Cada operación se ejecuta por separado y en orden, conserva su propia confirmación y actualiza el paso como pendiente, en curso, completado o bloqueado. Un rechazo o error detiene el avance del plan. En documentos y biblioteca se usa el plan general; Task Manager conserva su alias específico.
- **Resúmenes por persona**: cuando se solicita una vista completa por responsables, el agente inspecciona todos los tickets del panel, releva las atribuciones explícitas tanto de los metadatos como de los detalles y evita agrupar el trabajo de distintas personas bajo el primer nombre encontrado.
- **Búsqueda de personas**: los resultados relevantes se diversifican entre archivos para que un historial con muchas menciones no desplace otros tickets coincidentes. La cantidad informada corresponde a rutas de tickets únicas, no a comentarios o estados dentro de un mismo archivo.
- **Panel adaptable**: el borde izquierdo del chat lateral permite ajustar su ancho con arrastre o teclado y conserva la medida elegida entre sesiones.
- **Colaboración en tiempo real**: la publicación LAN permite configurar entre 1 y 64 sesiones autenticadas y conexiones WebSocket concurrentes (64 por defecto). Las mutaciones del host y de las URL publicadas se distribuyen en ambas direcciones con revisión, reintento idempotente y detección de conflictos; una edición que quedó vieja pide recargar y no pisa el cambio de otra persona. Si se corta la red, la URL reconecta y recupera eventos por cursor o solicita un snapshot nuevo; al ocultar la pestaña pausa socket y reintentos y resincroniza al volver. Revocar un dispositivo cierra solo sus conexiones activas.

---

## 🧩 Consumo de Funcionalidades

> Esta sección describe, para cada módulo funcional, **qué hace**, **cuándo usarlo**, los **pasos para consumirlo**, las **entradas esperadas**, las **salidas/resultados** y los **errores comunes** con su resolución. Se expresa en lenguaje funcional (orientado a analistas y usuarios finales).

### Librerías y Explorador de Archivos

| Campo | Descripción |
|---|---|
| **Qué hace** | Indexa una carpeta local del filesystem y la presenta como un árbol jerárquico interactivo. Permite navegar, crear, copiar, mover, renombrar, eliminar y buscar archivos. |
| **Cuándo usarlo** | Siempre que necesites organizar, acceder o modificar tus notas y documentos dentro de una carpeta de trabajo. |
| **Pasos para consumir** | 1. Abrir Notia. 2. En el panel izquierdo, clic en **"Administrar librerías"** (footer). 3. Clic en **"Agregar librería"**. 4. Seleccionar una carpeta del filesystem (escritorio) o conceder permisos SAF (Android). 5. La carpeta aparece en el Explorador. |
| **Entradas esperadas** | Una ruta absoluta de carpeta (escritorio) o una URI de árbol SAF (Android). En Android, también un nombre descriptivo para la librería. |
| **Salidas / Resultado** | Árbol de archivos renderizado en el panel izquierdo. Los archivos y carpetas se listan con íconos según tipo. En escritorio, el árbol se actualiza automáticamente ante cambios externos. |
| **Errores comunes** | **"El selector de carpetas tardó demasiado. Intenta nuevamente."**: DocumentsUI no respondió dentro de 60 segundos; el modal queda disponible para reintentar. **"No se pudo acceder a la carpeta"** o **"Could not resolve Android directory."**: verificá que `selection.androidTreeUri` no esté vacío y reseleccioná la carpeta mediante Android SAF usando la versión actual de la aplicación. **Error al escribir la configuración**: SAF rechazó la escritura, se revocó el permiso o falló la escritura del contenido inicial; el plugin realiza _best-effort cleanup_ del documento creado y la librería no se agrega, así que podés volver a seleccionar la carpeta. Los mensajes de error ahora incluyen el detalle original de SAF (por ejemplo, `Could not create file. No se recibió una URI SAF válida.`) para facilitar el diagnóstico. **"No se pudieron guardar los cambios pendientes antes de agregar la libreria."**: guardá o corregí el documento pendiente y reintentá. **"El árbol está vacío"**: la carpeta seleccionada realmente no tiene archivos, o el path es incorrecto. |

### Crear una Nota Markdown

| Campo | Descripción |
|---|---|
| **Qué hace** | Crea un archivo de texto con formato Markdown dentro de una carpeta del Explorador. |
| **Cuándo usarlo** | Cuando querés documentar información estructurada con formato enriquecido, wikilinks, frontmatter y propiedades. |
| **Pasos para consumir** | 1. Seleccionar una carpeta en el Explorador. 2. Clic derecho → **"Nueva nota"** (o usar el botón **Nueva nota** del encabezado del Explorador, o `Ctrl + N`). 3. Ingresar el nombre del archivo. 4. Presionar Enter o clic fuera. 5. El archivo se crea y se abre automáticamente en una pestaña. |
| **Entradas esperadas** | Nombre del archivo (string, sin caracteres especiales `/`, `\`, `.`, `..`). El sistema agrega automáticamente la extensión `.md`. |
| **Salidas / Resultado** | Archivo `Nombre.md` creado en el filesystem. Pestaña abierta con el editor Markdown listo para edición. |
| **Errores comunes** | **"Nombre inválido"**: contiene caracteres prohibidos o está vacío. Solución: usar solo letras, números, espacios, guiones y guiones bajos. |

### Editar una Nota Markdown (Wikilinks)

| Campo | Descripción |
|---|---|
| **Qué hace** | Permite vincular notas entre sí mediante la sintaxis `[[Nombre de Nota]]`, creando un grafo de conocimiento bidireccional. |
| **Cuándo usarlo** | Cuando querés relacionar conceptos, ideas o documentos entre sí para navegación rápida y descubrimiento de conexiones. |
| **Pasos para consumir** | 1. Abrir una nota Markdown. 2. En cualquier parte del texto, escribir `[[Nombre de otra nota]]`. 3. Notia resaltará el wikilink y mostrará sugerencias mientras escribís. 4. Hacer clic en el wikilink para abrir la nota destino en una nueva pestaña. 5. Si la nota destino no existe, Notia ofrecerá crearla. |
| **Entradas esperadas** | Texto con patrón `[[nombre de nota]]`. El nombre debe coincidir (case-insensitive) con un archivo `.md` existente en la librería. |
| **Salidas / Resultado** | Enlace bidireccional activo. Al hacer clic se abre la nota destino. El Graph View utiliza estos enlaces para construir el mapa de relaciones. |
| **Errores comunes** | **Wikilink rojo/quebrado**: la nota destino no existe. Solución: crear la nota destino o corregir el nombre. |

### Enlaces Secuenciales — Page Links (`nextPage` / `previousPage`)

| Campo | Descripción |
|---|---|
| **Qué hace** | Vincula notas Markdown en una secuencia ordenada mediante las propiedades de frontmatter `nextPage` y `previousPage`. Útil para navegar entre capítulos, pasos de un proceso o entradas de un diario. |
| **Cuándo usarlo** | Cuando necesitás que varias notas estén conectadas en un orden específico y que el explorador las agrupe como un bloque secuencial. |
| **Pasos para consumir** | 1. Abrí una nota Markdown; el panel **Propiedades** está arriba del texto. 2. Encontrá la propiedad `nextPage` (se crea automáticamente al abrir una nota si no existe). 3. Tocá **Vincular nota…** (o el lápiz, si ya tiene una nota). 4. Escribí parte del nombre y elegí la nota de la lista, o tocá **Crear nota «…»** para crearla junto a la actual. 5. Notia actualizará automáticamente la nota destino para que tenga `previousPage: [[Nombre de la nota actual]]`. 6. Repetí el proceso para `previousPage` si es necesario. |
| **Entradas esperadas** | Un wikilink válido: `[[nombre-de-archivo.md]]`. Se aceptan referencias sin extensión (ej. `[[6-10]]`) que se resuelven automáticamente a `.md`. |
| **Salidas / Resultado** | Las dos notas quedan vinculadas bidireccionalmente. El **Explorador** renderiza las notas conectadas con una línea vertical que las agrupa como un bloque. Los bloques se ordenan por la fecha de creación (`createdAt`) de la primera nota. |
| **Errores comunes** | **Ciclo detectado**: si A → B → C, intentar que C apunte a A es rechazado. Solución: mantener una cadena lineal sin ciclos. **Link roto**: si `nextPage` apunta a un archivo inexistente, se ordena como nota suelta por fecha. Solución: verificar que el archivo exista. |

### Graph View

| Campo | Descripción |
|---|---|
| **Qué hace** | Visualiza todas las notas Markdown de la librería como nodos y los wikilinks entre ellas como conexiones, permitiendo navegación visual interactiva. |
| **Cuándo usarlo** | Cuando querés explorar visualmente las relaciones entre tus notas, encontrar notas aisladas o descubrir clusters de conocimiento. |
| **Pasos para consumir** | 1. Asegurate de tener notas Markdown con wikilinks en la librería. 2. En el **Icon Rail** (barra lateral izquierda), seleccionar **"Graph view"**. 3. Esperar a que se cargue el grafo (puede tomar segundos en bibliotecas grandes). 4. Usar órbita, zoom y paneo para explorar. 5. Hacer clic en un nodo para abrir la nota. 6. Usar la barra de búsqueda para encontrar texto en el título o contenido. 7. En una coincidencia, usar el ojo para enfocar su nodo, `+` para agregarla o quitarla del contexto visible del chat, o el icono de archivo para abrirla. |
| **Entradas esperadas** | Librería activa con al menos un archivo Markdown. No requiere entrada manual del usuario. |
| **Salidas / Resultado** | Canvas 2D interactivo con nodos (títulos de notas) y líneas de conexión (wikilinks). Al hacer clic en un nodo se abre la nota correspondiente en pestaña. |
| **Errores comunes** | **"El grafo está vacío"**: no hay archivos Markdown en la librería. Solución: crear notas Markdown. **"Lentitud"**: bibliotecas con miles de notas pueden tardar en construir el modelo. El archivo `linkCache.md` dentro de `.notia/` acelera la vista previa del grafo y se regenera automáticamente en segundo plano; si aún se siente lento, considerá dividir la librería en partes más pequeñas. |

### AI Chat con Ollama

| Campo | Descripción |
|---|---|
| **Qué hace** | Permite conversar con Ollama local o Cloud, según la URL configurada, con las reglas (`rules.md`) y la memoria (`memory.md`) del agente, contexto de archivos de la librería y análisis de imágenes. |
| **Cuándo usarlo** | Cuando necesitás asistencia de IA para redactar, resumir, analizar imágenes o consultar sobre el contenido de tus notas. |
| **Pasos para consumir** | 1. En Notia, abrir **Settings → IA**. 2. Dejar `https://ollama.com` para Ollama Cloud o configurar una URL local compatible con el chat. 3. Si se usa Cloud, ingresar la API Key sin compartirla en el prompt. 4. Hacer clic en **"Verificar conexión"**. 5. Seleccionar un modelo de la lista. 6. En el Icon Rail, abrir **"AI Chat"**. 7. Escribir un mensaje y presionar Enter. 8. Opcional: adjuntar archivos de la librería como contexto (modo **Directo** para contenido completo, **Referencia** para lista de nombres/rutas). 9. Opcional: abrir **Adjuntar archivo → Seleccionar archivo**, elegir uno o varios archivos locales y quitar individualmente los que no quieras enviar. 10. Opcional: cancelar una respuesta en curso con el botón **Cancelar** del compositor lateral o **Detener respuesta** en la vista Chat IA. |
| **Entradas esperadas** | Texto del mensaje (string, límite flexible ~30k caracteres de contexto acumulado). Opcional: uno o varios archivos locales de imagen, PDF o texto; cada archivo admite hasta 40 MB, los textos hasta 120.000 caracteres y los PDF hasta 24 páginas. No hay límite ejecutable de tamaño total del lote ni cantidad máxima de imágenes. Opcional: archivos de la librería como contexto. |
| **Salidas / Resultado** | Respuesta de texto del modelo de IA. Durante la generación, el pensamiento ocupa un bloque de altura fija que avanza hacia el fragmento más reciente y el hilo mantiene visible la parte inferior de la respuesta. Si todavía no hay una sesión seleccionada, el primer envío crea y muestra el chat inmediatamente en el panel lateral. La sesión se guarda automáticamente con un título generado por IA. Los mensajes de usuario conservan la metadata de sus adjuntos en el Markdown del chat; al recargar, los nombres vuelven a mostrarse y los adjuntos incluidos en la ventana de contexto pueden reutilizarse en una consulta de seguimiento. Las reglas y memorias del agente se cargan y se guardan (cuando el agente usa sus herramientas) en las superficies persistentes y en Telegram vinculado al Owner; Meeting, la publicación y Telegram vinculado a otro usuario mantienen políticas sin memoria. |
| **Errores comunes** | **"No se pudo conectar con Ollama"**: el proveedor no responde o la URL es incorrecta. Solución: verificar el endpoint en Settings; para una instalación local, confirmar que Ollama esté ejecutándose. **"No se pudo procesar el archivo"**: el tipo, tamaño, contenido, límite de caracteres o cantidad de páginas no es compatible; elegir archivos de imagen/PDF/texto dentro de los límites. **"La búsqueda web no está disponible"**: la búsqueda pública requiere Ollama Cloud y una API Key válida; el chat local puede seguir funcionando. **"La IA no devolvió contenido"**: reintentar o cambiar de modelo. **"El modelo seleccionado no admite imágenes"**: elegir un modelo con capacidad de visión en Settings → IA. |

### Multichat

| Campo | Descripción |
|---|---|
| **Qué hace** | Coordina una conversación efímera entre el usuario y de uno a seis agentes elegidos desde `.agent/promps/`, guiados por una dinámica Markdown de `.agent/dynamics/` y un contexto adicional opcional fijo. |
| **Cuándo usarlo** | Para comparar perspectivas, encadenar respuestas o pedir una discusión guiada sin agregar la sala al historial de chats. |
| **Pasos para consumir** | 1. Abrir **Multichat**, debajo de **Agenda**. 2. Elegir una dinámica válida. 3. Opcionalmente escribir contexto adicional. 4. Marcar entre uno y seis agentes válidos. 5. Crear la sala y enviar el primer mensaje. 6. Cancelar la ronda desde el botón visible si hace falta. |
| **Entradas esperadas** | Una dinámica Markdown no vacía, un contexto adicional opcional y entre uno y seis prompts Markdown no vacíos. El contenido del frontmatter se ignora. El contexto es contenido de usuario no confiable y no otorga permisos. |
| **Salidas / Resultado** | Mensajes identificados por hablante y mostrados en orden. En cada ronda se elige por defecto un subconjunto no vacío y un orden aleatorios entre los agentes fijados; una dinámica puede nombrar agentes concretos o indicar explícitamente todos, sin incorporar agentes externos a la sala. El contexto adicional queda fijo al iniciar y se envía a cada agente junto con la dinámica y su prompt, separado del historial de hasta 40 mensajes. Thinking y respuesta se muestran en streaming por separado; cada respuesta completada se confirma inmediatamente en la vista y se incorpora al contexto del siguiente agente, mientras que los parciales siguen siendo temporales. Las rondas continúan automáticamente hasta el límite de una a cuatro, salvo que la dinámica pida esperar al usuario; un nuevo mensaje reinicia el contador. Solo la respuesta final se guarda como mensaje. La sala conserva la conversación solo en memoria de la vista y se elimina al cerrar la pestaña; el panel derecho puede verla como contexto auxiliar sin participar y mantiene sus permisos normales. |
| **Errores comunes** | **"Seleccioná una dinámica válida"** o **"La dinámica seleccionada está vacía"**: elegí un `.md` legible con contenido. **"Seleccioná entre uno y seis agentes"** o **"El prompt seleccionado está vacío"**: corregí los prompts y volvé a seleccionar. Si un agente falla, se cancela o no devuelve contenido, la sala muestra el estado correspondiente y no encadena turnos automáticamente. |

### Finanzas: Servicios, auditorías y control mediante IA

| Campo | Descripción |
|---|---|
| **Qué hace** | Administra servicios mensuales, el pago o la ocurrencia de cada mes, facturas/boletas asociadas y una auditoría asistida que detecta inconsistencias y propone revisiones seguras. El chat de Finanzas también permite consultar snapshots y registros paginados o por ID, guardar entidades, revertir movimientos, eliminar registros permitidos, limpiar el dominio y extraer documentos para revisión. |
| **Cuándo usarlo** | Para registrar un servicio recurrente sin crear obligaciones futuras, asociar un gasto o comprobante a un servicio, cargar una factura, revisar propuestas del mes o gestionar datos financieros desde el chat. |
| **Pasos para consumir** | 1. Abrir **Finanzas** en el panel izquierdo. 2. Seleccionar **Home**; la sección **Servicios** aparece debajo del dashboard dentro del mismo desplazamiento vertical. 3. Elegir el mes. 4. Usar **Nuevo servicio**, **Registrar pago**, **Guardar como factura**, **Historial** o los filtros visibles. 5. Para el control integral, abrir el chat lateral y describir la consulta o cambio; revisar el preview y la confirmación reforzada cuando corresponda. 6. Revisar la bandeja **Auditoría del mes** y abrir el detalle legible de cada propuesta. 7. Elegir **Confirmar**, **Rechazar** o **Cancelar** individualmente. |
| **Entradas esperadas** | Servicio: nombre, categoría de gasto, importe esperado, moneda y modalidad; opcionalmente vencimiento, cuenta habitual y proveedor. Pago: importe y fecha efectiva, con un ID de gasto existente opcional. Factura: período, importe y moneda, con servicio, vencimiento, gasto o comprobante opcionales. Chat: una consulta o cambio financiero con datos inequívocos; la IA solicita aclaración si falta una cuenta, categoría o ID. |
| **Salidas / Resultado** | El servicio queda activo o inactivo, la ocurrencia mensual conserva su versión anterior al reemplazarse y la factura queda diferenciada del gasto. Una auditoría puede terminar sin propuestas, quedar pendiente para reintento o mostrar propuestas individuales con estado. El preview de auditoría no escribe; al aplicar, la aplicación realiza únicamente la acción permitida que se muestra: conciliar consumos `purchase` del resumen con ocurrencias mensuales, descartar o crear la ocurrencia sin pago, cambiar su importe esperado sin cambiar el gasto, o quitar el vínculo con un servicio inexistente conservando el gasto. Las mutaciones del chat y Telegram devuelven un resultado verificable; extraer un documento no crea entidades automáticamente. Si el preview deja de coincidir con los datos actuales, la propuesta se marca obsoleta y no se aplica. La evidencia de tarjeta que cubre una ocurrencia sin importe pagado no genera una propuesta de servicio impago y la auditoría continúa sin abortar la aplicación. |
| **Errores comunes** | **"La categoría no existe o está inactiva"**: elegir una categoría de gasto activa. **"La cuenta ... debe usar la moneda"**: seleccionar una cuenta de la misma moneda. **"Servicio/factura duplicado"**: revisar el servicio, período o comprobante existente. **"Propuesta obsoleta"**: volver a cargar la auditoría y obtener un preview nuevo. **"Registro no encontrado"**: volver a listar y usar el ID devuelto. Una acción libre, incompatible o sin `#Confidencial` se rechaza. Si no hay IA, el dato confirmado se conserva y la auditoría queda pendiente. Ante evidencia incompleta, Finanzas devuelve un resultado o error concreto para revisar y reintentar, sin cerrar la aplicación. |

### Agenda: semana en bloques de 15 minutos y anotador del día

| Campo | Descripción |
|---|---|
| **Qué hace** | Muestra el mes y la semana elegidos, agenda tareas en bloques de 15 minutos con prioridad, lista los próximos eventos y guarda un anotador de pendientes del día. |
| **Cuándo usarlo** | Para reservar tiempo en la semana, ver de un vistazo qué días tenés tareas y anotar pendientes rápidos del día. |
| **Pasos para consumir** | 1. Abrir **Agenda** en la barra izquierda. 2. Elegir el día en el calendario o moverse con las flechas de **Semana**. 3. Seleccionar bloques en la grilla (clic o arrastre; en táctil, tocar o mantener presionado y deslizar). 4. Escribir el nombre, elegir la prioridad y tocar **Agendar**. 5. Tocar una tarea para eliminarla. 6. Anotar pendientes en **Anotador rápido** y marcarlos al terminarlos. |
| **Entradas esperadas** | Bloques de 15 minutos (hasta una semana completa por vez), nombre de la tarea (hasta 120 caracteres; vacío queda «Tarea sin título»), prioridad y notas de hasta 200 caracteres. |
| **Salidas / Resultado** | La vista se actualiza al instante y se recarga al volver a la ventana. Los días con tareas muestran un punto en el calendario y el encabezado resume los eventos próximos y las tareas pendientes. |
| **Errores comunes** | **«El horario … se superpone con…»**: elegí bloques libres o eliminá la tarea que ocupa ese horario. **«La nota es obligatoria»**: escribí algo antes de **Agregar**. **«La biblioteca perdió su URI SAF»** (Android): volvé a seleccionar la carpeta de la biblioteca. |

### Rutina: hábitos, rachas y rueda de la vida

| Campo | Descripción |
|---|---|
| **Qué hace** | Organiza hábitos en rutinas, registra qué hiciste cada día y calcula rachas, porcentajes diarios, semanales y mensuales y el puntaje de cada categoría de la rueda de la vida. |
| **Cuándo usarlo** | Para sostener hábitos diarios o de ciertos días, revisar cómo viene la semana o el mes y equilibrar áreas de tu vida con metas por categoría. |
| **Pasos para consumir** | 1. Abrir **Rutina** en la barra izquierda. 2. Crear o renombrar rutinas en **Tus rutinas**. 3. En **Sumar a la rutina**, escribir la tarea, elegir rutina, categoría y días, y tocar **Añadir**. 4. Marcar lo hecho en **Semana actual**, eligiendo la rutina en las pestañas. 5. Ajustar las metas en **Rueda de la vida**. 6. Opcional: pedirle a la IA, por ejemplo, «marcá tomar agua y estirar como hechas hoy» y confirmar. |
| **Entradas esperadas** | Nombre de rutina (hasta 30 caracteres), nombre de tarea (hasta 60), una de las 8 categorías, días de la semana, nota opcional (hasta 80) y metas de 1 a 10. |
| **Salidas / Resultado** | El panel se actualiza al instante. Si la IA hace cambios desde el chat o Telegram, la vista abierta se recarga sola. Una tarea eliminada puede recuperarse con **Deshacer** o pidiéndoselo a la IA. |
| **Errores comunes** | **«Elegí al menos un día»**: marcá algún día o elegí **Todos los días**. **«Necesitás al menos una rutina»** o **«vaciala antes de eliminarla»**: mové o eliminá sus tareas primero. **«No se pueden marcar días futuros»**, **«no aplica el…»** o **«está pausada»**: marcá solo hoy o días anteriores, en días que correspondan a la tarea y con la tarea activa. **«Hay varias tareas llamadas…»**: indicá a la IA de qué rutina se trata. |

### ColdPass (Credenciales Cifradas)

| Campo | Descripción |
|---|---|
| **Qué hace** | Almacena credenciales (usuarios, contraseñas, URLs, notas) en un archivo cifrado dentro de la librería activa. El cifrado ocurre localmente en el dispositivo. |
| **Cuándo usarlo** | Cuando necesitás guardar contraseñas, claves API, datos bancarios o cualquier información sensible de forma segura dentro de tu espacio de conocimiento. |
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"ColdPass"**. 2. Si es la primera vez, se creará automáticamente la carpeta `ColdPass/` y el archivo `ColdPass.md` cifrado. 3. Ingresar una **passkey** (contraseña maestra) para descifrar. 4. Agregar nuevas credenciales mediante el formulario (nombre, usuario, contraseña, URL, notas). 5. Guardar. Los cambios se cifran automáticamente. |
| **Entradas esperadas** | Passkey (string, mínimo recomendado 12 caracteres). Credenciales: nombre (string, obligatorio), usuario, contraseña, URL, notas (todos strings opcionales). |
| **Salidas / Resultado** | Archivo `ColdPass/ColdPass.md` cifrado en el filesystem. Lista de credenciales descifradas visualizable solo con la passkey correcta. |
| **Errores comunes** | **"Passkey incorrecta"**: la contraseña maestra no descifra el archivo. Solución: verificar mayúsculas/minúsculas. Si se olvida, no hay recuperación posible (diseño privacy-first). |

### Sincronización ColdPass por Bluetooth

| Campo | Descripción |
|---|---|
| **Qué hace** | Transfiere la bóveda de credenciales cifrada de un dispositivo a otro mediante Bluetooth Low Energy (BLE) con emparejamiento seguro (PIN + autenticación de aplicación). |
| **Cuándo usarlo** | Cuando querés tener la misma bóveda de credenciales en tu computadora y tu dispositivo móvil (o viceversa). |
| **Pasos para consumir** | 1. Asegurate de que ambos dispositivos tengan Bluetooth activado y estén a menos de 1 metro. 2. En el dispositivo origen, abrir ColdPass y hacer clic en **"Conectar Bluetooth"**. 3. Esperar a que detecte el dispositivo destino (nombre "ColdPass"). 4. Ingresar el PIN mostrado en el dispositivo destino. 5. Esperar la confirmación de emparejamiento. 6. Hacer clic en **"Autenticar"** para establecer canal seguro. 7. Hacer clic en **"Enviar bóveda"** para transferir las credenciales cifradas. |
| **Entradas esperadas** | PIN numérico (4-6 dígitos, mostrado en el dispositivo destino). Dispositivos con BLE compatible. En Linux, requiere BlueZ. |
| **Salidas / Resultado** | Bóveda cifrada transferida al dispositivo destino. El destino debe ingresar la misma passkey para descifrarla. |
| **Errores comunes** | **"No se encontró dispositivo"**: BLE no está activado o los dispositivos están muy lejos. Solución: acercar dispositivos y verificar Bluetooth. **"PIN incorrecto"**: solución: reintentar con el PIN correcto. **"Bluetooth no soportado"**: en Android/iOS o Windows/macOS el soporte es limitado; Linux tiene soporte completo. |

### Task Manager (Kanban y Tabla)

| Campo | Descripción |
|---|---|
| **Qué hace** | Gestiona tareas organizadas en tableros con dos vistas disponibles: Kanban (columnas drag-and-drop) y tabla (listado ordenable). Cada tarea incluye estado, prioridad, subtareas, comentarios y fecha de fin. |
| **Cuándo usarlo** | Cuando necesitás organizar proyectos, seguimiento de actividades o gestión personal de tareas de forma visual o tabular. |
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"Task Manager"**. 2. Hacer clic en **"Nuevo tablero"** e ingresar un nombre y su contexto. 3. Para cambiarlo después, usar **"Editar tablero"**. 4. Agregar tareas al tablero. 5. Para cada tarea, definir estado, prioridad, subtareas y comentarios. 6. Cambiar entre vista Kanban y vista Tabla según prefieras. 7. Al completar o cancelar una tarea, ésta se archiva automáticamente en la carpeta correspondiente. |
| **Entradas esperadas** | Nombre y contexto del tablero. Tarea: título visible (string, obligatorio; puede incluir `/` y `\\`), descripción, prioridad (alta/media/baja), estado (pendiente/en progreso/completada/cancelada), subtareas (lista de wikilinks), comentarios (lista). Los nombres de tableros y grupos siguen rechazando separadores de rutas. |
| **Salidas / Resultado** | Cada tarea se guarda como un archivo `.md` individual con metadatos YAML (frontmatter), incluido `contexto`, dentro de la carpeta `task-mannager/<tablero>/` en tu librería. Al crear o editar el contexto del tablero, todos los `.md` de esa carpeta se actualizan para usarlo. Los metadatos compartidos del tablero (nombres, colores, horas de actividad y contexto) se guardan en `.notia-task-manager.json`; `localStorage` conserva solo preferencias de presentación. |
| **Errores comunes** | **"No se pudo guardar la tarea"**: error de escritura en el filesystem. Solución: verificar permisos de la carpeta de la librería. **"No se encuentra el tablero"**: la carpeta del tablero fue renombrada o eliminada fuera de Notia. Solución: refrescar el Explorador. |

### Pomodoro

| Campo | Descripción |
|---|---|
| **Qué hace** | Temporizador de productividad con ciclos de 25 minutos de trabajo y 5 minutos de descanso. Registra cada sesión en un archivo `PomodoroLog.md` dentro de la carpeta `task-mannager/` de tu librería, con timestamp y duración. |
| **Cuándo usarlo** | Durante sesiones de trabajo enfocado para medir y mejorar la productividad. |
| **Pasos para consumir** | 1. Abrir el Task Manager. 2. En el panel lateral, abrir **"Pomodoro"**. 3. Hacer clic en **"Iniciar"** para comenzar un ciclo de 25 minutos. 4. Al finalizar, se registra automáticamente la sesión en `PomodoroLog.md`. 5. Hacer clic en **"Descanso"** para iniciar los 5 minutos de pausa. 6. Consultar el historial de sesiones y estadísticas acumuladas. |
| **Entradas esperadas** | Ninguna entrada manual. El temporizador se controla con botones de inicio, pausa y reset. |
| **Salidas / Resultado** | Registro de sesión completada con timestamp en `task-mannager/PomodoroLog.md`. Estadísticas: total de sesiones, tiempo acumulado, distribución por día. |
| **Errores comunes** | **"El temporizador no avanza"**: la pestaña o ventana está inactiva y el navegador limita los timers. Solución: mantener la ventana visible o usar la app en modo ventana maximizada. |

### Publicar Task Manager en la red local

El chat de IA del panel publicado envía la consulta al host y recibe el resultado por streaming; la app host ejecuta el motor global de Notia con sus límites, permisos, confirmaciones y herramientas del alcance publicado. El navegador no contacta Ollama ni recibe la URL o la API key.

Desde **Configuraciones → Publicar**, el anfitrión elige los tableros y comparte la URL HTTPS `/task-manager`. El login valida el usuario y la contraseña de la cuenta de la biblioteca; no existe una contraseña adicional de tablero ni una aprobación de dispositivos. Una vez autenticado, puede editar tareas desde la misma interfaz: las mutaciones viajan por WebSocket seguro y los cambios confirmados aparecen en el anfitrión y en los demás navegadores autorizados.

La URL publicada solicita un nombre de usuario y la contraseña personal de esa cuenta. Rust autentica contra `library_users` y crea una cookie `HttpOnly` asociada al `user_id`; la contraseña nunca se guarda en texto plano ni se recuerda en el navegador. Cambiar la contraseña, quitar el usuario, cambiar sus contextos o cerrar/republicar la publicación invalida el acceso correspondiente.

Los ajustes de sincronización requieren reiniciar el proceso de escritorio con el código actualizado y recargar las páginas publicadas. La URL recibe en el arranque la ubicación lógica de la carpeta de tareas y la reutiliza durante toda la sesión, por lo que mover varios tickets seguidos no genera consultas repetidas de detección de carpetas ni agota el límite de solicitudes. Host e invitados esperan su turno ante acciones simultáneas, y un lote conserva la misma identidad desde el inicio hasta su confirmación; se pueden mover repetidamente los mismos tickets, crear, editar detalle/Markdown, comentar y cambiar estado sin dejar bloqueado el siguiente cambio. Las operaciones sobre tickets diferentes no chocan solo porque avanzó la revisión global; si dos personas editan el mismo archivo desde versiones incompatibles, se informa el conflicto en lugar de sobrescribirlo. Si la sesión realmente vence o el host vuelve a publicar, el navegador regresa al ingreso en vez de continuar acumulando errores `401`/`429`. La validación visual multiusuario sigue pendiente y no debe darse por certificada únicamente por las pruebas automatizadas.

La capacidad está configurada entre 1 y 64 sesiones autenticadas y conexiones WebSocket simultáneas (64 por defecto). Si se alcanza el límite, el nuevo ingreso recibe un mensaje para reintentar; las sesiones existentes continúan activas. Si la red se corta, el navegador reconecta y recupera eventos pendientes; si ya no están disponibles, descarga un snapshot nuevo. Una edición Markdown que parta de una revisión vieja muestra conflicto y conserva el texto escrito, sin sobrescribir el cambio remoto. Revocar el acceso de un usuario, vencer su sesión o detener/republicar la publicación cierra sus conexiones y finaliza sus streams.

Para integraciones o diagnóstico, el flujo HTTP usa `POST /task-manager/login` con `{ "username", "userPassword" }` y `GET /task-manager/bootstrap` con la cookie de sesión. No hay endpoint de aprobación de dispositivos ni campo `boardPassword`; el identificador de dispositivo no autoriza el login. Las mutaciones no deben enviarse a `/invoke`: el canal colaborativo es `wss://<host>/task-manager/ws`, con mensajes JSON como:

```json
{
  "type": "mutate",
  "protocolVersion": 1,
  "messageId": "mensaje-opaco",
  "operationId": "operacion-opaca",
  "baseRevision": 12,
  "command": "task_manager_board_execute",
  "args": { "payload": { "intent": { "kind": "change-state", "taskPath": "task-mannager/board/task.md", "state": "En progreso" } } }
}
```

El servidor responde con un `ack` y distribuye un evento `changed` con `publicationEpoch`, `sequence`, `revision` y `messageId`. Las rutas locales, credenciales, contenido no autorizado y preferencias privadas no forman parte del protocolo.

`GET /task-manager/status` requiere la misma cookie autenticada y devuelve solo métricas agregadas del host para diagnóstico; nunca expone rutas locales, credenciales ni contenido de tareas.

### Servidor Notia sin ventana (headless)

El mismo `notia.exe` puede quedar corriendo como servidor, sin abrir la ventana, para que otros equipos de la red usen Notia. En Linux se compila solo el servidor. Usa las mismas bibliotecas y datos que la aplicación, así que no pueden estar abiertas las dos a la vez sobre la misma carpeta de datos. Si se intenta, Notia avisa que ya está en uso.

1. Definí la contraseña del dueño: `notia --headless --set-owner-password`.
2. Si hace falta, agregá bibliotecas de ese equipo: `notia --headless --add-library "D:\Notas"`.
3. Arrancá el servidor: `notia --headless`. Muestra la dirección `https://<ip>:52480/`. Con `--static-dir` sirve también la interfaz web, y `--bind` cambia la dirección o el puerto.

Desde otro equipo o un teléfono, abrí esa dirección en el navegador. El certificado es autofirmado, por eso el navegador pide confirmarlo la primera vez. Después de ingresar la contraseña del dueño se usa la misma interfaz de Notia: bibliotecas, notas, chat, Task Manager, Finanzas y el resto, con los cambios en vivo. El dictado del chat graba con el micrófono del dispositivo desde el que usás Notia y el texto aparece al finalizar. Lo que depende del equipo servidor no se ofrece en el navegador: Meeting, el Bluetooth de ColdPass, importar un vault CSV, elegir la carpeta de backups y agregar librerías con el selector. Para que el servidor sirva la interfaz, indicá `--static-dir` con la carpeta `dist` compilada o dejala junto al ejecutable.

Si el navegador pierde la conexión, se reconecta solo y recibe los cambios que ocurrieron mientras tanto. Si pasó demasiado tiempo o el servidor se reinició, aparece un aviso arriba con el botón **Recargar** para volver a leer todo.

En Linux, el servidor se compila desde `src-tauri` con `cargo build --release --no-default-features`. Allí no hay dictado ni Bluetooth.

### Búsqueda de Archivos

| Campo | Descripción |
|---|---|
| **Qué hace** | Busca archivos por nombre dentro de la librería activa, mostrando resultados en tiempo real mientras escribís. |
| **Cuándo usarlo** | Cuando necesitás encontrar rápidamente una nota o documento sin navegar manualmente por el árbol. |
| **Pasos para consumir** | 1. En el panel del Explorador (izquierda), hacer clic en la barra de búsqueda. 2. Escribir el nombre o parte del nombre del archivo. 3. Los resultados se filtran automáticamente en el árbol. 4. Hacer clic en un resultado para abrirlo. |
| **Entradas esperadas** | Query de búsqueda (string, mínimo 1 carácter). Búsqueda case-insensitive y sin acentos. |
| **Salidas / Resultado** | Lista de archivos cuyo nombre coincide con el query. Si no hay coincidencias, el árbol muestra estado vacío. |
| **Errores comunes** | **"No hay resultados"**: el archivo no existe o está en otra librería. Solución: verificar la librería activa o el nombre del archivo. |

---

## 📖 Guía de Uso

### Inicio Rápido

1. **Abrir la aplicación**: al iniciar por primera vez, Notia no tiene librerías configuradas.
2. **Agregar una librería**:
   - En el panel izquierdo, abajo, tocá el selector de librería y elegí **"Administrar librerías"**.
   - Seleccioná **"Agregar librería"** y elegí una carpeta de tu filesystem (escritorio) o concedé permisos de carpeta (Android).
   - La carpeta seleccionada se indexará y aparecerá en el Explorador.
3. **Crear contenido**:
   - Desde el encabezado del Explorador: **Nueva nota**, **Nuevo diagrama** o **Nueva carpeta** (también `Ctrl + N` para una nota nueva).
   - Sin ninguna nota abierta, la pantalla central ofrece **Nueva nota**, **Nuevo chat** (abre la vista Chat IA en un chat nuevo) e **Ir a archivo**.
   - O desde el **menú contextual** (clic derecho) en cualquier carpeta del Explorador.
4. **Abrir archivos**: hacé clic en cualquier archivo del árbol de archivos. Se abrirá en una pestaña.
5. **Navegar entre vistas**: el **Icon Rail** (barra vertical izquierda) permite cambiar entre:
   - **Explorador**: muestra u oculta el panel de archivos.
   - **Vista de grafo**, **Chat** y **Task Manager**.
   - **ColdPass**, **Transcribir meeting** y **Finanzas**.
   - **Calendario**, **Agenda**, **Multichat** y **Rutina**.
   - Abajo, **Ayuda** y **Configuración**. En escritorio, cada ícono muestra su nombre al pasar el mouse; el módulo abierto queda marcado en teal.
6. **Buscar un archivo**: escribí en **Buscar archivos**, arriba del árbol, o usá `Ctrl + O`.
7. **Cerrar pestañas**: clic en la "X" de la pestaña, o atajo `Ctrl + W`.
8. **Paneles**: los botones a la derecha de las pestañas muestran u ocultan el Explorador y el Asistente, y cambian el tema. En un teléfono, el Explorador se abre sobre el contenido.

### Uso de Wikilinks

1. En cualquier nota Markdown, escribí `[[Nombre de otra nota]]`.
2. Notia resaltará el wikilink y mostrará sugerencias mientras escribís.
3. Hacé clic en el wikilink para abrir la nota destino en una nueva pestaña.
4. Si la nota destino no existe, Notia te ofrecerá crearla.

### Usar Enlaces Secuenciales (Page Links)

1. Abrí una nota Markdown desde el Explorador.
2. En el panel **Propiedades** (arriba del texto), buscá la propiedad `nextPage`. Si no existe, se crea automáticamente al abrir la nota por primera vez.
3. Tocá **Vincular nota…** (o el lápiz, si ya apunta a una nota).
4. Escribí parte del nombre: aparece la lista de notas de la librería, cada una con su carpeta.
5. Elegí la nota (o presioná **Enter** para la resaltada). Si todavía no existe, tocá **Crear nota «…»**: Notia la crea junto a la nota actual y la enlaza.
6. Notia guardará automáticamente:
   - La nota actual con `nextPage: [[nombre-del-siguiente-archivo]]`
   - La nota destino con `previousPage: [[nombre-de-la-nota-actual]]`
7. En el **Explorador**, ambas notas aparecerán conectadas visualmente como un bloque secuencial.
8. Para **romper un link**, tocá el lápiz de `nextPage` (o `previousPage`) y elegí **Quitar enlace**. Notia limpiará el vínculo opuesto automáticamente.
9. Para **cambiar el destino**, editá `nextPage` a un nuevo archivo. Notia limpiará el vínculo en el destino anterior y lo creará en el nuevo.
10. **Nota**: No se permiten ciclos (A → B → C → A). Si intentás crear un ciclo, Notia mostrará un error.

### Configurar el Chat con IA

1. Asegurate de tener **Ollama** instalado y corriendo localmente en tu máquina (o accesible en red local).
2. En Notia, abrí **Settings** (⚙️) → **IA**.
3. Ingresá la URL de Ollama (por defecto: `http://localhost:11434`).
4. Opcional: ingresá una API Key si usás Ollama Cloud o un servicio con autenticación.
5. Hacé clic en **"Verificar conexión"** para confirmar que Notia puede comunicarse con Ollama.
6. Seleccioná un modelo de la lista de modelos disponibles. Para enviar imágenes, elegí uno con capacidad de visión.

### Usar ColdPass

1. En el **Icon Rail**, seleccioná **ColdPass**.
2. La primera vez, se creará automáticamente una carpeta `ColdPass/` y un archivo `ColdPass.md` cifrado en tu librería activa.
3. Ingresá una **passkey** (contraseña maestra) para descifrar la bóveda.
4. Agregá, editá o eliminá credenciales. Cada cambio se cifra automáticamente al guardar.
5. Para sincronizar con otro dispositivo:
   - Asegurate de que ambos dispositivos tengan Bluetooth activado.
   - En el dispositivo origen, iniciá la conexión Bluetooth desde ColdPass.
   - Seguí las instrucciones de emparejamiento (PIN y autenticación).
   - Transferí la bóveda cifrada de forma segura.

### Usar el Task Manager y Pomodoro

1. En el **Icon Rail**, seleccioná **Task Manager**.
2. Creá un **tablero** nuevo dándole un nombre (ej. "Proyecto Alpha"). Notia creará automáticamente la carpeta `task-mannager/Proyecto Alpha/` en tu librería.
3. Agregá **tareas** al tablero. Podés definir prioridad, estado, fecha de fin, subtareas y comentarios.
4. Cambiá entre la **vista Kanban** (columnas visuales) y la **vista Tabla** (listado ordenable) según prefieras.
   - Hacé **doble clic** en una tarea para editarla con el mismo editor de las notas: arriba sus propiedades y abajo el cuerpo con formato (títulos, listas, tablas, diagramas). **Guardar** se habilita cuando cambiás algo.
5. Al completar o cancelar una tarea, ésta se archiva automáticamente en la carpeta `finished/` o `cancelled/` respectivamente.
6. Para usar el **Pomodoro**:
   - Abrí el panel Pomodoro desde la barra lateral del Task Manager.
   - Iniciá una sesión de 25 minutos.
   - Al completarla, se registrará automáticamente en el archivo `PomodoroLog.md` dentro de `task-mannager/`.
   - Consultá las estadísticas de productividad acumuladas.

### Cambiar el Tema y Preferencias

1. Abrí **Settings** (⚙️) desde la barra de título o el menú.
2. En **Apariencia**, seleccioná **Claro** u **Oscuro**.
3. En **Explorador**, ajustá el **intervalo de refresco** (útil en Android para detectar cambios externos).
4. En **InkMath**, configurá el intervalo de inactividad previo al reconocimiento OCR.

---

## 🛠️ Requisitos de Sistema

### Para ejecutar la aplicación

- **Sistema operativo**: Windows 10+, macOS 11+, Linux (kernel 5.x+), Android 10+.
- **Para IA local**: instancia de **Ollama** corriendo localmente o accesible en red (opcional).
- **Para ColdPass Bluetooth**: adaptador Bluetooth Low Energy (BLE) compatible (Linux requiere BlueZ; Windows y macOS tienen soporte limitado actualmente).

### Para desarrollo

- **Node.js**: 20 o superior.
- **npm**: 10 o superior.
- **Rust Toolchain**: `rustup`, `cargo`, `rustc` (edición 2021).
- **Git**: para control de versiones.

### Dependencias del sistema (Linux)

Para compilar y ejecutar Notia en Linux, se requieren los siguientes paquetes del sistema:

```bash
# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libdbus-1-dev \
    libbluetooth-dev

# Fedora
sudo dnf install webkit2gtk4.1-devel \
    gcc \
    gcc-c++ \
    make \
    curl \
    wget \
    openssl-devel \
    gtk3-devel \
    libayatana-appindicator3-devel \
    librsvg2-devel \
    dbus-devel \
    bluez-devel
```

📖 **Guía oficial de prerequisitos de Tauri**:  
https://tauri.app/start/prerequisites/

---

## 🚀 Instalación y Desarrollo

### Clonar el repositorio

```bash
git clone <repository-url>
cd notia
```

### Instalar dependencias

```bash
# Frontend (Node.js)
npm ci

# Backend (Rust) — se descarga automáticamente con cargo durante el build
```

`npm ci` instala exactamente las versiones de `package-lock.json`, incluido el override de `esbuild` usado para estabilizar el build en Windows. `npm install` también es válido para instalaciones de desarrollo que necesiten actualizar el lockfile.

### Modo desarrollo

Los launchers de Tauri generan automáticamente el build multipágina de desarrollo antes de iniciar la app, sin minificar JavaScript. En Windows, esbuild `0.27.3` podía terminar con `-1073741819` (`STATUS_ACCESS_VIOLATION`) y Vite mostraba `The service was stopped` al generar esos assets. El proyecto fija `esbuild` en `0.27.7` mediante `package.json` y `package-lock.json`; esto también prepara `public-task-manager.html`, que el servidor HTTPS local necesita para entregar la pantalla posterior al login de la URL publicada de Task Manager. El `npm run build` normal continúa siendo el build optimizado para producción.

```bash
# Solo frontend web (Vite, puerto 1420)
npm run dev

# App desktop completa (Linux, auto-detecta Wayland/X11)
npm run dev:tauri

# App desktop completa en Windows
npm run dev:tauri:windows

# Forzar backend Wayland
NOTIA_TAURI_BACKEND=wayland npm run dev:tauri:wayland

# Forzar backend X11
NOTIA_TAURI_BACKEND=x11 npm run dev:tauri:x11

# Wayland con fallback a X11
NOTIA_TAURI_BACKEND=wayland NOTIA_TAURI_FALLBACK_X11=1 npm run dev:tauri:wayland:fallback
```

En Windows, si el puerto 1420 ya está ocupado por una instancia de Vite iniciada desde este mismo repositorio, el comando la reutiliza. Si pertenece a otra aplicación o proyecto, informa el proceso que debe cerrarse y no inicia Tauri contra un servidor incorrecto.

El launcher de Windows reintenta una vez el build de desarrollo si esbuild se detiene. Si ambos intentos fallan, revisá procesos Node/Vite duplicados y el antivirus antes de volver a ejecutar el comando.

### Desarrollo para Android

```bash
# Desarrollo en dispositivo Android (auto-detecta NDK y dispositivo adb)
npm run dev:android

# Build debug APK
npm run build:android:debug

# Build release AAB (Android App Bundle para Play Store)
npm run build:android:aab

# Instalar release en dispositivo conectado
npm run install:android:release
```

---

## ⚙️ Configuración de Entorno y Preferencias

Notia guarda las preferencias en su backend: las del dispositivo en los datos de la aplicación y las de IA, Telegram y contextos en la configuración de cada biblioteca. En el navegador o WebView solo quedan preferencias visuales, como el tema, el ancho de paneles o las carpetas expandidas. Las siguientes configuraciones están disponibles:

### Apariencia
- **Tema**: claro u oscuro. Persiste entre sesiones.

### IA (Ollama)
- **URL de Ollama**: dirección del servidor local de Ollama (default: `http://localhost:11434`).
- **API Key**: opcional, para servicios que requieren autenticación.
- **Modelo seleccionado**: elegí entre los modelos multimodales disponibles detectados automáticamente.
- **Feedback del agente**: estándar, mínimo, detallado o desactivado; el plan y el resumen de enfoque se pueden ocultar.

Las ediciones documentales se proponen con diff por hunks, revisión exacta, confirmación y undo por `operationId`. La memoria activa vive en `.agent/memory/memory.md`; los chats persistentes del Owner y Telegram vinculado al Owner pueden cargarla y guardarla, mientras Meeting y Telegram vinculado a otro usuario no la cargan ni la guardan. La búsqueda web de Ollama solo admite consultas públicas sanitizadas y no envía claves, datos personales ni contenido del workspace.

### Explorador de archivos
- **Intervalo de refresco**: en Android, podés configurar un intervalo en milisegundos para que el árbol de archivos se refresque periódicamente (default: deshabilitado).

### InkMath
- **Espera de OCR**: intervalo de inactividad antes de enviar a Ollama los trazos de una fórmula dibujada.

### Logging
- Notia registra solamente errores, salvo una traza diagnóstica acotada para imágenes procesadas por Telegram/Ollama. Esa traza muestra descarga, rondas de IA, nombres de tools, persistencia, respuesta y tiempos sin incluir la imagen, el prompt, credenciales ni argumentos financieros.

---

## ❓ FAQ y Troubleshooting

### No veo mis archivos en Android
- Verificá que hayas concedido los permisos de acceso a la carpeta mediante el selector del sistema (SAF).
- Asegurate de que la URI de la carpeta (Android Tree URI) esté correctamente asociada a la librería.
- Si la carpeta fue modificada externamente, usá el botón de refresco manual o configurá un intervalo de refresco automático en Settings.

### Al abrir el chat IA la pantalla se queda en blanco o se dejan de ver los mensajes
- Si la app se volvía blanca, ese problema fue corregido. Si persistiera, reiniciá la app y verificá que no haya quedado cacheado el bundle anterior (`npm run dev:tauri` o volvé a instalar la app en Android).
- Si los mensajes del asistente aparecen cortados, asegurate de usar la última versión del código: el hilo de chat ahora renderiza cada mensaje con su altura real, sin forzar un tamaño fijo que recorte contenido largo.
- Reportá cualquier traza adicional que aparezca en la consola de desarrollo.

### La IA no responde o da error de conexión
- Verificá que **Ollama** esté corriendo localmente (`ollama serve` en terminal).
- Confirmá que la URL en **Settings → IA** coincida con la dirección de Ollama (generalmente `http://localhost:11434`).
- Si estás en Android, asegurate de que el dispositivo tenga acceso de red a la instancia de Ollama (no funciona offline a menos que Ollama corra en el mismo dispositivo).

### Windows muestra `The service was stopped` durante el build de desarrollo
- Instalá las dependencias desde el lockfile con `npm ci` y comprobá la versión efectiva: `node -e "require('esbuild').version"` debe devolver `0.27.7`.
- Ejecutá `npm run build -- --minify=false` para validar el build multipágina de desarrollo. `npm run dev:tauri:windows` ya lo ejecuta sin minificación y reintenta una vez si el proceso nativo de esbuild termina con error.
- Si el segundo intento también falla, cerrá instancias duplicadas de Node/Vite y revisá el antivirus. El fallo observado correspondía a `STATUS_ACCESS_VIOLATION` de esbuild `0.27.3`, no a la minificación de la aplicación.

### «Notia ya está en uso» al abrir la app o el servidor
- La app y el servidor sin ventana (`notia --headless`) comparten la misma carpeta de datos, y solo uno puede usarla a la vez. Cerrá el otro proceso (o la otra ventana de Notia) y volvé a abrir.

### El navegador avisa que la conexión con el servidor Notia no es segura
- El servidor usa un certificado propio (autofirmado). Confirmá la excepción una vez para esa dirección. Si cambiaste de red y la IP es otra, puede pedirlo de nuevo.

### El dictado no funciona desde el navegador
- El navegador solo permite el micrófono en páginas HTTPS: entrá con la dirección `https://…` que muestra el servidor y aceptá el permiso de micrófono.
- La transcripción la hace el servidor: necesita el reconocimiento de voz activado en **Configuraciones → Voz** y un servidor Windows. En Linux no está disponible.

### El tema no se guarda entre sesiones
- Verificá que tu navegador o WebView no esté en modo privado/incógnito (bloquea localStorage).
- Si estás en Android, asegurate de que la app tenga permisos de almacenamiento local.

### Wayland no funciona en Linux o la ventana se ve mal
- Probá forzar el backend X11: `NOTIA_TAURI_BACKEND=x11 npm run dev:tauri:x11`.
- O usá el modo fallback a X11: `NOTIA_TAURI_BACKEND=wayland NOTIA_TAURI_FALLBACK_X11=1 npm run dev:tauri:wayland:fallback`.

### ColdPass no sincroniza por Bluetooth
- Asegurate de que el Bluetooth esté activado en ambos dispositivos.
- En Linux, verificá que el servicio BlueZ esté corriendo y que tu adaptador soporte BLE.
- Confirmá que ingresaste el PIN correcto durante el emparejamiento.
- Mantené los dispositivos a menos de 1 metro de distancia durante la sincronización.

### La aplicación se siente lenta con bibliotecas muy grandes
- El Explorador usa virtualización (`useVirtualList`) para renderizar solo los nodos visibles; árboles de miles de archivos deberían mantenerse fluidos.
- Los diagramas Mermaid embebidos renderizan de forma **lazy** (solo cuando entran al viewport) y cancelan renders previos al cambiar de archivo.
- Notia aplica memoización selectiva (`React.memo`, `useMemo`, `useCallback`) y selectores de acciones (`useNotiaAction`) para reducir re-renders del panel izquierdo, el workspace y el panel derecho.
- En Android, Notia aplaza la carga de vistas pesadas (Graph, Chat, Task Manager) un par de frames para mantener la UI responsiva.
- En Android, Notia ajusta automáticamente la caché de renders Mermaid a 10 entradas / 2 MB para reducir consumo de memoria, mientras que en desktop conserva 20 / 5 MB.
- Al cambiar de biblioteca o cerrar todos los documentos, Notia invalida la caché de renders Mermaid para liberar SVGs de la librería anterior.
- Los componentes pesados (`MarkdownView`, `MermaidView`, `GraphView`) limpian sus recursos al desmontar: destruyen editores, remueven canvas, cancelan timeouts y limpian listeners globales.
- Las vistas pesadas usan selectores Redux memoizados (`selectTheme`, `selectMermaidViewerState`, `selectActiveLibraryPath`) en lugar de funciones inline, reduciendo re-renders en cadena.
- Las vistas más pesadas (`MarkdownView`, `MermaidView`, `ChatWorkspaceView`, `GraphView` y `TaskManagerApp`) se cargan bajo demanda mediante `React.lazy`, con `Suspense` y fallback mínimo, así el bundle inicial no incluye el editor Milkdown/Crepe, Monaco, Mermaid, react-force-graph-2d, Cytoscape ni MUI.
- En escritorio, Notia precarga esas vistas de forma inteligente durante los momentos de inactividad (`requestIdleCallback`) para que la primera apertura de archivo sea instantánea; en Android la precarga se omite por defecto para ahorrar memoria y datos.
- `vite.config.ts` agrupa dependencias grandes en chunks separados (`vendor-milkdown`, `vendor-mermaid`, `vendor-iconify-packs`, `vendor-mui`, `vendor-cytoscape`, `vendor-lucide`, etc.), manteniendo el bundle inicial en ~460 KB gzip.
- Los icon packs de Mermaid (`@iconify-json/*`) y las librerías de exportación PDF (`jspdf`, `html2canvas`) se cargan dinámicamente solo cuando se abre el menú de iconos o se exporta un PDF, respectivamente.
- El backend Rust se compila con perfil de release optimizado (`lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"`) para reducir tamaño de binario y mejorar rendimiento en Android.
- La lectura del árbol, la búsqueda y la lectura masiva de Markdown corren en el backend en un pool de hilos (`spawn_blocking`), sin bloquear la interfaz. Lo mismo vale en el servidor sin ventana.
- En Android, Notia cachea resoluciones SAF en una LRU Rust-side de 500 entradas y throttlea refrescos de cache a 200 ms, reduciendo llamadas JNI.
- Los eventos de cambio en el árbol de archivos (`notia-library-tree-changed`) se agrupan (batch) 160 ms para evitar refrescos en cascada durante guardados o pegados múltiples.
- Considerá dividir tu conocimiento en múltiples librerías más pequeñas si un solo árbol supera varios miles de archivos.

---

## 📝 Licencia

Copyright © 2026 Gabriel. Todos los derechos reservados.

---

**Notia** — Tu espacio de conocimiento, organizado.

## Cambios del motor de la aplicación

Notia ejecuta ahora toda la lógica de la aplicación en su motor nativo; la interfaz solo muestra resultados y envía tus acciones. En el uso diario esto cambia lo siguiente:

- **Telegram** funciona aunque la ventana de Notia esté cerrada, y también en Android. Si le enviás al bot un PDF escaneado (sin texto), te pide fotos de las páginas.
- **Notas editadas por el agente**: si el agente modifica una nota que tenés abierta, Notia la recarga. Si además tenías cambios sin guardar, al guardar te avisa del conflicto en lugar de pisar la versión del agente.
- **Confirmaciones**: ya no existe la opción de aplicar automáticamente los cambios de bajo riesgo; todo cambio del agente pide confirmación. En los planes del agente se quitó **Reintentar paso fallido**; **Continuar TO-DO** y **Cancelar** siguen disponibles.
- **Preferencias por dispositivo**: el prompt elegido del agente, las opciones de voz y la publicación de Task Manager se guardan en cada dispositivo, no en la biblioteca. Las elecciones anteriores se conservan.
- **Publicación de Task Manager**: en Windows se vuelve a publicar sola al abrir Notia, con tema oscuro.
- **Task Manager**: un ticket se mueve a Completadas o Canceladas solo cuando cambiás su estado; una subtarea finalizada que guardás junto a su tarea padre queda donde está. Los comentarios usan el formato con fecha, hora y autor descrito en **Task Manager**.
- **ColdPass por Bluetooth**: la passkey de la sesión ya no queda en la interfaz. La sincronización sigue disponible solo en Linux.

## Roles, usuarios y acceso

En Telegram, el agente recibe instrucciones específicas para responder sin Markdown escapado y usando únicamente el subconjunto HTML admitido por Telegram.

El agente de Telegram genera directamente la respuesta en el formato del canal. Si Telegram rechaza una entidad mal formada, Notia reintenta el envío como texto plano para no perder la respuesta.

En **Configuraciones → Roles** se administran los roles de la biblioteca activa; cada biblioteca comienza con `Owner`, `Family` y `Guest`. En **Configuraciones → Usuarios** se pueden crear usuarios, asignarles un rol, cambiar su nombre o contraseña y eliminar usuarios que no sean `Owner`. Las acciones de cada usuario se muestran como iconos compactos con tooltip y soporte de teclado. Estos datos viven en el SQLite de cada biblioteca y no se mezclan al cambiarla. Las contraseñas solo se almacenan como hashes PBKDF2 y los usuarios sin contraseña se muestran como **Sin contraseña**.

La vinculación de Telegram se realiza en un chat privado escribiendo `/start`, el nombre de usuario de Notia y la contraseña correspondiente. Una cuenta no vinculada queda bloqueada fuera de ese flujo. El Task Manager publicado usa el mismo usuario y contraseña de la biblioteca; ya no requiere una contraseña adicional del tablero.

## Acceso actualizado a publicación y Telegram

La publicación de Task Manager usa únicamente las cuentas de la biblioteca: no existe una contraseña adicional del tablero, aprobación de dispositivos ni almacenamiento local de credenciales. El login muestra estados accesibles de carga, error, sesión inválida y reintento; las sesiones autenticadas quedan asociadas al `user_id` de SQLite.

El enlace de Telegram se resuelve por chat privado contra SQLite. El flujo limita los intentos, aplica un enfriamiento temporal al alcanzar el límite y mantiene mensajes genéricos para no revelar si un usuario existe.

Configuraciones tiene las secciones a la izquierda, agrupadas en Biblioteca, Acceso, Editor, Integraciones y Datos, con el buscador **Buscar ajuste** para filtrarlas. A la derecha, cada sección muestra su descripción y sus ajustes en tarjetas, con interruptores, deslizadores con su valor y el estado de cada prueba de conexión. En ventanas angostas, las secciones pasan a una tira desplazable arriba del contenido. Configuraciones mide como máximo 1280 × 820 píxeles y se achica en pantallas más chicas. Administrar librerías y el selector de archivos del chat ocupan el 75 % de la ventana (casi toda la pantalla en teléfonos). Los demás modales, como los mensajes de error y las confirmaciones, se ajustan a su contenido.

Los desplegables de Configuraciones tienen el mismo comportamiento de menú que el resto de Notia: se cierran al seleccionar, con Escape o al hacer click fuera, y se pueden recorrer con teclado.

Si escribis al bot desde un chat sin usuario vinculado, Notia te indica que inicies sesion con `/start` para comenzar el enlace y no procesa el mensaje como una consulta.

El primer enlace de Telegram también funciona para usuarios recién creados sin contraseña: después de confirmar la nueva contraseña, Notia guarda el acceso y vincula el chat.
