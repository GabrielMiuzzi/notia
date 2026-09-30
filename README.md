# Notia

Si el agente anuncia una acción —por ejemplo, «Ahora insertaré este gráfico»— y no llama a una herramienta, Notia le pide continuar dentro de la misma operación. Conserva las confirmaciones de escritura. Tras dos intentos de corrección sin ejecución, muestra un error; una promesa no confirma que el archivo haya cambiado. Esta recuperación reconoce anuncios explícitos de acción y no garantiza que cualquier modelo complete todos los pedidos.

El agente no muestra reglas internas, prompts, correcciones de validación ni nombres internos de herramientas. Si una respuesta del modelo intenta exponerlos, Notia la descarta y solicita una respuesta segura antes de enviarla.

Si el modo desarrollo reinicia repetidamente con mensajes `File ... .gradle/... changed. Rebuilding application`, reiniciá una vez `npm run dev:tauri:windows` para que lea `src-tauri/.taurignore`. Ese archivo excluye las cachés y salidas de Gradle y de compilación nativa tanto del proyecto Android como de las dependencias en `vendor/`. Los warnings de funciones Rust sin uso no son la causa.

## XGraph en notas Markdown

Si el código falla, una franja indica que el gráfico puede estar incompleto y conserva visible la parte construida. **Ver detalle del error** permite desplegar el mensaje técnico con toque o teclado. Corregí el código para actualizar el gráfico y retirar el aviso.

El agente de IA conoce XGraph y puede ayudarte a crear o corregir sus bloques. Por ejemplo: «Agregá en esta nota un gráfico XGraph de seno con un control de amplitud». Usa las herramientas y confirmaciones disponibles en el contexto actual. Esta guía llega también a agentes con prompts personalizados o bibliotecas existentes, sin sobrescribir sus instrucciones. El gráfico se visualiza al abrir la nota en Milkdown.

En una nota `.md`, abrí el menú de bloques de Milkdown (con `/` o el botón de agregar bloque) y elegí **XGraph**. Escribí JavaScript de JSXGraph: `board` es un tablero ya inicializado, con ejes y límites de −5 a 5. La vista previa se actualiza al editar, sobre un tablero con los colores del tema. **Ocultar código** deja solo el gráfico y **Mostrar** vuelve a mostrarlo, igual que en las fórmulas; **PNG** guarda el gráfico como imagen junto a la nota. Todos los controles admiten toque.

También podés escribir el bloque directamente:

```xgraph
board.create('point', [1, 2], { name: 'A' });
board.create('functiongraph', [(x) => Math.sin(x)]);
```

Se admite también el lenguaje `jsxgraph`. El código queda guardado en el `.md`; los movimientos interactivos del gráfico y el estado de Ocultar código/Mostrar son temporales. Para cambiar la escala usá `board.setBoundingBox([-10, 10, 10, -10])`. `JXG` y `BOARDID` también están disponibles; no hace falta pegar HTML ni importar scripts. Ver los ejemplos de la [documentación de JSXGraph](https://jsxgraph.org/home/start/gettingstarted/).

Funciona sin conexión. Cada gráfico se ejecuta aislado de Notia y no puede usar sus archivos, APIs ni realizar peticiones de red. Los errores aparecen en el visualizador; corregí el código para reintentar. El límite es de 100.000 caracteres por bloque. Evitá bucles infinitos o construcciones enormes: el aislamiento no impone un presupuesto de CPU. La exportación a PDF/Word conserva estos bloques como código, sin capturar el gráfico interactivo.

En el chat de **Finanzas** y en Telegram, el asistente es quien carga y corrige los datos financieros: la pantalla de Finanzas solo muestra. Podés mandarle la foto de un ticket, un recibo de sueldo, una factura o el resumen de la tarjeta, o contarle un gasto, y lo guarda con herramientas tipadas: cuentas, categorías, movimientos, ahorro, tickets, sueldos, resúmenes, planes de cuotas y servicios. También puede corregir o eliminar cualquier registro, unificar o renombrar productos y comercios, vincular o desvincular un gasto con su línea del resumen, limpiar Finanzas o extraer documentos para revisión. Cada cambio muestra un resumen y pide confirmación individual (en Telegram, una sola) y solo se informa como hecho después de verificar lo guardado. Al guardar, Notia une solo lo que es claramente lo mismo —por ejemplo, un ticket pagado con tarjeta y la línea del resumen que lo pagó— y el asistente te lo cuenta en una línea, con la opción de deshacerlo; lo dudoso (dos tickets posibles para una línea, un producto con nombre parecido a otro, una cuota que no aparece) queda en **Para revisar** y el asistente te lo pregunta. Al registrar el pago de un servicio consulta primero los datos locales y no inventa servicios. También puede obtener cotizaciones actuales de dólar oficial, blue y tarjeta desde DolarApi, e IPC mensual e interanual y el historial del dólar oficial desde ArgentinaDatos; las respuestas que usan fuentes externas indican su origen y pueden fallar si no hay conexión.

Las consultas sobre datos locales de Finanzas no usan ni sugieren `search_web`: se resuelven con las herramientas financieras y el snapshot de la biblioteca. Esto incluye pedidos como «mis últimos sueldos» o «sueldos cargados», que consultan `list_finance_salaries` y muestran como máximo los tres recibos más recientes, ordenados por `paymentDate` y luego `period`; los rangos, años y comparaciones usan `from` y/o `to` inclusivos en formato `YYYY-MM`. Las preguntas sobre salarios e IPC conservan la lectura local como evidencia y consultan además los índices de ArgentinaDatos; si faltan períodos, campos o monedas compatibles, no completan ni mezclan datos, y las lecturas limitadas no se presentan como inventarios completos. Los escenarios de factibilidad —por ejemplo, alquilar pagando un importe y ahorrar USD por mes con el sueldo— también conservan los salarios como evidencia intermedia y orientan la consulta a continuar con el dashboard financiero y, si hace falta convertir el objetivo, las cotizaciones del dólar; no afirman viabilidad si faltan gastos, compromisos, saldos o cotizaciones necesarios. En Telegram, el agente universal conserva el mismo enrutamiento cuando tiene habilitadas las herramientas de Finanzas. Las cotizaciones, el IPC y otros datos externos usan sus herramientas de consulta específicas; una consulta explícita de noticias o fuentes públicas puede usar búsqueda web sin confirmación adicional y se informa como tal. Las llamadas de herramienta idénticas dentro de una misma operación no se ejecutan nuevamente, y el límite predeterminado de rondas evita ciclos repetitivos sin cambiar las confirmaciones ni la autorización.

Las mutaciones de la biblioteca y de Finanzas muestran primero el cambio o preview, respetan autorización y confirmación, y solo se informan como exitosas después de verificar el resultado persistido. Las búsquedas públicas no modifican la biblioteca ni requieren confirmación adicional.

## Dictado offline en el chat

El contacto autorizado de Telegram también puede enviar una nota de voz OGG/Opus de hasta 15 minutos y 20 MB. Notia la descarga, la decodifica y carga bajo demanda el modelo offline necesario para transcribirla. La decodificación admite los modos SILK, CELT e híbrido usados por Telegram, incluso en notas de voz rápidas. Primero responde **Solicitud transcripción recibida y en proceso.**, mostrando la transcripción en negrita, y después procesa ese texto como una consulta normal del agente. El audio no se envía al proveedor de IA; Telegram sí interviene necesariamente en su transporte y descarga.

El contacto autorizado también puede enviar una foto de hasta 4 MB, una imagen JPG o PNG como archivo de hasta 10 MB o un PDF. Notia registra de forma durable tanto el update como la solicitud pendiente antes de procesarla, de modo que un reinicio del WebView reanuda la cola sin perder el documento, y la entrega al modelo de IA configurado junto con el contexto financiero local. Antes de responder, el asistente mira el adjunto y decide qué pedido es: un comprobante va a Finanzas, una captura de una agenda o un calendario se puede copiar a Google Calendar y unos apuntes se pueden guardar como nota. Si es un comprobante, lo clasifica como ticket de compra, recibo de sueldo, resumen de tarjeta de crédito u otro documento. Para tickets extrae comercio, fecha, productos, cantidades, precios y total, busca o crea la categoría y registra el gasto. Para recibos extrae período, fecha de cobro, empleador, bruto, descuentos, neto y conceptos, y registra tanto el recibo como el ingreso neto. Si la fuente es un PDF y el recibo indica que está firmado, conserva el neto impreso como valor autoritativo aunque difiera de bruto menos descuentos por adelantos, ajustes u otros conceptos de liquidación. Para resúmenes extrae emisor, tarjeta, período, vencimiento, saldos y líneas; registra consumos y cargos contra la cuenta de tarjeta en el mes del vencimiento, une los tickets y gastos con tarjeta que ya estaban cargados, concilia pagos y créditos y nunca cuenta el total a pagar como otro gasto. Las conciliaciones del resumen se consultan en los datos financieros locales. Solo pregunta si no puede identificar con suficiente claridad la cuenta correspondiente. Telegram informa los cambios de etapa y termina con un resultado verificable: documento registrado, duplicado o error concreto. Podés enviar varias fotos separadas, que entran como solicitudes distintas en una cola durable de hasta diez, o un álbum de hasta diez fotos o archivos, que llega como un solo pedido: el asistente procesa cada comprobante, cada uno con su confirmación, hasta terminar. Esta función requiere un modelo configurado que admita imágenes y herramientas.

Cargar el resumen de la tarjeta significa que ya lo pagaste: cada consumo, cargo, interés e impuesto cuenta como gasto del mes en que vence el resumen, y el total es lo **pagado de tarjetas** de ese mes, nunca otro gasto; no hace falta registrar el pago aparte. Un ticket o un gasto pagado con tarjeta queda **en tarjeta, a pagar** hasta que llega su resumen, y no se cuenta dos veces: si el resumen ya estaba cargado, el ticket se une a su línea. Las líneas en cuotas arman solas el plan de cuotas de la compra, para ver lo que queda por pagar. Al guardar un resumen, las líneas `purchase` confirmadas también se comparan de forma determinista con el nombre o proveedor normalizado de los servicios. El matching acepta el servicio dentro de un descriptor con identificadores cuando aparece como palabra completa —por ejemplo, `MOVISTAR ARGENTINA 82997`—, pero no acepta coincidencias parciales como `Supermovistar`. Una línea se asigna al `statement.period`; si hay exactamente dos consumos del mismo servicio, se ordenan por fecha y se distribuyen entre el período anterior y el período del resumen. Si un consumo nombra más de un servicio, el asistente te pregunta de cuál es; los demás casos dudosos se corrigen pidiéndoselo en el chat.

Las asociaciones de una ocurrencia con un gasto comparan los importes por centavos, por lo que formatos equivalentes como `100` y `100.00` no se consideran cambios ni duplican el historial. Al vincularla, también se actualiza la compra asociada cuando existe. Un vínculo con moneda, tipo de transacción, importe o destino incompatible se rechaza.

Notia reconoce la voz localmente con Parakeet TDT 0.6B v3, el único modelo de reconocimiento. Corre en CPU mediante sherpa-onnx, detecta el idioma automáticamente (español incluido) y transcribe mucho más rápido que el tiempo real. En **Configuraciones → Voz** podés activarlo o desactivarlo y elegir el idioma, que sólo ajusta la puntuación del español; para que las frases cortas no se interpreten en otro idioma, cada frase se reconoce junto con los últimos segundos de lo que venías diciendo. Qwen3-ASR ya no está disponible: si lo tenías elegido, Notia pasa a usar Parakeet y conserva si el reconocimiento estaba activo y su idioma.

Si el reconocimiento de voz está activo, Notia carga el modelo elegido en segundo plano apenas se inicia y lo mantiene en memoria mientras la aplicación está abierta, para que el dictado y Meeting empiecen a transcribir sin esperas. La ventana no espera esa carga: si abrís Meeting antes de que termine, verás «Preparando voz al iniciar Notia…» hasta que el modelo esté listo. Parakeet queda listo en pocos segundos. Qwen3-TTS se carga cuando se solicita una síntesis. Al cambiar el idioma, Notia prepara el reconocedor nuevo y descarta de forma segura el anterior.

El compositor incluye un botón de micrófono para dictar sin enviar audio ni texto a servicios externos. Cada respuesta del asistente muestra debajo del avatar una acción para leer ese mensaje con Qwen3-TTS usando la voz, el idioma y la velocidad configurados; una segunda pulsación detiene la reproducción. En Windows y Android arm64, Notia muestra texto parcial en tiempo real y, al detener, diariza el audio completo y vuelve a transcribir cada turno detectado para asignar el texto mediante sus límites temporales, separando intervenciones como `Hablante 1` y `Hablante 2` sin repartir palabras proporcionalmente. El resultado queda editable y nunca se envía automáticamente.

El acceso **Meeting**, ubicado debajo de ColdPass en el panel izquierdo, abre un espacio dedicado para grabar y transcribir reuniones, o transcribir una grabación que ya tengas, en cuatro pasos:

- **Lista para grabar:** el botón grande inicia la grabación (con teclado, `Ctrl + Shift + R`). Cada fuente tiene su interruptor: el micrófono y, en Windows, el audio de la computadora. **Probar audio** abre las fuentes solo para mostrar sus medidores, durante hasta dos minutos. También elegís el idioma, cuántos hablantes hay (o dejás que Notia lo detecte) y la carpeta de la biblioteca donde se guarda la nota; por defecto es `Meetings`.
- **Subir audio o video:** en la segunda pestaña podés elegir un archivo o soltarlo en la pantalla: audio (MP3, WAV, M4A, OGG, FLAC) o video (MP4, MOV, MKV, WEBM, del que se usa solo el audio), de hasta 2 GB. Notia muestra su duración, su tamaño y su onda. Con **Transcribir archivo** lo transcribe en tu equipo, igual que una grabación, con una barra de avance. Podés ver lo que ya transcribió o cancelar. Al terminar separa a los hablantes y la reunión queda como cualquier otra, titulada con el nombre del archivo.
- **Grabando:** muestra el tiempo, una onda por fuente y la transcripción en vivo con el minuto de cada frase. **Seguir en vivo** mantiene visible lo último. Podés marcar un momento, pausar, reanudar, finalizar o cancelar. **Respuestas en vivo** viene apagado: al activarlo, cuando alguien hace una pregunta, la IA sugiere una respuesta breve que podés copiar, pedir más corta o fijar a la nota; las anteriores quedan debajo. Las **Notas rápidas** se guardan junto a la transcripción.
- **Separando hablantes:** al finalizar, una barra muestra el avance y la etapa. Podés ver el texto sin separar o cancelar la separación y quedarte con la transcripción por minuto.
- **Finalizada:** cada hablante muestra su porcentaje y su tiempo de habla. Podés renombrarlo o unir dos hablantes que Notia separó de más. La transcripción por turnos se puede buscar y filtrar por hablante. **Pasar por IA** genera lo que elijas: resumen, puntos clave, tareas (que podés enviar a un tablero del Task Manager) y corrección de errores de dictado. **Preguntale a la reunión** propone las preguntas que se hicieron en la reunión, cada una con su minuto, y responde indicando el minuto en que se dijo algo. **Guardar como nota** crea una nota en la carpeta elegida con el resumen, los puntos clave, las tareas, tus notas, los momentos marcados, las respuestas fijadas y la transcripción. Si la guardás de nuevo, se actualiza la misma nota, salvo que la hayas editado. **Exportar** guarda la nota y crea junto a ella un PDF o un Word. **Nueva grabación** descarta la reunión y vuelve al inicio.

Las respuestas en vivo, **Pasar por IA** y las preguntas envían la transcripción al proveedor de IA configurado. La reunión queda en memoria hasta que la guardás, empezás otra o cerrás Notia. Si pasás a otro módulo (por ejemplo, Rutinas) mientras grabás, la grabación y la transcripción siguen; al volver a Meeting ves la reunión como la dejaste, con su tiempo y lo que se transcribió mientras tanto. Lo mismo pasa mientras separa hablantes. El chat lateral usa la transcripción actual como contexto y el mismo runtime agente, prompt, native tool calling y opciones que el resto de los chats; es efímero, no carga ni persiste memoria global y funciona en modo solo lectura para la biblioteca. Si querés modificar una nota desde ese contexto, abrí un chat persistente. En Windows mezcla el micrófono predeterminado con la salida de audio predeterminada mediante captura WASAPI nativa; no requiere dispositivos virtuales ni cambiar la entrada del sistema.

El acceso **Finanzas**, ubicado debajo de **Transcribir meeting** en el panel izquierdo, abre el módulo local de finanzas personales: un seguimiento informal de los gastos del mes, lo pagado de tarjetas, lo que está en tarjeta a pagar, lo ahorrado, los servicios y los productos con su precio y comercio. La pantalla solo muestra; para cargar o corregir algo, tocá **Cargar con el asistente** o escribile en el chat o por Telegram. Las cuentas solo identifican de dónde salió el dinero y no llevan saldo; las reservas de ahorro sí conservan un saldo a partir de su importe inicial y sus movimientos. Comprar o vender dólares del ahorro es un cambio de moneda: no suma a los gastos ni a los ingresos del mes. Cada biblioteca comienza con diez categorías de gasto y los cargos, intereses e impuestos de las tarjetas van a «Cargos de tarjeta». Los importes usan centavos exactos y ARS/USD se muestran siempre por separado.

La pantalla tiene cuatro pestañas y las flechas junto al título cambian el mes:

- **Resumen**: **Para revisar** (las dudas del asistente; cada botón pone tu respuesta en el chat y nada cambia hasta que la envíes y confirmes), **¿A dónde fue el sueldo?** (el sueldo del mes anterior repartido en tarjetas pagadas, ahorro, servicios pagados fuera de la tarjeta y lo sin registrar), gastos del mes, ahorrado este mes, **En qué se gastó** por categoría con los gastos más grandes, **Tarjetas pagadas** (avisa si las líneas cargadas de un resumen no suman su total), los servicios del mes con su historial y los últimos movimientos. Arriba a la derecha se ven las cotizaciones del dólar.
- **Movimientos**: los movimientos del mes agrupados por tarjeta o cuenta, con búsqueda y filtros (sin categoría, cada categoría, en tarjeta a pagar, ahorro, descartados). Al tocar uno se ve su detalle —fecha de compra, mes en que cuenta, categoría, servicio, de dónde se cargó y estado— y **Pedir un cambio en el chat** lo cita en el chat.
- **Sueldo y ahorro**: el sueldo neto de los últimos meses en pesos o dólares, su promedio, la comparación con la inflación, qué parte del sueldo se va en tarjetas, servicios y ahorro mes a mes, las cotizaciones oficial, blue y tarjeta con tu última compra de dólares, y cada reserva de ahorro con sus movimientos del mes.
- **Productos y tickets**: los productos con el precio más barato y el historial por comercio, y los tickets con su forma de pago y si ya se pagaron en un resumen. Sin productos, explica cómo mandar el primer ticket.

En el teléfono la pantalla se ordena en una columna, las dudas se recorren deslizando y el detalle de un movimiento se abre desde abajo. La pestaña **Dev** (en el teléfono, **Herramientas de desarrollo** al final) permite inspeccionar las tablas.

Los servicios, sus pagos y sus facturas los carga el asistente; los servicios no generan obligaciones futuras automáticamente. En **Resumen**, **Servicios del mes** muestra cada servicio activo como pagado, pendiente o que no corresponde, y **Ver historial de servicios** muestra su estado en los últimos seis meses.

Finanzas se actualiza sola cuando el asistente guarda un cambio, desde el chat de la aplicación o desde Telegram, sin requerir que cierres y vuelvas a abrir la vista. Si falla una consulta, se muestra un error para reintentar.

Las facturas o boletas de servicios pueden llegar como texto, voz, imagen o PDF desde el agente. Se registran asociadas al servicio, período, importe, moneda y, cuando corresponde, al gasto y comprobante original; registrar una factura no crea otro gasto genérico. Si elegís extraer visualmente un documento `service_invoice` con LlamaCloud, usá la acción explícita de extracción y configurá `LLAMA_CLOUD_API_KEY` en el entorno nativo.

Desde **Configuraciones → Finanzas** podés eliminar todos los datos financieros de la biblioteca activa. Tocá **Eliminar datos…** y escribí el nombre de la biblioteca para confirmar; recién entonces Notia borra cuentas, categorías personalizadas, movimientos, tickets, productos y precios, sueldos, ahorro, cuotas, servicios, ocurrencias, facturas y casos para revisar; al terminar vuelve a crear las diez categorías de gasto iniciales. La acción no elimina la biblioteca ni otros datos de Notia y no se puede deshacer.

Los tickets, recibos y resúmenes de tarjeta mantienen el documento original y sus campos normalizados. La extracción visual opcional usa LlamaCloud desde el backend nativo: configurá `LLAMA_CLOUD_API_KEY` en el entorno donde se inicia Notia. El secreto nunca se envía al WebView, pero el documento sí se transmite a LlamaCloud cuando pulsás **Extraer con LlamaCloud**. Sin esa acción, la carga y corrección permanecen locales.

1. Ejecute `bash scripts/install-speech.sh parakeet` para instalar Parakeet y Silero VAD; el build falla si faltan. La diarización conserva sus modelos ONNX independientes y el runtime documentado en `src-tauri/resources/speech/runtime/README.md`.
2. Abra un chat y pulse **Dictar mensaje sin conexión**.
3. En Android, conceda el permiso de micrófono cuando lo solicite el sistema.
4. Use los controles visibles para pausar, reanudar, finalizar o cancelar. Cancelar restaura el borrador anterior.

En Meeting, Notia mantiene la captura y la transcripción en vivo durante toda la reunión. El audio se conserva temporalmente con memoria acotada y la diarización se ejecuta recién al finalizar, por lo que una reunión de varias horas no se corta cada 15 minutos. El audio temporal se elimina al terminar o cancelar la sesión.

El texto en vivo se actualiza aproximadamente cada medio segundo mientras hablás y cada frase se confirma cuando hay una pausa de medio segundo, o a los 20 segundos de habla continua. Si el equipo está muy exigido, Notia deja de actualizar el texto en curso hasta ponerse al día, para no perder audio; las frases confirmadas siguen apareciendo. Con el idioma en español, una frase con palabras en inglés se transcribe en español: si el modelo la devuelve entera en inglés, Notia la vuelve a transcribir por partes. Lo que se dice realmente en inglés se conserva en inglés. En Meeting, el archivo temporal admite hasta 12 horas; al llegar al límite, la grabación termina sola y se procesa como si la hubieras detenido. La diarización final se procesa en ventanas de unos 15 minutos, cortadas en una pausa para no partir palabras, para mantener acotada la memoria. Al separar hablantes, Notia reutiliza el texto transcripto en vivo y solo vuelve a transcribir las frases en las que cambia quien habla, así que la espera al detener es mucho más corta. Las etiquetas de hablante se calculan únicamente al finalizar, con la cantidad elegida (cada ventana de 15 minutos se separa en esa cantidad) o, por defecto, automática, clustering conservador y matching global de embeddings entre ventanas; voces solapadas, ruido y fragmentos breves pueden reducir la precisión. Cuando dos personas hablan a la vez, lo dicho en ese tramo queda en el turno de quien empezó primero, sin repetirse en el otro. Si no hay evidencia suficiente para hacer matching, se conserva una etiqueta separada para no fusionar hablantes incorrectamente. Si falla únicamente la diarización, se conserva el texto sin etiquetas. Si Android denegó el permiso permanentemente, habilítelo desde Ajustes. En Windows, compruebe el dispositivo predeterminado y los permisos de privacidad.

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
- **Contextos**: **Configuraciones → Contextos** lista cada tag con su color y permite crear nuevos desde la fila superior, renombrarlos, cambiar su color o eliminarlos, salvo el último o uno que use un tablero (`#Laboral`, `#Personal`, `#Academico` y `#Confidencial` rojo por defecto). Las notas nuevas empiezan con `contexto: "#Personal"`; Graph View colorea los tickets según el contexto aplicado a su tablero y muestra un chip por cada contexto con notas.
- **Clima**: en **Configuraciones → Clima** elegís el lugar del pronóstico de la biblioteca: buscá la ciudad (con provincia o país si hay varias con el mismo nombre) y tocá el resultado. Hasta que elijas uno se usa Buenos Aires. El Inicio se actualiza al momento y el asistente lo usa cuando le preguntás por el clima sin nombrar otro lugar.
- **Cuentas asociadas**: en **Configuraciones → Cuentas asociadas** conectás una o varias cuentas de Gmail a la biblioteca activa (hasta 10) y marcás cada una como laboral, personal o estudiantil. Primero cargá las credenciales de tu propio proyecto de Google Cloud (la pantalla explica los pasos): pegá el **Client ID** y el **Client secret** de un cliente OAuth de tipo App de escritorio o tocá **Importar JSON** para leer el archivo que descarga Google; **Probar conexión** verifica que Google los reconozca y **Guardar** los deja en la biblioteca. Después, **Conectar** abre el navegador para iniciar sesión en Google y autorizar a Notia a leer, enviar, eliminar y mover tus correos; tu contraseña nunca pasa por Notia. La cuenta conectada muestra su **Tipo de cuenta** (Laboral, Personal o Estudiantil), **Reconectar** (por ejemplo, cuando el permiso venció) y **Desconectar**. Las credenciales y los tokens se guardan en `.notia/notiaConfig.json` de la biblioteca, cifrados con la contraseña del Owner, así que viajan con ella si la copiás o la sincronizás y solo se leen después de iniciar sesión.
- **El asistente sigue trabajando**: en el chat principal y en Telegram el asistente encadena todos los pasos que necesita (buscar, contar, borrar, cargar cada ticket…) sin límite de pasos ni de preguntas y sin quedarse en «voy a ver…»: un plan con muchos cambios pide cada confirmación hasta terminar. Lo que escribe entre un paso y otro, las preguntas que te hace, el plan que te propone y tus respuestas quedan en el chat. Cuando decidís un plan (aprobar o **Sugerir cambios**), el plan y tu respuesta quedan como mensajes y la tarjeta se cierra; si sugerís cambios, el asistente te propone un plan corregido. Si algo falla después de que el asistente empezó a trabajar, tu mensaje y el motivo quedan en el chat (por ejemplo, «No pude terminar: …») para que puedas pedirle que siga; si falla antes de hacer nada, el mensaje vuelve al cuadro para reenviarlo. Si una herramienta falla después de que confirmaste, el asistente recibe el error y lo corrige en lugar de cortar. Mientras trabaja, Telegram muestra en el mensaje de progreso lo que está haciendo.
- **Adjuntos sin texto**: en el chat de la app y en Telegram podés mandar solo una foto, una imagen o un PDF, sin escribir nada. El asistente mira qué es y hace lo que corresponde: carga un ticket o un resumen en Finanzas, copia las reuniones de una captura de calendario o guarda unos apuntes como nota, y si no queda claro, te pregunta.
- **Inicio de sesión**: al abrir Notia aparece la ventana de inicio de sesión de la biblioteca: solo el usuario **Owner** entra a la app. Si el Owner todavía no tiene contraseña, activá **Primer inicio**, escribí su usuario (por defecto «Owner»), tocá **Continuar** y creá la contraseña (al menos 8 caracteres). Desde ahí `.notia/notiaConfig.json` (tokens, API keys, cuentas de Gmail, contextos) queda cifrado con esa contraseña: **si la olvidás, esa configuración no se puede recuperar** y hay que volver a cargar tokens y cuentas. **Recordar sesión** mantiene la biblioteca abierta en este equipo (el bot de Telegram, la sincronización y el agente autónomo arrancan solos al prender el equipo) y **Recordar datos** completa usuario y contraseña; en Windows quedan protegidos con tu cuenta de Windows y en Android en el almacenamiento privado de la app. **Cambiar contraseña** pide la actual y una nueva. Para cerrar la sesión, **Configuraciones → Usuarios → Cerrar sesión**. Mientras la biblioteca está bloqueada no corren el bot, la sincronización ni el agente autónomo.
- **Confirmar todos o proponer otra cosa**: cuando el asistente te pide confirmar un cambio o un plan, en el chat y en Telegram elegís entre **Confirmar**, **Confirmar todos**, **Proponer otra cosa** y **Cancelar**. **Confirmar todos** aprueba ese cambio y todos los que siga pidiendo en ese mismo pedido, sin volver a preguntarte (útil para tareas largas, como ordenar todo el correo); el próximo pedido vuelve a preguntar. **Proponer otra cosa** no aplica el cambio: escribís qué querés en su lugar y el asistente sigue con eso. En Telegram, después de cada respuesta el progreso sigue en un mensaje nuevo al final del chat.
- **Mensajes mientras trabaja**: podés escribir mientras el asistente responde. Si pedís frenar («cancelá», «pará»), corta lo que está haciendo; si pedís otra cosa, queda en cola para después, y si pedís frenar y hacer otra cosa, corta y sigue con lo nuevo. En la app los mensajes en cola se ven sobre el compositor y se pueden quitar; `/cancelar` en Telegram corta siempre.
- **Textos largos en Telegram**: si pegás un texto de más de 4096 caracteres, Telegram lo manda en varios mensajes. Notia espera unos segundos a que lleguen todos y los lee como un solo pedido, sin ponerlos en cola por separado.
- **El asistente elige sus herramientas**: en el chat principal y en Telegram, antes de responder el asistente decide qué áreas necesita tu pedido (notas, tareas, finanzas, rutina o correo y calendario) y trabaja solo con esas, así responde mejor y más rápido. Puede combinar áreas, por ejemplo «mandale por mail a Juan el resumen de gastos». Solo elige entre las áreas que tu usuario tiene permitidas.
- **Correo y calendario con la IA**: con las cuentas de Gmail conectadas, podés pedirle al asistente (chat, chat de una nota, Task Manager o Telegram) que busque y lea tus correos, los mande a la papelera, los mueva de carpeta, los marque como spam o como leídos, envíe o responda correos, y que lea o cree eventos en tu Google Calendar. Antes de cambiar o enviar algo te muestra exactamente qué va a hacer y espera tu confirmación. El asistente sabe de qué cuenta es cada correo o evento y de qué tipo (no es lo mismo un correo de la facultad que del trabajo): las búsquedas recorren todas las cuentas y te dice de cuál es cada resultado, y para enviar o crear un evento usa la cuenta que le digas (por dirección o por tipo, como «desde la laboral») o te pregunta. No sigue instrucciones que vengan dentro de un correo. Es información confidencial: lo usan el Owner y quienes tengan acceso a #Confidencial. Si conectaste la cuenta antes de que existiera el calendario, reconectala para darle ese permiso.
- **El asistente te escribe solo**: con el bot de Telegram activo y tu usuario Owner vinculado, cuando llega un mail nuevo a Recibidos de alguna cuenta de Gmail conectada el asistente lo mira y, si vale la pena, te escribe por Telegram (solo a vos, el Owner): un recordatorio, una pregunta o una propuesta para organizarte. Si no hay nada para decirte, no manda nada. En esas revisiones solo lee: si propone un cambio, respondele «dale» y lo hace en el chat con la confirmación de siempre. Anota lo que ya te dijo para no repetírtelo y respeta tus reglas, por ejemplo «no me mandes mensajes de noche». Si le escribís mientras revisa, tu mensaje va primero. Se apaga con el interruptor **Agente autónomo** de **Configuraciones → Telegram**. La revisión de cada hora de tu agenda, tareas, rutina, correo y finanzas es la acción **Revisión de cada hora** de **Acciones IA**.
- **Usuarios y permisos de contexto**: en **Configuraciones → Usuarios** cada usuario puede tener contextos permitidos, que se activan o desactivan con un toque sobre cada uno. Owner tiene todos los contextos por defecto y esa condición queda protegida.
- **AI Chat local**: conversación con modelos de lenguaje ejecutados localmente vía Ollama, con un motor común para el chat principal, chats desplegables, Meeting, Telegram y la publicación. Cada solicitud usa el `libraryUserId` estable de la biblioteca y autorización por contextos; Meeting y la publicación no persisten memoria global. Telegram usa memoria persistente únicamente cuando el vínculo autorizado corresponde al Owner (`libraryUserId: user-owner`); para cualquier otro usuario conserva la política `ephemeral-no-memory`. Finanzas exige `#Confidencial`. Las respuestas nativas vacías transitorias después de una ronda de tools se reintentan de forma segura.
- **Inicio**: el primer acceso de la barra izquierda (el ícono de la casa) abre un tablero con lo más importante de la biblioteca: la agenda de los próximos 7 días, tus tareas más urgentes con el Pomodoro, el mes de Finanzas con el dólar, los hábitos de hoy, el anotador del día, los chats, notas y reunión para retomar y el clima de tu ciudad. Desde ahí podés preguntarle al asistente, crear una nota o empezar a grabar una reunión.
- **Agenda**: calendario mensual, semana en bloques de 15 minutos para agendar tareas con prioridad, anotador rápido del día y próximos eventos, guardados en la biblioteca para cada usuario.
- **Agentes en el Chat IA**: cada chat puede sumar hasta seis agentes de `.agent/promps/` y una dinámica de `.agent/dynamics/`; los agentes responden en rondas y entre ellos, con los permisos, la memoria y el contexto permanente del chat. Reemplaza a Multichat.
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

Desde Telegram, el agente tiene acceso transversal a la biblioteca activa: puede buscar reuniones y notas, consultar y modificar (con confirmación) tickets y grupos de cualquier tablero de Task Manager y usar las herramientas de Finanzas en la misma conversación. El módulo seleccionado en la interfaz no limita esas consultas; cada lectura y escritura sigue la autorización del usuario y sus contextos, y Finanzas requiere `#Confidencial`. Los pedidos de sueldos ya cargados se resuelven con los datos locales, sin búsqueda web, y las llamadas de herramienta idénticas no se repiten dentro de la misma operación.

Las respuestas del agente en Telegram no usan Markdown. El modelo utiliza texto plano y, cuando hace falta, un subconjunto básico de HTML compatible con Telegram (por ejemplo, negrita, cursiva o código); el resto de los chats conserva su formato habitual.

Mientras una solicitud de Telegram avanza, Notia mantiene un único mensaje de estado editable que comienza como **Solicitud recibida y en proceso**. Cuando llega la primera señal del thinking, ese mismo mensaje cambia a etapas claras como preparación, lectura, organización de pasos, ejecución y verificación. Si la solicitud es compuesta fuera de Finanzas, muestra el TO-DO con el estado de cada paso; cuando Finanzas está habilitada, Telegram no expone herramientas de planes de ejecución y limita cada turno a una mutación financiera confirmada. Las aclaraciones y confirmaciones aparecen en mensajes separados con sus botones. El estado muestra resúmenes breves del avance, nunca el razonamiento interno completo del modelo ni datos privados.

Las preferencias de feedback permiten elegir modo mínimo, estándar, detallado o desactivado, mostrar/ocultar el TO-DO y decidir si Telegram edita un único mensaje de progreso. La búsqueda web pública no requiere confirmación adicional ni modifica la biblioteca. Las consultas de noticias actuales, incluso si mencionan finanzas, se envían al scope con búsqueda pública; el agente no puede finalizar sin ejecutar la búsqueda y, si encuentra fuentes, debe incluir enlaces devueltos por ella. Las búsquedas web sanitizan la consulta y los resultados como contenido no confiable: no envían contexto privado, claves, tokens ni datos personales, y cada operación admite como máximo seis búsquedas únicas normalizadas, contando errores, cancelaciones y respuestas vacías.

Cada biblioteca mantiene además `.agent/memory/` con `rules.md` (las instrucciones que le diste al asistente), `memory.md` (tus datos y preferencias) y `thoughts.md` (los pensamientos del propio asistente: qué notó y qué te avisó, preguntó o propuso, con fecha). Notia crea automáticamente esa carpeta y esos archivos si no existen, y si borrás `thoughts.md` vuelve a aparecer en menos de un minuto. El asistente reordena sus pensamientos cada vez que agrega uno y, cuando `thoughts.md` o `memory.md` se llenan, los reescribe más cortos sin perder lo importante. Además, al terminar cada pedido tuyo (aunque haya sido largo, haya fallado o lo hayas cancelado), Notia repasa lo que pasó y guarda lo nuevo que aprendió de vos en la memoria y lo que quedó hecho o pendiente en sus pensamientos; nunca guarda contraseñas, códigos ni tarjetas. La memoria persistente se carga para el usuario Owner; las reglas operativas se cargan desde la biblioteca según el agente construido. Las superficies efímeras no cargan ni persisten memoria global, excepto Telegram cuando el vínculo autorizado corresponde al Owner; para cualquier otro usuario de la biblioteca Telegram tampoco carga ni persiste memoria.
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

`memory.md` conserva hechos duraderos, como nombre, preferencias, empleo o proyectos actuales del Owner. Esos datos no se consideran reglas de comportamiento. El agente los guarda sin confirmación y los incorpora como contexto en conversaciones persistentes del Owner y en Telegram cuando el usuario autorizado es el Owner; Meeting y la publicación no cargan ni persisten memoria global; el chat de Graph View la lee si el chat tiene memoria, pero no la escribe. Telegram usa `persistencePolicy: 'persistent'` para `user-owner` y `persistencePolicy: 'ephemeral-no-memory'` para cualquier otro usuario de la biblioteca. En el segundo caso tampoco puede exponer ni leer rutas bajo `.agent/memory/` mediante tools.

Cada vez que `memory.md` cambia, Notia pide en segundo plano al modelo configurado que ordene las memorias: une duplicados, resuelve contradicciones quedándose con el dato más reciente y agrupa datos del mismo tema, sin inventar ni perder datos. Esa llamada no tiene herramientas ni recibe la memoria como contexto: solo la lista a ordenar. La conversación no la espera, y si mientras tanto se guardó otra memoria, el resultado se descarta y se ordena de nuevo. Si la respuesta del modelo no es una lista válida, el archivo queda como estaba. `rules.md` no se reorganiza. Si la configuración apunta a Ollama Cloud, la lista de memorias se envía a ese servicio. Cada chat nuevo puede crearse sin memoria desde el panel de contexto de la vista Chat IA; los archivos de chat anteriores que tengan `longTermMemory` en su encabezado se siguen abriendo y esa línea deja de escribirse al guardarlos.

En Telegram, las respuestas finales se transforman al subconjunto HTML permitido por Telegram. Encabezados, listas Markdown o HTML (`ul`/`ol`/`li`), negritas, código y enlaces se normalizan aunque el modelo produzca Markdown; el resto de los chats conserva Markdown. Si un modelo emite accidentalmente una llamada de herramienta XML, Notia intenta recuperarla como tool calling nativo en vez de mostrarla como texto.

En Windows, pulsar la **X** oculta Notia en la bandeja del sistema en vez de finalizarla. Para volver, hacé doble clic izquierdo en el icono de Notia o abrí su menú y elegí **Abrir Notia**. Para terminar completamente la aplicación, elegí **Salir** desde ese mismo menú. Este comportamiento no se aplica en Android, macOS ni Linux.

Para conectar Telegram, creá un bot con BotFather, copiá su token y abrí **Configuraciones → Telegram**. Pegá el token, pulsá **Probar conexión**, activá el interruptor **Bot de Telegram** y enviá `/start` al bot. El interruptor **Agente autónomo** (activo por defecto) deja que el asistente te escriba solo cuando llegan mails nuevos; la revisión de cada hora se maneja desde **Acciones IA**. Notia vincula el chat privado con un usuario de la biblioteca; solo coincidir simultáneamente con el `chat_id` y el identificador de usuario vinculados permite consultar esa biblioteca. Las acciones de creación, reemplazo y eliminación, incluidas las financieras, muestran los botones **Confirmar**, **Confirmar todos**, **Proponer otra cosa** y **Cancelar** antes de ejecutarse; en Finanzas se muestra una sola confirmación por mutación. Revocá el vínculo desde la misma pantalla cuando ya no lo necesites.

El token se guarda en `.notia/notiaConfig.json`, cifrado con la contraseña del Owner. Igual conviene no compartir ese archivo; si el token se expone, revocalo inmediatamente desde BotFather. El bot arranca recién cuando el Owner inicia sesión (o solo, si marcaste **Recordar sesión**). El bot funciona únicamente mientras Notia está ejecutándose y requiere conectividad tanto con Telegram como con el backend de IA configurado.

---

## 📦 Módulos Funcionales

### Inicio

El acceso **Inicio** (el ícono de la casa) es el primero de la barra izquierda, separado de los módulos. Abre un tablero que junta los datos de los otros módulos de la biblioteca abierta; cada tarjeta lleva a su módulo con **Abrir**.

- **Encabezado**: el día, un saludo y un resumen (eventos de la semana, hábitos pendientes y tareas urgentes).
- **Clima**: junto al saludo, un chip con la temperatura, el estado del cielo, la máxima y la mínima de hoy y los próximos tres días. Al tocarlo se abre el pronóstico: sensación térmica, humedad y viento, las próximas horas (ahora y cada tres horas, con probabilidad de lluvia y luna de noche) y los próximos 7 días con su rango de temperaturas; se cierra con la X, con Escape o tocando afuera. Los datos son de Open-Meteo, se renuevan cada 15 minutos y son del lugar que elegís en **Configuraciones → Clima** (Buenos Aires hasta que elijas otro). Sin conexión, el chip dice «Clima no disponible · Reintentar». El cuadro **Preguntale al asistente** manda la pregunta al chat lateral, en un chat nuevo, con el agente del chip (tocá el chip para cambiarlo; es el mismo agente del chat lateral). `Ctrl + K` lleva el cursor al cuadro. **Nueva nota** crea una nota en el explorador y **Grabar** empieza a grabar una reunión con el micrófono y, en Windows, el audio de la computadora (`Ctrl + Shift + R`); la grabación sigue en **Transcribir meeting**. Si hay una reunión terminada sin guardar, el botón lleva a Meeting para que decidas qué hacer con ella.
- **Agenda**: los próximos 7 días con un punto en los que tienen eventos; tocá un día para ver solo sus eventos y otra vez para volver a la semana.
- **Tareas**: cuántas tareas hay en **Sprint actual**, **En revisión** y bloqueadas, las más urgentes (tocá una para abrir su ticket) y el Pomodoro de Task Manager. Si no elegiste tarea para el Pomodoro, **Iniciar** trabaja sobre la más urgente.
- **Finanzas**: los gastos del mes, cuántos no tienen categoría, lo ahorrado, la primera reserva y el dólar oficial, blue y tarjeta. **Revisar en el chat** deja en el compositor del chat lateral lo que queda en «Para revisar»: dudas del asistente, gastos sin categoría o resúmenes que no cuadran.
- **Rutinas**: los hábitos de hoy de cada rutina para marcarlos, la semana, el porcentaje del mes y la mejor racha.
- **Anotador rápido**: el mismo anotador del día de la Agenda: agregá, marcá o borrá pendientes.
- **Seguir donde quedaste**: los últimos chats, las notas que abriste en el editor y la reunión actual; tocá uno para retomarlo. Debajo, las carpetas de la biblioteca: tocá una para verla en el explorador. **Ver historial** abre el Chat IA.
- **Actualización**: el tablero se vuelve a leer al volver a la ventana y cuando el asistente u otra pantalla cambian tareas, finanzas o hábitos. Si un módulo no se puede leer, su tarjeta muestra el motivo y las demás siguen funcionando.

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
- **Wikilinks**: escribí `[[Nombre de Nota]]` para crear enlaces bidireccionales entre documentos. Al hacer clic sobre el wikilink, la nota destino se abre en una nueva pestaña; al hacer clic en el resto de la línea, el cursor se ubica ahí para seguir escribiendo o borrar el enlace. Los enlaces se guardan tal cual, `[[Nombre de Nota]]`, sin barras invertidas. En el editor el enlace se lee solo con su texto («Nombre de Nota», o el alias de `[[nota|alias]]`). Al poner el cursor junto al enlace aparecen los corchetes; si borrás el último, queda `[[Nombre de Nota]` y deja de ser un enlace.
- **Propiedades**: arriba de cada nota, el panel **Propiedades** muestra sus metadatos y se pliega con un toque; plegado, resume el contexto y la fecha. Cada valor se edita según su tipo: el contexto con los de la biblioteca, las fechas legibles, casillas, etiquetas como chips y los enlaces a otras notas con un buscador que también permite **Crear nota**. **Agregar propiedad** pide el nombre y el tipo (Texto, Etiquetas, Número, Fecha, Nota o Casilla).
- **Barra de formato**: al pasar el mouse sobre un párrafo, título, ítem de lista o cita aparece encima una barra que formatea el bloque entero; al seleccionar texto (o un bloque con su handle), la barra formatea la selección. Sirve para cambiar el tipo de bloque (párrafo, títulos, listas o cita) y aplicar negrita, cursiva, subrayado, tachado, código, color de texto, resaltado, alineación y enlaces, o quitar el formato. El subrayado, el color, el resaltado y la alineación se guardan como HTML dentro del Markdown (`<u>`, `<span data-color>`, `<mark>`, `<div align>`), que GitHub y Obsidian también muestran, salvo el color.
- **Mover bloques**: al pasar sobre un bloque se resalta y muestra su handle (el ícono de seis puntos); arrastralo para moverlo. Una línea teal marca dónde va a quedar. Para agregar bloques, usá Enter o escribí `/`. Si debajo de un bloque de código, tabla, fórmula, imagen o bloque GitBook no hay una línea donde escribir, tocá el espacio justo debajo del bloque y se agrega una. Tocar el espacio vacío debajo del final de la nota empieza una línea nueva al final.
- **Bloques de GitBook**: el menú `/` suma avisos (información, éxito, advertencia, error), pestañas, desplegables, pasos, columnas, novedades con fecha y etiquetas, código con título, prompts con «Copiar» y «Ejecutar» (lo envía al chat lateral, en un chat nuevo), contenido condicional, tarjetas, URL embebidas, archivos, enlaces a páginas, contenido reutilizable de otra nota y dibujos hechos a mano, más botones, íconos, variables, imágenes del tamaño del texto y anotaciones (notas al pie que se leen al pasar el puntero o al tocarlas). Los elementos en línea también se insertan desde el «+» de la barra de formato. Todo se guarda con la sintaxis de GitBook, así que las notas siguen siendo compatibles con GitBook Git Sync. Las variables salen de la propiedad `vars:` de la nota y de `.gitbook/vars.yaml` de la biblioteca; las condiciones que dependen del lector publicado se marcan como tales. Al exportar a PDF o Word, los bloques se escriben con formato, el contenido reutilizable se inserta y las condiciones se evalúan.

- **Bloques dentro de tablas Markdown**: una celda puede combinar texto normal con bloques de código (incluidos XGraph y Mermaid), imágenes y otros bloques compatibles con el editor.
- **Indicadores de estado**: visualización de "Guardando...", "Guardado ✓" o "Error ✗" en la pestaña activa.
- **Imágenes de chats persistidos**: al abrir un chat Markdown que conserva adjuntos, Notia muestra sobre el editor hasta 24 previews de imágenes raster válidas; también las muestra en la vista de documento grande. SVG, formatos no admitidos y datos Base64 que no superan la validación permitida no se renderizan.
- **Zoom de lectura**: ampliá o reducí el contenido con `Ctrl + rueda del mouse` en Windows, con el gesto de pinza de dos dedos en Android o con el deslizador junto al estado de guardado. El porcentaje visible y el botón **Restablecer** permiten consultar o volver rápidamente al 100%.
- **Diagramas Mermaid embebidos**: insertá bloques de código con lenguaje `mermaid` dentro de cualquier nota Markdown. El editor renderiza el diagrama con el **mismo motor visual** que los archivos `.mmd` (temas Notia, zoom/pan interactivo, manejo de errores uniforme). Los diagramas embebidos son de **solo lectura**: se pueden explorar (zoom, paneo, exportar a PNG/SVG) pero no se pueden editar nodos ni flechas desde el editor Markdown. Desde la versión 1.0.13, el renderizado embebido es **lazy** (solo renderiza cuando el diagrama entra en el viewport), cancela renders previos al cambiar de archivo y gestiona la memoria mediante una caché LRU con límite de tamaño.
- **InkMath**: el botón **OCR** de cada bloque Math abre un lienzo compatible con mouse, stylus y touch. Al terminar de escribir, espera el intervalo configurado, rasteriza los trazos y solicita a Ollama la fórmula en LaTeX; una entrada nueva invalida cualquier resultado anterior.
- **Aspecto de los elementos**: títulos, citas, listas (puntos teal y tareas con casilla), tablas, líneas horizontales, notas al pie, bloques de código, fórmulas, diagramas y bloques de GitBook siguen el diseño del editor. Los bloques de código tienen **Números** y **Ajustar** (solo cambian cómo se ven) y **Copiar**; las fórmulas LaTeX, **Escribir a mano**, **Copiar** y **Ocultar código**; los diagramas Mermaid, **Código**, **Dividido** o **Vista** y **Exportar SVG**, que guarda el diagrama junto a la nota (`<nota> - diagrama.svg`). Al posar el puntero sobre un enlace a otra nota aparece una tarjeta con su carpeta, título, el comienzo del texto, cuándo se editó y cuántos enlaces tiene; en pantallas táctiles, tocar el enlace sigue abriendo la nota.
- **Hoja de la nota**: sin modo página, la nota es una sola hoja con el mismo fondo que las páginas, del ancho de un A3, centrada y sin fin hacia abajo: llega hasta el borde inferior del editor y crece con la nota. Usa los mismos márgenes que las páginas. En pantallas más angostas que la hoja se achica para entrar.
- **Modo página**: las notas se abren en el editor normal. En el menú «⋯» de la nota, **Modo página** divide esa nota en hojas A3 numeradas, como en un procesador de texto. Queda guardado en la nota como la propiedad `pageMode: true`, así que cada nota vuelve a abrirse como la dejaste; desactivarlo quita la propiedad. La orientación, los márgenes y la numeración valen para todas las notas en modo página y se eligen en **Configuración** (`Ctrl+,` o **Tamaño de página** en el mismo menú). Los títulos pasan a la hoja siguiente junto con lo que introducen. En pantallas angostas, las hojas se achican para entrar. El chip «A3 · Vertical» de la cabecera abre la misma configuración. Las exportaciones a PDF y Word usan el mismo tamaño.
- **Seleccionar varios bloques**: con el **Selector**, arrastrá desde un lugar vacío (los márgenes de la hoja, debajo de la nota o fuera de la hoja) y aparece un rectángulo, como en el escritorio de Windows: los bloques que toca quedan seleccionados y resaltados, listos para copiar, cortar, borrar o dar formato. Arrastrar sobre el texto sigue seleccionando texto y un clic debajo de la nota sigue agregando una línea. Con mouse o lápiz; en pantallas táctiles el dedo desplaza la nota y la selección de texto sigue disponible.
- **Escritura a mano**: arriba de la nota está la barra **Herramientas de lápiz**: **Selector** (para escribir texto), **Lazo**, **Lápiz**, **Resaltador** y **Borrador**, seis colores, la punta (fina, media, gruesa o de 1 a 16 px), **Deshacer trazo** y **Rehacer trazo**. Con el lápiz o el resaltador se escribe sobre toda la nota; en modo página, solo sobre las hojas. Los trazos se ven en los dos modos, sobre el mismo texto: lo escrito en una hoja sigue ahí al salir del modo página, y lo escrito sin modo página aparece en las hojas, corrido con los saltos de página. Con **Lazo** (o con el botón lateral del lápiz en «Selección») rodeá trazos para seleccionarlos: se marca un recuadro con la cantidad y **Borrar**; arrastralos para moverlos, y **Delete** o **Borrar** los quita. Mover y borrar se deshacen con **Deshacer trazo**. **Opciones** guarda en el dispositivo la sensibilidad a la presión, el rechazo de palma, dibujar solo con lápiz (el dedo desplaza la página), el suavizado del trazo y qué hace el botón lateral del lápiz (borrador, selección o nada). Los trazos se guardan en la biblioteca, en `.notia/ink/`, y siguen a la nota si se renombra, se mueve, se copia o se borra; la nota Markdown no cambia.
- **Exportación**: el menú «⋯» exporta la nota como PDF o como Word (`.docx`, importable en Google Docs), con formato y sin las propiedades de la nota: títulos, negrita, cursiva, colores, listas, tareas, citas, tablas, código y enlaces. Las fórmulas LaTeX quedan escritas, no como imagen: en el PDF, compuestas como en el editor; en Word, como ecuaciones editables. Los dos usan el tamaño de página, los márgenes y la numeración de la configuración. Las imágenes aparecen como «[Imagen: …]» y los emojis, como «?». El PDF solo está disponible para una nota en modo página; en las demás la opción aparece deshabilitada con la leyenda «Requiere modo página». El agente tampoco exporta a PDF una nota que no esté en modo página. La exportación de Meeting no depende del modo página. El archivo se crea junto a la nota; en Android, dentro de la librería SAF activa. Si no se puede escribir, se muestra el error.

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

- Cada nota es un **nodo**; cada wikilink es una **conexión**. Los nodos más conectados son más grandes y el color indica la etiqueta.
- Arriba se ven las notas y enlaces, el cambio entre grafo **Global** y **Local** (la nota elegida y sus vecinas) y un chip por etiqueta para ocultarla o mostrarla.
- Tocar un nodo lo selecciona: el panel de la derecha muestra su carpeta, sus enlaces, **Abrir nota**, **Sumar al chat** y sus conexiones. Sin selección, el panel resume la biblioteca: notas, enlaces, huérfanas, notas por etiqueta y las más conectadas.
- Arrastrar un nodo lo deja fijo; un doble toque lo suelta.
- El buscador lista las notas que coinciden, con su carpeta, y las marca en el grafo.
- Abajo: zoom, **Encuadrar**, nombres automáticos o todos, mostrar u ocultar huérfanas y carpetas, y **Fuerzas** para ajustar la separación, la distancia de los enlaces y cuánto se agrupan las carpetas. Estas preferencias se recuerdan.
- Un minimapa muestra todo el grafo y la parte que está en pantalla.
- En pantallas angostas el panel de la nota aparece abajo.
- Los chats laterales de Graph View, Task Manager y archivos comparten el mismo flujo persistente de creación, selección, hidratación y visualización. Cada contexto usa una clave estable y su propio archivo dentro del historial de chats. En Graph View, sin selección consulta la biblioteca mediante RAG local, incluyendo nombres y rutas de carpetas; por ejemplo, preguntar por `chats` recupera los documentos ubicados dentro de esa carpeta. Al seleccionar archivos usa su contenido completo como contexto directo. También puede buscar y leer por título mediante tool calling nativo de Ollama.
- Durante una consulta con herramientas, el panel muestra si está analizando, ejecutando una búsqueda o procesando resultados. Los modelos grandes disponen de un tiempo ampliado para completar las distintas rondas del agente y la operación se puede cancelar desde el compositor.
- Notia mantiene un archivo `linkCache.md` dentro de `.notia/` con el diagrama del grafo, que se regenera automáticamente en segundo plano cuando cambian las notas.

### AI Chat

Chat con inteligencia artificial local via **Ollama**.

La vista **Chat IA** del menú izquierdo se organiza en tres zonas:

- **Historial** (izquierda): botón **Nuevo chat**, que vuelve a la pantalla «¿En qué trabajamos hoy?» (el chat se crea al enviar el primer mensaje), búsqueda por título, la lista de chats de `chat/chats` y la librería activa. Cada chat tiene un botón **⋯** con la opción **Eliminar chat**; en escritorio también funciona el clic derecho. El historial se oculta y se vuelve a mostrar desde su propio botón; en pantallas angostas y teléfonos flota sobre la conversación y se cierra solo al elegir un chat.
- **Conversación** (centro): una barra con el título del chat, el modelo activo (tocándolo abre **Configuraciones → IA**) y el botón del panel de contexto. Tus mensajes aparecen a la derecha; las respuestas de Notia ocupan todo el ancho y se pueden copiar con un botón. El compositor reúne adjuntar, el interruptor **Toda la librería**, dictado y enviar. Con el interruptor encendido, la IA puede buscar en toda la librería (RAG); apagado, solo usa los archivos y carpetas que elijas y no busca otros. El menú **+** ofrece **Seleccionar archivo**, **Buscar archivos de la librería** y **Buscar carpetas de la librería**: una carpeta suma todos sus archivos, subcarpetas incluidas. El interruptor, los archivos y las carpetas quedan guardados en el chat. Mientras llega una respuesta, el botón de enviar pasa a **Detener respuesta**.
- **Contexto** (derecha): el alcance actual con los archivos elegidos (se pueden quitar uno por uno), acciones rápidas que completan el mensaje y el interruptor **Memoria persistente del agente**. Con el interruptor apagado, el próximo chat nuevo no lee `memory.md` ni guarda reglas o memorias (las reglas de `rules.md` se siguen aplicando), y la barra superior muestra **Sin memoria**. La elección queda guardada en el chat: con un chat abierto, el interruptor muestra su valor y no se puede cambiar. **Administrar memoria** permite vaciar `memory.md`. En pantallas medianas y teléfonos flota sobre la conversación.

Al abrir la vista no se abre ningún chat anterior: aparece un chat nuevo con **¿En qué trabajamos hoy?**, el compositor en el centro y tres sugerencias para empezar. El primer mensaje crea el chat; para retomar uno anterior, elegilo en el historial.

El chat principal, los chats desplegables, Meeting, Telegram y la publicación usan el motor común y el contrato global versionado: biblioteca, request, actor estable, canal, snapshot, scope solicitado y política de persistencia. El motor verifica el actor y los contextos antes de ofrecer o ejecutar herramientas; Finanzas requiere `#Confidencial` para lecturas y escrituras, y Graph View guarda sus chats en `chat/chats/` como el resto, con herramientas de solo lectura. Telegram y la URL pública conservan sus adaptadores de transporte, pero no pueden ampliar permisos mediante `scope`, rutas o IDs enviados por el cliente.

- Configurá la URL de tu instancia de Ollama desde **Settings → IA**.
- Funciona con **cualquier modelo de Ollama**, no solo modelos de visión.
- El selector enumera todos los modelos informados por Ollama y marca Thinking, Vision y Tools; para los chats con agente se recomienda elegir uno con **Tools**.
- La búsqueda web opcional usa el endpoint oficial de Ollama Cloud (`https://ollama.com`) y requiere una API Key; una URL local continúa siendo válida para el chat, pero no habilita búsquedas públicas.
- En Task Manager, las consultas temáticas usan RAG; los pedidos exhaustivos como “todos los tickets” activan una lectura completa del corpus y reportan si algún contenido debió truncarse.
- Podés adjuntar archivos y carpetas de la librería como contexto para la conversación. En modo **Directo** la IA recibe el contenido de los archivos (hasta 30.000 caracteres por consulta; los que no entran se nombran como omitidos). En modo **Referencia** recibe nombres y rutas (hasta 50 archivos) y, si la búsqueda en la librería está encendida, puede leerlos. Cada consulta toma hasta 500 archivos entre los elegidos y los de las carpetas.
- En el chat lateral de un archivo abierto, el archivo activo está autorizado como contexto; la IA solicita permiso visible antes de leer cualquier otro archivo.
- Cuando hace falta información actualizada, la IA puede solicitar buscar fuentes públicas mediante Ollama Cloud. La consulta pasa por un filtro que bloquea secretos, datos personales y contenido privado; la API key nunca se incluye en la búsqueda, en la URL, en los mensajes ni en los logs, y la confirmación del usuario no desactiva esa protección.
- La vista principal de chat, los chats desplegables, Meeting, Telegram y la publicación comparten el agente con tool calling nativo, catálogo filtrado por scope, aclaraciones, planes cuando corresponden y confirmaciones individuales. Cuando Telegram tiene Finanzas habilitadas, su catálogo no incluye herramientas de planes de ejecución y cada turno admite como máximo una mutación financiera confirmada. El contexto activo solo limita qué archivos están autorizados inicialmente y qué tablero se considera activo.
- Telegram autoriza inicialmente el corpus legible completo de la biblioteca y no hereda el módulo activo de la interfaz: sus consultas pueden combinar documentos, tickets de Task Manager y datos financieros.
- El compositor admite dictado y adjuntos de audio mediante ASR/STT; Qwen3-TTS permanece disponible para superficies que lo integren, pero los chats no exponen un modo llamada ni leen automáticamente las respuestas. La sección **Configuraciones → Voz** concentra las opciones de transcripción y síntesis disponibles.
- Cuando el agente necesita una aclaración abierta, muestra la pregunta dentro del hilo y pausa la ejecución. La respuesta escrita en el compositor reanuda la misma consulta; también puede cancelarse mientras espera.
- Cada librería puede mantener prompts Markdown alternativos en `.agent/promps/`. La carpeta `.agent` es visible y editable desde el explorador de Notia, aunque las demás carpetas ocultas continúan excluidas. `default.md` se crea o sobrescribe para mostrar exactamente el prompt default embebido, pero no es la fuente de ejecución: la opción **default** siempre usa el prompt del sistema. Los prompts alternativos `.md` se cargan únicamente cuando se seleccionan de forma explícita y nunca se sobrescriben durante esta sincronización. El chat lateral muestra en su encabezado el agente que responde (su nombre es el primer título del archivo y su descripción, el campo `description` o el primer párrafo); al tocarlo se elige otro de la lista, que incluye `default` y cada archivo adicional. Recuerda la elección en este dispositivo y vuelve al prompt del sistema si el alternativo no puede leerse o está vacío.
- El selector **Adjuntar archivo → Seleccionar archivo** permite elegir varios archivos locales a la vez. Notia los conserva juntos en el compositor, muestra un chip por archivo y permite quitar cada uno individualmente antes de enviar la consulta. Cuando hay muchos adjuntos, se muestran dentro de un bloque compacto con desplazamiento propio para mantener visible el campo de mensaje. Al enviar, los adjuntos quedan asociados al mensaje de usuario, se conservan al guardar el historial del chat y se rehidratan al volver a cargarlo; sus nombres aparecen en el hilo y pueden reutilizarse en consultas posteriores dentro del contexto conservado.
- La IA mantiene **memoria persistente** en `.agent/memory/memory.md` para las superficies persistentes: el agente guarda con su herramienta de memoria los hechos, preferencias y datos personales duraderos que mencionás, y los usa para personalizar respuestas futuras. Meeting y las superficies publicadas no cargan ni escriben esa memoria; el chat de Graph View puede leerla, pero no escribirla. Telegram la carga y puede guardarla cuando el vínculo autorizado corresponde al Owner; para cualquier otro usuario usa `persistencePolicy: 'ephemeral-no-memory'`, no carga ni persiste memoria y filtra las rutas bajo `.agent/memory/` de sus documentos y tools.
- Soporte para modelos multimodales: enviá una o varias imágenes (capturas, fotos) para que la IA las analice (requiere modelo con soporte de visión). En el chat lateral de un `.md`, podés adjuntarlas junto con PDF o texto y pedir **"Insertá esto en el documento"**: la IA conserva el orden, transcribe el contenido respetando párrafos, listas y encabezados, convierte las fórmulas en bloques LaTeX `$$...$$`, muestra una vista previa con confirmación y actualiza la nota abierta.
- El botón **Adjuntar archivo** permite seleccionar varios archivos locales —imágenes, PDF y texto— para enviarlos en una misma consulta, además de los archivos de la librería. Los archivos de texto se agregan como bloques de contexto separados; las imágenes y las páginas renderizadas de los PDF se combinan en una colección visual ordenada para Ollama. Notia valida el tipo MIME o la extensión admitida, el tamaño individual y el procesamiento de cada archivo antes de iniciar la consulta: rechaza archivos de texto vacíos o demasiado extensos, archivos individuales de más de 40 MB y PDF que no pueden procesarse. No hay un límite ejecutable de tamaño total del lote ni una cantidad máxima implementada de imágenes, por lo que esas condiciones no provocan por sí solas el rechazo del lote. Al pedir **"Transcribí estos PDF a este archivo .md"**, Notia procesa las páginas en orden, incluidos PDFs escaneados, y puede insertar el resultado en el Markdown activo con texto, listas, tablas y fórmulas en bloques LaTeX `$$...$$`. Los PDF de más de 24 páginas se rechazan antes de enviarse para evitar una transcripción incompleta; se requiere un modelo con soporte de visión cuando el lote incluye imágenes o PDF.
- Generación automática de títulos para las sesiones de chat.
- Streaming progresivo de respuestas en escritorio y Android mediante el bridge nativo. En un navegador conectado a un servidor Notia, las respuestas llegan en vivo desde ese servidor; la página publicada de Task Manager usa su propio canal.
- Cancelación de respuestas en curso.
- Soporte en escritorio, Android y navegador (contra un servidor Notia) a través del mismo backend de Notia; la prueba en dispositivo Android sigue siendo un requisito de plataforma.

### Agentes, dinámica y permisos del Chat IA

El panel **Contexto** del Chat IA (botón de panel en la barra superior) tiene, además del alcance, las acciones rápidas y la memoria:

- **Permisos**: **Uso de herramientas** deja que la IA busque en la librería y ejecute acciones; apagado, responde solo con lo que ya tiene el chat. **Permisos de lectura/escritura** decide si puede crear y editar notas y tareas o si queda en **Solo lectura**. La memoria (`memory.md` y `rules.md`) depende de su propio interruptor, que se elige al crear el chat.
- **Contexto permanente**: instrucciones que la IA tiene en cuenta en cada mensaje del chat, por ejemplo «Respondé corto y citá la nota de origen». Se guarda solo, un momento después de que dejás de escribir.
- **Dinámica**: una guía de cómo conversan los agentes (debate, mesa redonda, análisis…). Son los archivos Markdown de `.agent/dynamics/`. Con **Ninguna**, los agentes conversan igual, sin guía.
- **Agentes**: **Agregar agente** abre la lista de los prompts de `.agent/promps/` con búsqueda; se pueden sumar hasta seis y quitarlos con la cruz. Sin agentes responde Notia.

Con agentes, al enviar un mensaje responden ellos en lugar de Notia: en cada ronda habla uno o varios, en un orden al azar, y se responden entre sí durante hasta cuatro rondas sin que tengas que intervenir, salvo que la dinámica pida esperar tu mensaje o nombre a quién le toca. Cada respuesta muestra el nombre y las iniciales del agente, y mientras uno escribe ves su respuesta en vivo. Los agentes usan los mismos permisos, memoria y contexto del chat. El botón de detener corta al agente que está hablando; lo que dijeron los anteriores queda guardado. Todo el chat, con los mensajes de cada agente, se guarda en `chat/chats/` como los demás.

Estos ajustes se guardan con cada chat y podés cambiarlos en cualquier momento, salvo mientras la IA está respondiendo. Para un chat nuevo, lo que elijas antes del primer mensaje se aplica al crearlo.

### Agenda

El acceso **Agenda** aparece debajo de **Calendario** en la barra izquierda y abre tu agenda personal.

- **Calendario del mes**: tocá un día para ver su semana; **Hoy** vuelve al día actual y las flechas cambian de mes. Los días con tareas agendadas tienen un punto.
- **Feriados de Argentina**: los días feriados se pintan con el color de su tipo y muestran su nombre (inamovible en coral, trasladable en oro, puente turístico en violeta y no laborable en gris con borde punteado); los días que solo cierran los bancos aparecen como «Feriado bancario». La leyenda debajo del calendario explica cada color. La tarjeta **Feriados** cuenta los días hasta el próximo feriado (sin contar los no laborables) y muestra el siguiente; al tocarla, la agenda salta a ese día. Los feriados se consultan a argentinadatos.com una sola vez por año (nacionales y bancarios) mientras la app está abierta; al llegar a otro año en el calendario se consulta ese año. Sin conexión, la tarjeta lo avisa y se vuelve a intentar a los dos minutos.
- **Semana**: una grilla de lunes a domingo dividida en bloques de 15 minutos, que arranca en las 8:00. Con mouse, hacé clic o arrastrá sobre los bloques; en pantallas táctiles, tocá cada bloque o mantené presionado y deslizá; con teclado, movete con las flechas y seleccioná con Enter o Espacio. Después escribí el nombre, elegí la prioridad (Urgente, Alta, Media o Baja) y tocá **Agendar**. Si elegís bloques separados o de varios días, se crea una tarea por cada tramo seguido.
- **Tareas agendadas**: tocá una para ver su prioridad y horario, y eliminarla con **Eliminar tarea**. Las tareas pueden superponerse: las que comparten horario se muestran lado a lado, y al tocar una la barra avisa «Se superpone con …». Una franja angosta a la derecha de cada día queda libre para elegir bloques debajo de otra tarea (con teclado, las flechas también pasan por debajo).
- **Google Calendar**: con cuentas de Google conectadas en **Configuraciones → Cuentas asociadas** (con el permiso del calendario), la Agenda se sincroniza en las dos direcciones cada 5 minutos con todas las cuentas, desde 30 días atrás hasta un año adelante. Los eventos de cada cuenta aparecen en la Agenda con prioridad Media; los que creás en Notia van a tu primera cuenta personal (o a la primera cuenta si no hay personal). Si el mismo evento cambia en los dos lados, gana Notia. Borrar un evento de un lado lo borra del otro. Los eventos de día completo no se traen, y los que pasan la medianoche terminan a las 24:00 en la Agenda.
- **Anotador rápido**: una lista de pendientes del día. Las tareas que marcás como hechas quedan tachadas hasta que termina el día; las que siguen pendientes pasan al día siguiente.
- **Próximos eventos**: las próximas 10 tareas que todavía no terminaron; al tocar una, la semana salta a ese día y la muestra.
- **Datos**: se guardan en la base de la biblioteca, separados por usuario.
- **IA**: desde el chat o Telegram podés pedirle al asistente que agende un evento en la Agenda de Notia («agendá Iron Maiden el 21/10 a las 21 en Notia»), que te diga qué tenés, que borre un evento o que anote, marque o borre un pendiente del anotador. Cada cambio pide confirmación. Si pedís agendar en Notia y en Google Calendar, lo crea solo en Notia y la sincronización lo lleva a Google. Un evento no puede pasar la medianoche; para eso agenda dos.

### Rutina

El acceso **Rutina** aparece debajo de **Agenda** en la barra izquierda y abre un panel para convertir tareas en hábitos.

- **Rutinas**: agrupá las tareas en rutinas con su propio checklist (Mañana, Noche, Fin de semana...). Podés crearlas, renombrarlas y eliminarlas cuando están vacías; siempre queda al menos una.
- **Tareas**: cada tarea tiene nombre, rutina, categoría de la rueda de la vida, días en que aplica (todos o algunos) y una nota opcional. Se pueden pausar sin perder el historial, editar, eliminar con **Deshacer** y ordenar arrastrando el asa o con las flechas del teclado.
- **Seguimiento**: cada tarea cuenta desde el día en que la creaste (los días anteriores no son días perdidos, salvo que los marques como hechos). Panel de hábitos con la racha de cada tarea, calendario del mes, evolución diaria comparada con el mes pasado, progreso semanal, rueda de la vida con metas por categoría y la semana actual para marcar lo hecho, con la pestaña **Todos** (cada tarea indica su rutina) o una pestaña por rutina. Solo se puede marcar hoy o días anteriores.
- **Datos**: se guardan en la base de la biblioteca, separados por usuario.
- **IA**: desde el chat principal, el chat lateral (también en Finanzas) o Telegram podés hacer lo mismo que en la pantalla: consultar tu rutina, rachas, progreso e informes de este mes o de meses anteriores; crear, renombrar o eliminar rutinas; crear, editar, mover, pausar, reordenar, eliminar o recuperar tareas; marcar hábitos hechos (por ejemplo «ayer hice yoga») y ajustar metas. Cada cambio pide confirmación antes de guardarse. En Telegram, la rutina que ves y modificás es la del usuario de la biblioteca vinculado a tu cuenta.

### Acciones IA

El acceso **Acciones IA** (ícono del cuervo, Munin) aparece debajo de **Rutina** en la barra izquierda. Es el tablero de todo lo que la IA hace sola en un horario: qué hace (el prompt), cuándo, si ya se ejecutó hoy y si se repite. La IA siempre responde por Telegram y solo al Owner.

- **Tipos**: **Recordatorio** (una vez; la IA redacta un aviso breve a partir del prompt), **Hora específica** (una vez; la IA ejecuta el prompt como tarea, con las herramientas de la app, y te manda el resultado) y **Recurrente** (cada N minutos, horas, días o semanas, en los días elegidos y, para minutos u horas, dentro de una ventana opcional «desde–hasta»).
- **Tablero**: métricas del día (ejecutadas, pendientes, recurrentes activas y próxima ejecución), filtros por tipo con contador, buscador por nombre o prompt, una columna por tipo y el panel **Hoy** con todas las ejecuciones del día, pasadas y futuras, y la línea **AHORA**.
- **Estados**: Pausada, Falló (con **Reintentar**), Próxima, Ejecutada (o Enviado en recordatorios, o Reintentada), Pendiente y Programada. Una ejecución perdida porque Notia estaba cerrada figura como **Omitida**.
- **Formulario**: tipo, nombre, prompt, cuándo y un resumen con las próximas ejecuciones. **Probar ahora** ejecuta el prompt una vez sin guardarlo y la respuesta llega a Telegram con el prefijo «[Prueba]». Tocando una tarjeta se edita, se ve su historial y se puede eliminar (el historial se conserva).
- **Cómo corre**: cada ejecución es un pedido del Owner en su chat de Telegram, con sus reglas, su memoria, sus pensamientos y las herramientas de la app. Si algo necesita confirmación o una respuesta, te lo pregunta por Telegram. Una acción que pide «avisame solo si hay algo» puede no mandar nada.
- **Revisión de cada hora**: la revisión que antes hacía sola el agente autónomo ahora es una acción recurrente más, **Revisión de cada hora**, que Notia crea una vez en cada biblioteca (activa si tenías el agente autónomo prendido). Se puede editar, pausar o eliminar.
- **Dónde corre**: solo en el equipo donde está activo el bot de Telegram de la biblioteca. Si el servidor headless y la app de escritorio usan la misma biblioteca, el servidor tiene prioridad y cada ejecución ocurre una sola vez.
- **Horarios**: se leen en la zona horaria del lugar configurado en **Configuración → Clima** (Buenos Aires si no elegiste otro).
- **La IA las administra**: desde cualquier chat (el principal, el lateral, el de Finanzas, el del tablero de tareas, el de una nota) o por Telegram podés pedirle «recordame mañana a las 10 que pague la tarjeta», «todos los días a las 8 armame un resumen», «pausá la revisión de cada hora», «cambiá la de gastos a cada 2 horas», «borrá el recordatorio del contador», «ejecutá ahora el briefing» o «reintentá la que falló». La IA crea o cambia cualquier campo (tipo, nombre, prompt, fecha, hora, repetición, días, ventana, activa o pausada) y pide confirmación antes de guardar. Solo el Owner puede.

### Recetas

El acceso **Recetas** (ícono de un plato hondo) aparece debajo de **Rutina** en la barra izquierda. Es tu recetario: cada comida con su foto, sus ingredientes, la preparación y la información nutricional por porción.

- **Dónde se guardan**: cada receta es un archivo `.md` en la carpeta `recipes` de la biblioteca, con los datos en tablas y la foto adentro del mismo archivo. Se puede abrir como cualquier nota.
- **Tablero**: buscador por nombre o ingrediente, filtros por momento (**Desayuno**, **Almuerzo**, **Cena**, **Snack**), orden (más recientes, menos calorías, más proteína o por nombre) y una tarjeta por receta con calorías, tiempo y reparto de proteína, carbohidratos y grasas.
- **Detalle**: calorías por porción y qué parte son de una dieta de 2000 kcal, macros, fibra, azúcares, vitaminas y minerales con su porcentaje del valor diario. El sodio se muestra como parte del límite diario y se marca cuando es alto. Desde ahí se edita o se elimina (pide confirmación).
- **Nueva comida**: nombre, momento, tiempo, porciones, descripción, foto, ingredientes, pasos y los nutrientes que sepas. Al guardar, la IA revisa la comida y completa lo que falte, sobre todo vitaminas y minerales. Lo que escribiste se respeta. Sin foto, se muestra una ilustración del plato.
- **Sin repetidas**: si la comida ya está en el recetario (aunque la escribas un poco distinto), no se guarda otra igual y te ofrece **Ver la receta**.
- **Lo que comés también queda en el recetario**: si le mandás al asistente la foto de lo que comiste (con o sin texto) o le contás qué comiste, busca la receta. Si no existe, la arma con sus ingredientes y pesos estimados y la guarda (con la foto si la mandaste). Si ya existe, usa esa. En los dos casos también la carga en **Salud**. Para guardar una receta que todavía no comiste, pedíselo así: «guardá esta receta».
- **La IA la administra**: desde el chat principal, el lateral o Telegram podés pedirle «qué recetas tengo con lentejas», «cuánto hierro tiene el guiso», «cambiá las porciones del bowl a 3» o «borrá la receta de hummus». Cada cambio pide confirmación.

### Salud

El acceso **Salud** (ícono de un corazón con pulso) aparece debajo de **Recetas** en la barra izquierda. Es tu panel de peso, alimentación, agua y composición corporal. Cada usuario de la biblioteca ve solo sus propios datos.

- **Perfil**: fecha de nacimiento, sexo biológico, altura, peso y nivel de actividad. Con eso se calculan tu IMC, tu metabolismo basal, tu gasto diario y el agua que necesitás.
- **IMC**: el valor, su rango (bajo peso, normal, sobrepeso u obesidad), cuántos kilos te separan del rango normal para tu altura y dónde quedarías con tu objetivo.
- **Peso**: el gráfico de 30 días, 90 días, 1 año o todo, con la línea de tu objetivo. Podés cargar el peso de cualquier día y ver o borrar los registros. Tocá un punto del gráfico para ver su valor.
- **Peso objetivo y plan**: fijá el objetivo y el ritmo (0,25 a 1 kg por semana). **Generar plan con IA** arma tus calorías y macros diarios con recomendaciones; **Calcular sin IA** usa una fórmula. Las calorías nunca quedan por debajo de tu metabolismo basal. Sin plan, los objetivos son de mantenimiento.
- **Alimentación**: las comidas de cada día por desayuno, snack, almuerzo, merienda y cena, con calorías, proteínas, carbohidratos, grasas y fibra comparados con tu objetivo. Al agregar una comida podés tocar **Estimar con IA** para que complete los valores, o repetir una que ya cargaste.
- **Agua**: vaso de 250 ml, botella de 500 ml u otra cantidad, con el avance del día y los últimos 7 días.
- **Composición corporal**: cargá lo que te mide tu balanza (grasa, músculo, agua, huesos, grasa visceral, metabolismo, edad metabólica…). Se ve cómo se reparte tu peso, cada valor con su rango y la diferencia con la medición anterior. Lo que la balanza no da y se puede calcular se completa solo.
- **Desde cualquier chat**: también desde el chat de Finanzas, y el asistente cambia solo al módulo que haga falta.
- **Con la IA y por Telegram**: contale lo que comiste («almorcé dos empanadas de carne», «comí 500 g del guiso», «la milanesa pero con el doble de papas») o mandale la foto de tu plato, aunque no escribas nada. Busca la receta en **Recetas** (si no existe, la crea con ingredientes y pesos estimados) y la carga en tu alimentación con las calorías y macros de lo que comiste, ajustados si fue otra cantidad. También podés decirle «me pesé 82,4», «tomé un vaso de agua», pasarle los datos de la balanza, pedirle tu plan o preguntarle cuánto te queda por comer hoy. Cada cambio pide confirmación.
- Los rangos son referencias generales para adultos y no reemplazan una consulta profesional.

### ColdPass

Gestor de credenciales cifradas integrado en Notia.

- Tus credenciales se almacenan en un archivo `ColdPass.md` dentro de cada librería, **cifrado con AES-256-GCM**.
- Se abre con la **contraseña del Owner**, la misma con la que iniciás sesión en Notia; no hay una contraseña aparte. Aunque tengas «Recordar sesión», ColdPass la pide cada vez que lo abrís y se bloquea al salir. Eliminar una credencial o importar un vault también la piden. Si cambiás la contraseña del Owner, ColdPass sigue abriéndose con la nueva.
- La pantalla tiene la lista de credenciales con buscador y filtros (**Todas**, **Débiles**, **Antiguas**) y, al lado, el detalle: contraseña (mostrar y copiar), usuario, usuario secundario, sitio web, historial de contraseñas anteriores con su fecha y notas. En el teléfono, la lista y el detalle se ven de a uno.
- Cada contraseña muestra si es **Fuerte**, **Débil** (corta, fácil de adivinar o con el nombre, el sitio o el usuario adentro) o **Antigua** (más de un año sin cambiar), y ofrece **Generar nueva**.
- Al copiar una contraseña, Notia la borra del portapapeles a los 30 segundos si no copiaste otra cosa (Windows y Android). En Windows tampoco queda en el historial del portapapeles.
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
- **Comentarios**: discusión y notas adjuntas a cada tarea. Cada comentario se agrega al final del ticket como `## Comentario - DD/MM/YYYY HH:MM - Autor`, con la hora local y el nombre del usuario, y el texto debajo. Los comentarios quedan en el orden en que se escribieron. La tarjeta muestra el detalle seguido de los comentarios.
- **Pomodoro integrado**: temporizador de 25/5 minutos con registro histórico de sesiones y estadísticas de productividad.
- **Persistencia transparente**: cada tarea se guarda como un archivo Markdown con metadatos (frontmatter) dentro de la carpeta del tablero correspondiente.
- **Agente contextual**: el chat lateral conoce el panel activo de Task Manager pero no adjunta todos los tickets. Las búsquedas y lecturas quedan limitadas al tablero o panel visible; para consultar otro contexto primero hay que cambiar a ese panel. Usa RAG local para consultas generales y lee archivos completos bajo demanda mediante tool calling nativo de Ollama. Cuando recupera o lee un ticket padre, incorpora automáticamente las subtareas declaradas en `childs` y su contenido, de forma recursiva, para que la respuesta no pierda sus seguimientos.
- **Filtros y organización asistida**: puede buscar por estado, prioridad, grupo, fechas, tags y texto de metadata, y actualizar dependencias y checklist controlados en el frontmatter sin cargar cuerpos innecesarios.
- **Edición asistida y confirmada**: el agente puede crear tickets, reemplazar su contenido Markdown, agregar, corregir o eliminar comentarios, agregar subtareas, mover tickets de grupo y cambiar estado o prioridad. Un comentario corregido conserva su fecha y su autor. El Owner puede cambiar cualquier comentario y los demás usuarios solo los propios. La confirmación cita el comentario completo. También puede consultar los grupos en el orden del tablero, crearlos, renombrarlos, cambiarles el color, reordenar las columnas y eliminarlos únicamente cuando no tengan ningún ticket asignado. Los índices del tablero (`*TaskIndex.md`) no los edita como documentos: los cambia siempre con las herramientas de Task Manager, que también actualizan los tickets de cada grupo. Consulta las opciones válidas del tablero y, ante cualquier dato faltante, definición imprecisa o coincidencia ambigua, pausa para preguntar en vez de inventar. Toda interacción pendiente aparece en una tarjeta dentro del chat: si encuentra varias opciones, cada alternativa se presenta como una opción clickeable; si necesita autorización, muestra los valores concretos, una vista previa del contenido y las acciones **Confirmar** y **Cancelar**. El runtime impide modificar entidades ambiguas hasta resolver la selección. Rechazar una autorización garantiza que no se escriba nada y una aprobación solo autoriza esa operación individual.
- **Planes para operaciones compuestas**: cuando un pedido requiere dos o más escrituras, el agente crea primero un TO-DO visible dentro del chat. El usuario debe aprobarlo antes de comenzar o puede elegir **Sugerir cambios**, escribir la corrección en el compositor y revisar una nueva versión. Cada operación se ejecuta por separado y en orden, conserva su propia confirmación y actualiza el paso como pendiente, en curso, completado o bloqueado. Un rechazo o error detiene el avance del plan. En documentos y biblioteca se usa el plan general; Task Manager conserva su alias específico.
- **Resúmenes por persona**: cuando se solicita una vista completa por responsables, el agente inspecciona todos los tickets del panel, releva las atribuciones explícitas tanto de los metadatos como de los detalles y evita agrupar el trabajo de distintas personas bajo el primer nombre encontrado.
- **Búsqueda de personas**: los resultados relevantes se diversifican entre archivos para que un historial con muchas menciones no desplace otros tickets coincidentes. La cantidad informada corresponde a rutas de tickets únicas, no a comentarios o estados dentro de un mismo archivo.
- **Panel adaptable**: el borde izquierdo del chat lateral permite ajustar su ancho con arrastre o teclado y conserva la medida elegida entre sesiones.
- **Encabezado y compositor del chat lateral**: arriba están el agente que responde, el título del chat abierto, el historial de chats, «Nuevo chat» y cerrar. El historial agrupa los chats en Fijados, Hoy, Ayer, Esta semana y Anteriores, muestra con qué agente habla cada uno, se puede buscar y permite fijar, renombrar o eliminar cada chat (Ctrl+H lo abre y Ctrl+N empieza un chat nuevo). Un chat elegido del historial queda abierto, con su agente, aunque no sea el de la nota actual. El chat vacío muestra con quién hablás y sugerencias que se envían con un toque. El compositor muestra como chip el archivo o la vista que se suma de contexto, junto con los adjuntos, y tiene adjuntar, dictar, el modelo (abre la configuración de IA) y enviar.
- **Colaboración en tiempo real**: la publicación LAN permite configurar entre 1 y 64 sesiones autenticadas y conexiones WebSocket concurrentes (64 por defecto). Las mutaciones del host y de las URL publicadas se distribuyen en ambas direcciones con revisión, reintento idempotente y detección de conflictos; una edición que quedó vieja pide recargar y no pisa el cambio de otra persona. Si se corta la red, la URL reconecta y recupera eventos por cursor o solicita un snapshot nuevo; al ocultar la pestaña pausa socket y reintentos y resincroniza al volver. Revocar un dispositivo cierra solo sus conexiones activas.

---

## 🧩 Consumo de Funcionalidades

> Esta sección describe, para cada módulo funcional, **qué hace**, **cuándo usarlo**, los **pasos para consumirlo**, las **entradas esperadas**, las **salidas/resultados** y los **errores comunes** con su resolución. Se expresa en lenguaje funcional (orientado a analistas y usuarios finales).

### Inicio: el tablero de la biblioteca

| Campo | Descripción |
|---|---|
| **Qué hace** | Reúne en una pantalla la agenda de la semana, las tareas urgentes y el Pomodoro, el mes de Finanzas, los hábitos de hoy, el anotador del día, lo último que usaste y el clima, y permite actuar sobre ellos sin abrir cada módulo. |
| **Cuándo usarlo** | Al empezar el día o para ver rápido qué tenés pendiente. |
| **Pasos para consumir** | 1. Tocar **Inicio** (la casa) en la barra izquierda. 2. Marcar hábitos o pendientes del anotador con su casilla. 3. Tocar un día de la agenda para filtrar sus eventos. 4. Iniciar, pausar o reiniciar el Pomodoro. 5. Escribir en **Preguntale al asistente** y tocar la flecha para mandarlo al chat lateral. 6. Tocar **Abrir** en una tarjeta para ir a su módulo. |
| **Entradas esperadas** | Pendientes de hasta 200 caracteres en el anotador; una pregunta cualquiera en el cuadro del asistente. |
| **Salidas / Resultado** | Cada cambio se guarda en su módulo (Agenda, Rutina o Task Manager) y el tablero se vuelve a leer. La pregunta aparece en un chat nuevo del chat lateral con el agente elegido. |
| **Errores comunes** | **Una tarjeta muestra un error en rojo**: ese módulo no se pudo leer (por ejemplo, la biblioteca perdió su permiso en Android); las demás tarjetas siguen. **«Grabar» deshabilitado**: el modelo de voz todavía se está preparando o el dictado está desactivado en Configuraciones. **Dólar en «—» y «Sin conexión»**: no se pudo consultar la cotización. **«Clima no disponible»**: no se pudo consultar Open-Meteo; tocá el chip para reintentar. **El clima es de otra ciudad**: elegí la tuya en **Configuraciones → Clima**. |

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
| **Pasos para consumir** | 1. Asegurate de tener notas Markdown con wikilinks en la librería. 2. En el **Icon Rail** (barra lateral izquierda), seleccionar **"Graph view"**. 3. Esperar a que se cargue el grafo (puede tomar segundos en bibliotecas grandes). 4. Usar zoom y paneo para explorar, o **Encuadrar** para ver todo. 5. Tocar un nodo para seleccionarlo y ver su detalle; **Abrir nota** la abre en una pestaña y **Sumar al chat** la agrega al contexto del chat. 6. Usar el buscador para encontrar notas por título o contenido y tocar un resultado para ir a su nodo. 7. Usar **Ver grafo local**, los chips de etiqueta y los controles de abajo para filtrar. |
| **Entradas esperadas** | Librería activa con al menos un archivo Markdown. No requiere entrada manual del usuario. |
| **Salidas / Resultado** | Canvas 2D interactivo con nodos (títulos de notas) y líneas de conexión (wikilinks). Al tocar un nodo se muestra su detalle; **Abrir nota** la abre en pestaña. |
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

### Agentes del Chat IA

| Campo | Descripción |
|---|---|
| **Qué hace** | Hace que respondan uno o varios agentes (prompts de `.agent/promps/`) en lugar de Notia, en rondas, guiados opcionalmente por una dinámica de `.agent/dynamics/`, con los permisos y el contexto permanente del chat. |
| **Cuándo usarlo** | Para comparar perspectivas, pedir un debate o un análisis entre varios roles, o encadenar el trabajo de varios agentes sobre la librería. |
| **Pasos para consumir** | 1. Abrir el **Chat IA** y el panel **Contexto**. 2. En **Agentes**, tocar **Agregar agente** y elegir hasta seis. 3. Opcional: elegir una **Dinámica**, escribir un **Contexto permanente** y ajustar los **Permisos**. 4. Enviar el mensaje. 5. Detener con el botón del compositor si hace falta. |
| **Entradas esperadas** | Agentes y dinámicas en Markdown con contenido; el frontmatter se ignora y su campo `description`, si existe, se muestra en la lista. El contexto permanente admite hasta 20.000 caracteres. |
| **Salidas / Resultado** | Mensajes de cada agente con su nombre e iniciales, guardados en el chat. Entre una y cuatro rondas automáticas por mensaje; la dinámica puede nombrar agentes, pedir que hablen todos o pedir esperar al usuario. |
| **Errores comunes** | **«Un chat puede tener hasta seis agentes»**: quitá uno antes de sumar otro. **«La dinámica del chat no es válida»** o un agente marcado **Vacío o ilegible**: revisá el archivo en `.agent/`. Un agente cuyo archivo se borró queda en la lista con el aviso «El archivo del agente ya no existe» y no habla. Si un agente falla, lo que dijeron los anteriores queda guardado y se muestra el error. |

### Finanzas: carga por el asistente y «Para revisar»

| Campo | Descripción |
|---|---|
| **Qué hace** | El asistente carga, corrige y elimina los datos financieros a partir de lo que le mandás (fotos de tickets, recibos, facturas y resúmenes, o un mensaje). Al guardar une solo lo que es claramente lo mismo, te lo cuenta y deja lo dudoso en **Para revisar** como una pregunta. La pantalla de Finanzas muestra los resultados. |
| **Cuándo usarlo** | Cada vez que pagás algo y querés registrarlo, cuando llega el resumen de la tarjeta ya pagado, al cobrar el sueldo, al comprar o vender dólares del ahorro, o para corregir, unificar o borrar algo cargado. |
| **Pasos para consumir** | 1. Abrir el chat (de la app o de Telegram). 2. Mandar la foto o contar el gasto. 3. Revisar el resumen del cambio y confirmarlo. 4. Leer los vínculos que el asistente informa; si alguno está mal, pedirle que lo deshaga. 5. Responder las preguntas de **Para revisar** (también podés pedirle «¿qué falta revisar en Finanzas?»). 6. Ver el resultado en **Finanzas**, pestaña **Resumen**; los botones de **Para revisar** llevan tu respuesta al chat. |
| **Entradas esperadas** | Ticket: comercio, fecha, productos, total y con qué cuenta o tarjeta se pagó. Resumen: la tarjeta y el archivo del resumen. Sueldo: el recibo. Cambio de moneda: reserva, cuenta, importes y si compraste o vendiste. |
| **Salidas / Resultado** | Los gastos del mes, lo pagado de tarjetas, lo que está en tarjeta a pagar, lo ahorrado, el estado de cada servicio, los productos con sus precios y las cuotas pendientes quedan actualizados. Cada vínculo automático se puede deshacer y cada duda queda en **Para revisar** hasta que la respondas. |
| **Errores comunes** | **"El movimiento pertenece a un ticket/resumen/sueldo"**: el importe, la fecha o la cuenta se corrigen desde ese documento; pedile al asistente que corrija o borre el documento. **"La reserva no alcanza para vender"**: revisá el importe o la reserva. **"La línea es de otra tarjeta, otra moneda u otro importe"**: el vínculo manual no corresponde. Una acción sin `#Confidencial` se rechaza. |

### Agenda: semana en bloques de 15 minutos y anotador del día

| Campo | Descripción |
|---|---|
| **Qué hace** | Muestra el mes y la semana elegidos, agenda tareas en bloques de 15 minutos con prioridad, lista los próximos eventos y guarda un anotador de pendientes del día. |
| **Cuándo usarlo** | Para reservar tiempo en la semana, ver de un vistazo qué días tenés tareas y anotar pendientes rápidos del día. |
| **Pasos para consumir** | 1. Abrir **Agenda** en la barra izquierda. 2. Elegir el día en el calendario o moverse con las flechas de **Semana**. 3. Seleccionar bloques en la grilla (clic o arrastre; en táctil, tocar o mantener presionado y deslizar). 4. Escribir el nombre, elegir la prioridad y tocar **Agendar**. 5. Tocar una tarea para eliminarla. 6. Anotar pendientes en **Anotador rápido** y marcarlos al terminarlos. |
| **Entradas esperadas** | Bloques de 15 minutos (hasta una semana completa por vez), nombre de la tarea (hasta 120 caracteres; vacío queda «Tarea sin título»), prioridad y notas de hasta 200 caracteres. |
| **Salidas / Resultado** | La vista se actualiza al instante y se recarga al volver a la ventana. Los días con tareas muestran un punto en el calendario y el encabezado resume los eventos próximos y las tareas pendientes. |
| **Errores comunes** | **«No se pudieron cargar los feriados»**: revisá la conexión; se reintenta solo. **Un evento de Google no aparece**: los de día completo no se traen; revisá que la cuenta tenga el permiso del calendario. **«La nota es obligatoria»**: escribí algo antes de **Agregar**. **«La biblioteca perdió su URI SAF»** (Android): volvé a seleccionar la carpeta de la biblioteca. |

### Rutina: hábitos, rachas y rueda de la vida

| Campo | Descripción |
|---|---|
| **Qué hace** | Organiza hábitos en rutinas, registra qué hiciste cada día y calcula rachas, porcentajes diarios, semanales y mensuales y el puntaje de cada categoría de la rueda de la vida. |
| **Cuándo usarlo** | Para sostener hábitos diarios o de ciertos días, revisar cómo viene la semana o el mes y equilibrar áreas de tu vida con metas por categoría. |
| **Pasos para consumir** | 1. Abrir **Rutina** en la barra izquierda. 2. Crear o renombrar rutinas en **Tus rutinas**. 3. En **Sumar a la rutina**, escribir la tarea, elegir rutina, categoría y días, y tocar **Añadir**. 4. Marcar lo hecho en **Semana actual**, eligiendo la rutina en las pestañas. 5. Ajustar las metas en **Rueda de la vida**. 6. Opcional: pedirle a la IA, por ejemplo, «marcá tomar agua y estirar como hechas hoy» y confirmar. |
| **Entradas esperadas** | Nombre de rutina (hasta 30 caracteres), nombre de tarea (hasta 60), una de las 8 categorías, días de la semana, nota opcional (hasta 80) y metas de 1 a 10. |
| **Salidas / Resultado** | El panel se actualiza al instante. Si la IA hace cambios desde el chat o Telegram, la vista abierta se recarga sola. Una tarea eliminada puede recuperarse con **Deshacer** o pidiéndoselo a la IA. |
| **Errores comunes** | **«Elegí al menos un día»**: marcá algún día o elegí **Todos los días**. **«Necesitás al menos una rutina»** o **«vaciala antes de eliminarla»**: mové o eliminá sus tareas primero. **«No se pueden marcar días futuros»**, **«no aplica el…»** o **«está pausada»**: marcá solo hoy o días anteriores, en días que correspondan a la tarea y con la tarea activa. **«Hay varias tareas llamadas…»**: indicá a la IA de qué rutina se trata. |

### Acciones IA: tareas programadas de la IA

| Campo | Descripción |
|---|---|
| **Qué hace** | Programa prompts que la IA ejecuta sola: un recordatorio, una tarea a una hora o una tarea que se repite. Muestra el estado de cada una y la línea del día. |
| **Cuándo usarlo** | Para que la IA te avise algo a una hora, arme un resumen todas las mañanas, revise el correo cada tanto o haga una tarea recurrente y te conteste por Telegram. |
| **Pasos para consumir** | 1. Abrir **Acciones IA** en la barra izquierda. 2. Tocar **Nueva acción**. 3. Elegir el tipo, escribir el nombre y el prompt y definir cuándo. 4. Revisar el resumen y las próximas ejecuciones. 5. Opcional: **Probar ahora**. 6. **Guardar acción**. Para pausarla, usar el interruptor de la tarjeta; si falló, **Reintentar**. |
| **Entradas esperadas** | Nombre (hasta 80 caracteres), prompt (hasta 4000), fecha y hora futuras (una vez) o «cada N» con unidad, días de la semana y, opcionalmente, «desde» y «hasta» (recurrente). |
| **Salidas / Resultado** | La respuesta de la IA llega por Telegram. El tablero, las métricas y la línea **Hoy** se actualizan solos al cambiar algo o al terminar una ejecución. |
| **Errores comunes** | **«La fecha y hora tienen que ser futuras»**. **«En minutos, el mínimo es 5»**. **«Elegí al menos un día»**. **«En días o semanas, «Desde» es la hora de ejecución»**. **«Telegram no está activo en este equipo…»**: activá el bot en **Configuración → Telegram** y vinculá tu chat de Owner; las acciones solo corren donde está el bot. |

### Recetas: recetario con información nutricional

| Campo | Descripción |
|---|---|
| **Qué hace** | Guarda tus comidas en la carpeta `recipes` de la biblioteca, con foto, ingredientes, preparación, calorías, macros, vitaminas y minerales por porción. La IA revisa cada comida nueva y completa los datos que faltan. |
| **Cuándo usarlo** | Para armar tu recetario, ver qué aporta cada comida o registrar lo que cocinaste mandando una foto por Telegram. |
| **Pasos para consumir** | 1. Abrir **Recetas** en la barra izquierda. 2. Tocar **Nueva comida**. 3. Escribir al menos el nombre; opcionalmente momento, tiempo, porciones, foto, ingredientes, pasos y nutrientes. 4. **Guardar receta** y esperar la revisión de la IA. 5. Tocar una tarjeta para ver el detalle, editarla o eliminarla. Por Telegram: mandar la foto del plato con la descripción y confirmar. |
| **Entradas esperadas** | Nombre (hasta 120 caracteres, sin `/`, `\` ni `\|`), descripción (hasta 400), tiempo en minutos (hasta 1440), porciones (1 a 100), hasta 60 ingredientes y 40 pasos (uno por línea) y una foto JPG, PNG o WebP de hasta 15 MB. |
| **Salidas / Resultado** | Un archivo `.md` por receta con los datos en tablas y la foto embebida (reducida a 1024 px). El tablero se actualiza solo, también cuando la receta llega por Telegram. |
| **Errores comunes** | **«Ya tenés esta comida en el recetario»**: tocá **Ver la receta** y editala en lugar de cargarla de nuevo. **Error de la IA**: la receta no se guarda; revisá que el modelo esté configurado y probá otra vez. **«Escribí un nombre…»** u otros avisos de campo: corregí el campo marcado. |

### Salud: peso, alimentación, agua y composición corporal

| Campo | Descripción |
|---|---|
| **Qué hace** | Lleva tu peso, lo que comés cada día, el agua y las mediciones de tu balanza. Calcula tu IMC, tu gasto diario y un plan de calorías y macros hacia tu peso objetivo, con IA o sin ella. |
| **Cuándo usarlo** | Para bajar, subir o mantener el peso, controlar calorías y macros, tomar suficiente agua o seguir tu composición corporal. |
| **Pasos para consumir** | 1. Abrir **Salud** en la barra izquierda. 2. **Configurar perfil**. 3. Fijar el **Peso objetivo** y tocar **Generar plan con IA** o **Calcular sin IA**. 4. Cargar comidas con **Agregar comida** (opcional: **Estimar con IA**), el agua y el peso de cada día. 5. Opcional: **Registrar medición** con los datos de la balanza. También se puede hacer todo desde el chat o por Telegram. |
| **Entradas esperadas** | Fecha de nacimiento (14 años o más), altura de 100 a 250 cm, peso de 20 a 400 kg, fechas que no sean futuras, comida con descripción de hasta 120 caracteres y calorías o macros (o la estimación de la IA), agua de hasta 20 litros por día. |
| **Salidas / Resultado** | El panel se actualiza al instante. Lo que registra la IA desde el chat o Telegram aparece solo en la pantalla abierta. |
| **Errores comunes** | **«La fecha no puede ser futura»**. **«El peso tiene que estar entre 20 y 400 kg»**. **«Cargá las calorías o los macros…»**: tocá **Estimar con IA** o completá algún valor. **«Fijá primero tu peso objetivo»** o **«hacen falta tu perfil y tu peso»** antes del plan. **Error de la IA**: revisá el modelo configurado, probá de nuevo o usá **Calcular sin IA**. |

### ColdPass (Credenciales Cifradas)

| Campo | Descripción |
|---|---|
| **Qué hace** | Almacena credenciales (usuarios, contraseñas, URLs, notas) en un archivo cifrado dentro de la librería activa. El cifrado ocurre localmente en el dispositivo. |
| **Cuándo usarlo** | Cuando necesitás guardar contraseñas, claves API, datos bancarios o cualquier información sensible de forma segura dentro de tu espacio de conocimiento. |
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"ColdPass"**. 2. Ingresar la **contraseña del Owner**. La primera vez se crean la carpeta `ColdPass/` y el archivo `ColdPass.md` cifrado. 3. Agregar credenciales con **Nueva credencial** (nombre, sitio web, usuario, usuario secundario, contraseña, notas). 4. Elegir una credencial de la lista para ver su detalle, copiar la contraseña o editarla. Los cambios se cifran al guardar. |
| **Entradas esperadas** | Contraseña del Owner. Credenciales: nombre (obligatorio), sitio web, usuario, usuario secundario, contraseña y notas (opcionales). |
| **Salidas / Resultado** | Archivo `ColdPass/ColdPass.md` cifrado en el filesystem. Lista de credenciales con el estado de cada contraseña (Fuerte, Débil, Antigua) y su historial. |
| **Errores comunes** | **«La contraseña del Owner no es correcta»**: revisá mayúsculas y minúsculas. Después de varios intentos fallidos hay que esperar 30 segundos. Si se olvida la contraseña del Owner no hay recuperación: se pierden ColdPass y la configuración cifrada. **Vault anterior**: un vault creado con la passkey de antes pide esa passkey una sola vez, junto con la contraseña del Owner; después se abre solo con la del Owner. |

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
| **Pasos para consumir** | 1. En el Icon Rail, seleccionar **"Task Manager"**. 2. Hacer clic en **"Nuevo tablero"** e ingresar un nombre y su contexto. 3. Para cambiarlo después, usar **"Editar tablero"**. 4. Agregar tareas al tablero. 5. Para cada tarea, definir estado, prioridad, subtareas y comentarios. 6. Cambiar entre vista Kanban y vista Tabla según prefieras. 7. Para mover una tarea, arrastrarla con el mouse o, en táctil, mantenerla presionada y deslizarla (el tablero se desplaza solo al llegar al borde); también se puede usar **Mover** en la tarjeta para subirla, bajarla o pasarla a otro grupo. Las subtareas se reordenan igual dentro de su tarea. 8. Al completar o cancelar una tarea, ésta se archiva automáticamente en la carpeta correspondiente. |
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

### Host y Cliente: usar la misma biblioteca desde otro equipo

En **Configuraciones → General → Modo de ejecución** elegís cómo corre Notia en cada equipo:

- **Host**: el equipo guarda la biblioteca y la comparte. Debajo se ve el puerto (52480) con **Escuchando**. La primera vez, Windows puede pedir permiso de red para Notia: aceptalo para que los otros equipos lleguen.
- **Cliente**: usa la biblioteca de un host. Escribí su dirección (por ejemplo `192.168.0.10:52480`), tocá **Guardar** y la ventana se recarga. **Probar conexión** muestra **Conectado** o **No responde**.

Hay dos tipos de cliente:

- **Remoto**: trabaja directo sobre el host y no guarda la biblioteca en el dispositivo.
- **Con copia**: guarda una copia sincronizada. En Android primero elegís una carpeta vacía con **Elegir carpeta** (ahí queda la copia); en Windows y Linux se guarda sola en los datos de Notia. Si el host deja de responder, podés seguir trabajando con la copia: notas y archivos se editan, la IA y el dictado usan este equipo y los datos de la base (Finanzas, Agenda, Rutina, usuarios) quedan de solo lectura. Cuando el host vuelve, Notia espera unos segundos, concilia los archivos (queda el último modificado, de cualquier equipo) y vuelve al host.

Para entrar desde un cliente se usa el usuario **Owner** de la biblioteca del host, en la misma ventana de inicio de sesión. Mientras hay conexión, todo corre en el host: el chat con IA, el dictado (el cliente graba y el host transcribe), Telegram y el agente autónomo. Un cliente nunca activa Telegram: en su **Configuraciones → Telegram** los controles quedan deshabilitados y el bot se configura desde el equipo host. En el cliente no se ofrecen Meeting ni lo que depende del equipo host (selectores de carpetas, conectar cuentas de correo).

Si el host y sus clientes abren la misma nota, la editan juntos: los cambios de cada uno aparecen en los demás mientras escriben, y el bloque que está editando cada persona se marca con su color y el nombre de su equipo.

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
   - **Calendario**, **Agenda** y **Rutina**.
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
2. Ingresá la **contraseña del Owner**. La primera vez se crean una carpeta `ColdPass/` y un archivo `ColdPass.md` cifrado en tu librería activa. Si tu vault es de antes, también te pide su passkey anterior, una sola vez.
3. Agregá, editá o eliminá credenciales. Cada cambio se cifra automáticamente al guardar. Para eliminar te vuelve a pedir la contraseña del Owner.
4. Usá los filtros **Débiles** y **Antiguas** para encontrar las contraseñas que conviene cambiar, y **Generar nueva** para reemplazarlas.
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

Cada build copia a `builds/android/` solo el APK que acaba de generar. Si Gradle no produce uno, el comando falla en vez de instalar una versión anterior.

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

### El cliente no se conecta al host
- Revisá que el host esté en modo **Host** y muestre **Escuchando** en Configuraciones → General. Si dice **Sin escuchar**, otro programa usa el puerto.
- Comprobá que los dos equipos estén en la misma red y que el firewall del host permita a Notia.
- En la pantalla «Sin conexión con el host» podés reintentar, cambiar la dirección o volver a usar el equipo como host.

### El cliente dice «El certificado del host cambió»
- El cliente recuerda el certificado del host desde la primera conexión. Si reinstalaste Notia en el host, editá su dirección en **Configuraciones → General** y tocá **Guardar** para confiar en el nuevo.

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
