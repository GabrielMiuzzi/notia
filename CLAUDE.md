# Guía general de trabajo

Este archivo define cómo trabajar en el repositorio. No contiene información específica del producto, funcionalidades concretas ni decisiones de arquitectura. Esas definiciones pertenecen a `README-TECH.md`; las reglas de documentación pertenecen a `AGENTS-DOC.md`.

## Antes de editar

- Revisar `git status`; todo cambio preexistente pertenece a la persona usuaria y debe preservarse.
- Consultar `README.md`, `README-TECH.md` `FUNCIONALIDADES.md` `CHANGELOG.md` y `AGENTS-DOC.md` antes de modificar comportamiento relevante.
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

### Frontera obligatoria entre Rust y React

- El backend Rust es la única fuente de verdad y debe contener **toda la lógica de la aplicación**: dominio, casos de uso, validaciones, autorización, coordinación, persistencia, acceso a archivos, integraciones y decisiones dependientes de plataforma.
- El frontend React es exclusivamente una **cáscara visual**. Su responsabilidad se limita a renderizar datos, capturar interacciones, mantener estado efímero de presentación y llamar a los comandos o contratos tipados del backend Rust.
- React no debe implementar, duplicar ni usar como fallback reglas de negocio, validaciones autoritativas, acceso directo a persistencia o filesystem, transformaciones de dominio ni flujos de coordinación. Que una validación mejore la experiencia visual no reemplaza la validación obligatoria en Rust.
- Toda operación que consulte, derive o modifique estado de la aplicación debe exponerse desde Rust mediante un contrato explícito. El frontend envía intención y datos de entrada, y representa la respuesta, el progreso o el error devueltos por el backend; no decide el resultado de la operación.
- Los hooks, servicios y stores TypeScript pueden coordinar únicamente comportamiento de interfaz —por ejemplo, apertura de modales, selección visual, foco, carga y mensajes de error—, pero no convertirse en una segunda capa de aplicación.
- Al crear o modificar un flujo existente, mover a Rust cualquier lógica funcional detectada en React y evitar añadir lógica nueva en TypeScript. Las excepciones puramente visuales deben ser evidentes, locales y no afectar datos, permisos ni resultados funcionales.

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

## Interfaz y experiencia de usuario

- Usar componentes funcionales, estado local cuando sea suficiente y estado compartido solo cuando exista una necesidad real.
- Respetar las reglas del framework, las dependencias reales de efectos y la serialización del estado global.
- Diseñar estados de carga, error, vacío, éxito, deshabilitado, foco y cancelación.
- Mantener HTML semántico, labels accesibles, foco visible y navegación completa por teclado.
- Toda acción esencial debe tener una alternativa visible para touch y no depender exclusivamente de hover, menú contextual, rueda, precisión del cursor o teclado físico.
- Verificar tamaños reducidos, textos largos, zoom, orientación, split-screen y teclado virtual cuando correspondan.

## Documentación obligatoria

Después de cada desarrollo, funcionalidad, bugfix, refactor o cambio de contrato:

- Seguir el flujo definido en `AGENTS-DOC.md`.
- Actualizar `README-TECH.md` con el estado técnico real y `README.md` cuando cambie el comportamiento visible.
- Actualizar `FUNCIONALIDADES.md` si cambia el inventario de capacidades.
- Agregar una línea a `CHANGELOG.md` con fecha, hora, zona horaria y una explicación breve.
- Dejar constancia de validaciones ejecutadas y pendientes.
