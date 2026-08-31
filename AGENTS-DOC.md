# Documentación

El canal de Telegram personaliza el prompt del agente para evitar Markdown y envía las respuestas con el subconjunto HTML compatible de Telegram. Esta regla no se aplica al chat principal, los chats laterales ni Meeting.

Finanzas es un scope del mismo runtime común. No recibe documentos de la biblioteca como contexto y expone únicamente herramientas financieras tipadas y la aclaración al usuario; no ofrece reglas, memorias, documentos ni Task Manager durante una carga financiera. Chat interno y Telegram comparten los mismos servicios financieros, estados y persistencia; el canal solo cambia formato e historial efímero. Las fotos autorizadas de Telegram se descargan mediante un comando nativo acotado a 4 MB y entran al mismo agente como adjuntos de imagen; el update se checkpointa antes de descargar para impedir un ciclo de reprocesamiento si el WebView termina inesperadamente. El agente clasifica cada imagen antes de mutar. Ante un ticket legible, `create_finance_purchase` busca o crea automáticamente una categoría, guarda compra, líneas, precios y gasto. Ante un recibo de sueldo, `create_finance_salary` guarda período, empleador, importes, conceptos y evidencia, y crea el ingreso neto sin categoría. Ante un resumen de tarjeta, `create_finance_credit_card_statement` guarda emisor, período, cierre, vencimiento, saldos y líneas; crea gastos únicamente para consumos/cargos y concilia pagos/créditos, sin convertir el total a pagar en otro gasto. Las tres herramientas auto-confirman en Telegram, deduplican y producen un resultado terminal determinista; se mantiene la aclaración de cuenta cuando no puede inferirse razonablemente. El bridge mantiene hasta diez solicitudes pendientes, por lo que un álbum o varias fotos sucesivas se procesan secuencialmente y no se descartan mientras otra espera respuesta.

La sección **Configuraciones → Finanzas** expone la única operación de borrado total del módulo. `finance_clear_all_data` vacía atómicamente todas las entidades financieras de la biblioteca activa después de una confirmación destructiva, conserva esquema y migraciones, sincroniza SAF cuando corresponde y notifica a las vistas montadas para recargarse.

La inicialización del agente garantiza también `.agent/memory/rules.md` y `.agent/memory/memory.md` en cada biblioteca, creando únicamente los elementos faltantes.
También crea `.agent/skills/` si no existe.
Las reglas permanentes detectadas en una conversación se escriben directamente en `NOTIA_IA_RULES` sin confirmación; esta excepción no se extiende a documentos, tickets ni otras mutaciones del usuario.
Las correcciones generadas por validadores se agregan como instrucciones internas de sistema, nunca como mensajes del usuario. No pueden crear reglas o memorias; la inicialización elimina del bloque aprendido cualquier corrección interna conocida que hubiera quedado persistida por versiones anteriores.
Los hechos personales y contextos duraderos pertenecen a `.agent/memory/memory.md`, no a `NOTIA_IA_RULES`. Toda modificación interna de reglas aprendidas o memorias programa una reorganización conjunta en background mediante el Ollama configurado, que puede reclasificar elementos sin alterar `NOTIA_DEFAULT_RULES`.
Telegram usa HTML limitado y un formateador defensivo; el runtime común recupera llamadas XML heredadas únicamente cuando coinciden con herramientas nativas disponibles.

## Capacidad de voz offline

La frontera pública de voz vive en `src/services/speech/` y `src-tauri/src/commands/speech.rs`; los componentes no invocan Tauri directamente. Captura, worker ASR, runtime dinámico, repositorio de modelos y diarización son servicios Rust separados. Windows y Android conservan el mismo contrato, con permiso/empaquetado Android detrás de `mobile_speech_permission` y `build.rs`.

Los eventos `speech://state`, `speech://partial` y `speech://segments` se filtran por `sessionId` y todo listener requiere cleanup. No registrar audio/transcripciones, aceptar rutas nativas desde la UI ni marcar modelos como instalados sin tamaño y SHA-256 válidos.

La documentación es un entregable obligatorio de cada cambio de código. No se considera una tarea completa hasta que la documentación refleje fielmente el estado actual del sistema.

### Reglas generales

1. **Documentación sincronizada**: todo PR o conjunto de cambios debe ir acompañado de la actualización correspondiente en los archivos de documentación. Nunca dejar `README.md` ni `README-TECH.md` desactualizados respecto al código.

2. **Dos audiencias, dos documentos**:
   - **`README.md`**: orientado a usuarios finales y analistas funcionales. Debe explicar qué hace la app, cómo usarla y qué valor aporta cada feature.
   - **`README-TECH.md`**: orientado a ingenieros de software. Debe explicar arquitectura, integración, decisiones técnicas y cómo extender el sistema.

### Contenido obligatorio de README.md

- Descripción funcional de la aplicación y sus módulos.
- Guía de uso paso a paso para cada feature.
- **Si hay controllers/endpoints**: incluir por cada feature los endpoints, headers, body necesario y detalle de consumo en lenguaje funcional (qué hace, cuándo usarlo, ejemplos simples).
- Requisitos de sistema e instalación.
- Configuración de entorno (variables, settings, preferencias).
- FAQ o troubleshooting desde la perspectiva del usuario.

### Contenido obligatorio de README-TECH.md

- **Documentación general**: descripción técnica del servicio, stack de tecnologías, cómo levantar el proyecto en local, variables de entorno relevantes y decisiones arquitectónicas.
- **Documentación específica de flujos**: para cada flujo modificado o agregado, detallar:
  - Endpoints, headers y body necesarios, con detalle de consumo técnico (método, path, query, request/response).
  - **Ejemplos JSON obligatorios (backend)**: para cada endpoint que reciba o devuelva JSON, incluir el ejemplo completo del request body y del response body en bloques de código JSON. No omitir campos; mostrar la estructura real con valores representativos.
  - Entradas y salidas (tipos, formatos, contratos).
  - Validaciones aplicadas.
  - Pasos del proceso (secuencia lógica).
  - Comportamiento ante errores y casos límite.
  - Dependencias con otros módulos.
- **Diagramas en Mermaid**: agregar diagramas obligatoriamente. La granularidad depende del tipo de sistema:
  - **Backend (servicios con controllers/endpoints)**: generar los diagramas **por cada controller/funcionalidad**.
  - **Frontend (aplicaciones con vistas/páginas)**: generar los diagramas **por cada vista/funcionalidad**.
  - En ambos casos, cada unidad (controller o vista) debe tener su propio conjunto de diagramas separados, nunca mezclados en uno solo.
  - Diagramas requeridos por unidad:
    - Un diagrama de flujo específico.
    - Un diagrama de arquitectura (componentes/relaciones) específico.
    - Un diagrama de secuencia específico.
  - Diagramas generales del sistema:
    - Flujos de proceso (diagramas de flujo).
    - Secuencias entre componentes (diagramas de secuencia).
    - Arquitectura del sistema y relaciones entre módulos (diagramas de componentes/despliegue).
    - Modelos de datos relevantes (diagramas de clases/ER).
    - Acoplamiento y cohesión entre módulos (diagramas UML de paquetes/componentes).

### Reglas de formato

- Usar bloques de código ` ```mermaid ` para todos los diagramas.
- Asegurar que los diagramas sean legibles y estén actualizados con el código.
- Emplear nomenclatura consistente con el resto del proyecto (nombres de módulos, servicios, tipos).

### Reglas de existencia

> **Regla:** Si `README.md` o `README-TECH.md` no existen en el repositorio, deben crearse inmediatamente con la información mínima requerida antes de considerar finalizada cualquier tarea de desarrollo.

### Informe de cohesión vs acoplamiento

`README-TECH.md` debe incluir una sección titulada **"Informe de cohesión vs acoplamiento"** con un análisis detallado del estado actual del sistema. El informe debe contener:

1. **Resumen ejecutivo**: valoración general del nivel de cohesión y acoplamiento del sistema (alto/medio/bajo para cada uno).
2. **Análisis por módulo/capa**: para cada capa o módulo relevante (controllers, services, common, models, etc.):
   - Nivel de cohesión (funcional, secuencial, comunicacional, etc.).
   - Nivel de acoplamiento con otros módulos (de datos, de control, de contenido, etc.).
   - Observaciones y riesgos identificados.
3. **Diagrama de dependencias**: un diagrama Mermaid que visualice las dependencias reales entre módulos, destacando acoplamientos fuertes.
4. **Métricas cualitativas**:
   - ¿Cada módulo tiene una única responsabilidad clara?
   - ¿Existen dependencias circulares?
   - ¿Hay módulos que conozcan la implementación interna de otros?
   - ¿Los cambios en un módulo impactan a otros módulos?
5. **Recomendaciones**: acciones concretas para mejorar la cohesión o reducir el acoplamiento, si aplica.

> **Regla:** este informe debe actualizarse con cada cambio estructural significativo (nueva capa, nuevo módulo, refactorización de dependencias).

### Informe de arquitectura

`README-TECH.md` debe incluir una sección titulada **"Informe de arquitectura"** que analice globalmente la salud estructural del sistema. El informe debe contener:

1. **Complejidad ciclomática**:
   - Evaluar funciones críticas (comandos de Tauri, servicios, lógica de negocios en Rust y TypeScript).
   - Identificar funciones con complejidad alta (>10) y proponer extracción o refactorización.
   - Incluir ejemplos de funciones refactorizables y su posible división.

2. **Modularidad**:
   - Análisis de la separación de responsabilidades entre capas (`components/`, `services/`, `engines/`, `commands/`, `filesystem/`).
   - Evaluación de la reutilización de módulos (si existen duplicaciones o abstracciones compartidas).
   - Medición del acoplamiento aferente/eferente (qualitativo) por módulo.
   - Identificación de "módulos Dios" o archivos que concentran demasiada lógica.

3. **Escalabilidad arquitectónica**:
   - Evaluación de cuellos de botella actuales (ej: main thread, polling, watchers).
   - Capacidad de agregar nuevas features sin modificar código existente (Open/Closed Principle).
   - Facilidad para agregar nuevos commands de Tauri, nuevos tipos de documento, nuevas vistas o nuevos backends de IA.
   - Recomendaciones concretas para mejorar la escalabilidad horizontal (nuevos módulos) y vertical (renderizado, performance).

> **Regla:** este informe debe actualizarse cada vez que se agregue un módulo de negocio nuevo, se refactorice una capa o se identifique un cuello de botella de performance.

### Informe de calidad de código

`README-TECH.md` debe incluir una sección final titulada **"Informe de calidad de código"** que evalúe de forma continua el estado del código del proyecto. El informe debe contener:

1. **Legibilidad del código**:
   - Uso consistente de naming conventions (sección 6 de AGENTS.md).
   - Clarity sobre intención vs implementación (nombres descriptivos, funciones cortas).
   - Uso apropiado de comentarios (solo "por qué", no "qué").
   - Formato y estilo consistente (linting, formatting).

2. **Mantenibilidad**:
   - Facilidad para localizar y modificar funcionalidades.
   - Ausencia de código muerto o dependencias no utilizadas.
   - Evolución de la deuda técnica (lista de items conocidos y plan de mitigación).
   - Facilidad de onboarding para nuevos desarrolladores/agentes.

3. **Testabilidad**:
   - Porcentaje de código en `engines/` y `utils/` (puro/sin side-effects) vs código acoplado a UI o Tauri.
   - Identificación de bloques de código que requieren mocking excesivo.
   - Plan para aumentar la cobertura de pruebas unitarias y de integración.

4. **Observabilidad**:
   - Instrumentación existente (performance baselines, logging, eventos).
   - Facilidad de diagnóstico de errores en producción y Android (logcat).
   - Métricas clave expuestas (duraciones, tasa de errores, tamaño de estado).

5. **Clean code y principios SOLID**:
   - Análisis del cumplimiento de los 5 principios SOLID en las capas críticas (services, commands, components).
   - Evaluación de DRY, KISS y separación de responsabilidades.
   - Identificación de violaciones conocidas (ej: commands con lógica de negocio, componentes con state duplicado) y plan de corrección.

> **Regla:** este informe debe actualizarse con cada refactorización significativa, eliminación de deuda técnica o introducción de nuevos patrones de código.

> **Regla general de sincronización:** los tres informes (cohesión vs acoplamiento, arquitectura y calidad de código) son entregables obligatorios de `README-TECH.md` y deben mantenerse actualizados con cada cambio estructural significativo (nueva capa, nuevo módulo, refactorización de dependencias o resolución de deuda técnica).
