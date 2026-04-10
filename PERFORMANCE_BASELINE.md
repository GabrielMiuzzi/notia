# Performance Baseline

Este repo ahora expone una línea base liviana de performance para medir flujos clave sin depender de tooling externo.

## Qué se mide

- `app.bootstrap`
- `library.switch_load`
- `explorer.refresh_tree`
- `document.open`
- `graph.load_sources`
- `chat.submit_message`
- `chat.ai_reply`

Cada entrada guarda:

- nombre de la medición
- dispositivo detectado
- duración en milisegundos
- estado: `success`, `error` o `canceled`
- metadatos livianos como `viewKind`, `libraryId`, `nodeCount`, `fileCount` o `messageLength`

## Cómo usarlo

1. Abrí la app.
2. Si querés ver cada medición en consola:

```js
localStorage.setItem('notia.perfBaseline.console', '1')
location.reload()
```

3. Corré los escenarios base:

- arranque en frío
- cambio de librería
- refresh del explorer
- apertura de un `.inkdoc`
- carga del graph
- envío de mensaje en chat

4. Inspeccioná las métricas:

```js
window.__NOTIA_PERF_BASELINE_API__?.getEntries()
```

5. Si querés limpiar el buffer:

```js
window.__NOTIA_PERF_BASELINE_API__?.clearEntries()
```

## Notas

- La captura está habilitada por defecto y guarda solo una ventana acotada de entradas recientes.
- Si querés desactivarla por completo:

```js
window.__NOTIA_PERF_BASELINE_API__?.setEnabled(false)
```

- En modo desarrollo, React Strict Mode puede duplicar algunas mediciones ligadas al render inicial. Para comparar números finos, conviene usar una build de producción o al menos contrastar varias corridas.
