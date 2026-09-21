# Guía general de trabajo

Este archivo define cómo trabajar en el repositorio. No contiene información específica del producto, funcionalidades concretas ni decisiones de arquitectura. Esas definiciones pertenecen a `README-TECH.md`; las reglas de documentación pertenecen a `AGENTS-DOC.md`.

## Antes de editar

- Revisar `git status`; todo cambio preexistente pertenece a la persona usuaria y debe preservarse.
- Consultar `README.md`, `README-TECH.md` y `AGENTS-DOC.md` antes de modificar comportamiento relevante.
- Inspeccionar los módulos afectados, sus consumidores y sus pruebas.
- Identificar el contrato que cambia: interfaz, estado, formato persistido, API, evento, DTO o error.
- Buscar implementaciones existentes antes de crear una utilidad, hook, servicio o abstracción nueva.
- Confirmar el alcance y evitar acciones externas o destructivas no solicitadas.

## Principios de implementación

- Priorizar corrección, claridad y facilidad de depuración.
- Mantener cambios pequeños, enfocados y reversibles.
- Diseñar, implementar y revisar cada flujo para Windows y Android desde el inicio. Esto incluye el frontend, los comandos y adaptadores Rust del backend, la iteración de desarrollo y las diferencias de plataforma, permisos y ciclo de vida.
- Mantener las interfaces responsive para teléfonos y tabletas Android, además de las ventanas de Windows. Toda interacción esencial debe poder realizarse con toque y gestos de dedo adecuados en Android; no debe depender de mouse, hover, clic derecho, teclado físico ni precisión de puntero.
- Resolver la causa raíz sin ocultar errores ni alterar contratos sin justificación.
- Aplicar KISS, YAGNI y DRY con criterio; tolerar duplicación pequeña antes que una abstracción incorrecta.
- Mantener alta cohesión y bajo acoplamiento.
- Separar presentación, coordinación, dominio, persistencia e infraestructura según la arquitectura documentada en `README-TECH.md`.
- Usar nombres precisos, funciones cortas y efectos secundarios explícitos.
- Evitar código muerto, valores mágicos, casts amplios, estados imposibles y abstracciones de una sola implementación sin una frontera real.
- No editar artefactos generados, dependencias vendorizadas ni archivos derivados salvo solicitud explícita.

### Reglas específicas para archivos y filesystem en Android

- Tratar las URI SAF `content://` como identificadores opacos: no normalizarlas como rutas, no colapsar sus barras, no decodificar ni reordenar sus segmentos y conservar la codificación recibida.
- Diferenciar siempre la URI raíz `tree` (`/tree/`) de la URI de documento (`/document/`). La raíz representa el grant de la biblioteca; las lecturas y escrituras deben resolver un documento hijo real mediante SAF. Nunca enviar una URI `tree`, una ruta lógica o una URI sintética al comando que abre un archivo.
- Mantener separadas la ruta lógica visible de la biblioteca y la URI SAF real. Los nodos Android pueden exponer la URI de documento como identificador; al abrir un archivo, conservar esa URI durante la vida de la pestaña y usarla también para guardar, sin reemplazar la ruta lógica usada por pestañas, enlaces, búsqueda o estado.
- Validar en el límite toda URI y toda ruta lógica: exigir `content://`, autoridad válida, grant de árbol cuando corresponda y segmentos sin `.`/`..`, separadores embebidos ni traversal. Comprobar que el destino pertenece al árbol autorizado; nunca usar la raíz como fallback para una ruta anidada desconocida.
- Centralizar la resolución Android en los adaptadores SAF. Las cachés de ruta lógica a URI deben tener límite, invalidarse después de crear, renombrar, mover o eliminar, y descartar resultados obsoletos; preferir resolución lazy por subárbol y consultas acotadas frente a reconstrucciones recursivas completas.
- Solicitar y conservar permisos SAF de lectura y escritura cuando se selecciona una biblioteca. Traducir la revocación (`SecurityException`), cancelación, suspensión y pérdida de foco en errores recuperables que permitan volver a seleccionar la biblioteca; no ocultar el error ni continuar con una URI vacía.
- Mantener contratos explícitos entre frontend, Rust y Kotlin para `directoryUri`, URI de documento y rutas lógicas. Si existe una fuente Kotlin y una copia Android generada, verificar su sincronización mediante el mecanismo del proyecto y no editar la copia manualmente salvo solicitud explícita.
- No registrar URI completas, grants, tokens ni contenido privado. Los diagnósticos solo pueden indicar presencia, tipo, autoridad anonimizada o longitudes seguras.
- Incorporar regresiones para preservar URI `content://`, distinguir tree/document, resolver archivos abiertos desde el árbol, guardar usando la URI real, invalidar cachés y manejar permisos revocados o URI inválidas.

## Contratos y límites

- Tratar toda entrada externa como no confiable y validarla en el límite correspondiente.
- Usar contratos tipados, serializables y estables entre capas.
- Mantener sincronizados consumidores y productores cuando cambien nombres, campos, eventos, comandos o respuestas.
- Preferir errores estructurados, seguros y accionables frente a strings ambiguos.
- Centralizar adaptadores de filesystem, red, almacenamiento, dispositivos y procesos externos.
- Mantener las operaciones largas cancelables, con timeout, cleanup y manejo explícito de resultados obsoletos.
- No mantener locks ni recursos críticos durante I/O lento o esperas asíncronas.
- No registrar secretos, credenciales, tokens, contenido privado ni payloads sensibles.

## Interfaz y experiencia de usuario

- Usar componentes funcionales, estado local cuando sea suficiente y estado compartido solo cuando exista una necesidad real.
- Respetar las reglas del framework, las dependencias reales de efectos y la serialización del estado global.
- Diseñar estados de carga, error, vacío, éxito, deshabilitado, foco y cancelación.
- Mantener HTML semántico, labels accesibles, foco visible y navegación completa por teclado.
- Toda acción esencial debe tener una alternativa visible para touch y no depender exclusivamente de hover, menú contextual, rueda, precisión del cursor o teclado físico.
- Verificar tamaños reducidos, textos largos, zoom, orientación, split-screen y teclado virtual cuando correspondan.

## Seguridad y rendimiento

- Aplicar mínimo privilegio y validar rutas, tamaños, extensiones, URLs, identificadores y límites.
- Impedir traversal, SSRF, inyección y renderizado de contenido no confiable.
- Usar escrituras atómicas cuando una interrupción pueda corromper datos.
- Medir antes de optimizar; no agregar cachés, concurrencia o memoización sin ownership, límites e invalidación claros.
- Evitar bloquear el hilo de interfaz, cargar colecciones completas innecesariamente o repetir I/O sin necesidad.
- Diseñar para conectividad intermitente, presión de memoria, pérdida de foco, suspensión y recuperación del proceso.

## Política permanente de rendimiento

- Antes de optimizar renders, memoria o I/O, registrar un baseline reproducible de tiempos, cantidad de operaciones, referencias relevantes y consumo aproximado; no aceptar una mejora basada únicamente en una intuición.
- Reducir el alcance de las suscripciones de estado: preferir selectores específicos y memoizados, evitar propagar estados globales o contextos monolíticos y no hacer que un cambio local invalide componentes no relacionados.
- Usar `useMemo`, `React.memo`, `useCallback`, `useDeferredValue` y `startTransition` únicamente cuando exista un cálculo, identidad o transición costosa demostrable; mantener dependencias completas y no ocultar cambios legítimos con comparadores incorrectos.
- Mantener structural sharing en árboles, colecciones y estados anidados: una actualización debe conservar las referencias de las ramas que no cambiaron para que la memoización de componentes pueda funcionar.
- Virtualizar o cargar de forma lazy las colecciones grandes. Un inventario lógico completo puede residir en un índice persistente y consultarse por lotes; no debe materializarse entero en el estado global o en la memoria de la interfaz sin una justificación contractual.
- Centralizar las lecturas de filesystem, red, almacenamiento, SAF, JNI y procesos externos en adaptadores con deduplicación de operaciones en vuelo y reutilización segura de resultados finalizados.
- Toda caché debe declarar propietario, clave, límite de memoria, política de expulsión, TTL o generación, invalidación y comportamiento ante errores. No crear cachés globales sin límite ni retener contenido completo cuando solo se necesitan metadatos.
- Invalidar la ruta, subárbol o generación mínima que corresponda a una mutación. Asociar cada resultado asíncrono a su generación y descartar respuestas obsoletas, canceladas o pertenecientes a otra biblioteca.
- Agrupar lecturas independientes, evitar recorridos recursivos completos repetidos y preferir sincronización incremental, lotes acotados e índices persistentes frente a reconstrucciones completas.
- En Android y SAF, considerar límites de memoria, tamaño de payloads JNI, coste de `readTree`, locks, suspensión, pérdida de foco, permisos revocados y recuperación. No realizar un recorrido recursivo completo para pintar una vista que puede cargarse por subárboles.
- Toda optimización debe conservar estados de carga, error, vacío, cancelación, foco y accesibilidad, además de los contratos de autorización, persistencia y concurrencia.
- Incorporar regresiones para identidad referencial, renders observables, deduplicación, TTL, invalidación, límites, cancelación, concurrencia, presión de memoria y resultados obsoletos cuando sea técnicamente viable.
- Registrar en la entrega el baseline, las métricas comparativas, las validaciones ejecutadas, las plataformas no disponibles y los riesgos pendientes; no afirmar validaciones manuales que no se hayan realizado.

## Pruebas

- Cada bug debe incluir una prueba de regresión cuando sea técnicamente viable.
- Probar comportamiento observable y contratos, no detalles incidentales de implementación.
- Priorizar pruebas deterministas de lógica pura, validadores, transformaciones, reducers y adaptadores.
- Cubrir éxito, errores, límites, cancelación, concurrencia y variantes de plataforma aplicables.
- No usar servicios reales ni secretos en pruebas unitarias.
- No eliminar ni debilitar aserciones para obtener un resultado verde.

## Documentación obligatoria

Después de cada desarrollo, funcionalidad, bugfix, refactor o cambio de contrato:

- Seguir el flujo definido en `AGENTS-DOC.md`.
- Actualizar `README-TECH.md` con el estado técnico real y `README.md` cuando cambie el comportamiento visible.
- Actualizar `FUNCIONALIDADES.md` si cambia el inventario de capacidades.
- Agregar una línea a `CHANGELOG.md` con fecha, hora, zona horaria y una explicación breve.
- Dejar constancia de validaciones ejecutadas y pendientes.

## Validación y entrega

- Ejecutar los comandos de lint, typecheck, build, formato y pruebas definidos por el proyecto en `README-TECH.md`, según el alcance del cambio.
- Para cambios multiplataforma, validar los targets disponibles y revisar las ramas no compiladas; declarar explícitamente lo que quede pendiente.
- No ejecutar builds de release, firma, publicación, instalación en dispositivos ni acciones destructivas sin solicitud explícita.
- Revisar el diff completo antes de entregar y eliminar logs temporales, comentarios obsoletos y archivos accidentales.
- No afirmar que algo funciona si no fue verificado.

## Definición de terminado

Un cambio está terminado cuando:

- satisface el comportamiento solicitado y sus casos límite razonables;
- conserva contratos, seguridad, accesibilidad y rendimiento esperados;
- incluye pruebas útiles y pasa las validaciones aplicables;
- tiene la documentación sincronizada según `AGENTS-DOC.md`;
- deja explícitos los riesgos, pendientes y validaciones no ejecutadas;
- mantiene un diff enfocado, legible y sin pisar cambios ajenos.
