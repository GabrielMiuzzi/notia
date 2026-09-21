# Estabilización integral del filesystem Android (SAF)

> Estado: implementación automatizada avanzada; quedan pendientes la validación manual en Android/Windows y varias comprobaciones de ciclo de vida y proveedor SAF. Este documento reemplaza los planes parciales anteriores y define el trabajo necesario para corregir el alta de bibliotecas y consolidar toda la frontera SAF Android sin regresiones en Windows.
>
> Contexto de reproducción confirmado: Lenovo Yoga Tab Plus, almacenamiento interno. La APK se ejecutó desde `npm run dev:android` y Android Studio después de las correcciones SAF previas. La versión exacta de Android y el proveedor DocumentsUI quedan pendientes de identificar.

## Incidente principal

En Android, desde **Administrar librerías → Agregar nueva librería**, el selector permite elegir una carpeta y confirmar **Usar esta carpeta**, pero la biblioteca no se agrega. El log disponible muestra `readTree`, seguido de `createPathEntry rootUri=` vacío y el rechazo `No se recibió una URI SAF válida.`.

El contrato que debe mantenerse es:

```text
Selección SAF (URI tree persistida)
  → selection.androidTreeUri
  → NotiaLibrary.androidTreeUri
  → filesystemEngine.directoryUri
  → payload.directory_uri Rust
  → android_saf.root_tree_uri
  → createPathEntry.rootUri Kotlin
```

La ruta lógica de una biblioteca Android conserva la URI tree `content://.../tree/...`; los documentos reales SAF son URI `content://.../document/...`. No se debe tratar una ruta sintética construida bajo una URI tree como si fuera un documento real.

### Seguimiento del incidente — 21 de septiembre de 2026

- **Causa confirmada:** en Tauri 2.10.3, `DirectoryPickerPlugin.runSaf` usaba `invoke.parseArgs(JSONObject::class.java)`. Jackson ignoraba las claves del payload y entregaba un objeto vacío, perdiendo `rootUri`, `segments` y `content`. La reproducción se ejecutó en JVM con Robolectric, el `Invoke` real y el mapper construido por `PluginManager` de Tauri.
- **Corrección focalizada:** `runSaf` usa `invoke.getArgs()`. `normalizeToDocumentUri` distingue `DocumentsContract.isDocumentUri(activity, uri)` de `isTreeUri` y convierte el tree puro con `getTreeDocumentId`, conservando documentos existentes sin inventar un grant tree para un documento puro. Los listados normalizan la URI antes de consultar `getDocumentId`. La fuente autoritativa sigue en `src-tauri/resources/directory-picker/android/DirectoryPickerPlugin.kt`; la copia generada se sincronizó únicamente mediante `build.rs`.
- **Regresión ejecutada:** `src-tauri/resources/directory-picker/tests/DirectoryPickerPluginTest.kt`, mediante `saf-tests.init.gradle`: antes del fix, 10 tests con **7 fallos**; después, **10 aprobados y 0 fallos**. Cubre conservación de los tres campos, tree puro, documento hijo, documento puro y consultas de `readTree`, `readDirectory` y `readFlatFileList` con un proveedor vacío de prueba.
- **Validaciones aprobadas:** compilación Kotlin normal `:app:compileArm64DebugKotlin --no-daemon`, `cargo check --target aarch64-linux-android` tras configurar explícitamente los compiladores y el archivador del NDK, y `git diff --check`.
- **Pendientes:** no se verificó el alta completa ni la escritura en un proveedor SAF real; no hay una APK validada para este fix ni validación manual en dispositivo. La comprobación completa de permisos por operación sigue pendiente y `pathExists` todavía captura errores y devuelve `false`. Este seguimiento no completa ninguna fase ni cierra el alcance restante de estabilización SAF.

## Objetivo

Dejar una única frontera SAF consistente, segura y observable para todas las operaciones de archivos Android:

- selección y persistencia de bibliotecas;
- lectura de árbol, directorio, inventario plano y archivos de texto/binarios;
- creación, escritura, borrado, renombrado, copia y movimiento;
- configuración `.notia/notiaConfig.json`, exportaciones y documentos financieros;
- permisos revocados, cachés obsoletas, suspensión, reinicio y recuperación;
- interacción touch y estados de error/reintento visibles.

Windows debe conservar los contratos y el comportamiento actuales. No se modifican ColdPass ni capacidades exclusivas de Windows.

## Criterios transversales

- [x] Conservar la URI SAF completa, incluida la doble barra de `content://`, sin normalizarla como ruta local.
- [ ] Validar datos externos en cada límite TypeScript, Rust y Kotlin; rechazar URI vacía, no `content://`, rutas fuera del grant, traversal y segmentos inválidos.
- [x] Usar URI tree únicamente como grant raíz y URI document únicamente para I/O sobre una entrada existente.
- [x] No registrar URI completas, contenido de archivos ni credenciales. Los diagnósticos solo pueden registrar presencia, tipo, tamaño, hash no reversible o códigos de error seguros.
- [ ] No ocultar errores SAF devolviendo una colección vacía; preservar un error recuperable hasta la interfaz con una acción visible de reintento.
- [ ] Centralizar el mapeo ruta lógica ↔ URI document, con caché limitada, invalidación de subárbol, TTL, resultados obsoletos y permisos revocados explícitos.
- [ ] No asumir que una operación concluyó tras suspensión, destrucción de Activity o revocación de permiso; comunicar el resultado verificable al volver.
- [x] Mantener operaciones esenciales accesibles con touch, teclado y mouse; no depender de clic derecho, hover ni precisión del puntero.

## Fase 0 — Línea base, trazabilidad y sincronización de artefactos

- [x] Revisar el diff preexistente y no sobrescribir cambios ajenos; identificar qué partes de la frontera SAF ya fueron modificadas y cuáles siguen siendo inconsistentes.
- [x] Verificar que `src-tauri/resources/directory-picker/android/DirectoryPickerPlugin.kt` sea la fuente autoritativa y que la copia bajo `src-tauri/gen/android/...` coincida exactamente antes de construir.
- [x] Confirmar el recorrido real de `npm run dev:android`, Android Studio y Gradle para asegurar que la APK instalada contiene el plugin y Rust actuales; documentar cómo comprobar la versión/build sin exponer datos privados.
- [x] Añadir instrumentación temporal, segura y acotada para distinguir: URI ausente en selector, pérdida de `androidTreeUri` en frontend, pérdida de `directoryUri` en payload, `root_tree_uri` vacío en Rust y `rootUri` vacío en Kotlin.
- [ ] Eliminar o reducir la instrumentación diagnóstica antes de entrega, conservando solo logs seguros y accionables.
- [ ] Registrar baseline reproducible: flujo de alta, cantidad de invocaciones SAF (`readTree`, `createPathEntry`), resultado y mensajes de error sin URI completa.

## Fase 1 — Corrección del alta de biblioteca SAF

- [x] Inspeccionar y corregir la propagación completa `pickDirectoryTree → pick_android_directory_tree → filesystemEngine → libraryRuntime → LibraryManagerModal → ensureLibraryConfigExists → create_library_file`.
- [x] Exigir que una selección Android válida entregue una única URI tree no vacía y `content://`; no continuar si `path` y `uri` son inconsistentes.
- [x] Asegurar que `NotiaLibrary.path` y `NotiaLibrary.androidTreeUri` conserven el contrato definido, incluso tras serialización, Redux, cambio de biblioteca y reinicio de WebView.
- [x] Asegurar que la creación inicial de `.notia/notiaConfig.json` pase explícitamente el grant raíz a Rust y Kotlin, sin depender de que `readTree` descubra primero `.notia`.
- [x] Crear de forma idempotente `.notia` y `notiaConfig.json` desde la raíz seleccionada, sin sobrescribir una configuración compatible existente y rechazando colisiones de tipo.
- [x] Mantener el modal abierto ante cancelación o error, restaurar el estado de carga y mostrar un mensaje recuperable; cerrarlo únicamente cuando la configuración y el alta persistida finalicen correctamente.
- [x] Añadir regresiones TypeScript para URI ausente, URI preservada, payload de creación con `directoryUri`, configuración existente, configuración ausente y error recuperable del backend.
- [x] Añadir pruebas Rust puras para derivación de segmentos relativos, coincidencia de raíz exacta, rechazo de rutas fuera del grant y propagación del error original.

## Fase 2 — Contrato único de URI, rutas y cachés SAF

- [x] Definir y aplicar un contrato único para claves de caché: ruta lógica bajo la URI tree normalizada y URI document real como valor; no usar URI sintéticas como destinos de I/O.
- [x] Corregir la normalización y unión de rutas para `content://`, barras finales, backslashes, caracteres codificados y prefijos; no permitir coincidencias por prefijo ambiguas entre bibliotecas.
- [x] Revisar `resolve_entry_uri`, `resolve_android_tree_uri`, `roots`, `paths` y LRU para que una ruta desconocida nunca se resuelva erróneamente a la raíz.
- [x] Sembrar la URI document devuelta por una creación y actualizar/invalidate solo las claves afectadas; preservar entradas hermanas válidas.
- [x] Establecer límites verificables para TTL, capacidad LRU, profundidad y traversal; descartar respuestas asociadas a otra biblioteca, a una generación obsoleta o a un permiso revocado.
- [x] Evitar recorridos recursivos completos para pintar directorios expandibles; usar `readDirectory` para subárboles y reservar `readTree`/inventario plano para consumidores que realmente lo requieren.
- [ ] Añadir regresiones para aislamiento de dos bibliotecas, rutas sintéticas, URI document directa, rutas anidadas desconocidas, invalidación selectiva y resultados obsoletos.

## Fase 3 — Operaciones SAF de lectura y escritura

- [x] Revisar y completar el contrato Kotlin/Rust para `readTree`, `readDirectory`, `readFlatFileList`, `readFile`, `readFileBinary`, `writeFile`, `statEntry`, `createEntry`, `createPathEntry`, `deleteEntry`, `renameEntry`, `copyEntry` y `moveEntry`.
- [ ] Normalizar URI tree a URI document antes de abrir streams o consultar hijos, y comprobar permisos de lectura/escritura antes de cada operación relevante. Reabierto el 21 de septiembre: normalización corregida y cubierta por regresiones JVM; sigue pendiente la comprobación completa de permisos por operación.
- [x] Corregir texto y binarios para que Base64 se decodifique exactamente una vez; verificar Markdown UTF-8, PDF, DOCX e imágenes sin corrupción ni escritura literal de Base64.
- [x] Mantener la semántica de creación: contenido inicial solo en archivo nuevo; no truncar un archivo compatible existente; limpiar best-effort un destino nuevo si falla su contenido inicial.
- [x] Hacer que creación binaria/exportación cree el destino dentro del grant cuando falta, con validación de padre y nombre, y devuelva el error específico si no puede hacerlo.
- [x] Verificar éxito de borrado, renombrado, copia y movimiento; rechazar duplicados, mover una carpeta dentro de sí misma, operaciones fuera del árbol y proveedores que no soporten la operación.
- [ ] Propagar el detalle seguro de errores del plugin a Rust y TypeScript; no sustituir un permiso revocado, URI inválida o proveedor rechazado por `[]`, `false` o un mensaje genérico. Reabierto el 21 de septiembre: `pathExists` todavía captura errores y devuelve `false`.
- [ ] Añadir pruebas Kotlin unitarias cuando el proyecto lo permita, y pruebas Rust/TypeScript para los contratos serializados de cada comando.

## Fase 4 — Consumidores del filesystem y recuperación visible

- [ ] Auditar todos los consumidores TypeScript de `filesystemEngine`, incluidos explorador, apertura/guardado de documentos, configuración, inventario/búsqueda, Task Manager, memoria del agente, exportación Markdown y extracción financiera.
- [ ] Asegurar que cada llamada Android reciba el `androidDirectoryUri` correcto de la biblioteca dueña, nunca el URI de una subcarpeta o de otra biblioteca.
- [ ] Corregir los flujos que capturan errores de lectura y devuelven `[]`, de modo que la UI diferencie carpeta vacía de fallo SAF y permita reintentar.
- [ ] Ofrecer en el explorador acciones táctiles visibles para crear, renombrar, mover, copiar, pegar, eliminar y reintentar, conservando mouse, teclado y menú contextual de Windows.
- [x] Revisar exportación PDF/DOCX para Android: seleccionar un destino permitido, crear el documento SAF cuando corresponda, escribir bytes mediante la frontera común y mostrar resultado/error verificable.
- [ ] Revisar extracción financiera: leer el binario mediante la frontera SAF común, aplicar límites de tamaño/memoria y conservar errores recuperables sin registrar ni mutar entidades automáticamente.
- [ ] Verificar que `.notia`, archivos del agente, inventario y archivos de usuario usan el mismo contrato y no generan recorridos completos repetidos.

## Fase 5 — Permisos, ciclo de vida y persistencia Android

- [x] Revisar la persistencia del grant con `takePersistableUriPermission`, flags realmente concedidos y tratamiento de `SecurityException`/permiso revocado.
- [ ] Definir la recuperación al volver desde suspensión, cambio de aplicación, bloqueo/desbloqueo, reinicio de proceso y revocación/reconcesión de permisos.
- [ ] Invalidar de forma segura caches y referencias en memoria al recuperar, sin borrar archivos de usuario ni afirmar éxito de operaciones interrumpidas.
- [ ] Revisar la base SQLite Android relacionada con bibliotecas: identidad estable por URI grant, migración al inicializar, temporales, reemplazo recuperable/atómico y limpieza tras fallos.
- [ ] Validar que Finanzas, usuarios, roles e inventario sobreviven a reinicio y a una interrupción durante sincronización sin pérdida silenciosa.
- [ ] Añadir pruebas deterministas de validadores, transiciones de estado y recuperación donde no se requiera un proveedor SAF real.

## Fase 6 — Validación automatizada y de plataforma

- [ ] Ejecutar las pruebas dirigidas TypeScript/Rust/Kotlin de los módulos modificados y añadir regresiones por cada bug corregido.
- [x] Ejecutar `npx tsc --noEmit`, `npm run lint`, `npm test -- --run`, `npm run build -- --minify=false`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, `cargo check --manifest-path src-tauri/Cargo.toml --tests` y `git diff --check`.
- [ ] Compilar una APK debug actual con el flujo documentado, sin firmar, publicar ni instalar automáticamente.
- [ ] Validar manualmente en la Lenovo Yoga Tab Plus: seleccionar almacenamiento interno, agregar biblioteca, cerrar/reabrir aplicación, cambiar de app, bloquear/desbloquear y retirar/reconceder permiso.
- [ ] Validar manualmente lectura, creación de carpetas/notas, guardado, renombrado, copia, movimiento, eliminación, exportación PDF/DOCX y error/reintento en Android.
- [ ] Validar Windows para apertura de modales, selección de bibliotecas, árbol, edición, exportación y operaciones de archivos afectadas.
- [ ] Registrar proveedor SAF y versión Android al ejecutar QA; si no están disponibles, declararlos como limitación explícita.

## Fase 7 — Cierre y documentación

- [ ] Revisar el diff final completo, eliminar diagnósticos temporales y confirmar que no se modificaron artefactos generados salvo mediante el flujo de build correspondiente.
- [ ] Actualizar los checkboxes de este archivo solo después de implementar y validar cada tarea.
- [ ] Invocar al subagente `documentador` al completar las fases técnicas, entregándole cambios, archivos modificados, validaciones aprobadas, pruebas manuales realizadas y pendientes.
- [ ] Esperar y revisar el resultado de `documentador`; no editar directamente `README.md`, `README-TECH.md`, `FUNCIONALIDADES.md` ni `CHANGELOG.md`.

## Criterios de aceptación

- [ ] En Android, una selección SAF válida crea/reutiliza `.notia/notiaConfig.json`, agrega la biblioteca y no recibe `rootUri` vacío.
- [x] Ninguna operación SAF usa una URI tree sintética como URI document de I/O.
- [ ] Las operaciones de lectura, texto, binarios, creación, escritura, borrado, renombrado, copia, movimiento y exportación tienen errores recuperables y no corrompen datos.
- [ ] La UI distingue un directorio vacío de un fallo SAF y ofrece reintento accesible con touch.
- [ ] Revocar permisos, suspender, reiniciar o cambiar de biblioteca no causa pérdida silenciosa ni cruza datos entre grants.
- [ ] Las pruebas automatizadas aplicables pasan y las validaciones manuales no ejecutadas quedan declaradas.
- [ ] Windows conserva su comportamiento en los flujos compartidos.
