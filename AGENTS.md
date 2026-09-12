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
- Resolver la causa raíz sin ocultar errores ni alterar contratos sin justificación.
- Aplicar KISS, YAGNI y DRY con criterio; tolerar duplicación pequeña antes que una abstracción incorrecta.
- Mantener alta cohesión y bajo acoplamiento.
- Separar presentación, coordinación, dominio, persistencia e infraestructura según la arquitectura documentada en `README-TECH.md`.
- Usar nombres precisos, funciones cortas y efectos secundarios explícitos.
- Evitar código muerto, valores mágicos, casts amplios, estados imposibles y abstracciones de una sola implementación sin una frontera real.
- No editar artefactos generados, dependencias vendorizadas ni archivos derivados salvo solicitud explícita.

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
