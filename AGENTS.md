# AGENTS.md — Guía de ingeniería de Notia

Este archivo define las reglas de trabajo para cualquier persona o agente que modifique este repositorio. Su alcance es todo el proyecto. Las instrucciones más cercanas a un archivo prevalecen si en el futuro aparecen otros `AGENTS.md` en subdirectorios.

## 1. Contexto del proyecto

Notia es una aplicación multiplataforma construida con:

- Frontend: React 19, TypeScript estricto, Vite, Redux Toolkit, Emotion/MUI y Vitest.
- Backend nativo: Rust 2021 sobre Tauri 2, con destinos desktop y mobile.
- Integración: comandos y eventos Tauri. La frontera TypeScript/Rust es una API y debe tratarse como tal.

Antes de cambiar comportamiento relevante, consultar `README.md`, `README-TECH.md` y `AGENTS-DOC.md`. Mantener esa documentación sincronizada cuando cambien arquitectura, flujos, APIs, instalación o decisiones técnicas.

## 2. Principios no negociables

1. **Corrección antes que ingenio.** Preferir código explícito, predecible y fácil de depurar.
2. **Cambios pequeños y enfocados.** No mezclar una funcionalidad con refactors o formateos ajenos.
3. **Preservar comportamiento.** Un refactor no modifica contratos sin una razón documentada y pruebas.
4. **KISS, YAGNI y DRY con criterio.** No abstraer hasta que exista una variación real; tolerar una duplicación pequeña antes que una abstracción incorrecta.
5. **Alta cohesión y bajo acoplamiento.** Agrupar por capacidad de negocio y depender de contratos mínimos.
6. **Dependencias dirigidas hacia el dominio.** UI y adaptadores conocen los casos de uso; el dominio no conoce React, Tauri, almacenamiento ni red.
7. **Estados inválidos difíciles de representar.** Usar tipos, enums/uniones discriminadas y validación en los límites.
8. **Errores visibles y accionables.** Nunca silenciar errores ni registrar secretos.
9. **Seguridad y accesibilidad desde el diseño.** No son tareas posteriores.
10. **Optimizar con evidencia.** Medir antes de añadir memoización, cachés, concurrencia o complejidad.

## 3. Flujo de trabajo obligatorio

Antes de editar:

- Inspeccionar los módulos afectados, sus consumidores y sus pruebas.
- Revisar `git status`; todo cambio preexistente pertenece al usuario y debe preservarse.
- Identificar el contrato que cambia: props, estado, formato persistido, comando Tauri, evento, DTO o error.
- Buscar implementaciones existentes antes de crear una utilidad, hook o servicio nuevo.

Durante la implementación:

- Resolver la causa raíz, no ocultar síntomas.
- Mantener el parche mínimo y respetar estilo, nombres y estructura existentes.
- No agregar dependencias sin justificar necesidad, mantenimiento, tamaño, seguridad y compatibilidad multiplataforma.
- No editar artefactos generados (`dist/`, `target/`) ni dependencias vendorizadas.
- Si una migración cambia datos persistidos o contratos, hacerla compatible, versionada y recuperable.

Antes de finalizar:

- Revisar el diff completo y eliminar código muerto, logs temporales y comentarios obsoletos.
- Ejecutar las validaciones proporcionales al cambio y reportar cuáles se ejecutaron.
- Actualizar pruebas y documentación afectadas.
- No afirmar que algo funciona si no fue verificado; declarar claramente cualquier validación pendiente.

## 4. Arquitectura y límites

### Frontend

Respetar las responsabilidades existentes:

- `components/`: presentación y composición visual.
- `components/**/hooks/` y `hooks/`: coordinación reutilizable del ciclo de vida y comportamiento React.
- `features/`: estado global por capacidad, reducers, acciones, selectores y tipos asociados.
- `modules/`: capacidades autocontenidas con componentes, hooks, engines, servicios y tipos propios.
- `engines/`: lógica pura o casi pura, determinista y fácil de probar.
- `services/`: I/O, persistencia, integración con Tauri y adaptadores externos.
- `context/`: dependencias o coordinadores React de alcance acotado.
- `utils/`: funciones pequeñas, puras y genuinamente transversales.
- `types/`: contratos compartidos; evitar convertirlo en un depósito indiscriminado.

Flujo recomendado:

`vista -> hook/caso de uso -> engine o servicio -> adaptador Tauri -> comando Rust -> servicio Rust`

Las vistas no deben conocer detalles de persistencia, rutas HTTP ni payloads internos de Tauri. Los servicios no deben manipular DOM ni depender de componentes. Evitar importaciones circulares y accesos cruzados a internals de otra feature; exponer una API pública mínima.

### Backend Rust

- `commands/` y comandos de `filesystem/`: adaptadores delgados para Tauri; deserializan, validan, autorizan, llaman al servicio y traducen el resultado.
- `services/`: casos de uso e integraciones con dispositivos, red o sistema operativo.
- `dto/`: contratos serializables de entrada/salida.
- `state/`: estado compartido administrado por Tauri, con sincronización explícita.
- `filesystem/`: capacidades de archivos separadas por plataforma, validación y dominio.

No concentrar lógica de negocio en `lib.rs` ni en funciones `#[tauri::command]`. Extraer módulos por responsabilidad. Mantener las diferencias de plataforma detrás de `cfg` y una interfaz consistente; no dispersar condiciones de plataforma por todo el código.

### Frontera Tauri

- Considerar toda entrada del frontend como no confiable.
- Definir DTOs explícitos en ambos lados y usar `camelCase` de forma consistente donde corresponda.
- Validar rutas, tamaños, extensiones, URLs, identificadores y límites antes de realizar I/O.
- Mantener estable el nombre de comandos, eventos y campos. Un cambio exige actualizar ambos lados y sus pruebas.
- Preferir respuestas tipadas y errores estructurados/categorizados frente a strings ambiguos. No exponer detalles sensibles del sistema.
- Centralizar llamadas `invoke` y sus conversiones en servicios/adaptadores TypeScript; no invocar Tauri desde componentes presentacionales.
- Todo listener debe devolver y ejecutar su `unlisten`; toda operación larga debe contemplar cancelación, timeout y cierre de la vista.
- No bloquear el hilo principal ni mantener un lock a través de un `.await`.

## 5. SOLID aplicado, no ceremonial

- **SRP:** cada módulo cambia por una razón. Separar render, coordinación, reglas de negocio e I/O.
- **OCP:** extender mediante composición, estrategias o handlers cuando haya variantes reales; evitar cadenas crecientes de condicionales.
- **LSP:** toda implementación debe preservar invariantes, errores y semántica del contrato que implementa.
- **ISP:** props, interfaces y traits pequeños orientados al consumidor. No obligar a depender de métodos o datos innecesarios.
- **DIP:** la lógica de alto nivel recibe dependencias o traits/adaptadores; no instancia directamente infraestructura difícil de probar.

No crear interfaces de una sola implementación sin un límite arquitectónico, una necesidad de prueba o una segunda variante previsible y concreta.

## 6. Clean Code y nombres

- Usar nombres del dominio, precisos y buscables. Evitar `data`, `item`, `manager`, `helper`, `util` o `handle` sin contexto.
- Funciones cortas con un nivel de abstracción y efectos secundarios explícitos.
- Preferir guard clauses frente a anidamiento profundo.
- Evitar parámetros booleanos que cambien el significado; usar opciones nombradas o funciones separadas.
- Reemplazar números y strings mágicos por constantes con unidad o significado.
- Los comentarios explican el **porqué**, restricciones o decisiones; el código explica el **qué**. No comentar código muerto.
- Mantener APIs pequeñas. Exportar solo lo que otros módulos necesitan.
- No usar abstracciones genéricas para ocultar reglas de negocio específicas.

## 7. React y TypeScript

### Componentes y composición

- Usar componentes funcionales y composición. Preferir componentes pequeños enfocados en una responsabilidad visible.
- Mantener estado lo más local posible; elevarlo solo cuando varios consumidores necesiten una única fuente de verdad.
- No guardar en estado valores derivables de props u otro estado; calcularlos durante render.
- Props explícitas, mínimas e inmutables. Preferir uniones discriminadas cuando un componente tenga modos excluyentes.
- No usar índices como `key` si el orden puede cambiar; utilizar identidades estables.
- No ejecutar efectos secundarios durante render.
- Accesibilidad: HTML semántico, navegación por teclado, foco visible y restaurado, labels accesibles, contraste y estados de carga/error anunciables. Un `div` clickeable no reemplaza un `button`.

### Hooks y efectos

- Cumplir siempre las Rules of Hooks y el lint de dependencias.
- Un efecto sincroniza React con un sistema externo. No usar `useEffect` para datos derivados ni para encadenar transformaciones internas.
- Cada efecto que suscribe, temporiza o crea recursos debe tener cleanup simétrico.
- Evitar closures obsoletos; declarar dependencias reales. No deshabilitar reglas de hooks para esconder un diseño incorrecto.
- Hooks personalizados encapsulan una capacidad coherente, no solo líneas reutilizadas. Su API debe ocultar detalles y exponer intención.
- Soportar cancelación o ignorar resultados obsoletos en operaciones async para evitar carreras y updates tras unmount.
- Usar `useMemo`, `useCallback`, `memo`, virtualización y lazy loading solo ante costo o identidad relevante medidos; no como decoración.

### Estado y Redux Toolkit

- Estado local para interacción efímera; Context para dependencias o estado acotado de baja frecuencia; Redux para estado compartido y coordinado entre áreas.
- Los slices representan dominio de UI/cliente, no detalles de componentes.
- Reducers puros; I/O y asincronía fuera de reducers.
- Acceder mediante hooks tipados y selectores. Crear selectores memoizados solo si existe cálculo significativo o estabilidad de referencia necesaria.
- Normalizar colecciones con relaciones o actualizaciones frecuentes. Evitar duplicar la misma entidad en varios slices.
- No almacenar nodos React, funciones, Promises, errores nativos ni valores no serializables.
- Modelar `idle | loading | success | error` con una unión discriminada cuando impida combinaciones inválidas.

### TypeScript

- Mantener `strict`; no relajar el `tsconfig` para resolver un error puntual.
- Evitar `any`, `as unknown as`, `!` y casts amplios. Usar `unknown` en límites y reducirlo con type guards o validación.
- Preferir `type` para uniones/composición e `interface` para contratos extensibles, siguiendo el estilo del módulo.
- Usar `import type` bajo `verbatimModuleSyntax`.
- Distinguir ausencia (`undefined`), vacío y `null` según el dominio.
- Las funciones públicas y contratos compartidos deben tener tipos explícitos. Dejar inferencia en detalles locales obvios.
- No usar enums numéricos para protocolos; preferir literales de string y uniones discriminadas.
- Validar datos externos en runtime: el tipo TypeScript no valida JSON, storage ni respuestas Tauri.

### Estilos y UI

- Reutilizar tokens, componentes y patrones visuales existentes antes de agregar CSS nuevo.
- Evitar estilos inline para reglas dinámicas complejas y evitar selectores globales que filtren comportamiento.
- Diseñar estados hover, focus, active, disabled, loading, empty y error.
- Probar tamaños reducidos, zoom, textos largos y plataformas desktop/mobile afectadas.
- Minimizar renders masivos, layout thrashing y carga inicial de editores o librerías pesadas; usar división de código en límites naturales.

### Android, interacción táctil y diseño responsive

Android es un destino de primera clase, no una adaptación posterior. Toda funcionalidad nueva o modificada en Windows debe diseñarse desde el inicio para poder ejecutarse en una tableta Android de gama media.

- Mantener **paridad funcional** entre Windows y Android. Toda acción de negocio disponible mediante mouse, teclado, menú contextual, hover, doble clic, drag-and-drop o atajo debe tener una alternativa táctil visible y descubrible.
- Traducir la intención del gesto, no copiar literalmente el mecanismo: clic a toque; menú contextual a pulsación larga o botón de acciones; hover a estado persistente/toque; atajo a acción visible; drag-and-drop a arrastre táctil o flujo seleccionar/mover; Escape a botón atrás/cerrar.
- Ninguna operación esencial puede depender exclusivamente de hover, botón derecho, rueda del mouse, precisión de cursor, teclas modificadoras o teclado físico.
- Centralizar las acciones de dominio para que mouse, teclado y touch invoquen el mismo comando/caso de uso. No duplicar la lógica por tipo de entrada.
- Usar Pointer Events cuando una interacción deba aceptar mouse, lápiz y touch. Manejar cancelación, umbral de movimiento y conflictos entre scroll, selección y arrastre; no bloquear el scroll global innecesariamente.
- Respetar el botón/gesto Atrás de Android, teclado virtual, áreas seguras, barras del sistema, cambios de orientación, reanudación de la app y pérdida temporal de foco.
- Toda capacidad exclusiva del sistema operativo debe vivir detrás de un adapter/capability check. Si Android no ofrece un equivalente exacto, implementar una alternativa que conserve el objetivo del usuario; documentar únicamente como excepción las acciones intrínsecas de ventana, como minimizar o maximizar.
- No usar detección de user-agent para decidir capacidades. Preferir detección de runtime, media queries de interacción (`pointer`, `hover`) y adapters de plataforma.
- Diseñar desde el contenido con CSS Grid/Flexbox, medidas fluidas y breakpoints motivados por el layout, no por modelos de dispositivo concretos.
- La UI debe funcionar en orientación vertical y horizontal, con split-screen y cambios de tamaño sin perder datos, selección ni contexto. Evitar anchos/altos fijos salvo controles o límites deliberados.
- En espacios reducidos, reordenar o colapsar paneles con navegación explícita; no reducir toda la interfaz hasta volverla ilegible ni ocultar acciones críticas.
- Objetivos táctiles de al menos `48x48` CSS px, separación suficiente, texto legible sin zoom y controles accesibles. No depender solo del color para comunicar estado.
- Contemplar teclado virtual: el campo activo y la acción principal deben permanecer visibles; evitar layouts basados ciegamente en `100vh` y usar unidades dinámicas/áreas seguras cuando corresponda.
- Las listas, árboles, editores, diagramas, modales y menús deben probarse específicamente con touch. Los gestos personalizados no deben interferir con zoom, desplazamiento o navegación del sistema sin una razón justificada.

Checklist obligatorio para cada interacción nueva o modificada:

1. Identificar la intención de usuario independiente del dispositivo.
2. Definir entrada equivalente para mouse/teclado y touch/gestos.
3. Hacer que ambas rutas llamen a la misma acción de dominio.
4. Diseñar estados pressed, focus, disabled, loading, success y error.
5. Verificar layout angosto/ancho, ambas orientaciones y teclado virtual.
6. Probar cancelación, toque accidental, pulsación larga, scroll y botón Atrás cuando apliquen.

## 8. Rust

### Diseño idiomático

- Favorecer ownership y borrowing claros; clonar solo cuando la propiedad compartida lo requiera y el costo sea aceptable.
- Preferir tipos de dominio y newtypes a strings/primitivos intercambiables.
- Usar `enum` para estados y variantes cerradas; hacer `match` exhaustivo.
- Evitar `unwrap`, `expect`, `panic!`, `todo!` y `unimplemented!` en rutas de ejecución. Solo son aceptables en pruebas o invariantes verdaderamente imposibles, con explicación.
- Propagar errores con `?` y agregar contexto en el límite apropiado. No descartar `Result` con `let _ =` salvo operación deliberadamente best-effort y documentada.
- Mantener traits pequeños y definidos cerca del consumidor. Usar genéricos para polimorfismo estático y `dyn Trait` cuando se necesite heterogeneidad o desacoplamiento en runtime.
- No usar `unsafe` salvo necesidad demostrada. Encapsularlo en una API segura, documentar invariantes y agregar pruebas específicas.

### Errores, async y concurrencia

- Definir errores por capa y conservar su causa. Traducirlos a una respuesta segura recién en la frontera Tauri.
- Distinguir errores recuperables, cancelación, timeout y fallos internos.
- Nunca registrar API keys, contraseñas, tokens, contenido privado ni payloads completos sensibles.
- En async, evitar I/O bloqueante; usar las primitivas apropiadas o aislar trabajo bloqueante.
- No mantener guardas de mutex ni préstamos sensibles a través de `.await`.
- Compartir el mínimo estado posible. Preferir mensajes o ownership a mutabilidad global.
- Aplicar timeouts, límites de concurrencia y backpressure a red, streams, watchers y dispositivos.
- Toda tarea lanzada debe tener dueño, estrategia de cancelación y manejo de error; evitar tareas huérfanas.

### Plataforma y filesystem

- Validar y normalizar rutas antes de usarlas. Impedir traversal y confirmar que el destino permanezca dentro de la raíz autorizada.
- No concatenar rutas manualmente; usar `Path`/`PathBuf`.
- Usar escrituras atómicas cuando la corrupción parcial sea relevante.
- Mantener diferencias desktop/Android/iOS encapsuladas y compilables bajo sus `cfg`.
- Reducir la ventana de locks y no realizar red o filesystem lento mientras se mantiene estado bloqueado.
- En Android, usar las APIs y permisos compatibles con su modelo de almacenamiento (incluido SAF cuando corresponda); nunca asumir rutas, permisos o semántica de filesystem de Windows.
- Diseñar comandos compartidos por capacidad y contrato. Los adapters Windows y Android pueden diferir internamente, pero deben mantener resultados y errores equivalentes para la misma acción de negocio.

## 9. Patrones de diseño recomendados

Aplicar patrones porque resuelven una presión concreta, no por cumplir una lista:

- **Adapter:** encapsular Tauri, storage, filesystem, Bluetooth, HTTP y APIs de plataforma.
- **Strategy:** algoritmos intercambiables de orden, búsqueda, exportación o plataforma.
- **Repository:** acceso coherente a entidades persistidas cuando exista una verdadera abstracción de colección; no para envolver cada llamada de archivo.
- **Facade:** ofrecer una API simple sobre subsistemas complejos, como runtimes existentes.
- **Observer / eventos:** comunicar cambios asíncronos sin acoplar productores y vistas; documentar ciclo de vida y desuscripción.
- **Command:** acciones de usuario o Tauri con entrada, resultado y responsabilidad definidos.
- **State machine:** flujos con transiciones relevantes (conexión, streaming, guardado, tareas) para impedir estados imposibles.
- **Factory:** construcción con variantes de plataforma o dependencias, cuando un constructor simple ya no alcance.
- **Dependency injection:** pasar servicios/relojes/adaptadores a lógica que debe ser aislable en pruebas.

Evitar Singleton mutable, Service Locator, herencias profundas, “god objects”, repositorios genéricos universales y capas que solo reenvían llamadas sin aportar una frontera.

## 10. Seguridad y privacidad

- Validar en el backend toda entrada que afecte archivos, red, comandos, dispositivos o configuración.
- Aplicar mínimo privilegio en capacidades y permisos de Tauri.
- Nunca guardar secretos en el repositorio, logs, Redux, URLs o almacenamiento sin protección adecuada.
- No renderizar HTML no confiable ni eludir sanitización. Tratar Markdown, Mermaid, SVG y contenido generado como potencialmente hostil.
- Restringir URLs y esquemas; prevenir SSRF cuando el backend acepte destinos configurables.
- Limitar tamaño y tipo de archivos, mensajes, imágenes y respuestas para prevenir agotamiento de memoria.
- No incluir información interna sensible en errores mostrados al usuario.
- Evaluar dependencias nuevas y mantener archivos lock versionados.

## 11. Pruebas

- Cada bug corregido debe incluir una prueba de regresión cuando sea técnicamente viable.
- Probar comportamiento observable y contratos, no detalles internos ni snapshots enormes.
- Priorizar lógica pura en engines, reducers, validadores y transformaciones.
- En React, probar desde la perspectiva del usuario: interacción, accesibilidad, estados async y errores. Evitar tests que dependan de estructura incidental del DOM.
- En Rust, usar tests unitarios junto al módulo y tests de integración para fronteras públicas. Cubrir `Ok`, errores, límites y variantes de plataforma cuando sea posible.
- Las pruebas deben ser deterministas: controlar reloj, UUID, red, filesystem y aleatoriedad mediante dependencias o fixtures temporales.
- No usar servicios reales ni secretos en tests unitarios. Los tests de integración externos deben ser explícitos y aislados.
- No reducir aserciones ni borrar pruebas para lograr verde sin demostrar que el contrato cambió.

Pirámide recomendada: muchas pruebas unitarias puras, algunas de integración entre capas y pocas end-to-end para caminos críticos.

## 12. Observabilidad y rendimiento

- Logs estructurados con nivel, módulo y contexto seguro; evitar ruido en loops o renders.
- Los mensajes de error para usuario deben indicar qué ocurrió y qué puede hacer; los logs técnicos conservan contexto sin datos privados.
- Medir tiempo, frecuencia, memoria y tamaño de bundle antes y después de optimizaciones relevantes.
- Evitar N+1 de filesystem/red, serializaciones repetidas, copias grandes y recomputaciones por render.
- Cachés con clave, límite, TTL/invalidez y ownership claros. Una caché incorrecta es peor que ninguna.
- Carga diferida para vistas y dependencias pesadas, sin degradar accesibilidad ni ocultar fallos.

### Presupuesto para tablet Android de gama media

- Tomar como referencia un dispositivo con CPU móvil de gama media, 4–6 GB de RAM y almacenamiento no siempre rápido. No diseñar suponiendo hardware de escritorio, GPU potente o conectividad estable.
- Mantener el hilo de UI libre: dividir trabajo costoso, mover I/O y cómputo pesado fuera del render y ofrecer feedback inmediato. Las interacciones deben conservar fluidez cercana a 60 fps; evitar tareas continuas mayores a un frame (~16 ms) y especialmente bloqueos perceptibles mayores a 50 ms.
- Establecer para cada flujo pesado un presupuesto medible de tiempo, memoria y volumen de datos. Perfilar en un dispositivo Android físico de referencia; el emulador y la máquina desktop no bastan para validar rendimiento.
- Virtualizar o paginar colecciones grandes; procesar archivos y respuestas extensas de forma incremental. Evitar cargar bibliotecas completas, imágenes base64, grafos o documentos duplicados en memoria.
- Reducir copias y serializaciones a través de Tauri. No enviar payloads masivos repetidamente si puede usarse streaming, lotes, referencias o resultados incrementales.
- Aplicar debounce/throttle a búsquedas, resize, scroll, autosave y gestos de alta frecuencia cuando corresponda, sin volver lenta la respuesta percibida.
- Pausar o cancelar timers, watchers, streams y tareas cuando la app pase a segundo plano o la vista deje de necesitarlos; revalidar estado al reanudar.
- Diseñar para presión de memoria y terminación del proceso: persistir cambios importantes, restaurar sesión de forma segura y no depender de estado volátil para evitar pérdida de datos.
- Optimizar batería y red: evitar polling agresivo, reintentos infinitos y trabajo en background sin necesidad; usar backoff, caché acotada y conectividad tolerante a interrupciones.
- Probar al menos apertura de biblioteca grande, navegación, búsqueda, edición/autoguardado, modales, diagramas o vistas pesadas y retorno desde background. Registrar regresiones relevantes.

## 13. Comandos de validación

Ejecutar desde la raíz según el alcance:

```bash
npm run lint
npm test
npm run build
```

Para Rust, desde `src-tauri/`:

```bash
cargo fmt --all -- --check
cargo check --all-targets
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
```

Antes de entregar una funcionalidad transversal, ejecutar las validaciones completas aplicables. Para cambios condicionados por plataforma, verificar al menos la compilación del target disponible y revisar explícitamente las ramas `cfg`; documentar los targets no comprobados.

Para cambios que afecten Android, ejecutar además la validación disponible apropiada:

```bash
npm run dev:android
npm run build:android:debug
```

El build confirma compatibilidad, pero no sustituye una prueba manual en tableta Android física. Validar paridad de acciones, touch, botón Atrás, orientación, teclado virtual, suspensión/reanudación y rendimiento de los flujos afectados. Si no hay dispositivo disponible, dejar esa validación explícitamente pendiente.

No ejecutar automáticamente builds de release, firma Android, publicación, instalación en dispositivos ni acciones destructivas sin solicitud explícita.

## 14. Definición de terminado

Un cambio está terminado cuando:

- satisface el comportamiento solicitado y los casos límite razonables;
- mantiene límites arquitectónicos y contratos TypeScript/Rust alineados;
- no introduce errores ignorados, carreras, fugas de listeners/recursos ni secretos;
- incluye o actualiza pruebas útiles;
- pasa lint, typecheck/build, formato, Clippy y tests aplicables;
- contempla accesibilidad, seguridad, rendimiento y plataformas afectadas;
- ofrece en Android un equivalente táctil de toda acción de negocio afectada disponible en Windows;
- mantiene una UI responsive usable en touch, orientación vertical/horizontal, split-screen y con teclado virtual;
- fue evaluado con los límites de una tableta Android de gama media y no depende de capacidades de hardware desktop;
- actualiza la documentación relevante;
- el diff es enfocado, legible y no pisa cambios ajenos.

Si alguno de estos puntos no puede cumplirse, dejar constancia precisa del motivo, impacto y validación pendiente.
