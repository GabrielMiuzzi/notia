1. Crear un índice incremental para búsqueda y graph sources.
   Hoy la búsqueda y el grafo vuelven a leer y procesar muchos archivos; conviene mantener un índice por librería y refrescar solo archivos modificados en vez de recalcular todo cada vez.

2. Bajar renders innecesarios en chat, graph y shell principal.
   `ChatWorkspaceView.tsx`, `GraphView.tsx` y `NotiaMenu.tsx` concentran muchos efectos y estados cruzados; hay que mover trabajo a hooks dedicados, usar transiciones diferidas donde corresponda y evitar cascadas de re-render.

3. Centralizar logs y eliminar ruido de debug.
   Hay `console.log`, `console.warn`, `console.error` y `println!` repartidos por filesystem, runtime de librerías, settings, picker Android y shell principal; conviene un logger con niveles y flags de entorno para no ensuciar runtime ni debugging.

4. Agregar una suite mínima de tests automatizados.
   Hoy no se ve una batería real de tests de app; hacen falta tests para engines puros, filesystem, Android SAF, graph, task-manager e InkDoc, además de smoke tests de flujos críticos.

5. Escalonar mejor la carga inicial por librería.
   Al cambiar de librería se disparan varias tareas juntas como config, explorer, chat structure, graph y estados auxiliares; conviene priorizar lo visible primero y diferir lo secundario para que la app “se sienta” más rápida.

6. Unificar contratos frontend/backend para operaciones de filesystem.
   Los payloads y resultados están bastante repartidos entre TypeScript y Rust; centralizar tipos, errores y validaciones va a hacer más fácil evolucionar Desktop y Android sin abrir regresiones.

7. Revisar scripts y artefactos de desarrollo para dejar el repo más limpio.
   Conviene ordenar scripts, documentar variables de entorno, revisar la copia/runtime de Drawio, confirmar que los artefactos generados no ensucien el flujo diario y dejar un setup de desarrollo más predecible.
