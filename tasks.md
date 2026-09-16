# Roles por biblioteca

> Estado de revisión: las tareas marcadas `[x]` fueron contrastadas con el código actual y las validaciones ejecutadas; las tareas `[ ]` requieren pruebas adicionales, validación manual o implementación pendiente.

## Objetivo

Agregar en **Configuraciones → Roles** una tabla con los roles de la biblioteca activa y, encima de la tabla, un input junto a un botón **Agregar rol** para crear roles nuevos.

Los roles deben persistirse en la base SQLite propia de cada biblioteca. Una biblioteca nueva debe comenzar con estos roles, en este orden:

1. `Owner`
2. `Family`
3. `Guest`

Esta tarea cubre el alta y la visualización de roles. La asignación de roles a usuarios se define en el apartado **Usuarios**; este apartado no incluye permisos, edición ni eliminación de roles.

## Contrato funcional

- La sección se llama exactamente **Roles** y aparece dentro del modal de **Configuraciones**.
- La tabla muestra los roles de la biblioteca activa.
- El formulario de alta se ubica arriba de la tabla e incluye:
  - un input etiquetado para escribir el nombre del rol;
  - un botón visible con el texto **Agregar rol**.
- Al agregar un rol válido, la tabla se actualiza sin cerrar el modal y el valor queda guardado en SQLite.
- Al cerrar y volver a abrir Configuraciones, el rol agregado continúa visible.
- Al cambiar de biblioteca, solo se muestran los roles de la biblioteca seleccionada.
- Los defaults `Owner`, `Family` y `Guest` se crean una única vez por biblioteca y no se duplican al reabrirla o reiniciar la aplicación.
- El nombre se normaliza quitando espacios al inicio y al final; no se aceptan nombres vacíos.
- No se aceptan duplicados ignorando mayúsculas/minúsculas y espacios periféricos.
- Los errores de validación, SQLite o biblioteca no disponible deben mostrarse en la sección y permitir reintentar.
- La acción debe funcionar con mouse, teclado y touch, con foco visible y labels accesibles.

## Alcance técnico

### 1. Modelo SQLite y migración

- [x] Incrementar la versión de esquema en `src-tauri/src/database.rs` mediante una migración idempotente.
- [x] Crear una tabla específica para roles, por ejemplo `library_roles`, con al menos:
  - `id` estable y único;
  - `name` no vacío;
  - timestamps de creación/actualización si son necesarios para el contrato del adaptador.
- [x] Agregar una restricción o índice único para impedir duplicados de nombre de forma insensible a mayúsculas/minúsculas.
- [x] Sembrar `Owner`, `Family` y `Guest` dentro de la migración o inicialización de cada biblioteca usando inserciones idempotentes.
- [x] Mantener la migración compatible con bases existentes, bases vacías y ejecuciones repetidas.
- [ ] Verificar que la misma migración se ejecute en escritorio y en el flujo SQLite/SAF de Android.
- [x] No guardar los roles en `localStorage`, `notiaConfig.json` ni en el estado React como fuente de verdad.

### 2. API nativa y servicio TypeScript

- [x] Definir DTOs serializables para listar roles y crear un rol, sin exponer rutas privadas ni detalles internos de SQLite.
- [x] Agregar comandos Tauri para:
  - listar los roles de la biblioteca activa;
  - crear un rol en la biblioteca indicada.
- [x] Reutilizar la apertura, migración y sincronización de la base existente en lugar de abrir una conexión paralela sin ownership claro.
- [x] Ejecutar el alta dentro de una operación SQLite segura y devolver errores estructurados para nombre inválido, duplicado, biblioteca inválida y fallo de almacenamiento.
- [x] En Android, sincronizar la copia temporal con la biblioteca mediante el adaptador existente después de una escritura exitosa.
- [x] Crear un servicio en `src/services/libraries` que encapsule los `invoke` y exponga tipos estables al frontend.
- [x] Recargar la lista desde SQLite después de crear el rol; no asumir que la inserción local equivale a persistencia confirmada.

### 3. Estado y ciclo de vida de la biblioteca

- [x] Cargar los roles al inicializar o cambiar la biblioteca activa, después de que la base haya sido inicializada.
- [x] Limpiar la lista anterior durante el cambio de biblioteca para evitar mostrar datos mezclados mientras carga la nueva.
- [x] Contemplar estados de carga, vacío inesperado, guardado, error y reintento.
- [x] Evitar escrituras o actualizaciones de estado obsoletas si la persona cambia de biblioteca mientras una operación asíncrona sigue pendiente.
- [x] Mantener una única fuente de verdad para el catálogo durante la sesión, derivada de la respuesta confirmada por SQLite.

### 4. Sección Roles en Configuraciones

- [x] Agregar `Roles` al tipo, listado y validación de secciones de `src/components/notia/SettingsModal.tsx`.
- [x] Renderizar el input y el botón encima de la tabla.
- [x] Renderizar una tabla semántica con caption accesible y una fila por rol.
- [x] Enviar el formulario tanto mediante el botón como con Enter en el input.
- [x] Deshabilitar el botón durante el guardado y cuando el input no contenga un nombre válido.
- [x] Mostrar el error cerca del formulario, conservar el texto para que pueda corregirse y no cerrar el modal.
- [x] Vaciar el input únicamente después de que SQLite confirme el alta.
- [x] Mantener el layout usable en modal angosto, orientación vertical/horizontal, split-screen y con teclado virtual abierto.
- [x] Respetar objetivos táctiles de al menos 48×48 CSS px y navegación completa por teclado.

### 5. Pruebas

- [x] Agregar pruebas Rust de migración: esquema nuevo, base existente, idempotencia y defaults exactos.
- [ ] Agregar pruebas Rust de repositorio/comandos: listado, alta válida, nombre vacío, espacios periféricos, duplicado case-insensitive y error de biblioteca.
- [x] Agregar pruebas del servicio TypeScript para serialización de payloads y propagación de errores estructurados.
- [ ] Agregar pruebas de UI del modal para defaults, listado, alta confirmada, Enter, botón deshabilitado, error visible y reintento.
- [ ] Verificar que cambiar de biblioteca no conserve roles de la biblioteca anterior.
- [x] Ejecutar las pruebas en memoria o con fixtures temporales; no usar una biblioteca real ni datos del usuario.

## Criterios de aceptación

- [x] **Configuraciones → Roles** existe y muestra una tabla.
- [x] Una biblioteca nueva muestra exactamente `Owner`, `Family` y `Guest` sin duplicados.
- [x] El input y **Agregar rol** aparecen arriba de la tabla.
- [ ] Al agregar `Child`, la tabla muestra `Child` y el rol sobrevive al cerrar/reabrir Configuraciones y reiniciar la aplicación.
- [x] ` child ` se guarda como `child` o `Child` según la normalización definida, pero no se permiten luego `CHILD` ni otra variante equivalente.
- [ ] Dos bibliotecas distintas mantienen catálogos independientes.
- [x] Un error de persistencia no deja el rol como guardado en la UI y ofrece reintentar.
- [ ] La funcionalidad es usable por teclado y touch, y los mensajes de error son accesibles.
- [ ] Las pruebas focalizadas y las validaciones del proyecto pasan sin debilitar aserciones existentes.

## Validación y documentación al implementar

- [x] Ejecutar las validaciones definidas en `README-TECH.md` para TypeScript, Rust y build según los targets afectados.
- [x] Revisar el diff completo y comprobar que la persistencia no se haya desviado a `localStorage` o configuración JSON.
- [x] Actualizar `README-TECH.md` con el esquema, migración, comandos, contratos, aislamiento por biblioteca, errores y pruebas ejecutadas.
- [x] Actualizar `README.md` y `FUNCIONALIDADES.md` porque cambia una funcionalidad visible.
- [x] Agregar una línea fechada a `CHANGELOG.md` siguiendo el formato del repositorio.
- [x] Dejar explícito qué validaciones de Android o de UI manual quedaron pendientes, si no pudieron ejecutarse.

## Fuera de alcance

- Autorización, permisos o control de acceso basado en roles.
- Editar nombres de roles.
- Eliminar roles.
- Sincronizar roles con servicios externos o entre bibliotecas.

---

# Usuarios por biblioteca

## Objetivo

Agregar en **Configuraciones → Usuarios** una tabla con los usuarios de la biblioteca activa y, encima de la tabla, un input junto a un botón **Agregar un usuario** para crear usuarios nuevos.

Cada usuario debe tener un rol asignado del catálogo de **Roles** y la relación debe persistirse en el SQLite propio de la biblioteca. Una biblioteca nueva debe comenzar con un único usuario default:

- Usuario: `Owner`
- Rol: `Owner`

El usuario `Owner` representa a la persona dueña de la aplicación y debe existir antes de permitir altas posteriores.

Esta tarea cubre el alta, el listado, la asignación inicial de roles, las contraseñas, la vinculación de Telegram y el acceso al Task Manager publicado. No incluye un sistema de permisos nuevo basado en roles.

## Contrato funcional

- La sección se llama exactamente **Usuarios** y aparece dentro del modal de **Configuraciones**.
- La tabla muestra los usuarios de la biblioteca activa y su rol asignado.
- El formulario de alta se ubica arriba de la tabla e incluye:
  - un input etiquetado para escribir el nombre del usuario;
  - un selector etiquetado para elegir un rol existente;
  - un botón visible con el texto **Agregar un usuario**.
- El selector de rol debe listar los roles persistidos, incluyendo `Owner`, `Family` y `Guest` cuando se trata de una biblioteca nueva.
- Al agregar un usuario válido, la tabla se actualiza sin cerrar el modal y el usuario queda guardado con el rol elegido.
- Al cerrar y volver a abrir Configuraciones, el usuario y su rol continúan visibles.
- Al cambiar de biblioteca, solo se muestran los usuarios de la biblioteca seleccionada.
- El usuario default `Owner` se crea una única vez por biblioteca y no se duplica al reabrirla o reiniciar la aplicación.
- El usuario `Owner` debe tener el rol `Owner` por defecto.
- No se puede crear un usuario sin rol asignado ni asignar un rol que no exista en la biblioteca.
- El nombre se normaliza quitando espacios al inicio y al final; no se aceptan nombres vacíos.
- No se aceptan usuarios duplicados ignorando mayúsculas/minúsculas y espacios periféricos.
- Los errores de validación, SQLite, rol inexistente o biblioteca no disponible deben mostrarse en la sección y permitir reintentar.
- La acción debe funcionar con mouse, teclado y touch, con foco visible y labels accesibles.

## Alcance técnico

### 1. Modelo SQLite y migración

- [x] Incrementar la versión de esquema de forma compatible con la migración de `library_roles`.
- [x] Crear una tabla específica para usuarios, por ejemplo `library_users`, con al menos:
  - `id` estable y único;
  - `name` no vacío;
  - `role_id` obligatorio con foreign key a `library_roles(id)`;
  - timestamps de creación/actualización si son necesarios para el contrato del adaptador.
- [x] Agregar una restricción o índice único para impedir usuarios duplicados de forma insensible a mayúsculas/minúsculas.
- [x] Sembrar el usuario `Owner` con el rol `Owner` mediante una inserción idempotente.
- [x] Garantizar que la migración cree primero los roles default antes de insertar el usuario default.
- [x] Mantener la foreign key activa y rechazar referencias a roles inexistentes.
- [x] Mantener la migración compatible con bases existentes, bases vacías y ejecuciones repetidas.
- [ ] Verificar que la misma migración se ejecute en escritorio y en el flujo SQLite/SAF de Android.
- [x] No guardar los usuarios ni sus roles asignados en `localStorage`, `notiaConfig.json` ni en el estado React como fuente de verdad.

### 2. API nativa y servicio TypeScript

- [x] Definir DTOs serializables para listar usuarios y crear un usuario con su `roleId`.
- [x] Devolver en el listado el identificador y nombre del rol para que la UI no tenga que resolver la relación con datos locales desactualizados.
- [x] Agregar comandos Tauri para listar usuarios con su rol y crear un usuario con un rol existente.
- [x] Reutilizar la apertura, migración y sincronización de la base existente en lugar de abrir una conexión paralela sin ownership claro.
- [x] Ejecutar el alta dentro de una operación SQLite segura y devolver errores estructurados para nombre inválido, duplicado, `roleId` inexistente, biblioteca inválida y fallo de almacenamiento.
- [x] En Android, sincronizar la copia temporal con la biblioteca mediante el adaptador existente después de una escritura exitosa.
- [x] Crear un servicio en `src/services/libraries` que encapsule los `invoke` y exponga tipos estables al frontend.
- [x] Recargar la lista desde SQLite después de crear el usuario; no asumir que la inserción local equivale a persistencia confirmada.

### 3. Estado y ciclo de vida de la biblioteca

- [x] Cargar usuarios y roles al inicializar o cambiar la biblioteca activa, después de que la base haya sido inicializada.
- [x] Limpiar las listas anteriores durante el cambio de biblioteca para evitar mostrar datos mezclados mientras carga la nueva.
- [x] Contemplar estados de carga, vacío inesperado, guardado, error y reintento.
- [x] Evitar escrituras o actualizaciones de estado obsoletas si la persona cambia de biblioteca mientras una operación asíncrona sigue pendiente.
- [x] Si se crean roles en la misma sesión, actualizar el selector de Usuarios únicamente con la respuesta confirmada por SQLite.

### 4. Sección Usuarios en Configuraciones

- [x] Agregar `Usuarios` al tipo, listado y validación de secciones de `src/components/notia/SettingsModal.tsx`.
- [x] Renderizar el input, selector de rol y botón encima de la tabla.
- [x] Renderizar una tabla semántica con caption accesible, nombre de usuario y rol.
- [x] Enviar el formulario tanto mediante el botón como con Enter en el input cuando exista un rol seleccionado.
- [x] Seleccionar `Owner` por defecto para el usuario default; para nuevas altas, seleccionar una opción válida sin inventar roles.
- [x] Deshabilitar el botón durante el guardado, cuando el nombre sea inválido o cuando no haya roles cargados.
- [x] Mostrar el error cerca del formulario, conservar los valores para que puedan corregirse y no cerrar el modal.
- [x] Vaciar el input y restablecer el selector únicamente después de que SQLite confirme el alta.
- [x] Mantener el layout usable en modal angosto, orientación vertical/horizontal, split-screen y con teclado virtual abierto.
- [x] Respetar objetivos táctiles de al menos 48×48 CSS px y navegación completa por teclado.

### 5. Pruebas

- [x] Agregar pruebas Rust de migración: tabla, foreign key, usuario default, orden de migraciones e idempotencia.
- [ ] Agregar pruebas Rust de repositorio/comandos: listado, alta válida, nombre vacío, espacios periféricos, duplicado, rol inexistente y error de biblioteca.
- [x] Verificar que el usuario default `Owner` siempre tenga el rol `Owner`, incluso al ejecutar la migración varias veces.
- [x] Agregar pruebas del servicio TypeScript para serialización de payloads y propagación de errores estructurados.
- [ ] Agregar pruebas de UI del modal para default, listado con rol, alta con cada rol, Enter, selector sin opciones, botón deshabilitado, error visible y reintento.
- [ ] Verificar que cambiar de biblioteca no conserve usuarios ni roles de la biblioteca anterior.
- [x] Ejecutar las pruebas en memoria o con fixtures temporales; no usar una biblioteca real ni datos del usuario.

## Criterios de aceptación

- [x] **Configuraciones → Usuarios** existe y muestra una tabla con nombre y rol.
- [x] Una biblioteca nueva muestra exactamente el usuario `Owner` con el rol `Owner`, sin duplicados.
- [x] El input, el selector de rol y **Agregar un usuario** aparecen arriba de la tabla.
- [ ] Al agregar `Ana` con rol `Family`, la tabla muestra `Ana — Family` y el registro sobrevive al cerrar/reabrir Configuraciones y reiniciar la aplicación.
- [x] No se puede agregar un usuario con nombre vacío, nombre duplicado o rol inexistente.
- [ ] Dos bibliotecas distintas mantienen usuarios y asignaciones de roles independientes.
- [x] Un error de persistencia no deja el usuario como guardado en la UI y ofrece reintentar.
- [ ] La funcionalidad es usable por teclado y touch, y los mensajes de error son accesibles.
- [ ] Las pruebas focalizadas y las validaciones del proyecto pasan sin debilitar aserciones existentes.

## Validación y documentación al implementar

- [x] Ejecutar las validaciones definidas en `README-TECH.md` para TypeScript, Rust y build según los targets afectados.
- [x] Revisar el diff completo y comprobar que la relación usuario-rol no se haya desviado a `localStorage` o configuración JSON.
- [x] Actualizar `README-TECH.md` con el esquema, migración, comandos, DTOs, foreign key, aislamiento por biblioteca, errores y pruebas ejecutadas.
- [x] Actualizar `README.md` y `FUNCIONALIDADES.md` porque cambia una funcionalidad visible.
- [x] Agregar una línea fechada a `CHANGELOG.md` siguiendo el formato del repositorio.
- [x] Dejar explícito qué validaciones de Android o de UI manual quedaron pendientes, si no pudieron ejecutarse.

## Fuera de alcance

- Autenticación o inicio de sesión.
- Autorización y aplicación de permisos según el rol.
- Sincronizar usuarios con servicios externos o entre bibliotecas.

## ContraseÃ±as de usuarios

### Contrato funcional

- Cada usuario debe tener una contraseÃ±a almacenada como hash de una sola vÃ­a; el valor original nunca se persiste ni se devuelve al frontend.
- Desde **Configuraciones → Usuarios** se debe poder establecer una nueva contraseÃ±a para cada usuario.
- La acciÃ³n debe solicitar contraseÃ±a y confirmaciÃ³n, y rechazar valores vacÃ­os, demasiado cortos o que no coincidan.
- La contraseÃ±a nunca debe aparecer en la tabla, logs, errores, DTOs de listado ni respuestas de alta.
- DespuÃ©s de guardar una contraseÃ±a, la UI solo debe informar que fue actualizada, sin mostrarla ni permitir recuperarla.
- Reemplazar la contraseÃ±a no debe cambiar el nombre, el rol ni el identificador del usuario.

### Persistencia y seguridad

- [x] Agregar a `library_users` una columna nullable `password_hash`; cuando no haya contraseÃ±a configurada debe quedar estrictamente en `NULL`, nunca en texto plano ni en string vacÃ­o.
- [x] Definir el flujo de inicializaciÃ³n de la contraseÃ±a de `Owner` sin introducir una contraseÃ±a conocida hardcodeada ni guardar un secreto en el repositorio. Si se requiere una contraseÃ±a inicial, solicitarla antes de completar el alta o marcar el usuario como pendiente de configuraciÃ³n.
- [x] Elegir un algoritmo de hashing resistente a fuerza bruta y con salt/salting administrado por una librerÃ­a criptogrÃ¡fica, documentando sus parÃ¡metros y polÃ­tica de actualizaciÃ³n.
- [x] Mantener la migraciÃ³n compatible con usuarios existentes y hacerla idempotente.
- [x] Generar el hash en el backend nativo y descartar el texto plano inmediatamente despuÃ©s del hashing; no delegar el hashing a SQLite ni a `localStorage`.
- [x] No devolver el hash ni detalles innecesarios del algoritmo en respuestas destinadas a la UI o mensajes de error.

### API y UI

- [x] Agregar un comando Tauri para actualizar la contraseÃ±a de un usuario por su identificador.
- [x] Recibir la contraseÃ±a Ãºnicamente en el comando de escritura y responder con un resultado de Ã©xito/error sin contraseÃ±a ni hash.
- [x] Exponer el comando desde el servicio TypeScript de usuarios con DTOs que nunca incluyan `password_hash`.
- [x] Incorporar por cada fila una acciÃ³n accesible **Establecer nueva contraseÃ±a**.
- [x] Usar controles `type=password`, permitir mostrar/ocultar el valor con una acciÃ³n accesible y evitar autocompletar una contraseÃ±a existente.
- [x] Validar longitud mÃ­nima, coincidencia entre contraseÃ±a y confirmaciÃ³n y lÃ­mites razonables de tamaÃ±o antes de invocar al backend.
- [x] Limpiar los campos despuÃ©s de una actualizaciÃ³n exitosa o al cancelar, y mostrar Ãºnicamente un estado de Ã©xito/error.

### Pruebas y aceptaciÃ³n

- [ ] Agregar pruebas Rust de migraciÃ³n para `password_hash`, compatibilidad con usuarios existentes e idempotencia.
- [ ] Agregar pruebas del comando para cambio exitoso, contraseÃ±a vacÃ­a, longitud invÃ¡lida, confirmaciÃ³n diferente, usuario inexistente y error de almacenamiento.
- [x] Verificar que la contraseÃ±a almacenada no sea igual al texto plano y que dos contraseÃ±as iguales puedan producir hashes distintos cuando el algoritmo use salt aleatorio.
- [ ] Verificar que el listado, logs y errores no contengan contraseÃ±as ni hashes.
- [ ] Verificar desde la UI que una contraseÃ±a vÃ¡lida se confirma y no se muestra nuevamente, y que un error no altera la contraseÃ±a anterior.
- [x] Documentar en `README-TECH.md` el algoritmo de hash, sus parÃ¡metros, la polÃ­tica de longitud, el flujo de actualizaciÃ³n y la garantÃ­a de que nunca se persiste texto plano.

## Eliminacion de usuarios

### Contrato funcional

- Cada fila de usuario debe mostrar un boton accesible **Eliminar usuario**.
- Al pulsarlo, la UI debe mostrar una confirmacion destructiva antes de borrar.
- El usuario `Owner` no se puede eliminar bajo ninguna circunstancia.
- La UI debe ocultar o deshabilitar la accion de eliminar para `Owner` y explicar el motivo de forma accesible.
- Un usuario distinto de `Owner` solo se elimina despues de una confirmacion explicita.
- Al confirmar, el usuario debe desaparecer de la tabla solo despues de que SQLite confirme el borrado.
- Cancelar la confirmacion no debe modificar datos ni limpiar la contrasena de otro usuario.
- Si el borrado falla, el usuario debe continuar visible y la UI debe mostrar un error accionable con opcion de reintento.

### Persistencia, API y seguridad

- [x] Agregar un comando Tauri para eliminar un usuario por su identificador.
- [x] Rechazar el borrado del usuario `Owner` tambien en el backend nativo; la proteccion no puede depender solo de la UI.
- [x] Validar que el usuario pertenezca a la biblioteca activa antes de eliminarlo.
- [x] Ejecutar el borrado dentro de una operacion SQLite segura y mantener la integridad referencial con roles y futuras relaciones.
- [x] No registrar nombres sensibles, contrasenas, hashes ni detalles innecesarios del usuario eliminado.
- [x] En Android, sincronizar la copia temporal con la biblioteca mediante el adaptador existente despues de un borrado exitoso.
- [x] Eliminar el registro de la fuente SQLite y recargar la lista confirmada; no mantenerlo solo fuera de la vista mediante un filtro local.

### UI y pruebas

- [x] Incorporar el boton **Eliminar usuario** por fila con foco visible, soporte de teclado y objetivo tactil adecuado.
- [x] Reutilizar el componente de confirmacion destructiva existente y usar un mensaje que identifique al usuario sin exponer la contrasena ni el hash.
- [x] Deshabilitar acciones mientras el borrado esta pendiente para evitar dobles operaciones.
- [ ] Agregar pruebas Rust para borrado exitoso, usuario inexistente, usuario de otra biblioteca y rechazo del usuario `Owner`.
- [ ] Agregar pruebas de UI para boton visible, confirmacion, cancelacion, borrado confirmado, error y reintento.
- [ ] Verificar que borrar otro usuario no afecte a `Owner`, sus roles ni el resto de los usuarios.
- [ ] Verificar que un reinicio de la aplicacion no recupere un usuario eliminado.

## Cambio de nombre de usuarios

### Contrato funcional

- Cada fila de usuario debe ofrecer una accion accesible **Cambiar nombre**.
- La accion debe permitir ingresar un nuevo nombre y confirmarlo sin modificar el `id`, el rol ni la contrasena del usuario.
- El nombre se normaliza quitando espacios al inicio y al final; no se aceptan nombres vacios.
- No se aceptan nombres duplicados ignorando mayusculas/minusculas y espacios perifericos.
- El cambio debe aplicarse tambien al usuario `Owner`; la proteccion de `Owner` solo impide eliminarlo.
- La tabla debe mostrar el nuevo nombre despues de la confirmacion de SQLite.
- Si el guardado falla, se debe conservar el nombre anterior y mostrar un error accionable con opcion de reintento.

### Persistencia, API y UI

- [x] Agregar un comando Tauri para actualizar el nombre de un usuario por su identificador.
- [x] Validar en el backend que el usuario pertenezca a la biblioteca activa antes de modificarlo.
- [x] Reutilizar la restriccion/indice de unicidad de nombres y devolver un error estructurado para nombres duplicados.
- [x] Ejecutar el cambio dentro de una operacion SQLite segura y actualizar `updated_at` sin tocar `role_id` ni `password_hash`.
- [x] Recargar la lista desde SQLite despues de un cambio confirmado; no aplicar solo un cambio optimista local.
- [x] Incorporar la accion en cada fila, con foco visible, soporte de teclado y objetivo tactil adecuado.
- [x] Usar un formulario o dialogo accesible con el nombre actual, confirmacion y cancelacion.
- [x] Deshabilitar la accion mientras el guardado esta pendiente para evitar dobles operaciones.

### Pruebas y criterios de aceptacion

- [ ] Agregar pruebas Rust para cambio exitoso, nombre vacio, espacios perifericos, duplicado, usuario inexistente y usuario de otra biblioteca.
- [x] Verificar que cambiar el nombre no modifique el identificador, rol, hash de contrasena ni pertenencia a la biblioteca.
- [ ] Agregar pruebas de UI para abrir la accion, confirmar, cancelar, error y reintento.
- [x] Verificar que el usuario `Owner` pueda cambiar de nombre pero siga siendo imposible de eliminar.
- [ ] Verificar que el nombre nuevo sobreviva al cierre/reapertura de Configuraciones y al reinicio de la aplicacion.

---

# Asociacion de Telegram con usuarios

## Objetivo

Retirar el sistema actual de validacion de acceso de Telegram basado en `authorizedPeer`/`pendingPeer` y asociar cada cuenta de Telegram con un usuario persistido en la biblioteca.

Cuando una persona escriba al bot de Telegram, el bot debe pedir el nombre de usuario de Notia. Si ese usuario existe:

1. Si no tiene contrasena configurada, el bot pide una nueva contrasena, la guarda como hash de una sola via en el usuario y asocia esa cuenta de Telegram.
2. Si ya tiene contrasena configurada, el bot pide la contrasena existente, la verifica contra el hash y asocia la cuenta solo si coincide.

La conversacion de vinculacion debe completarse antes de procesar consultas, documentos, audio, fotos o comandos protegidos.

## Contrato funcional

- Un chat de Telegram no asociado recibe una respuesta que solicita el nombre de usuario de Notia.
- El nombre se normaliza igual que en Configuraciones y se busca solo dentro de la biblioteca activa.
- Si el usuario no existe, el bot informa un error generico y no revela que nombres existen.
- Si el usuario existe y no tiene contrasena, el bot solicita una contrasena nueva y una confirmacion; al confirmarla, actualiza el hash y asocia el Telegram.
- Si el usuario ya tiene contrasena, el bot solicita esa contrasena; nunca la persiste en texto plano.
- Una contrasena incorrecta no crea la asociacion ni cambia el hash existente.
- Una vez asociada, la identidad de Telegram queda vinculada al usuario de Notia y las solicitudes posteriores se ejecutan en el contexto de ese usuario.
- Una cuenta de Telegram ya asociada no puede vincularse a otro usuario sin un flujo explicito de revocacion/reasignacion.
- Un usuario no puede tener asociaciones ambiguas que permitan que una misma cuenta de Telegram pertenezca a dos usuarios.
- La vinculacion debe expirar o cancelarse despues de un tiempo acotado y reiniciarse con `/start` o una accion equivalente.
- Mientras espera usuario, contrasena o confirmacion, el bot no debe interpretar el mensaje como una consulta normal.
- El bot no debe repetir ni mostrar contrasenas en sus respuestas, logs, telemetria o mensajes de error.
- El sistema debe conservar los limites actuales de tamano, frecuencia y tipos de contenido de Telegram.

## Persistencia SQLite

- [x] Agregar a `library_users` los campos nullable `telegram_user_id` y `telegram_chat_id`; ambos deben quedar vacios hasta completar el enlace.
- [x] Crear restricciones unicas para que un `telegram_user_id` solo pueda pertenecer a un usuario y un usuario solo pueda tener una identidad de Telegram asociada.
- [x] Persistir `telegram_chat_id` junto con `telegram_user_id` para permitir mensajes proactivos del bot en futuras iteraciones.
- [x] Mantener la asociacion en el SQLite de la biblioteca, no en preferencias JSON ni `localStorage`.
- [x] Ejecutar el alta de hash y asociacion dentro de una operacion SQLite atomica: no debe quedar una contrasena nueva sin asociacion confirmada ni una asociacion apuntando a un hash fallido.
- [x] Al eliminar un usuario, limpiar sus campos Telegram dentro de la misma eliminacion y revocar sus sesiones mediante una politica explicita y probada.
- [x] Al cambiar el nombre de un usuario, conservar sus campos Telegram; nunca usar el nombre como identificador persistente.
- [x] Al cambiar la contrasena desde Configuraciones, conservar los campos Telegram y hacer que la nueva contrasena sea la usada en futuras vinculaciones/verificaciones.
- [ ] Verificar migraciones en escritorio y Android/SAF, incluyendo bases existentes sin tabla de asociaciones.

## Flujo del bot y backend

- [x] Eliminar la dependencia funcional del flujo actual de `authorizedPeer` y `pendingPeer` en preferencias de Telegram.
- [x] Retirar o adaptar de **Configuraciones → Telegram** el panel de autorizacion manual y las acciones **Autorizar**/**Revocar acceso** que ya no correspondan al nuevo modelo.
- [x] Mantener en Configuraciones solo la configuracion del bot y un estado seguro/resumido de asociaciones, sin mostrar hashes ni secretos.
- [x] Implementar una maquina de estados por chat para `requiere_usuario`, `requiere_contrasena_nueva`, `confirma_contrasena_nueva`, `requiere_contrasena_existente`, `asociado`, `cancelado` y `bloqueado/limite`.
- [x] Mantener el estado temporal de la conversacion con vencimiento, limpieza al cancelar y aislamiento por `chat_id`/identidad de Telegram.
- [x] Resolver el usuario por nombre normalizado y verificar su pertenencia a la biblioteca activa antes de cualquier escritura.
- [x] Reutilizar el mismo algoritmo de hash y verificacion definido para `library_users`; no implementar un segundo formato de contrasena en Telegram.
- [x] No guardar la contrasena temporal en disco, preferencias, SQLite ni logs; mantenerla solo durante el paso necesario para derivar/verificar el hash.
- [x] Aplicar limites de intentos, enfriamiento y mensajes genericos para evitar enumeracion de usuarios y ataques de fuerza bruta.
- [x] Hacer que `/start` reinicie de forma segura un flujo pendiente sin alterar una asociacion existente.
- [x] Definir un comando de cancelacion y limpiar el estado temporal sin modificar el usuario.
- [x] Asegurar que los mensajes, audio, fotos y documentos recibidos durante el flujo no lleguen al agente ni a los modulos de Finanzas hasta completar la asociacion.
- [x] Definir la respuesta cuando el bot no tenga biblioteca activa, SQLite no este disponible o la migracion falle.

## Servicio y contratos

- [x] Agregar DTOs tipados para resolver usuario, iniciar vinculacion, verificar/establecer contrasena y consultar el estado de una asociacion, sin incluir hashes.
- [x] Separar la identidad externa de Telegram del `library_user_id`; el nombre visible es mutable y no debe viajar como clave interna.
- [x] Convertir errores internos de SQLite y hashing a mensajes genericos y accionables para Telegram, sin filtrar si el usuario existe ni detalles criptograficos.
- [x] Actualizar `src/services/telegram/telegramRuntime.ts` y los contratos nativos para transportar las respuestas necesarias sin exponer secretos.
- [x] Garantizar cancelacion, timeout y limpieza cuando llega un nuevo mensaje, se reinicia el bot, cambia la biblioteca o se revoca la configuracion del token.

## Pruebas

- [ ] Agregar pruebas de migracion SQLite para tabla, foreign keys, unicidad, idempotencia y bases existentes.
- [ ] Agregar pruebas de flujo para usuario inexistente, usuario sin contrasena, confirmacion correcta, confirmacion distinta, usuario con contrasena, contrasena correcta e incorrecta.
- [ ] Verificar que una contrasena incorrecta no cambie el hash ni cree la asociacion.
- [ ] Verificar que el alta de hash y asociacion sea atomica ante fallos intermedios.
- [ ] Verificar que una identidad de Telegram no pueda asociarse a dos usuarios y que dos identidades permitidas no mezclen sus contextos.
- [ ] Verificar expiracion, cancelacion, reintentos, limite de intentos, `/start`, cambio de biblioteca y reinicio del proceso.
- [ ] Verificar que durante la autenticacion pendiente no se ejecuten herramientas de IA ni procesamiento de documentos.
- [ ] Verificar que los logs, respuestas y DTOs no contengan contrasenas, hashes ni informacion que permita enumerar usuarios.
- [ ] Cubrir la eliminacion y renombrado de usuarios, y el cambio de contrasena desde Configuraciones, conservando o invalidando la asociacion segun la politica definida.

## Criterios de aceptacion

- [x] El sistema deja de depender del boton **Autorizar** del flujo anterior para validar acceso al bot.
- [x] Un Telegram nuevo recibe primero la solicitud de usuario.
- [x] Un usuario existente sin contrasena puede definirla desde el bot y queda asociado automaticamente al finalizar.
- [x] Un usuario existente con contrasena debe demostrarla antes de asociar el Telegram.
- [x] La contrasena queda almacenada unicamente como hash de una sola via dentro del usuario de SQLite.
- [x] La asociacion queda almacenada en SQLite y sobrevive al reinicio de la aplicacion.
- [x] Una cuenta de Telegram ya asociada no puede tomar control de otro usuario.
- [x] Usuario inexistente, contrasena incorrecta, timeout y errores de almacenamiento producen mensajes seguros y no procesan la consulta protegida.
- [x] Las asociaciones siguen el `user_id` aunque cambie el nombre del usuario.
- [ ] Las pruebas de Rust, TypeScript y Telegram pasan; las validaciones manuales de conversaciones y Android quedan registradas si no se ejecutan.

## Bloqueo obligatorio de Telegram sin cuenta asociada

- Ninguna identidad de Telegram sin asociacion valida puede interactuar con el bot fuera del flujo de enlace.
- Todo mensaje, comando, audio, foto, documento, callback o nota de voz de una identidad no asociada debe detenerse antes de llegar al agente, Finanzas, herramientas, memoria o cualquier otra operacion de Notia.
- La unica respuesta permitida para una identidad no asociada es continuar, reiniciar o cancelar el flujo de enlace; no se debe ejecutar la intencion original del mensaje.
- El bot debe iniciar el flujo obligatorio solicitando el usuario de Notia cuando no exista una asociacion para el `telegram_user_id`/`chat_id` recibido.
- Un flujo incompleto, cancelado, vencido o fallido mantiene bloqueado al Telegram y exige comenzar nuevamente el enlace.
- La asociacion solo se considera valida despues de confirmar atomicamente usuario, contrasena/hash y vinculo Telegram en SQLite.
- El bloqueo debe aplicarse en el backend/nucleo de procesamiento, no solo en la interfaz o en el texto de respuesta del bot.
- [x] Agregar un guard central previo al procesamiento de updates que resuelva la asociacion y corte cualquier update no autorizado.
- [x] Aplicar el guard a mensajes de texto, `/start`, comandos, callbacks, audio, fotos, documentos y reintentos de procesamiento.
- [x] Permitir unicamente las acciones de onboarding/cancelacion definidas mientras el estado sea no asociado o pendiente.
- [ ] Agregar pruebas que demuestren que una cuenta no asociada nunca ejecuta IA, Finanzas, descargas, transcripcion, herramientas ni escritura de datos aunque envie un comando o documento valido.
- [ ] Agregar pruebas de asociacion exitosa que demuestren que el primer procesamiento normal ocurre solo despues del vinculo confirmado.
- [ ] Agregar pruebas de timeout, cancelacion, contrasena incorrecta, usuario inexistente, reinicio del proceso y asociacion eliminada, verificando que el bloqueo se conserve.
- [ ] Incorporar este requisito como criterio de aceptacion de la validacion manual del bot.

---

# Autenticacion del Task Manager publicado

## Objetivo

El Task Manager publicado mediante URL publica debe autenticar usando los usuarios y contrasenas del nuevo sistema de la biblioteca. Se debe descartar el sistema anterior de usuarios de publicacion y la contrasena separada del tablero.

El formulario de acceso publico debe solicitar unicamente:

- Usuario de Notia.
- Contrasena del usuario de Notia.

La validacion debe consultar el usuario de la biblioteca publicada y verificar su `password_hash` con el mismo mecanismo criptografico definido para `library_users`.

## Contrato funcional

- La URL publica solicita usuario y contrasena del nuevo sistema de usuarios.
- Un usuario existente con contrasena correcta puede iniciar sesion si esta habilitado para acceder a la publicacion.
- Un usuario inexistente, sin contrasena configurada o con contrasena incorrecta no obtiene acceso.
- La contrasena vacia nunca permite iniciar sesion en la URL publica.
- El acceso debe resolverse por `user_id`, no por un nombre persistido de forma permanente; el nombre solo se usa para localizar al usuario durante el login.
- Cambiar el nombre del usuario no invalida sus sesiones ni rompe su acceso, salvo que la politica de sesiones defina explicitamente lo contrario.
- Cambiar la contrasena debe invalidar las sesiones o credenciales derivadas que la politica de seguridad determine, y las nuevas sesiones deben verificar el nuevo hash.
- El usuario `Owner` conserva las mismas reglas: puede acceder si tiene contrasena valida, pero no puede eliminarse.
- La URL publicada no debe solicitar ni conservar una segunda contrasena exclusiva del Task Manager.

## Retiro del sistema anterior

- [x] Eliminar `accessUsers`, `PublishedAccessUser` y la configuracion de usuarios propia de la publicacion como fuente de autenticacion.
- [x] Eliminar la `passwordHash` global o separada de la publicacion/tablero cuando solo servia para validar el acceso publico.
- [x] Retirar del formulario publicado el campo **Contrasena del tablero** y su logica de `remember` asociada.
- [x] Retirar la generacion, persistencia, aprobacion y revocacion de credenciales del sistema anterior que ya no sean necesarias.
- [x] Revisar la UI de **Configuraciones → Publicar** para eliminar controles que administraban usuarios o contrasenas duplicados.
- [x] Definir una migracion segura para publicaciones existentes: no copiar contrasenas antiguas a `library_users`; exigir que cada usuario tenga una contrasena configurada en el nuevo sistema antes de acceder.
- [x] No mantener un fallback silencioso al sistema anterior ni aceptar ambos mecanismos en paralelo.

## Backend, sesiones y seguridad

- [x] Resolver la biblioteca publicada desde el contexto nativo y abrir su SQLite antes de autenticar; no aceptar una ruta de biblioteca enviada por el navegador como fuente de verdad.
- [x] Implementar el login publicado contra `library_users`, validando `password_hash` en el host.
- [x] Emitir la sesion con el `user_id` autenticado y los alcances publicados permitidos; no transportar hashes al navegador ni al cliente remoto.
- [x] Aplicar autorizacion de operaciones usando el usuario autenticado, aunque la primera version solo tenga autenticacion y no permisos por rol.
- [x] Mantener mensajes genericos para usuario inexistente, usuario sin contrasena y contrasena incorrecta, evitando enumeracion.
- [x] Aplicar limites de intentos, backoff y expiracion de sesion; no registrar contrasenas, hashes ni tokens.
- [x] Invalidar sesiones cuando se revoca el acceso de la publicacion, se despublica la biblioteca o cambia una condicion de seguridad definida.
- [x] Garantizar que el flujo WebSocket/HTTP publicado use la misma identidad de sesion y no conserve un segundo mapa de credenciales.
- [x] Revisar la carga del bootstrap para no exponer `password_hash`, secretos, rutas locales ni credenciales del host.

## Cliente publicado y servicio

- [x] Actualizar el formulario de login generado por el Task Manager para pedir solo usuario y contrasena de usuario.
- [x] Ajustar los DTOs, endpoints, frames WebSocket y respuestas de error para eliminar campos de contrasena de tablero y usuarios de publicacion.
- [x] Eliminar el almacenamiento local de la antigua contrasena del tablero en IndexedDB o reemplazarlo por una politica explicita que no guarde credenciales sin solicitud.
- [x] Mostrar estados accesibles de cargando, credenciales invalidas, sesion expirada, acceso revocado, servidor no disponible y reintento.
- [x] Mantener los limites y controles de acceso existentes de la URL publica, sin convertir el nuevo usuario en una exposicion de datos de la biblioteca.

## Pruebas y criterios de aceptacion

- [ ] Agregar pruebas de login publicado con usuario y contrasena validos del nuevo sistema.
- [ ] Agregar pruebas para usuario inexistente, usuario sin contrasena, contrasena incorrecta, sesion expirada y usuario eliminado.
- [ ] Verificar que la contrasena antigua de publicacion y la contrasena de tablero ya no permitan acceso.
- [ ] Verificar que los campos, DTOs y respuestas ya no incluyan `boardPassword`, `passwordHash` de publicacion ni `accessUsers`.
- [ ] Verificar que el cambio de nombre conserve el acceso por `user_id` y que el cambio de contrasena use el hash nuevo.
- [ ] Verificar que no se filtren hashes, contrasenas, tokens, rutas locales ni detalles que permitan enumerar usuarios.
- [ ] Ejecutar pruebas de cliente, Rust y una prueba E2E de la URL publicada con al menos dos usuarios de la biblioteca.
- [ ] Validar manualmente login, logout, expiracion, revocacion, republicacion, reconexion WebSocket y acceso desde otro dispositivo.

## Fuera de alcance

- Crear un sistema de permisos nuevo basado en los roles; esta tarea reutiliza el rol existente y deja su aplicacion para una iteracion posterior.
- Mantener compatibilidad de login con las credenciales antiguas.

## Ajuste: alta de usuario sin contrasena

- Al crear un usuario, la contrasena es opcional y debe quedar en blanco por defecto.
- Un alta sin contrasena no debe generar ni guardar un hash ficticio: `password_hash` debe quedar estrictamente en `NULL`.
- La tabla debe mostrar el estado **Sin contrasena configurada** para esos usuarios, sin mostrar valores sensibles.
- El usuario nuevo debe poder utilizar la accion **Establecer nueva contrasena** despues de su alta.
- La confirmacion de contrasena y la validacion de longitud minima aplican unicamente cuando se intenta establecer una contrasena, no al crear el usuario.
- La migracion debe permitir usuarios existentes sin contrasena y no inventar una contrasena inicial para `Owner` ni para usuarios nuevos.
- Las pruebas deben cubrir alta con contrasena en blanco, persistencia del estado sin contrasena, alta posterior de una contrasena y rechazo de un hash ficticio.

### Criterios de aceptacion

- [x] Los usuarios distintos de `Owner` tienen un boton **Eliminar usuario**.
- [x] `Owner` no puede eliminarse aunque se invoque directamente el comando nativo.
- [x] La cancelacion deja el usuario intacto.
- [x] La confirmacion elimina el usuario de SQLite y de la tabla despues de una respuesta exitosa.
- [x] Un error de persistencia no elimina visualmente al usuario ni altera los demas registros.

---

# Decisiones confirmadas de alcance

Estas decisiones prevalecen sobre cualquier checklist anterior que las contradiga.

## Usuarios y bibliotecas

- `Owner` existe una vez por cada biblioteca porque la base SQLite vive dentro de cada biblioteca.
- El `id` del usuario `Owner` es reservado, estable e inmutable. La proteccion contra borrado no depende de que conserve el nombre visible `Owner`.
- El usuario `Owner` puede cambiar de nombre, pero no puede eliminarse.
- El usuario `Owner` se crea sin contrasena, igual que los usuarios nuevos. La contrasena se establece despues desde Configuraciones o durante el primer enlace autorizado de Telegram.
- Crear un usuario sin contrasena deja `password_hash` estrictamente en `NULL`; nunca se genera un hash ficticio ni se usa un string vacio.
- Solo se permite una cuenta de Telegram asociada por usuario de Notia.

## Hash de contrasenas

- Se reutiliza el formato y la implementacion PBKDF2-HMAC-SHA256 ya existente en el proyecto para la publicacion del Task Manager, incluidos sus parametros vigentes.
- No se introduce un segundo algoritmo de hash para Usuarios, Telegram o Task Manager publicado.
- Una contrasena vacia no se hashea y no permite autenticacion en Telegram ni en la URL publica.

## Telegram

- Cada bot/token de Telegram pertenece a una sola biblioteca. El runtime debe impedir o rechazar que el mismo bot se use simultaneamente en otra biblioteca.
- El enlace solo admite chats privados.
- La identidad persistente de Telegram es `telegram_user_id` y `telegram_chat_id` tambien queda persistido en `library_users` para futuras notificaciones proactivas.
- `telegram_chat_id` se usa para responder al chat privado actual y para futuros envios proactivos, pero no reemplaza a `telegram_user_id` como identidad ni habilita chats grupales.
- Una identidad de Telegram solo puede estar asociada a un usuario de la biblioteca.
- Un usuario de Notia solo puede tener una identidad de Telegram asociada.
- Es intencional que la primera persona que conozca el nombre de un usuario sin contrasena pueda establecer su primera contrasena mediante Telegram y completar el enlace.
- Configuraciones debe ofrecer **Desvincular Telegram**. Al desvincular, se revocan las sesiones relacionadas y el siguiente mensaje debe iniciar nuevamente el flujo de enlace.
- Eliminar un usuario revoca sus enlaces de Telegram y sus sesiones activas.
- Las asociaciones Telegram existentes del sistema anterior se descartan; no se convierten automaticamente en `Owner` ni en otro usuario.

## Task Manager publicado

- Cualquier usuario de la biblioteca con contrasena configurada puede acceder a la URL publica usando ese usuario y contrasena.
- No se aplican permisos nuevos basados en roles en esta iteracion.
- Se elimina completamente la aprobacion/revocacion de dispositivos del sistema anterior, ademas de `accessUsers`, la contrasena separada del tablero y sus hashes.
- Las sesiones activas del sistema anterior deben invalidarse al migrar/republicar; todos los clientes deben iniciar sesion con el nuevo sistema.
- Las credenciales antiguas se descartan y nunca se migran a `library_users`.

## Decisiones adicionales confirmadas

- El rol de un usuario se puede cambiar despues de crearlo desde Configuraciones.
- El usuario `Owner` debe conservar siempre el rol `Owner`; el backend debe rechazar cualquier intento de asignarle otro rol.
- El cambio de rol no modifica el `id`, el nombre, el `password_hash` ni las asociaciones de Telegram del usuario.
- Las contrasenas reutilizan los limites actuales del sistema de publicacion: minimo 8 y maximo 256 caracteres.
- Cambiar la contrasena de un usuario invalida sus sesiones activas del Task Manager publicado; las nuevas sesiones deben autenticarse con la nueva contrasena.
- Cambiar la contrasena no desvincula automaticamente la cuenta de Telegram asociada al usuario.
- [x] Agregar un comando Tauri para cambiar el rol de un usuario y rechazar en backend cualquier rol distinto de `Owner` para el usuario protegido.
- [x] Agregar en cada fila de Usuarios un selector o accion accesible para cambiar el rol, usando unicamente roles existentes y confirmando la persistencia en SQLite.
- [x] Validar en UI y backend contrasenas de 8 a 256 caracteres cuando se establecen o reemplazan.
- [x] Invalidar las sesiones publicadas del usuario despues de confirmar un cambio de `password_hash`, sin borrar su asociacion de Telegram.
- [ ] Agregar pruebas de cambio de rol, proteccion del rol `Owner`, limites 8/256, rechazo de valores fuera de rango e invalidacion de sesiones.
