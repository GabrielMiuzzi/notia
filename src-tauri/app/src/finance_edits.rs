//! Corrections the assistant makes on request: removing any finance record
//! with everything that depends on it, linking or unlinking a card line,
//! renaming or merging merchants and products, and answering the review
//! items. The screen only shows data; these run from the assistant's tools.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::finance::{now, sync_context, validate_context, FinanceCommandResult, FinanceContext};
use crate::finance_matching::{self, AutoLink, ReviewItem};

fn storage(error: rusqlite::Error) -> String {
    error.to_string()
}

/// Runs a change inside one database transaction and syncs the library.
fn change<T>(
    app: &crate::host::AppHandle,
    context: &FinanceContext,
    apply: impl FnOnce(&Connection) -> Result<T, String>,
) -> FinanceCommandResult<T> {
    let connection = validate_context(context, app)?;
    let transaction = connection.unchecked_transaction().map_err(storage)?;
    let result = apply(&transaction)?;
    transaction.commit().map_err(storage)?;
    drop(connection);
    sync_context(context, app)?;
    Ok(result)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletedRecord {
    pub entity: String,
    pub id: String,
    pub summary: String,
}

fn soft_delete_artifact(connection: &Connection, artifact_id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_source_artifacts SET deleted_at=?1,content_hash=NULL WHERE id=?2",
            params![now(), artifact_id],
        )
        .map_err(storage)?;
    Ok(())
}

fn soft_delete_transaction(connection: &Connection, transaction_id: &str) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_transactions SET deleted_at=?1,updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",
            params![now(), transaction_id],
        )
        .map_err(storage)?;
    Ok(())
}

fn existing(connection: &Connection, sql: &str, id: &str, missing: &str) -> Result<(), String> {
    connection
        .query_row(sql, [id], |_| Ok(()))
        .optional()
        .map_err(storage)?
        .ok_or_else(|| missing.to_string())
}

/// A ticket goes away with its products and prices. Its expense goes too,
/// unless a statement line paid it: then the line keeps the expense.
fn delete_purchase(connection: &Connection, id: &str) -> Result<String, String> {
    let (transaction_id, artifact_id): (String, Option<String>) = connection
        .query_row(
            "SELECT transaction_id,source_artifact_id FROM finance_purchases WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El ticket no existe.".to_string())?;
    connection
        .execute(
            "DELETE FROM finance_price_observations WHERE purchase_item_id IN
                (SELECT id FROM finance_purchase_items WHERE purchase_id=?1)",
            [id],
        )
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_purchase_items WHERE purchase_id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_purchases WHERE id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_receipts WHERE id=?1", [format!("receipt:{id}")])
        .map_err(storage)?;
    let paid_by_line: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM finance_credit_card_statement_items WHERE transaction_id=?1)",
            [&transaction_id],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if !paid_by_line {
        soft_delete_transaction(connection, &transaction_id)?;
    }
    // A ticket merged into a line left its own expense deleted already; a
    // line that reused the ticket's expense keeps it.
    let own_transaction_id = format!("purchase:{id}");
    if own_transaction_id != transaction_id {
        soft_delete_transaction(connection, &own_transaction_id)?;
    }
    if let Some(artifact_id) = artifact_id {
        soft_delete_artifact(connection, &artifact_id)?;
    }
    Ok(if paid_by_line {
        "Se borró el ticket; el gasto sigue en su línea del resumen.".into()
    } else {
        "Se borraron el ticket, sus productos y su gasto.".into()
    })
}

fn delete_salary(connection: &Connection, id: &str) -> Result<String, String> {
    let (transaction_id, artifact_id): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT transaction_id,source_artifact_id FROM finance_salary_receipts WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El recibo de sueldo no existe.".to_string())?;
    connection
        .execute("DELETE FROM finance_salary_concepts WHERE salary_receipt_id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_salary_receipts WHERE id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_receipts WHERE id=?1", [format!("salary-receipt:{id}")])
        .map_err(storage)?;
    if let Some(transaction_id) = transaction_id {
        soft_delete_transaction(connection, &transaction_id)?;
    }
    if let Some(artifact_id) = artifact_id {
        soft_delete_artifact(connection, &artifact_id)?;
    }
    Ok("Se borraron el recibo de sueldo y su ingreso.".into())
}

fn delete_installment_plan(connection: &Connection, id: &str) -> Result<String, String> {
    existing(
        connection,
        "SELECT 1 FROM finance_installment_plans WHERE id=?1",
        id,
        "El plan de cuotas no existe.",
    )?;
    connection
        .execute("DELETE FROM finance_installments WHERE plan_id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_installment_plans WHERE id=?1", [id])
        .map_err(storage)?;
    Ok("Se borró el plan de cuotas; las cuotas ya pagadas siguen en sus resúmenes.".into())
}

fn delete_savings_movement(connection: &Connection, id: &str) -> Result<String, String> {
    let linked: Option<String> = connection
        .query_row(
            "SELECT linked_transaction_id FROM finance_savings_movements WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El movimiento de ahorro no existe.".to_string())?;
    connection
        .execute("DELETE FROM finance_savings_movements WHERE id=?1", [id])
        .map_err(storage)?;
    soft_delete_transaction(connection, &format!("savings-movement:{id}"))?;
    if let Some(linked) = linked {
        soft_delete_transaction(connection, &linked)?;
    }
    Ok("Se borró el movimiento de ahorro.".into())
}

fn delete_savings_reserve(connection: &Connection, id: &str) -> Result<String, String> {
    let ledger: Option<String> = connection
        .query_row(
            "SELECT ledger_account_id FROM finance_savings_reserves WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "La reserva no existe.".to_string())?;
    let movements = connection
        .prepare("SELECT id FROM finance_savings_movements WHERE reserve_id=?1")
        .map_err(storage)?
        .query_map([id], |row| row.get::<_, String>(0))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    for movement in &movements {
        delete_savings_movement(connection, movement)?;
    }
    connection
        .execute("DELETE FROM finance_savings_accounts WHERE reserve_id=?1", [id])
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_savings_reserves WHERE id=?1", [id])
        .map_err(storage)?;
    // The ledger stays for the history of movements that referenced it.
    if let Some(ledger) = ledger {
        connection
            .execute(
                "UPDATE finance_accounts SET active=0,updated_at=?1 WHERE id=?2",
                params![now(), ledger],
            )
            .map_err(storage)?;
    }
    Ok(format!(
        "Se borró la reserva con sus {} movimiento(s).",
        movements.len()
    ))
}

fn delete_service(connection: &Connection, id: &str) -> Result<String, String> {
    existing(connection, "SELECT 1 FROM finance_services WHERE id=?1", id, "El servicio no existe.")?;
    let timestamp = now();
    connection
        .execute(
            "UPDATE finance_transactions SET service_id=NULL,updated_at=?1 WHERE service_id=?2",
            params![timestamp, id],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_purchases SET service_id=NULL,updated_at=?1 WHERE service_id=?2",
            params![timestamp, id],
        )
        .map_err(storage)?;
    connection
        .execute("DELETE FROM finance_services WHERE id=?1", [id])
        .map_err(storage)?;
    Ok("Se borró el servicio con sus meses; los gastos pagados quedan como gastos sueltos.".into())
}

fn delete_service_occurrence(connection: &Connection, id: &str) -> Result<String, String> {
    let (service_id, transaction_id): (String, Option<String>) = connection
        .query_row(
            "SELECT service_id,transaction_id FROM finance_service_occurrences WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "El mes del servicio no existe.".to_string())?;
    if let Some(transaction_id) = transaction_id {
        connection
            .execute(
                "UPDATE finance_transactions SET service_id=NULL,updated_at=?1 WHERE id=?2 AND service_id=?3",
                params![now(), transaction_id, service_id],
            )
            .map_err(storage)?;
    }
    connection
        .execute("DELETE FROM finance_service_occurrences WHERE id=?1", [id])
        .map_err(storage)?;
    Ok("Se borró el mes del servicio; el gasto, si había, sigue como gasto suelto.".into())
}

fn delete_service_invoice(connection: &Connection, id: &str) -> Result<String, String> {
    let artifact_id: Option<String> = connection
        .query_row(
            "SELECT artifact_id FROM finance_service_invoices WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(storage)?
        .ok_or_else(|| "La factura no existe.".to_string())?;
    connection
        .execute("DELETE FROM finance_service_invoices WHERE id=?1", [id])
        .map_err(storage)?;
    if let Some(artifact_id) = artifact_id {
        soft_delete_artifact(connection, &artifact_id)?;
    }
    Ok("Se borró la factura del servicio.".into())
}

/// Entities `finance_delete_record` removes besides loose movements,
/// accounts and categories.
pub(crate) const DELETABLE_RECORDS: [&str; 9] = [
    "purchase",
    "salary",
    "card-statement",
    "installment-plan",
    "savings-movement",
    "savings-reserve",
    "service",
    "service-occurrence",
    "service-invoice",
];

pub(crate) fn delete_record(connection: &Connection, entity: &str, id: &str) -> Result<String, String> {
    if id.trim().is_empty() {
        return Err("El registro a eliminar es obligatorio.".into());
    }
    match entity {
        "purchase" => delete_purchase(connection, id),
        "salary" => delete_salary(connection, id),
        "card-statement" => crate::finance_records::delete_card_statement(connection, id),
        "installment-plan" => delete_installment_plan(connection, id),
        "savings-movement" => delete_savings_movement(connection, id),
        "savings-reserve" => delete_savings_reserve(connection, id),
        "service" => delete_service(connection, id),
        "service-occurrence" => delete_service_occurrence(connection, id),
        "service-invoice" => delete_service_invoice(connection, id),
        _ => Err("La entidad financiera no se puede eliminar.".into()),
    }
}

pub fn finance_delete_record(
    app: crate::host::AppHandle,
    context: FinanceContext,
    entity: String,
    id: String,
) -> FinanceCommandResult<DeletedRecord> {
    let summary = change(&app, &context, |connection| delete_record(connection, &entity, &id))?;
    Ok(DeletedRecord { entity, id, summary })
}

/// Links a card-unpaid expense (or a ticket) or an installment with the
/// statement line that paid it.
pub fn finance_link_records(
    app: crate::host::AppHandle,
    context: FinanceContext,
    kind: String,
    subject_id: String,
    line_id: String,
) -> FinanceCommandResult<AutoLink> {
    change(&app, &context, |connection| match kind.as_str() {
        "purchase-card-line" => {
            let transaction_id: String = connection
                .query_row(
                    "SELECT transaction_id FROM finance_purchases WHERE id=?1",
                    [&subject_id],
                    |row| row.get(0),
                )
                .map_err(|_| "El ticket no existe.".to_string())?;
            finance_matching::link_expense_to_line(connection, &transaction_id, &line_id)
        }
        "expense-card-line" => finance_matching::link_expense_to_line(connection, &subject_id, &line_id),
        "installment-card-line" => finance_matching::link_installment_to_line(connection, &subject_id, &line_id),
        _ => Err("El tipo de vínculo no es válido.".into()),
    })
}

/// Undoes a link by its id (as the save reported it) or by the line.
pub fn finance_unlink_records(
    app: crate::host::AppHandle,
    context: FinanceContext,
    link_id: Option<String>,
    line_id: Option<String>,
) -> FinanceCommandResult<()> {
    change(&app, &context, |connection| {
        let link_id = match (link_id, line_id) {
            (Some(link_id), _) if !link_id.trim().is_empty() => link_id,
            (_, Some(line_id)) => finance_matching::active_link_for_line(connection, &line_id)?
                .ok_or_else(|| "La línea no tiene vínculos para deshacer.".to_string())?,
            _ => return Err("Indicá el vínculo o la línea del resumen.".into()),
        };
        finance_matching::unlink_line(connection, &link_id)
    })
}

pub fn finance_list_review_items(
    app: crate::host::AppHandle,
    context: FinanceContext,
    status: Option<String>,
) -> FinanceCommandResult<Vec<ReviewItem>> {
    let connection = validate_context(&context, &app)?;
    let status = status.filter(|value| !value.trim().is_empty());
    Ok(finance_matching::list_review_items(
        &connection,
        Some(status.as_deref().unwrap_or("pending")),
        100,
    )?)
}

pub fn finance_resolve_review_item(
    app: crate::host::AppHandle,
    context: FinanceContext,
    id: String,
    option_id: String,
) -> FinanceCommandResult<ReviewItem> {
    let actor = context.actor_library_user_id.clone();
    let source = context.source.clone();
    change(&app, &context, |connection| {
        finance_matching::resolve_review_item(connection, &id, &option_id, &actor, &source)
    })
}

/// Renames or merges merchants and products. `from` goes into `into`.
pub fn finance_edit_catalog(
    app: crate::host::AppHandle,
    context: FinanceContext,
    action: String,
    id: String,
    value: String,
) -> FinanceCommandResult<()> {
    change(&app, &context, |connection| match action.as_str() {
        "rename-merchant" => finance_matching::rename_merchant(connection, &id, &value),
        "rename-product" => finance_matching::rename_product(connection, &id, &value),
        "merge-merchants" => finance_matching::merge_merchants(connection, &id, &value),
        "merge-products" => finance_matching::merge_products(connection, &id, &value),
        _ => Err("La acción sobre el catálogo no es válida.".into()),
    })
}
