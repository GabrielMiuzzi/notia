# Notia Finanzas — Tasks de implementación

## Estado actual

El primer vertical slice desktop está implementado:

- [x] Reemplazar el iframe placeholder por un módulo React nativo.
- [x] Pasar la librería activa explícitamente a `FinanceView`.
- [x] Crear tipos y servicio TypeScript para Finanzas.
- [x] Crear migración SQLite v2 con cuentas, categorías, movimientos, comercios y artefactos de origen.
- [x] Registrar comandos Tauri financieros.
- [x] Crear dashboard mensual responsive.
- [x] Crear cuentas manualmente.
- [x] Crear ingresos y gastos manualmente.
- [x] Mostrar movimientos recientes, categorías y totales básicos.
- [x] Agregar scope financiero al runtime común de chat.
- [x] Agregar herramientas iniciales `get_finance_dashboard` y `create_finance_transaction`.
- [x] Agregar pruebas iniciales frontend y Rust.
- [x] Actualizar la documentación técnica y de usuario.

## Fase 0 — Correcciones de base antes de ampliar el módulo

- [x] Extraer la lógica SQLite financiera desde `database.rs` hacia servicios Rust dedicados, manteniendo los comandos como adapters delgados.
- [x] Validar tipos de movimiento, estados, monedas, fechas e importes en Rust mediante validadores explícitos.
- [x] Reemplazar la suma actual basada en `i128` por una operación decimal exacta que soporte importes con centavos.
- [x] Evitar mezclar ARS y USD en los totales del dashboard; mostrar totales independientes por moneda.
- [x] Calcular saldo actual de cada cuenta desde saldo inicial y movimientos confirmados.
- [x] Agregar transacciones dentro de una operación atómica cuando una acción afecte más de una cuenta.
- [x] Añadir constraints e índices para estados, monedas, fechas y referencias de origen.
- [x] Implementar actualización y baja lógica de cuentas, categorías y movimientos.
- [x] Añadir deduplicación por identificador de origen.
- [x] Añadir huella de operación para deduplicar cargas equivalentes.
- [x] Definir errores estructurados para comandos Tauri en lugar de depender exclusivamente de strings.

## Fase 1 — Cuentas, categorías y movimientos

- [x] Completar CRUD de cuentas con edición, activación/desactivación y confirmación visual.
- [x] Crear categorías manualmente con tipo ingreso/gasto.
- [x] Completar CRUD de categorías con categorías padre y desactivación.
- [x] Crear pantalla de configuración de cuentas y categorías.
- [x] Implementar transferencias entre cuentas con cuenta origen y destino obligatorias.
- [x] Implementar ajustes de saldo separados de ingresos y gastos.
- [x] Permitir editar, confirmar, corregir y descartar movimientos pendientes.
- [x] Permitir adjuntar un comprobante a un movimiento.
- [x] Mostrar origen, fecha de creación y última modificación.
- [x] Implementar filtros por cuenta, categoría, tipo, estado y moneda.
- [x] Agregar filtros por comercio.
- [x] Agregar filtros por rango de fechas.
- [x] Añadir paginación o virtualización para historiales grandes.

## Fase 2 — Dashboard y experiencia de usuario

- [x] Separar visualmente los totales por ARS y USD.
- [x] Añadir gráfico interactivo de gastos por categoría.
- [x] Permitir abrir los movimientos que componen cada categoría.
- [x] Añadir gráfico de evolución mensual de saldos.
- [x] Mostrar cargas pendientes de confirmación.
- [x] Añadir navegación a meses anteriores y posteriores.
- [x] Añadir estados empty, loading, error, guardado y actualización.
- [x] Añadir acceso visible al chat financiero.
- [x] Revisar foco, labels, teclado, lector de pantalla y contraste.
- [ ] Probar touch, pulsación accidental, orientación vertical/horizontal, split-screen y teclado virtual.

## Fase 3 — Chat financiero y Telegram

### Chat interno

- [x] Crear una entrada de chat financiero que use `ChatWorkspaceView` con scope `finance`.
- [x] Incluir contexto financiero seguro por librería, sin adjuntar datos innecesarios al prompt.
- [x] Agregar herramientas para listar cuentas, categorías y movimientos.
- [x] Agregar herramientas para consultar totales, saldos y desgloses por período.
- [x] Agregar herramientas para confirmar, corregir y descartar operaciones identificadas.
- [x] Agregar resolución asistida de categorías.
- [x] Impedir creación automática de categorías sin confirmación explícita.
- [x] Implementar confianza básica y estado pendiente cuando la operación financiera sea ambigua.
- [x] Probar que todas las conversaciones pasan por `notiaChatRuntime.ts`.

### Telegram

- [x] Conectar el bridge existente con el servicio financiero compartido.
- [x] Asociar cada carga financiera al usuario y librería autorizados.
- [x] Procesar texto financiero usando el mismo caso de uso que el chat interno.
- [x] Procesar audio y conservar transcripción más referencia al audio original.
- [x] Preguntar siempre la cuenta cuando no sea mencionada.
- [x] Reutilizar la confirmación HTML existente sin duplicar reglas de negocio.
- [x] Persistir identificadores de update y evitar duplicados por reintento o reenvío.
- [x] Probar confirmación, cancelación, expiración y respuestas ambiguas.

## Fase 4 — Tickets, compras y precios

- [x] Crear tablas para `Purchase`, `PurchaseItem`, `Product`, `Receipt` y relaciones con movimientos.
- [x] Crear servicio de extracción visual detrás de un adapter configurable.
- [x] Integrar inicialmente el contrato de LlamaCloud sin exponer secretos al frontend.
- [x] Persistir archivo original y respuesta cruda como evidencia.
- [x] Normalizar comercio y producto sin sobrescribir la descripción original.
- [x] Guardar observaciones históricas de precio por fecha, comercio, moneda y cantidad.
- [x] Validar suma de líneas, descuentos, impuestos y total.
- [x] Mostrar discrepancias antes de confirmar.
- [x] Permitir corregir cada campo extraído.
- [x] Implementar deduplicación de tickets.
- [x] Consultar compras por comercio, producto y fecha.
- [x] Consultar historial y último precio confirmado sin predicciones.
- [x] Mantener la compra aunque se elimine el archivo original.

## Fase 5 — Recibos de sueldo

- [x] Crear tablas `SalaryReceipt` y `SalaryConcept`.
- [x] Diferenciar recibos de sueldo de tickets.
- [x] Extraer período, empleador, bruto, descuentos, neto y conceptos.
- [x] Validar bruto menos descuentos cuando sea posible.
- [x] Mostrar una vista previa antes de guardar.
- [x] Crear el ingreso neto al confirmar el recibo.
- [x] Evitar duplicados por recibo y período.
- [x] Mostrar evolución mensual del bruto, neto y descuentos.
- [x] Mostrar variación absoluta y porcentual contra el período anterior.
- [x] Conservar datos normalizados aunque se reemplace el archivo original.

## Fase 6 — Ahorro

- [x] Crear `SavingsReserve` y `SavingsMovement` en SQLite.
- [x] Vincular una reserva lógica con una o varias cuentas reales.
- [x] Implementar comandos y cálculo de aportes, retiros, ajustes, rendimientos y pérdidas.
- [x] Exigir motivo para cada retiro.
- [x] Modelar aportes y retiros confirmados como transferencias internas.
- [x] Impedir que aportes aparezcan como gastos o retiros como ingresos.
- [x] Mantener saldos separados por reserva y moneda.
- [x] Mostrar saldo inicial, aportes, retiros, ajustes y saldo final por mes.
- [x] Añadir filtros por reserva y moneda.
- [x] Permitir consultar el detalle y motivo de cada retiro.
- [x] Vincular opcionalmente un retiro con el gasto posterior que motivó la operación.

## Fase 7 — Tarjetas y compras en cuotas

- [x] Definir modelo de tarjeta como subtipo de cuenta.
- [x] Registrar una compra con tarjeta en la fecha efectiva de compra.
- [x] Registrar el pago de tarjeta como transferencia.
- [x] Impedir que el pago de tarjeta duplique el gasto.
- [x] Crear modelo de compra en cuotas.
- [x] Generar calendario y estado de cuotas.
- [x] Reconocer el gasto por cuota, según la decisión adoptada.
- [x] Probar gastos con tarjeta, pago posterior y cuotas.
- [x] Persistir resúmenes de tarjeta con emisor, período, cierre, vencimiento, saldos, totales y evidencia original.
- [x] Importar consumos, cargos, intereses e impuestos como gastos y conciliar líneas ya existentes.
- [x] Conservar pagos y créditos como líneas de conciliación sin duplicar el gasto ni el total a pagar.
- [x] Exponer carga visual por el runtime común de IA, deduplicación, resultado terminal e historial en Finanzas.
- [x] Añadir pruebas de validación aritmética y contratos TypeScript/Rust para resúmenes.

## Fase 8 — Patrimonio e inversiones

- [x] Crear entidades de inversiones y valuaciones históricas.
- [x] Soportar cuentas de inversión y activos básicos.
- [x] Registrar deuda y activos sin conversión implícita entre monedas.
- [x] Calcular patrimonio por fecha como activos menos deudas.
- [x] Mostrar evolución patrimonial por moneda.
- [x] Mantener fuera de alcance cotizaciones automáticas, predicciones y recomendaciones.

## Fase 9 — Android y SAF

- [x] Implementar operaciones financieras del plugin SQLite Android.
- [x] Ejecutar CRUD sobre la base temporal sincronizada por SAF.
- [x] Sincronizar cambios de vuelta al árbol seleccionado de forma segura.
- [x] Mantener el contrato de comandos equivalente entre desktop y Android.
- [x] Añadir manejo de pérdida de URI, permisos revocados y reanudación de la app.
- [ ] Probar orientación, split-screen, teclado virtual, suspensión y reanudación.
- [ ] Completar `npm run build:android:debug`: Rust aarch64 compila, pero el empaquetado requiere habilitar Developer Mode de Windows para crear el symlink de Tauri. `npm run dev:android` queda pendiente por ser interactivo.
- [ ] Realizar prueba manual en tableta Android física de gama media.

## Pruebas y calidad

- [x] Añadir pruebas de migración desde esquema v1 al esquema vigente.
- [x] Añadir pruebas de rollback o recuperación ante migración incompleta.
- [x] Añadir pruebas de saldos, transferencias y exclusión de movimientos no confirmados.
- [x] Añadir pruebas de importes decimales exactos y separación de monedas.
- [x] Añadir pruebas de categorías ambiguas y confirmaciones explícitas.
- [x] Añadir pruebas de tickets, productos, precios y deduplicación.
- [x] Añadir pruebas de sueldos y evolución mensual.
- [x] Añadir pruebas de ahorro, retiros y motivos obligatorios.
- [x] Añadir pruebas React orientadas al usuario y accesibilidad.
- [x] Añadir pruebas de contratos Tauri TypeScript/Rust.
- [x] Ejecutar `npm run lint` y separar errores preexistentes de regresiones financieras. Ejecutado: falla por 24 errores y 10 warnings preexistentes fuera de Finanzas.
- [x] Ejecutar `npm test` (35 archivos, 177 pruebas aprobadas).
- [x] Ejecutar `npm run build` (aprobado).
- [x] Ejecutar `cargo fmt --all -- --check` (aprobado).
- [x] Ejecutar `cargo check --all-targets` (aprobado con warnings preexistentes).
- [x] Ejecutar `cargo clippy --all-targets --all-features -- -D warnings`. Ejecutado: falla por 48 warnings tratados como error, mayormente preexistentes y fuera de Finanzas.
- [x] Ejecutar `cargo test --all-targets` (83 pruebas aprobadas).
- [x] Resolver el fallo preexistente de modelos de voz `offlineNemoTransducer`; la suite Rust queda verde.

## Documentación y seguridad

- [x] Documentar todos los DTOs y comandos financieros en `README-TECH.md`.
- [x] Documentar el esquema y las migraciones SQLite.
- [x] Documentar el flujo compartido entre chat interno y Telegram.
- [x] Documentar retención y eliminación de tickets, audios y recibos.
- [x] Documentar identificación de usuario Telegram y alcance multiusuario.
- [x] Revisar permisos Tauri y exposición de archivos financieros.
- [x] Evitar registrar tokens, archivos, recibos, prompts o payloads financieros.
- [x] Revisar que las eliminaciones financieras sean lógicas o auditables.

## Bloqueos y limitaciones conocidas

- El empaquetado Android está bloqueado por la política local de Windows que impide crear symlinks; hay que habilitar Developer Mode y repetir `npm run build:android:debug`.
- Las pruebas manuales de touch, orientación, split-screen, teclado virtual, suspensión/reanudación y tableta física requieren un dispositivo Android disponible.
- `npm run lint` conserva 24 errores y 10 warnings preexistentes fuera del módulo financiero; no se alteraron módulos ajenos para ocultarlos.
- Clippy estricto conserva 48 warnings tratados como error, mayormente preexistentes y fuera de Finanzas; `cargo check` y las 83 pruebas Rust sí aprueban.
- Los únicos pendientes del plan requieren entorno Android interactivo o dispositivo físico; las validaciones globales de lint/Clippy conservan deuda preexistente fuera de Finanzas.
