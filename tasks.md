# Auditoría funcional y uso diario de Finanzas

> Estado: plan nuevo, todavía no iniciado.

## Objetivo

Revisar si las relaciones actuales del módulo de Finanzas representan de forma útil y comprensible la información registrada, y convertir esos datos en una experiencia práctica para el control diario de gastos y ahorro.

El módulo no pretende ser una contabilidad exacta ni conciliar saldos bancarios. Las cuentas continuarán funcionando como etiquetas de origen/destino: efectivo, bancos, billeteras y tarjetas pueden quedar incompletos o no coincidir con la realidad. La aplicación debe priorizar una carga sencilla, relaciones explícitas y métricas honestas antes que una falsa precisión.

## Decisiones confirmadas

- Finanzas es información sensible y solo debe estar disponible dentro del contexto `#Confidencial`.
- El Owner conserva el acceso completo que ya le corresponde; no se amplía el acceso a otros contextos.
- Las cuentas no mantendrán un saldo conciliable. Solo identificarán el origen o destino declarado de un movimiento.
- No se agregará sincronización bancaria ni se intentará inferir dinero disponible real.
- Las prioridades de uso diario son:
  1. control de gastos;
  2. control de ahorro.
- La carga rápida debe ser más importante que la precisión contable absoluta.
- Telegram debe usar las mismas reglas de relación, cálculo y clasificación que la interfaz.
- Las consultas financieras locales deben seguir resolviéndose con datos locales y no con búsqueda web.
- ARS y USD deben mantenerse separados en totales, gráficos, comparaciones y porcentajes.
- Los datos registrados, documentados, conciliados y derivados deben poder distinguirse visualmente.
- Este plan reemplaza el plan anterior de fecha de carga y reconciliación de servicios; sus cambios ya existentes en el código deben conservarse.

## Principios y límites del modelo

- SQLite por biblioteca continúa siendo la fuente de verdad.
- Las cuentas son etiquetas, no libros contables ni saldos.
- Las reservas de ahorro sí conservan saldo acumulado mediante su saldo inicial y movimientos confirmados.
- Un gasto confirmado no equivale necesariamente a un gasto documentado o conciliado.
- Un ticket, un resumen de tarjeta, una factura y una ocurrencia de servicio pueden aportar evidencia distinta del mismo hecho; no deben duplicar el gasto.
- Pagos y créditos de tarjeta no son gastos de servicios.
- El total a pagar de un resumen no debe registrarse como un gasto adicional.
- Los movimientos descartados no participan de las métricas principales.
- Los movimientos pendientes deben quedar visibles como pendientes y no mezclarse silenciosamente con los confirmados.
- Las relaciones ambiguas no se aplican automáticamente.
- Las métricas no deben llamarse “saldo disponible” si no existe un saldo real conciliable.
- No se guardarán prompts, respuestas completas de modelos, secretos ni contenido privado en logs.

## Relaciones que deben auditarse

1. **Movimiento → cuenta, categoría, comercio y servicio**
   - La cuenta representa origen o destino declarado.
   - La categoría representa clasificación del gasto o ingreso.
   - El comercio y el servicio son relaciones opcionales y deben poder distinguirse de una descripción libre.

2. **Ticket → compra → movimiento**
   - Verificar cuándo el ticket crea o reutiliza un gasto.
   - Detectar tickets sin movimiento, movimientos sin ticket y duplicados.
   - Mantener líneas y totales sin duplicar el importe.

3. **Resumen de tarjeta → líneas → movimientos**
   - Los consumos y cargos pueden generar gastos individuales.
   - Pagos y créditos deben quedar como conciliación del resumen, no como gastos.
   - El total a pagar nunca debe duplicar la suma de consumos.
   - Las relaciones con servicios deben conservar el período del resumen y su evidencia.

4. **Servicio → ocurrencia → factura → gasto**
   - Distinguir servicio activo, ocurrencia esperada, ocurrencia pagada, factura y gasto vinculado.
   - Mostrar cuándo falta evidencia o cuándo existe una propuesta ambigua.
   - Evitar que una factura por sí sola cree un gasto genérico.

5. **Sueldo → ingreso → ahorro**
   - Verificar si el sueldo registrado participa correctamente en los indicadores de ahorro.
   - Separar ingreso cobrado, sueldo documentado y dato usado en un cálculo.

6. **Reserva → movimientos de ahorro**
   - Separar aportes, retiros, rendimientos, pérdidas y ajustes.
   - Diferenciar ahorro del período de saldo acumulado de la reserva.
   - Evitar contar un aporte como gasto común o un retiro como ingreso.

7. **Inversión/valuación → patrimonio**
   - Distinguir valuación patrimonial de dinero disponible.
   - Indicar el origen y la fecha de cada valuación.

8. **Cuotas → compromisos futuros**
   - Verificar qué representa una cuota generada y cómo aparece frente al gasto original.
   - Evitar contar el total de una compra en cuotas y cada cuota como gastos independientes si el modelo no lo pretende.

## Fase 1 — Auditoría funcional y matriz de relaciones

- [ ] Inventariar las entidades financieras, sus campos de relación y sus consumidores en UI, servicios, Rust y tools de IA.
- [ ] Crear una matriz de relaciones con cardinalidad, fuente de verdad, datos derivados, relaciones opcionales y estados ambiguos.
- [ ] Identificar qué relaciones se crean automáticamente, cuáles requieren selección explícita y cuáles solo son sugerencias.
- [ ] Verificar que los DTO TypeScript y Rust representen las mismas relaciones y estados.
- [ ] Documentar las reglas vigentes de gastos confirmados, pendientes, corregidos y descartados.
- [ ] Documentar cómo se separan ARS y USD en cada cálculo.
- [ ] Revisar la relación entre tickets y movimientos para localizar duplicaciones, ausencias y reintentos.
- [ ] Revisar la relación entre resúmenes, líneas, movimientos, pagos y créditos.
- [ ] Revisar la relación entre servicios, ocurrencias, facturas, propuestas y gastos.
- [ ] Revisar la relación entre sueldos, ingresos, ahorro y evolución salarial.
- [ ] Revisar la relación entre reservas, movimientos de ahorro, intercambios y movimientos vinculados.
- [ ] Revisar la relación entre inversiones, valuaciones, patrimonio y fechas de corte.
- [ ] Revisar la relación entre planes de cuotas, cuotas y movimientos.
- [ ] Crear fixtures aislados con relaciones completas, incompletas, duplicadas y ambiguas.
- [ ] Registrar los casos donde no debe inferirse ninguna relación.

## Fase 2 — Reglas de dominio para gastos y ahorro

- [ ] Crear transformaciones puras para obtener gastos registrados por día, semana, mes y categoría.
- [ ] Excluir movimientos descartados y separar los pendientes de los confirmados.
- [ ] Definir el tratamiento de movimientos corregidos sin contar dos veces el mismo hecho.
- [ ] Mantener los totales y comparaciones separados por moneda.
- [ ] Crear una transformación pura para aportes, retiros, rendimientos, pérdidas y ajustes de ahorro.
- [ ] Calcular por separado ahorro del período, variación neta y saldo acumulado de cada reserva.
- [ ] Definir qué dato de ingreso se usa para porcentajes de ahorro y mostrar cuando no exista suficiente información.
- [ ] Impedir que movimientos de ahorro se mezclen como gastos o ingresos ordinarios sin una regla explícita.
- [ ] Crear un resultado tipado para métricas incompletas, relaciones ambiguas y datos insuficientes.
- [ ] Evitar nombres engañosos como “saldo disponible”, “dinero restante” o equivalentes cuando no exista conciliación real.
- [ ] Verificar que los cálculos no dependan de la búsqueda web ni de cotizaciones externas para el control básico de gastos y ahorro.
- [ ] Agregar pruebas deterministas de límites, monedas, estados, fechas, duplicados y ausencia de relaciones.

## Fase 3 — Resumen diario de Finanzas

- [ ] Revisar la estructura actual de `FinanceView`, `FinanceDashboard` y `FinanceRecordsPanel` para priorizar acciones diarias sobre información secundaria.
- [ ] Diseñar un resumen con vistas diaria, semanal y mensual.
- [ ] Mostrar gastos recientes y acumulados por categoría.
- [ ] Mostrar las categorías con mayor consumo y su variación frente al período comparable cuando existan datos suficientes.
- [ ] Mostrar aportes y retiros de ahorro del período.
- [ ] Mostrar el saldo acumulado de reservas separado del ahorro generado durante el período.
- [ ] Mostrar movimientos pendientes de confirmar o corregir.
- [ ] Mostrar gastos sin categoría, sin evidencia o con relaciones incompletas.
- [ ] Mostrar una indicación clara de cobertura: cantidad de datos registrados y limitaciones conocidas.
- [ ] Evitar presentar métricas derivadas como saldos reales de cuentas.
- [ ] Mantener accesos visibles a registrar gasto y registrar movimiento de ahorro.
- [ ] Mantener estados de carga, vacío, error, carga parcial, datos incompletos y actualización.
- [ ] Verificar uso con ancho reducido, touch, teclado, foco visible y textos largos.

## Fase 4 — Carga rápida y uso cotidiano

- [ ] Diseñar un flujo breve para registrar un gasto con importe, fecha, descripción, categoría opcional y cuenta-origen opcional.
- [ ] Usar la fecha actual y valores recientes como sugerencias, sin convertirlos en relaciones obligatorias.
- [ ] Permitir corregir categoría, cuenta o fecha antes de confirmar.
- [ ] Diseñar un flujo breve para registrar un aporte, retiro, rendimiento, pérdida o ajuste de ahorro.
- [ ] Mostrar la reserva y moneda seleccionadas antes de confirmar.
- [ ] Mantener los formularios detallados de tickets, sueldos, resúmenes y cuotas como flujos avanzados.
- [ ] Reutilizar las mismas validaciones y servicios nativos de las cargas existentes.
- [ ] Evitar crear un segundo registro cuando una carga rápida corresponde a un documento o movimiento ya existente.
- [ ] Mantener confirmaciones y resultados persistidos según el canal y la mutación.
- [ ] Verificar que la carga rápida sea viable en escritorio, móvil y teclado virtual.

## Fase 5 — Exploración y reparación de relaciones

- [ ] Permitir filtrar gastos por fecha, categoría, cuenta declarada, moneda, estado, origen, ticket, tarjeta, servicio y ahorro relacionado cuando corresponda.
- [ ] Mostrar desde cada gasto sus relaciones confirmadas y sus relaciones faltantes.
- [ ] Diferenciar relación confirmada, sugerida, ambigua, obsoleta y ausente.
- [ ] Crear una vista o sección de gastos sin categoría.
- [ ] Crear una vista o sección de gastos sin evidencia documental.
- [ ] Crear una vista o sección de tickets sin movimiento asociado.
- [ ] Crear una vista o sección de movimientos potencialmente duplicados.
- [ ] Crear una vista o sección de consumos de tarjeta todavía no conciliados con servicios.
- [ ] Crear una vista o sección de servicios con ocurrencia o factura incompleta.
- [ ] Permitir reparar una relación con una operación explícita, idempotente y auditable.
- [ ] No permitir que corregir una relación duplique gastos, tickets, movimientos o evidencias.
- [ ] Conservar historial cuando una relación sea reemplazada o desvinculada.

## Fase 6 — Consistencia entre UI, IA y Telegram

- [ ] Verificar que la interfaz y Telegram calculen los mismos totales y estados con el mismo snapshot.
- [ ] Verificar que Telegram pueda registrar gastos y ahorro sin crear relaciones implícitas inseguras.
- [ ] Verificar que texto, audio, imagen y PDF terminen en los mismos contratos financieros.
- [ ] Verificar que una aclaración de categoría, cuenta, servicio o documento no mutile hasta resolver la ambigüedad.
- [ ] Mantener una única confirmación visible por mutación financiera en Telegram.
- [ ] Verificar que Telegram no comunique una relación o métrica como confirmada antes de recibir el resultado persistido.
- [ ] Hacer que las respuestas indiquen cuando los datos son parciales, estimados o no conciliados.
- [ ] Mantener `ephemeral-no-memory` en Telegram y no guardar datos financieros en memoria global.
- [ ] Probar que las consultas de datos locales no llamen a `search_web`.
- [ ] Verificar autorización de lectura y escritura mediante `#Confidencial` para cada tool financiera.

## Fase 7 — Persistencia, compatibilidad y seguridad

- [ ] Determinar si las mejoras requieren migración SQLite o pueden resolverse con lecturas y transformaciones existentes.
- [ ] Si se agregan relaciones o estados persistidos, diseñar migraciones idempotentes y compatibles con bases existentes.
- [ ] Validar biblioteca, actor estable, contexto y origen en todos los nuevos comandos.
- [ ] Mantener importes con centavos exactos y validación de moneda en el límite nativo.
- [ ] Mantener operaciones de relación y reparación atómicas cuando modifiquen más de una entidad.
- [ ] Garantizar reintentos idempotentes y resultados verificables.
- [ ] No registrar contenido privado, documentos, secretos, prompts ni respuestas completas del agente.
- [ ] Revisar que los cambios no expongan Finanzas en la URL pública de Task Manager.
- [ ] Revisar accesibilidad semántica, labels, roles, foco y acciones alternativas a hover.

## Fase 8 — Pruebas

- [ ] Probar la matriz de relaciones con fixtures aislados.
- [ ] Probar gastos por día, semana, mes y categoría.
- [ ] Probar gastos confirmados, pendientes, corregidos, descartados y duplicados.
- [ ] Probar ARS y USD sin agregación cruzada.
- [ ] Probar aportes, retiros, rendimientos, pérdidas, ajustes y saldo acumulado de ahorro.
- [ ] Probar que retirar ahorro no se cuente como gasto común.
- [ ] Probar tickets con y sin movimiento asociado.
- [ ] Probar resúmenes con consumos, pagos, créditos, intereses, impuestos y total a pagar.
- [ ] Probar que el total del resumen no duplique gastos.
- [ ] Probar servicios con pago, factura, gasto, ocurrencia faltante y ambigüedad.
- [ ] Probar cuotas sin duplicar el total de la compra.
- [ ] Probar inversiones y valuaciones sin presentarlas como saldo disponible.
- [ ] Probar datos incompletos y mensajes de cobertura parcial.
- [ ] Probar carga rápida y actualización del dashboard después de guardar.
- [ ] Probar consistencia entre UI, app chat y Telegram con los mismos fixtures.
- [ ] Probar autorización `#Confidencial`, biblioteca distinta y actor no autorizado.
- [ ] Probar cancelación, rechazo, errores de persistencia, reintentos y operaciones obsoletas.
- [ ] Mantener pruebas sin servicios reales, bots reales, red externa ni secretos.

## Fase 9 — Validación y documentación

- [ ] Ejecutar las pruebas focalizadas del dominio financiero.
- [ ] Ejecutar pruebas de UI y accesibilidad afectadas.
- [ ] Ejecutar pruebas de integración de tools, chat y Telegram.
- [ ] Ejecutar `npx tsc --noEmit`.
- [ ] Ejecutar `npm run lint`.
- [ ] Ejecutar `npm run build`.
- [ ] Ejecutar la suite web completa con los flags definidos por el proyecto.
- [ ] Ejecutar `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Ejecutar `cargo check --manifest-path src-tauri/Cargo.toml`.
- [ ] Ejecutar las pruebas nativas disponibles y registrar bloqueos de plataforma.
- [ ] Validar manualmente el resumen diario con datos de gastos y ahorro.
- [ ] Validar manualmente carga rápida en escritorio y pantalla reducida.
- [ ] Validar manualmente Telegram con gasto simple, gasto ambiguo, aporte de ahorro y cancelación.
- [ ] Actualizar `README-TECH.md` con el modelo de relaciones, métricas, límites, contratos y validaciones reales.
- [ ] Actualizar `README.md` si cambia el comportamiento visible para usuarios.
- [ ] Actualizar `FUNCIONALIDADES.md` si cambia el inventario de capacidades.
- [ ] Agregar exactamente una línea a `CHANGELOG.md` con fecha, hora y zona horaria.
- [ ] Solicitar al subagente documentador la sincronización final y revisar su resultado.
- [ ] Revisar el diff completo, preservar cambios preexistentes y eliminar artefactos accidentales.

## Criterios de aceptación

- [ ] El usuario puede consultar gastos diarios, semanales y mensuales por categoría y moneda.
- [ ] El usuario puede consultar cuánto aportó, retiró y acumuló en ahorro sin mezclar esos conceptos.
- [ ] Ninguna pantalla presenta saldos de cuentas o dinero disponible que el modelo no pueda conocer.
- [ ] Cada métrica informa o permite entender si se basa en datos completos, parciales, pendientes o no conciliados.
- [ ] Los gastos provenientes de tickets y resúmenes no se duplican.
- [ ] Pagos, créditos y totales de tarjeta no aparecen como gastos individuales incorrectos.
- [ ] Las relaciones con servicios, tickets, tarjetas, ahorro e inversiones son visibles y trazables.
- [ ] Las relaciones ambiguas requieren decisión explícita y no se aplican silenciosamente.
- [ ] Registrar un gasto cotidiano requiere pocos campos y no obliga a completar relaciones que no se conocen.
- [ ] Registrar ahorro requiere pocos pasos y actualiza el resumen de forma verificable.
- [ ] UI, chat de la app y Telegram producen resultados equivalentes para los mismos datos.
- [ ] Toda lectura y mutación financiera respeta `#Confidencial`.
- [ ] Los importes ARS y USD no se mezclan en cálculos engañosos.
- [ ] Los cambios conservan idempotencia, historial, auditoría y compatibilidad con datos existentes.

## Fuera de alcance

- Conciliación automática con bancos, billeteras o tarjetas.
- Cálculo de saldo real de cuentas.
- Pretender que el efectivo registrado sea exacto.
- Integración bancaria o sincronización externa de movimientos.
- Presupuestos obligatorios o límites de gasto antes de validar el modelo actual.
- Compartir Finanzas fuera de usuarios autorizados por `#Confidencial`.
- Exponer Finanzas en la URL pública de Task Manager.
- Usar búsqueda web para completar o validar datos financieros locales.
- Resolver automáticamente relaciones ambiguas.
- Eliminar documentos, movimientos o evidencias para “limpiar” inconsistencias.
