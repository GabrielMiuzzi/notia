//! Brings the Finanzas data of an existing library to the model of schema
//! 26: purchases dollars for savings become exchanges, whatever a card
//! statement paid counts in the month the statement is paid, card expenses
//! no statement includes yet wait for it, and installments stop being
//! expenses of their own. Nothing the person loaded is removed: duplicates
//! are merged into the statement line that paid them, and doubtful cases
//! become review items.

use rusqlite::{params, Connection};

use crate::finance_matching::{
    self, create_review_item, find_merchant_for_descriptor, last_merchant_category, merchants_compatible,
    normalize_card_descriptor, normalize_text, LinkOutcome, ReviewOption, CARD_CHARGES_CATEGORY,
    CARD_UNPAID,
};

fn storage(error: rusqlite::Error) -> String {
    error.to_string()
}

fn today() -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();
    crate::task_manager_store::format_iso_timestamp(now_ms)[..10].to_string()
}


/// Converts the existing Finanzas data. Runs inside the schema 26
/// migration, after its tables exist, and only when there are movements.
pub(crate) fn migrate_existing_finance_data(connection: &Connection) -> Result<(), String> {
    let transactions: i64 = connection
        .query_row("SELECT COUNT(*) FROM finance_transactions", [], |row| row.get(0))
        .map_err(storage)?;
    if transactions == 0 {
        return Ok(());
    }
    seed_aliases(connection)?;
    convert_savings_exchanges(connection)?;
    date_card_lines_by_payment(connection)?;
    recategorize_card_purchases(connection)?;
    wait_for_card_statements(connection)?;
    detach_installment_expenses(connection)?;
    review_service_ambiguities(connection)?;
    Ok(())
}

fn seed_aliases(connection: &Connection) -> Result<(), String> {
    for (table, alias_table, column) in [
        ("finance_merchants", "finance_merchant_aliases", "merchant_id"),
        ("finance_products", "finance_product_aliases", "product_id"),
    ] {
        let rows = connection
            .prepare(&format!("SELECT id,name,normalized_name FROM {table} ORDER BY created_at,id"))
            .map_err(storage)?
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;
        for (id, name, normalized) in rows {
            for alias in [normalize_text(&name), normalized] {
                if alias.is_empty() {
                    continue;
                }
                connection
                    .execute(
                        &format!("INSERT OR IGNORE INTO {alias_table} (normalized_alias,{column}) VALUES(?1,?2)"),
                        params![alias, id],
                    )
                    .map_err(storage)?;
            }
        }
    }
    Ok(())
}

/// A dollar purchase for savings was an uncategorized expense; it is now an
/// exchange from the paying account into the reserve's ledger.
fn convert_savings_exchanges(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_transactions SET transaction_type='exchange',category_id=NULL,
                destination_account_id=(
                    SELECT r.ledger_account_id FROM finance_savings_movements m
                    JOIN finance_savings_reserves r ON r.id=m.reserve_id
                    WHERE m.linked_transaction_id=finance_transactions.id LIMIT 1)
             WHERE source='savings_exchange' AND transaction_type='expense'",
            [],
        )
        .map_err(storage)?;
    connection
        .execute(
            "UPDATE finance_categories SET name='Cargos de tarjeta',
                description='Cargos, intereses e impuestos de las tarjetas de crédito.'
             WHERE id=?1 AND name='Tarjeta de crédito'",
            [CARD_CHARGES_CATEGORY],
        )
        .map_err(storage)?;
    Ok(())
}

/// What a statement paid counts in the month the statement is due; the
/// purchase date stays on the expense.
fn date_card_lines_by_payment(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "UPDATE finance_transactions SET
                purchase_date=COALESCE(purchase_date,(
                    SELECT i.purchase_date FROM finance_credit_card_statement_items i
                    WHERE i.transaction_id=finance_transactions.id LIMIT 1)),
                effective_date=(
                    SELECT s.due_date FROM finance_credit_card_statement_items i
                    JOIN finance_credit_card_statements s ON s.id=i.statement_id
                    WHERE i.transaction_id=finance_transactions.id LIMIT 1)
             WHERE deleted_at IS NULL AND id IN (
                SELECT transaction_id FROM finance_credit_card_statement_items WHERE transaction_id IS NOT NULL)",
            [],
        )
        .map_err(storage)?;
    Ok(())
}

/// Card purchases were all filed under the card category; they take their
/// merchant's usual category instead, or none.
fn recategorize_card_purchases(connection: &Connection) -> Result<(), String> {
    let rows = connection
        .prepare(
            "SELECT t.id,i.description FROM finance_transactions t
             JOIN finance_credit_card_statement_items i ON i.transaction_id=t.id
             WHERE t.category_id=?1 AND i.item_type='purchase' AND t.deleted_at IS NULL",
        )
        .map_err(storage)?
        .query_map([CARD_CHARGES_CATEGORY], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    for (transaction_id, description) in rows {
        let merchant_id = find_merchant_for_descriptor(connection, &description)?;
        let category_id = match merchant_id.as_deref() {
            Some(merchant) => last_merchant_category(connection, merchant)?,
            None => None,
        };
        connection
            .execute(
                "UPDATE finance_transactions SET category_id=?1,merchant_id=COALESCE(merchant_id,?2) WHERE id=?3",
                params![category_id, merchant_id, transaction_id],
            )
            .map_err(storage)?;
    }
    Ok(())
}

/// Card expenses that no loaded statement includes wait for the statement
/// that pays them. Those older than the last statement are either paid in a
/// statement that was never loaded (they stay as they are) or duplicates of
/// a line (they are merged into it).
fn wait_for_card_statements(connection: &Connection) -> Result<(), String> {
    let cards = connection
        .prepare(
            "SELECT a.id,(SELECT MAX(s.closing_date) FROM finance_credit_card_statements s WHERE s.account_id=a.id)
             FROM finance_accounts a WHERE a.account_type='credit_card'",
        )
        .map_err(storage)?
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    // A card whose statements were never loaded only waits for its recent
    // expenses: from the first day of the previous month.
    let first_of_previous_month = finance_matching::add_months(&format!("{}-01", &today()[..7]), -1)?;
    for (account_id, latest_closing) in cards {
        let waits = |date: &str| match latest_closing.as_deref() {
            Some(closing) => date > closing,
            None => date >= first_of_previous_month.as_str(),
        };
        let expenses = connection
            .prepare(
                "SELECT id,status,effective_date FROM finance_transactions
                 WHERE account_id=?1 AND transaction_type='expense' AND deleted_at IS NULL
                   AND status IN ('confirmed','corrected') AND source NOT IN ('credit_card_statement','installment')
                   AND id NOT IN (SELECT transaction_id FROM finance_credit_card_statement_items
                                  WHERE transaction_id IS NOT NULL)",
            )
            .map_err(storage)?
            .query_map([&account_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?;
        for (transaction_id, status, date) in expenses {
            connection
                .execute(
                    "UPDATE finance_transactions SET status=?1,purchase_date=effective_date WHERE id=?2",
                    params![CARD_UNPAID, transaction_id],
                )
                .map_err(storage)?;
            let mut outcome = LinkOutcome::default();
            finance_matching::link_unpaid_expense(connection, &transaction_id, &mut outcome)?;
            if outcome.links.is_empty() && outcome.review_items.is_empty() && !waits(&date) {
                connection
                    .execute(
                        "UPDATE finance_transactions SET status=?1,purchase_date=NULL WHERE id=?2",
                        params![status, transaction_id],
                    )
                    .map_err(storage)?;
            }
        }
    }
    Ok(())
}

/// Installments no longer create expenses: the statement line of each one
/// is its expense. Future installment expenses go away; past ones are
/// merged into their line or, when no line fits, asked about.
fn detach_installment_expenses(connection: &Connection) -> Result<(), String> {
    let rows = connection
        .prepare(
            "SELECT t.id,t.effective_date,t.amount,t.account_id,t.currency,i.id,i.installment_number,
                    p.installment_count,p.description,
                    (SELECT MAX(s.closing_date) FROM finance_credit_card_statements s WHERE s.account_id=t.account_id)
             FROM finance_transactions t
             JOIN finance_installments i ON i.transaction_id=t.id
             JOIN finance_installment_plans p ON p.id=i.plan_id
             WHERE t.source='installment' AND t.deleted_at IS NULL
               AND t.id NOT IN (SELECT transaction_id FROM finance_credit_card_statement_items
                                WHERE transaction_id IS NOT NULL)",
        )
        .map_err(storage)?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    let today = today();
    let timestamp = crate::finance::now();
    for (transaction_id, date, amount, account_id, currency, installment_id, number, count, description, latest_closing) in rows {
        if date > today {
            connection
                .execute(
                    "UPDATE finance_transactions SET deleted_at=?1,updated_at=?1 WHERE id=?2",
                    params![timestamp, transaction_id],
                )
                .map_err(storage)?;
            connection
                .execute(
                    "UPDATE finance_installments SET transaction_id=NULL,status='pending',updated_at=?1 WHERE id=?2",
                    params![timestamp, installment_id],
                )
                .map_err(storage)?;
            continue;
        }
        if latest_closing.as_deref().map_or(true, |closing| date.as_str() > closing) {
            continue;
        }
        let amount = crate::finance::parse_cents(&amount).unwrap_or_default();
        let lines = connection
            .prepare(
                "SELECT i.transaction_id,i.description,i.amount FROM finance_credit_card_statement_items i
                 JOIN finance_credit_card_statements s ON s.id=i.statement_id
                 JOIN finance_transactions t ON t.id=i.transaction_id
                 WHERE s.account_id=?1 AND i.currency=?2 AND i.installment_number=?3 AND i.installment_count=?4
                   AND t.source='credit_card_statement' AND t.deleted_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM finance_installments x WHERE x.transaction_id=i.transaction_id)",
            )
            .map_err(storage)?
            .query_map(params![account_id, currency, number, count], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
            })
            .map_err(storage)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage)?
            .into_iter()
            .filter(|(_, line_description, line_amount)| {
                crate::finance::parse_cents(line_amount)
                    .is_ok_and(|value| (value - amount).abs() <= i128::from(count).max(amount / 100))
                    && (merchants_compatible(line_description, &description)
                        || normalize_card_descriptor(line_description) == normalize_card_descriptor(&description))
            })
            .collect::<Vec<_>>();
        if let [(line_transaction_id, _, _)] = lines.as_slice() {
            connection
                .execute(
                    "UPDATE finance_installments SET transaction_id=?1,status='confirmed',updated_at=?2 WHERE id=?3",
                    params![line_transaction_id, timestamp, installment_id],
                )
                .map_err(storage)?;
            connection
                .execute(
                    "UPDATE finance_transactions SET deleted_at=?1,updated_at=?1 WHERE id=?2",
                    params![timestamp, transaction_id],
                )
                .map_err(storage)?;
        } else {
            create_review_item(
                connection,
                "missing-installment",
                &installment_id,
                serde_json::json!({ "installmentId": installment_id, "transactionId": transaction_id }),
                format!(
                    "La cuota {number}/{count} de «{description}» ({date}) no aparece en los resúmenes cargados. ¿La borro?"
                ),
                vec![
                    ReviewOption { id: "delete".into(), label: "Sí, borrarla".into() },
                    ReviewOption { id: "keep".into(), label: "No, dejarla".into() },
                ],
            )?;
        }
    }
    Ok(())
}

fn review_service_ambiguities(connection: &Connection) -> Result<(), String> {
    let statements = connection
        .prepare("SELECT id FROM finance_credit_card_statements")
        .map_err(storage)?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage)?;
    for statement_id in statements {
        let mut outcome = LinkOutcome::default();
        crate::finance_records::review_service_lines(connection, &statement_id, &mut outcome)?;
    }
    Ok(())
}

