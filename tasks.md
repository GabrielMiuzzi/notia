1. Centralizar logs y eliminar ruido de debug.
   Hay `console.log`, `console.warn`, `console.error` y `println!` repartidos por filesystem, runtime de librerías, settings, picker Android y shell principal; conviene un logger con niveles y flags de entorno para no ensuciar runtime ni debugging.

2. Escalonar mejor la carga inicial por librería.
   Al cambiar de librería se disparan varias tareas juntas como config, explorer, chat structure, graph y estados auxiliares; conviene priorizar lo visible primero y diferir lo secundario para que la app “se sienta” más rápida.

3. Unificar contratos frontend/backend para operaciones de filesystem.
   Los payloads y resultados están bastante repartidos entre TypeScript y Rust; centralizar tipos, errores y validaciones va a hacer más fácil evolucionar Desktop y Android sin abrir regresiones.

4. Revisar scripts y artefactos de desarrollo para dejar el repo más limpio.
   Conviene ordenar scripts, documentar variables de entorno, revisar la copia/runtime de Drawio, confirmar que los artefactos generados no ensucien el flujo diario y dejar un setup de desarrollo más predecible.

5. Corregir el autosave de InkDoc para que reintente de verdad ante fallos.
   Hoy `DocumentSyncEngine` consume el guardado pendiente antes de confirmar la escritura y `InkDocView` absorbe errores de persistencia; hay que reencolar el save, propagar el error y evitar que un fallo transitorio deje cambios sin reintento hasta la próxima edición.

6. Reactivar el autosave de texto después de errores transitorios de filesystem o SAF.
   En markdown y texto, una tab que cae en `saveStatus: 'error'` sale del scheduler automático; conviene agregar estrategia de retry o backoff, y reanudar guardado sin obligar al usuario a volver a escribir para destrabarlo.

7. Unificar estados de guardado y feedback de persistencia entre Markdown, InkDoc y Drawio.
   InkDoc no expone hoy la misma semántica de `saving/error` ni el mismo feedback visible que los otros editores; hace falta un contrato común de persistencia, indicadores consistentes en la UI y manejo parejo de errores al guardar o cerrar pestañas.
