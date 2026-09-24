//! Changes the person makes on the Finanzas screen. Each one is stored and
//! leaves a pending audit of its period, so the assistant reviews it later;
//! the agent's own changes are audited by the agent runtime instead.

use serde::Deserialize;
use serde_json::Value;

use crate::finance::{
    self, FinanceAuditRun, FinanceCommandResult, FinanceContext, FinanceSavingsMovement, FinanceService,
    FinanceServiceInvoice, FinanceServiceOccurrence, FinanceTransaction,
};
use crate::finance_records::{self, CreditCardStatement, PurchaseRecord, SalaryReceipt};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum FinanceUiChange {
    CreateTransaction { transaction: FinanceTransaction },
    /// A pending movement that is edited becomes corrected.
    EditTransaction { transaction: FinanceTransaction },
    ConfirmTransaction { id: String },
    DiscardTransaction { id: String },
    SaveSavingsMovement { movement: FinanceSavingsMovement },
    SavePurchase { purchase: PurchaseRecord },
    SaveSalary { salary: SalaryReceipt },
    SaveCardStatement { statement: CreditCardStatement },
    SaveService { service: FinanceService },
    SaveServiceOccurrence {
        occurrence: FinanceServiceOccurrence,
        #[serde(default)]
        reason: Option<String>,
    },
    SaveServiceInvoice { invoice: FinanceServiceInvoice },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceUiChangePayload {
    pub context: FinanceContext,
    pub change: FinanceUiChange,
}

fn value<T: serde::Serialize>(saved: T) -> FinanceCommandResult<Value> {
    serde_json::to_value(saved).map_err(|_| "No se pudo leer el resultado financiero.".into())
}

fn month_of(date: &str) -> String {
    date.chars().take(7).collect()
}

fn stored_transaction(app: &crate::host::AppHandle, context: &FinanceContext, id: &str) -> FinanceCommandResult<FinanceTransaction> {
    finance::finance_get_transaction(
        app.clone(),
        finance::GetFinanceRecordPayload { context: context.clone(), id: id.to_string() },
    )
}

fn save_transaction(app: &crate::host::AppHandle, context: &FinanceContext, transaction: FinanceTransaction) -> FinanceCommandResult<FinanceTransaction> {
    finance::finance_save_transaction(
        app.clone(),
        finance::SaveTransactionPayload { context: context.clone(), transaction },
    )
}

/// Leaves a pending audit of the period; a failure does not undo the change.
fn queue_audit(app: &crate::host::AppHandle, context: &FinanceContext, period: String, fingerprint: String, reason: &str) {
    let run = FinanceAuditRun {
        id: uuid::Uuid::new_v4().to_string(),
        period,
        trigger_fingerprint: fingerprint,
        status: "pending".to_string(),
        actor_library_user_id: Some(context.actor_library_user_id.clone()),
        source: context.source.clone(),
        reason: Some(reason.to_string()),
        error_message: None,
        created_at: None,
        completed_at: None,
    };
    if let Err(error) = finance::finance_save_audit_run(
        app.clone(),
        finance::SaveFinanceAuditRunPayload { context: context.clone(), run },
    ) {
        log::warn!("[notia:finance] no se pudo dejar pendiente la auditoría: {}", error.message);
    }
}

/// Stores a change made on the Finanzas screen and queues its audit.
pub fn finance_apply_ui_change(app: crate::host::AppHandle, payload: FinanceUiChangePayload) -> FinanceCommandResult<Value> {
    let context = payload.context;
    let (saved, period, fingerprint, reason) = match payload.change {
        FinanceUiChange::CreateTransaction { transaction } => {
            let saved = save_transaction(&app, &context, transaction)?;
            let audit = (month_of(&saved.effective_date), format!("ui:transaction:{}", saved.id));
            (value(saved)?, audit.0, audit.1, "Alta de movimiento desde Finanzas")
        }
        FinanceUiChange::EditTransaction { mut transaction } => {
            if transaction.status == "pending" {
                transaction.status = "corrected".to_string();
            }
            let saved = save_transaction(&app, &context, transaction)?;
            let audit = (month_of(&saved.effective_date), format!("ui:transaction:{}", saved.id));
            (value(saved)?, audit.0, audit.1, "Corrección de movimiento desde Finanzas")
        }
        FinanceUiChange::ConfirmTransaction { id } | FinanceUiChange::DiscardTransaction { id } if id.trim().is_empty() => {
            return Err("El movimiento requiere un identificador.".into());
        }
        change @ (FinanceUiChange::ConfirmTransaction { .. } | FinanceUiChange::DiscardTransaction { .. }) => {
            let (id, status, reason) = match change {
                FinanceUiChange::ConfirmTransaction { id } => (id, "confirmed", "Confirmación de movimiento desde Finanzas"),
                FinanceUiChange::DiscardTransaction { id } => (id, "discarded", "Descarte de movimiento desde Finanzas"),
                _ => unreachable!(),
            };
            let mut transaction = stored_transaction(&app, &context, &id)?;
            transaction.status = status.to_string();
            let saved = save_transaction(&app, &context, transaction)?;
            let audit = (month_of(&saved.effective_date), format!("ui:transaction:{}", saved.id));
            (value(saved)?, audit.0, audit.1, reason)
        }
        FinanceUiChange::SaveSavingsMovement { movement } => {
            let audit = (month_of(&movement.effective_date), format!("ui:quick-savings:{}", movement.id));
            let saved = finance::finance_save_savings_movement(
                app.clone(),
                finance::SaveSavingsMovementPayload { context: context.clone(), movement },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta rápida de ahorro desde Finanzas")
        }
        FinanceUiChange::SavePurchase { purchase } => {
            let audit = (month_of(&purchase.observed_at), format!("ui:purchase:{}", purchase.id));
            let saved = finance_records::finance_save_purchase(
                app.clone(),
                finance_records::SavePurchasePayload { context: context.clone(), purchase },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta de compra desde Finanzas")
        }
        FinanceUiChange::SaveSalary { salary } => {
            let audit = (month_of(&salary.payment_date), format!("ui:salary:{}", salary.id));
            let saved = finance_records::finance_save_salary(
                app.clone(),
                finance_records::SaveSalaryPayload { context: context.clone(), salary },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta de sueldo desde Finanzas")
        }
        FinanceUiChange::SaveCardStatement { statement } => {
            let audit = (statement.period.clone(), format!("ui:card-statement:{}", statement.id));
            let saved = finance_records::finance_save_credit_card_statement(
                app.clone(),
                finance_records::SaveCreditCardStatementPayload { context: context.clone(), statement },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta de resumen de tarjeta desde Finanzas")
        }
        FinanceUiChange::SaveService { service } => {
            let fingerprint = format!("ui:service:{}", service.id);
            let saved = finance::finance_save_service(
                app.clone(),
                finance::SaveFinanceServicePayload { context: context.clone(), service },
            )?;
            (value(saved)?, crate::finance_views::current_month(), fingerprint, "Alta de servicio desde Finanzas")
        }
        FinanceUiChange::SaveServiceOccurrence { occurrence, reason } => {
            let audit = (occurrence.period.clone(), format!("ui:service-occurrence:{}:{}", occurrence.service_id, occurrence.period));
            let saved = finance::finance_save_service_occurrence(
                app.clone(),
                finance::SaveFinanceServiceOccurrencePayload { context: context.clone(), occurrence, reason },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta de ocurrencia desde Finanzas")
        }
        FinanceUiChange::SaveServiceInvoice { invoice } => {
            let audit = (invoice.period.clone(), format!("ui:service-invoice:{}", invoice.id));
            let saved = finance::finance_save_service_invoice(
                app.clone(),
                finance::SaveFinanceServiceInvoicePayload { context: context.clone(), invoice },
            )?;
            (value(saved)?, audit.0, audit.1, "Alta de factura de servicio desde Finanzas")
        }
    };
    queue_audit(&app, &context, period, fingerprint, reason);
    Ok(saved)
}
