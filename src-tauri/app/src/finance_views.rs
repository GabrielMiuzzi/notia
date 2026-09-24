//! Derived finance views the interface shows: the period summary, the
//! relation audit, the live ticket arithmetic, the card/service
//! reconciliation preview and the salary extraction draft. They only read;
//! every write keeps its own validation in `finance*`.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::finance::{
    FinanceAccount, FinanceCategory, FinanceCommandResult, FinanceContext, FinanceSavingsMovement,
    FinanceSavingsReserve, FinanceService, FinanceServiceInvoice, FinanceServiceOccurrence, FinanceTransaction,
};
use crate::finance_records::{CreditCardStatement, Investment, PurchaseSummary};

const CURRENCIES: [&str; 2] = ["ARS", "USD"];
const SAVINGS_TYPES: [&str; 5] = ["contribution", "withdrawal", "return", "loss", "adjustment"];

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/// Non-negative amount with up to two decimals, in cents.
fn cents(value: &str) -> Option<i128> {
    let value = value.trim();
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let valid = !whole.is_empty()
        && whole.chars().all(|character| character.is_ascii_digit())
        && fraction.len() <= 2
        && fraction.chars().all(|character| character.is_ascii_digit())
        && (fraction.is_empty() == !value.contains('.'));
    if !valid {
        return None;
    }
    let whole = whole.parse::<i128>().ok()?;
    let fraction = format!("{fraction:0<2}").parse::<i128>().ok()?;
    whole.checked_mul(100)?.checked_add(fraction)
}

fn format_cents(value: i128) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.unsigned_abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

fn add_to(target: &mut BTreeMap<String, String>, key: &str, amount: &str) -> bool {
    let (Some(current), Some(amount)) = (cents(target.get(key).map_or("0", String::as_str)), cents(amount)) else {
        return false;
    };
    target.insert(key.to_string(), format_cents(current + amount));
    true
}

fn currency_totals() -> BTreeMap<String, String> {
    CURRENCIES.iter().map(|currency| (currency.to_string(), "0.00".to_string())).collect()
}

fn savings_by_type() -> BTreeMap<String, String> {
    SAVINGS_TYPES.iter().map(|kind| (kind.to_string(), "0.00".to_string())).collect()
}

fn savings_net(values: &BTreeMap<String, String>) -> String {
    let value = |key: &str| values.get(key).and_then(|amount| cents(amount)).unwrap_or(0);
    format_cents(value("contribution") + value("return") + value("adjustment") - value("withdrawal") - value("loss"))
}

fn valid_date(value: &str) -> bool {
    crate::finance::valid_iso_date(value)
}

// ---------------------------------------------------------------------------
// Period summary
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct DateRange {
    from: String,
    to: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseByCategory {
    category_id: Option<String>,
    category_name: String,
    currency: String,
    amount: String,
    count: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseByDay {
    date: String,
    by_currency: BTreeMap<String, String>,
    count: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavingsByReserve {
    reserve_id: String,
    reserve_name: String,
    currency: String,
    balance: String,
    period: BTreeMap<String, String>,
    net_change: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavingsSummary {
    by_currency: BTreeMap<String, BTreeMap<String, String>>,
    net_by_currency: BTreeMap<String, String>,
    reserve_balances_by_currency: BTreeMap<String, String>,
    by_reserve: Vec<SavingsByReserve>,
    movement_count: usize,
}

#[derive(Debug, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SummaryCoverage {
    total_transactions: usize,
    included_expenses: usize,
    pending_transactions: usize,
    discarded_transactions: usize,
    corrected_transactions: usize,
    uncategorized_expenses: usize,
    invalid_transaction_amounts: usize,
    included_incomes: usize,
    invalid_income_amounts: usize,
    total_savings_movements: usize,
    included_savings_movements: usize,
    invalid_savings_amounts: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PeriodSummary {
    range: DateRange,
    expense_by_currency: BTreeMap<String, String>,
    expense_by_category: Vec<ExpenseByCategory>,
    expense_by_day: Vec<ExpenseByDay>,
    income_by_currency: BTreeMap<String, String>,
    savings_rate_by_currency: BTreeMap<String, Option<String>>,
    savings: SavingsSummary,
    coverage: SummaryCoverage,
}

fn in_range(date: &str, range: &DateRange) -> bool {
    valid_date(date) && date >= range.from.as_str() && date <= range.to.as_str()
}

/// Expenses, incomes and savings of confirmed or corrected records in the
/// range. It never computes account balances.
pub(crate) fn period_summary(
    range: &DateRange,
    transactions: &[FinanceTransaction],
    categories: &[FinanceCategory],
    movements: &[FinanceSavingsMovement],
    reserves: &[FinanceSavingsReserve],
) -> Result<PeriodSummary, String> {
    if !valid_date(&range.from) || !valid_date(&range.to) || range.from > range.to {
        return Err("El período financiero no es válido.".into());
    }
    let category_names = categories.iter().map(|category| (category.id.as_str(), category.name.as_str())).collect::<HashMap<_, _>>();
    let reserves_by_id = reserves.iter().map(|reserve| (reserve.id.as_str(), reserve)).collect::<HashMap<_, _>>();
    let counted = |status: &str| matches!(status, "confirmed" | "corrected");
    let transactions = transactions
        .iter()
        .filter(|item| in_range(item.effective_date.get(..10).unwrap_or_default(), range))
        .collect::<Vec<_>>();
    let movements = movements
        .iter()
        .filter(|item| in_range(item.effective_date.get(..10).unwrap_or_default(), range))
        .collect::<Vec<_>>();
    let mut coverage = SummaryCoverage {
        total_transactions: transactions.len(),
        pending_transactions: transactions.iter().filter(|item| item.status == "pending").count(),
        discarded_transactions: transactions.iter().filter(|item| item.status == "discarded").count(),
        corrected_transactions: transactions.iter().filter(|item| item.status == "corrected").count(),
        total_savings_movements: movements.len(),
        ..SummaryCoverage::default()
    };
    let mut expense_by_currency = currency_totals();
    let mut income_by_currency = currency_totals();
    let mut by_category = BTreeMap::<(String, String), ExpenseByCategory>::new();
    let mut by_day = BTreeMap::<String, ExpenseByDay>::new();
    for transaction in transactions {
        let date = transaction.effective_date.get(..10).unwrap_or_default();
        if !counted(&transaction.status) {
            continue;
        }
        let Some(amount) = cents(&transaction.amount) else {
            coverage.invalid_transaction_amounts += 1;
            if transaction.transaction_type == "income" {
                coverage.invalid_income_amounts += 1;
            }
            continue;
        };
        match transaction.transaction_type.as_str() {
            "income" => {
                add_to(&mut income_by_currency, &transaction.currency, &transaction.amount);
                coverage.included_incomes += 1;
            }
            "expense" => {
                let category_id = transaction.category_id.clone().filter(|id| !id.is_empty());
                let entry = by_category
                    .entry((category_id.clone().unwrap_or_else(|| "uncategorized".into()), transaction.currency.clone()))
                    .or_insert_with(|| ExpenseByCategory {
                        category_name: match category_id.as_deref() {
                            Some(id) => category_names.get(id).map_or("Categoría inexistente", |name| name).to_string(),
                            None => "Sin categoría".to_string(),
                        },
                        category_id: category_id.clone(),
                        currency: transaction.currency.clone(),
                        amount: "0.00".into(),
                        count: 0,
                    });
                entry.amount = format_cents(cents(&entry.amount).unwrap_or(0) + amount);
                entry.count += 1;
                add_to(&mut expense_by_currency, &transaction.currency, &transaction.amount);
                let day = by_day.entry(date.to_string()).or_insert_with(|| ExpenseByDay {
                    date: date.to_string(),
                    by_currency: currency_totals(),
                    count: 0,
                });
                add_to(&mut day.by_currency, &transaction.currency, &transaction.amount);
                day.count += 1;
                coverage.included_expenses += 1;
                if category_id.is_none() {
                    coverage.uncategorized_expenses += 1;
                }
            }
            _ => {}
        }
    }

    let mut savings_by_currency = CURRENCIES
        .iter()
        .map(|currency| (currency.to_string(), savings_by_type()))
        .collect::<BTreeMap<_, _>>();
    let mut reserve_balances = currency_totals();
    let mut by_reserve = reserves
        .iter()
        .map(|reserve| {
            add_to(&mut reserve_balances, &reserve.currency, &reserve.balance);
            (
                reserve.id.clone(),
                SavingsByReserve {
                    reserve_id: reserve.id.clone(),
                    reserve_name: reserve.name.clone(),
                    currency: reserve.currency.clone(),
                    balance: reserve.balance.clone(),
                    period: savings_by_type(),
                    net_change: "0.00".into(),
                },
            )
        })
        .collect::<HashMap<_, _>>();
    for movement in movements {
        if !counted(&movement.status) {
            continue;
        }
        let Some(reserve) = reserves_by_id.get(movement.reserve_id.as_str()) else {
            continue;
        };
        if reserve.currency != movement.currency || !SAVINGS_TYPES.contains(&movement.movement_type.as_str()) {
            continue;
        }
        let Some(totals) = savings_by_currency.get_mut(&movement.currency) else {
            continue;
        };
        if cents(&movement.amount).is_none() || !add_to(totals, &movement.movement_type, &movement.amount) {
            coverage.invalid_savings_amounts += 1;
            continue;
        }
        if let Some(summary) = by_reserve.get_mut(&reserve.id) {
            if add_to(&mut summary.period, &movement.movement_type, &movement.amount) {
                summary.net_change = savings_net(&summary.period);
            }
        }
        coverage.included_savings_movements += 1;
    }

    let net_by_currency = savings_by_currency
        .iter()
        .map(|(currency, values)| (currency.clone(), savings_net(values)))
        .collect();
    let savings_rate_by_currency = CURRENCIES
        .iter()
        .map(|currency| {
            let income = cents(&income_by_currency[*currency]).unwrap_or(0);
            let contribution = cents(&savings_by_currency[*currency]["contribution"]).unwrap_or(0);
            (currency.to_string(), (income > 0).then(|| format_cents(contribution * 10_000 / income)))
        })
        .collect();
    let mut expense_by_category = by_category.into_values().collect::<Vec<_>>();
    expense_by_category.sort_by_key(|entry| std::cmp::Reverse(cents(&entry.amount).unwrap_or(0)));
    let mut by_reserve = by_reserve.into_values().collect::<Vec<_>>();
    by_reserve.sort_by(|left, right| left.reserve_name.to_lowercase().cmp(&right.reserve_name.to_lowercase()));
    Ok(PeriodSummary {
        range: range.clone(),
        expense_by_currency,
        expense_by_category,
        expense_by_day: by_day.into_values().collect(),
        income_by_currency,
        savings_rate_by_currency,
        savings: SavingsSummary {
            by_currency: savings_by_currency,
            net_by_currency,
            reserve_balances_by_currency: reserve_balances,
            by_reserve,
            movement_count: coverage.included_savings_movements,
        },
        coverage,
    })
}

// ---------------------------------------------------------------------------
// Relation audit
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelationIssue {
    entity: &'static str,
    entity_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_transaction_id: Option<Option<String>>,
    relation: &'static str,
    severity: &'static str,
    code: &'static str,
    message: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelationAudit {
    issues: Vec<RelationIssue>,
    entity_count: usize,
    complete_entity_count: usize,
    incomplete_entity_count: usize,
}

/// Records whose relations are audited; the optional groups are only
/// checked when present.
#[derive(Default)]
pub(crate) struct RelationInput {
    pub accounts: Vec<FinanceAccount>,
    pub categories: Vec<FinanceCategory>,
    pub transactions: Vec<FinanceTransaction>,
    pub services: Option<Vec<FinanceService>>,
    pub occurrences: Option<Vec<FinanceServiceOccurrence>>,
    pub invoices: Vec<FinanceServiceInvoice>,
    pub reserves: Vec<FinanceSavingsReserve>,
    pub movements: Vec<FinanceSavingsMovement>,
    pub purchases: Vec<PurchaseSummary>,
    pub statements: Vec<CreditCardStatement>,
    pub investments: Vec<Investment>,
}

struct Issues(Vec<RelationIssue>);

impl Issues {
    fn add(&mut self, entity: &'static str, id: &str, relation: &'static str, severity: &'static str, code: &'static str, message: impl Into<String>) {
        self.0.push(RelationIssue {
            entity,
            entity_id: id.to_string(),
            target_id: None,
            current_transaction_id: None,
            relation,
            severity,
            code,
            message: message.into(),
        });
    }

    /// Issue about the movement linked to a record or statement line, which
    /// the interface can repair.
    #[allow(clippy::too_many_arguments)]
    fn linked(&mut self, entity: &'static str, id: &str, target: &str, current: Option<&str>, relation: &'static str, severity: &'static str, code: &'static str, message: impl Into<String>) {
        self.add(entity, id, relation, severity, code, message);
        if let Some(issue) = self.0.last_mut() {
            issue.target_id = Some(target.to_string());
            issue.current_transaction_id = Some(current.map(str::to_string));
        }
    }
}

fn valid_expense(transaction: &FinanceTransaction) -> bool {
    transaction.transaction_type == "expense" && transaction.status != "discarded"
}

pub(crate) fn relation_audit(input: &RelationInput) -> RelationAudit {
    let accounts = input.accounts.iter().map(|item| (item.id.as_str(), item)).collect::<HashMap<_, _>>();
    let categories = input.categories.iter().map(|item| (item.id.as_str(), item)).collect::<HashMap<_, _>>();
    let transactions = input.transactions.iter().map(|item| (item.id.as_str(), item)).collect::<HashMap<_, _>>();
    let services = input.services.iter().flatten().map(|item| (item.id.as_str(), item)).collect::<HashMap<_, _>>();
    let mut issues = Issues(Vec::new());

    for transaction in &input.transactions {
        let id = transaction.id.as_str();
        let account = accounts.get(transaction.account_id.as_str());
        if transaction.account_id.is_empty() {
            issues.add("transaction", id, "account", "error", "missing-required", "El movimiento no declara una cuenta de origen.");
        } else if let Some(account) = account {
            if account.currency != transaction.currency {
                issues.add("transaction", id, "currency", "error", "currency-mismatch", "La moneda del movimiento no coincide con la cuenta declarada.");
            }
        } else {
            issues.add("transaction", id, "account", "error", "not-found", "La cuenta declarada por el movimiento no existe en el snapshot.");
        }
        let categorizable = matches!(transaction.transaction_type.as_str(), "income" | "expense");
        match transaction.category_id.as_deref().filter(|value| !value.is_empty()) {
            None if categorizable => issues.add("transaction", id, "category", "warning", "missing-optional", "El movimiento categorizable todavía no tiene categoría."),
            None => {}
            Some(category_id) => match categories.get(category_id) {
                None => issues.add("transaction", id, "category", "error", "not-found", "La categoría del movimiento no existe en el snapshot."),
                Some(category) if categorizable && category.kind != transaction.transaction_type => {
                    issues.add("transaction", id, "category", "error", "kind-mismatch", "La categoría no corresponde al tipo del movimiento.")
                }
                Some(_) => {}
            },
        }
        if transaction.transaction_type == "transfer" {
            match transaction.destination_account_id.as_deref().filter(|value| !value.is_empty()) {
                None => issues.add("transaction", id, "destination-account", "error", "missing-required", "La transferencia no declara una cuenta destino."),
                Some(destination_id) => match accounts.get(destination_id) {
                    None => issues.add("transaction", id, "destination-account", "error", "not-found", "La cuenta destino de la transferencia no existe en el snapshot."),
                    Some(destination) if account.is_some_and(|account| account.currency != destination.currency) => {
                        issues.add("transaction", id, "currency", "error", "currency-mismatch", "Las cuentas de la transferencia usan monedas distintas.")
                    }
                    Some(_) => {}
                },
            }
        }
        if let (Some(service_id), Some(_)) = (transaction.service_id.as_deref().filter(|value| !value.is_empty()), input.services.as_ref()) {
            match services.get(service_id) {
                None => issues.add("transaction", id, "service", "error", "not-found", "El servicio asociado al movimiento no existe en el snapshot."),
                Some(service) if service.currency != transaction.currency => {
                    issues.add("transaction", id, "currency", "error", "currency-mismatch", "La moneda del movimiento no coincide con la del servicio.")
                }
                Some(_) => {}
            }
        }
    }

    for occurrence in input.occurrences.iter().flatten() {
        let id = occurrence.id.as_str();
        let linked = occurrence.transaction_id.as_deref().and_then(|transaction_id| transactions.get(transaction_id));
        match services.get(occurrence.service_id.as_str()) {
            None => issues.add("service-occurrence", id, "service", "error", "not-found", "La ocurrencia no tiene un servicio existente."),
            Some(service) => {
                let evidence_currency = match (occurrence.paid_amount.as_ref(), linked) {
                    (Some(_), Some(transaction)) => transaction.currency.as_str(),
                    _ => service.currency.as_str(),
                };
                if service.currency != evidence_currency {
                    issues.add("service-occurrence", id, "currency", "error", "currency-mismatch", "La evidencia de pago de la ocurrencia usa otra moneda.");
                }
            }
        }
        match (occurrence.transaction_id.as_deref(), linked) {
            (Some(_), None) => issues.add("service-occurrence", id, "transaction", "error", "not-found", "La transacción vinculada a la ocurrencia no existe."),
            (Some(_), Some(transaction)) if !valid_expense(transaction) => {
                issues.add("service-occurrence", id, "transaction", "error", "kind-mismatch", "La ocurrencia está vinculada a un movimiento que no es un gasto confirmado válido.")
            }
            (None, _) if occurrence.paid_amount.is_some() => {
                issues.add("service-occurrence", id, "transaction", "warning", "missing-optional", "La ocurrencia tiene importe pagado pero no conserva un gasto vinculado.")
            }
            _ => {}
        }
    }

    for invoice in &input.invoices {
        let id = invoice.id.as_str();
        if let Some(service_id) = invoice.service_id.as_deref() {
            match services.get(service_id) {
                None => issues.add("service-invoice", id, "service", "error", "not-found", "La factura referencia un servicio inexistente."),
                Some(service) if service.currency != invoice.currency => {
                    issues.add("service-invoice", id, "currency", "error", "currency-mismatch", "La factura usa una moneda distinta de la del servicio.")
                }
                Some(_) => {}
            }
        }
        if invoice.transaction_id.as_deref().is_some_and(|transaction_id| !transactions.contains_key(transaction_id)) {
            issues.add("service-invoice", id, "transaction", "error", "not-found", "La factura referencia un gasto inexistente.");
        }
    }

    let reserves = input.reserves.iter().map(|item| (item.id.as_str(), item)).collect::<HashMap<_, _>>();
    for movement in &input.movements {
        let id = movement.id.as_str();
        match reserves.get(movement.reserve_id.as_str()) {
            None => issues.add("savings-movement", id, "reserve", "error", "not-found", "El movimiento de ahorro no tiene una reserva existente."),
            Some(reserve) if reserve.currency != movement.currency => {
                issues.add("savings-movement", id, "currency", "error", "currency-mismatch", "La moneda del movimiento no coincide con la reserva.")
            }
            Some(_) => {}
        }
        if let Some(account_id) = movement.account_id.as_deref() {
            match accounts.get(account_id) {
                None => issues.add("savings-movement", id, "account", "error", "not-found", "La cuenta declarada por el movimiento de ahorro no existe."),
                Some(account) if account.currency != movement.currency => {
                    issues.add("savings-movement", id, "currency", "error", "currency-mismatch", "La moneda del movimiento de ahorro no coincide con la cuenta declarada.")
                }
                Some(_) => {}
            }
        }
        if let Some(linked_id) = movement.linked_transaction_id.as_deref() {
            match transactions.get(linked_id) {
                None => issues.linked("savings-movement", id, id, Some(linked_id), "transaction", "error", "not-found", "El movimiento de ahorro referencia un gasto inexistente."),
                Some(transaction) if transaction.transaction_type != "expense" || transaction.currency != movement.currency => {
                    let code = if transaction.currency != movement.currency { "currency-mismatch" } else { "kind-mismatch" };
                    issues.linked("savings-movement", id, id, Some(linked_id), "transaction", "error", code, "El gasto vinculado al retiro de ahorro no es compatible.")
                }
                Some(_) => {}
            }
        }
    }

    for investment in &input.investments {
        let Some(account_id) = investment.account_id.as_deref() else {
            continue;
        };
        match accounts.get(account_id) {
            None => issues.add("investment", &investment.id, "account", "warning", "not-found", "La valuación referencia una cuenta que no existe."),
            Some(account) if account.currency != investment.currency => {
                issues.add("investment", &investment.id, "currency", "error", "currency-mismatch", "La valuación usa una moneda distinta de la cuenta declarada.")
            }
            Some(_) => {}
        }
    }

    let mut purchase_transactions = HashMap::<&str, &str>::new();
    for purchase in &input.purchases {
        let id = purchase.id.as_str();
        match purchase.account_id.as_deref().and_then(|account_id| accounts.get(account_id)) {
            None => issues.add("purchase", id, "account", "error", "not-found", "La compra referencia una cuenta inexistente."),
            Some(account) if account.currency != purchase.currency => {
                issues.add("purchase", id, "currency", "error", "currency-mismatch", "La compra usa una moneda distinta de la cuenta declarada.")
            }
            Some(_) => {}
        }
        let Some(transaction_id) = purchase.transaction_id.as_deref() else {
            issues.linked("purchase", id, id, None, "transaction", "warning", "missing-optional", "El ticket no tiene un movimiento de gasto asociado.");
            continue;
        };
        match transactions.get(transaction_id) {
            None => issues.linked("purchase", id, id, Some(transaction_id), "transaction", "error", "not-found", "El ticket referencia un movimiento inexistente."),
            Some(transaction) if !valid_expense(transaction) => {
                issues.linked("purchase", id, id, Some(transaction_id), "transaction", "error", "kind-mismatch", "El ticket no está asociado a un gasto válido.")
            }
            Some(transaction) if transaction.currency != purchase.currency => {
                issues.linked("purchase", id, id, Some(transaction_id), "currency", "error", "currency-mismatch", "El ticket y su movimiento usan monedas distintas.")
            }
            Some(_) => {}
        }
        match purchase_transactions.get(transaction_id) {
            Some(previous) => issues.linked("purchase", id, id, Some(transaction_id), "transaction", "error", "duplicate", format!("El movimiento también está asociado al ticket {previous}.")),
            None => {
                purchase_transactions.insert(transaction_id, id);
            }
        }
    }

    for statement in &input.statements {
        let id = statement.id.as_str();
        match accounts.get(statement.account_id.as_str()) {
            None => issues.add("statement", id, "account", "error", "not-found", "El resumen referencia una cuenta inexistente."),
            Some(account) if account.currency != statement.currency => {
                issues.add("statement", id, "currency", "error", "currency-mismatch", "El resumen usa una moneda distinta de la cuenta de tarjeta.")
            }
            Some(_) => {}
        }
        let mut line_transactions = HashMap::<&str, &str>::new();
        for item in statement.items.iter().filter(|item| matches!(item.item_type.as_str(), "purchase" | "fee" | "interest" | "tax")) {
            let line = item.id.as_str();
            let Some(transaction_id) = item.transaction_id.as_deref() else {
                issues.linked("statement", id, line, None, "transaction", "warning", "missing-optional", format!("La línea “{}” todavía no tiene un gasto asociado.", item.description));
                continue;
            };
            match transactions.get(transaction_id) {
                None => issues.linked("statement", id, line, Some(transaction_id), "transaction", "error", "not-found", format!("La línea “{}” referencia un movimiento inexistente.", item.description)),
                Some(transaction) if !valid_expense(transaction) => issues.linked("statement", id, line, Some(transaction_id), "transaction", "error", "kind-mismatch", format!("La línea “{}” no está asociada a un gasto válido.", item.description)),
                Some(transaction) if transaction.currency != item.currency => issues.linked("statement", id, line, Some(transaction_id), "currency", "error", "currency-mismatch", format!("La línea “{}” y su movimiento usan monedas distintas.", item.description)),
                Some(_) => {}
            }
            match line_transactions.get(transaction_id) {
                Some(previous) => issues.linked("statement", id, line, Some(transaction_id), "transaction", "error", "duplicate", format!("Las líneas {previous} y {line} reutilizan el mismo gasto.")),
                None => {
                    line_transactions.insert(transaction_id, line);
                }
            }
        }
    }

    if let Some(occurrences) = input.occurrences.as_ref() {
        let with_occurrence = occurrences.iter().map(|item| item.service_id.as_str()).collect::<HashSet<_>>();
        for service in input.services.iter().flatten().filter(|service| !with_occurrence.contains(service.id.as_str())) {
            issues.add("service", &service.id, "source-artifact", "warning", "missing-optional", "El servicio todavía no tiene ninguna ocurrencia registrada.");
        }
    }

    let entities = input
        .transactions
        .iter()
        .map(|item| ("transaction", item.id.as_str()))
        .chain(input.purchases.iter().map(|item| ("purchase", item.id.as_str())))
        .chain(input.services.iter().flatten().map(|item| ("service", item.id.as_str())))
        .chain(input.statements.iter().map(|item| ("statement", item.id.as_str())))
        .chain(input.occurrences.iter().flatten().map(|item| ("service-occurrence", item.id.as_str())))
        .chain(input.invoices.iter().map(|item| ("service-invoice", item.id.as_str())))
        .chain(input.movements.iter().map(|item| ("savings-movement", item.id.as_str())))
        .chain(input.investments.iter().map(|item| ("investment", item.id.as_str())))
        .collect::<HashSet<_>>();
    let incomplete = issues.0.iter().map(|issue| (issue.entity, issue.entity_id.as_str())).collect::<HashSet<_>>();
    let incomplete_count = incomplete.len();
    RelationAudit {
        entity_count: entities.len(),
        complete_entity_count: entities.len().saturating_sub(incomplete_count),
        incomplete_entity_count: incomplete_count,
        issues: issues.0,
    }
}

// ---------------------------------------------------------------------------
// Salary extraction draft
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SalaryDraft {
    #[serde(skip_serializing_if = "Option::is_none")]
    period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payment_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    employer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gross_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deductions_total: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    net_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    concepts: Option<Vec<Value>>,
}

fn normalized_key(value: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    value
        .nfd()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

fn object_candidates(value: &Value, output: &mut Vec<serde_json::Map<String, Value>>) {
    match value {
        Value::Array(items) => items.iter().for_each(|item| object_candidates(item, output)),
        Value::Object(object) => {
            output.push(object.clone());
            object.values().for_each(|item| object_candidates(item, output));
        }
        _ => {}
    }
}

/// JSON objects written inside a string, fenced or plain.
fn embedded_json(value: &Value) -> Vec<Value> {
    let Value::String(text) = value else {
        return Vec::new();
    };
    let blocks = text.split("```").enumerate().filter(|(index, _)| index % 2 == 1).map(|(_, block)| block).collect::<Vec<_>>();
    let candidates = if blocks.is_empty() { vec![text.as_str()] } else { blocks };
    candidates
        .into_iter()
        .filter_map(|candidate| {
            let cleaned = candidate.trim();
            let cleaned = cleaned.strip_prefix("json").unwrap_or(cleaned).trim();
            serde_json::from_str(cleaned).ok()
        })
        .collect()
}

fn find_value<'a>(candidates: &'a [serde_json::Map<String, Value>], aliases: &[&str]) -> Option<&'a Value> {
    let keys = aliases.iter().map(|alias| normalized_key(alias)).collect::<HashSet<_>>();
    candidates.iter().find_map(|candidate| {
        candidate.iter().find(|(key, _)| keys.contains(&normalized_key(key))).map(|(_, value)| value)
    })
}

fn draft_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn draft_money(value: Option<&Value>) -> Option<String> {
    crate::finance_agent_inputs::normalize_decimal(&Value::String(draft_text(value)?), 2)
}

/// Fields of a salary receipt found in the extraction result, for the form
/// to prefill. Nothing is persisted.
pub(crate) fn salary_draft(raw: &Value) -> SalaryDraft {
    let mut roots = vec![raw.clone()];
    let mut objects = Vec::new();
    object_candidates(raw, &mut objects);
    for object in &objects {
        for value in object.values() {
            roots.extend(embedded_json(value));
        }
    }
    let mut candidates = Vec::new();
    for root in &roots {
        object_candidates(root, &mut candidates);
    }
    let concepts = find_value(&candidates, &["concepts", "conceptos", "items"]).and_then(Value::as_array).map(|entries| {
        entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                let record = entry.as_object()?.clone();
                let record = [record];
                let name = draft_text(find_value(&record, &["name", "nombre", "concept", "concepto"]))?;
                let amount = draft_money(find_value(&record, &["amount", "importe", "monto"]))?;
                let kind = normalized_key(&draft_text(find_value(&record, &["type", "tipo"])).unwrap_or_default());
                let concept_type = if kind.contains("deduc") || kind.contains("descu") { "deduction" } else { "earning" };
                Some(serde_json::json!({ "id": format!("extracted-{index}"), "name": name, "conceptType": concept_type, "amount": amount }))
            })
            .collect::<Vec<_>>()
    });
    let currency = draft_text(find_value(&candidates, &["currency", "moneda"]))
        .map(|value| value.to_uppercase())
        .filter(|value| CURRENCIES.contains(&value.as_str()));
    SalaryDraft {
        period: draft_text(find_value(&candidates, &["period", "periodo"])),
        payment_date: draft_text(find_value(&candidates, &["paymentDate", "fechaCobro", "fechaPago"])),
        employer: draft_text(find_value(&candidates, &["employer", "empleador", "company", "empresa"])),
        gross_amount: draft_money(find_value(&candidates, &["grossAmount", "gross", "bruto", "totalBruto"])),
        deductions_total: draft_money(find_value(&candidates, &["deductionsTotal", "deductions", "descuentos", "totalDescuentos"])),
        net_amount: draft_money(find_value(&candidates, &["netAmount", "net", "neto", "totalNeto"])),
        currency,
        concepts,
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodSummaryPayload {
    context: FinanceContext,
    range: DateRange,
}

pub fn finance_period_summary(app: crate::host::AppHandle, payload: PeriodSummaryPayload) -> FinanceCommandResult<PeriodSummary> {
    let context = payload.context;
    let transactions = crate::finance::finance_list_all_transactions(app.clone(), context.clone())?;
    let categories = crate::finance::finance_list_categories(app.clone(), context.clone())?;
    let movements = crate::finance::finance_list_all_savings_movements(app.clone(), context.clone())?;
    let reserves = crate::finance::finance_get_dashboard(app, context, payload.range.to.get(..7).unwrap_or_default().to_string())?.savings;
    period_summary(&payload.range, &transactions, &categories, &movements, &reserves).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationAuditPayload {
    context: FinanceContext,
    /// Audits only the month shown by the dashboard; without it, every
    /// finance record of the library.
    #[serde(default)]
    month: Option<String>,
}

pub fn finance_relation_audit(app: crate::host::AppHandle, payload: RelationAuditPayload) -> FinanceCommandResult<RelationAudit> {
    let context = payload.context;
    if let Some(month) = payload.month {
        let dashboard = crate::finance::finance_get_dashboard(app, context, month)?;
        return Ok(relation_audit(&RelationInput {
            accounts: dashboard.accounts,
            categories: dashboard.categories,
            transactions: dashboard.transactions,
            ..RelationInput::default()
        }));
    }
    let list_period = || crate::finance_records::ListPeriodPayload {
        context: context.clone(),
        from: None,
        to: None,
        merchant_id: None,
        product_id: None,
    };
    // Reserves come with their balances from the dashboard of any month.
    let reserves = crate::finance::finance_get_dashboard(app.clone(), context.clone(), current_month())?.savings;
    Ok(relation_audit(&RelationInput {
        accounts: crate::finance::finance_list_accounts(app.clone(), context.clone())?,
        categories: crate::finance::finance_list_categories(app.clone(), context.clone())?,
        transactions: crate::finance::finance_list_all_transactions(app.clone(), context.clone())?,
        services: Some(crate::finance::finance_list_services(app.clone(), context.clone())?),
        occurrences: Some(crate::finance::finance_list_all_service_occurrences(app.clone(), context.clone())?),
        invoices: crate::finance::finance_list_service_invoices(app.clone(), context.clone(), None)?,
        reserves,
        movements: crate::finance::finance_list_all_savings_movements(app.clone(), context.clone())?,
        purchases: crate::finance_records::finance_list_purchases(app.clone(), list_period())?,
        statements: crate::finance_records::finance_list_credit_card_statements(app.clone(), list_period())?,
        investments: crate::finance_records::finance_list_investments(
            app,
            crate::finance_records::ListInvestmentsPayload { context, active: None },
        )?,
    }))
}

/// Arithmetic of a ticket being edited, with the same rules used to save it.
pub fn finance_validate_purchase(
    purchase: crate::finance_records::PurchaseRecord,
) -> FinanceCommandResult<crate::finance_records::PurchaseValidation> {
    crate::finance_records::validate_purchase(&purchase).map_err(Into::into)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPreviewPayload {
    context: FinanceContext,
    statement: CreditCardStatement,
}

/// Service assignments a card statement would apply, before it is saved.
/// Lines have no movement yet, so each one uses a preview reference.
pub fn finance_preview_card_services(
    app: crate::host::AppHandle,
    payload: CardPreviewPayload,
) -> FinanceCommandResult<crate::finance_reconciliation::CardServiceReconciliation> {
    use crate::finance_reconciliation::{ReconciliationInput, ReconciliationLine, ReconciliationOccurrence, ReconciliationService};
    let statement = payload.statement;
    let services = crate::finance::finance_list_services(app.clone(), payload.context.clone())?;
    let occurrences = [crate::finance_reconciliation::previous_period(&statement.period), Some(statement.period.clone())]
        .into_iter()
        .flatten()
        .map(|period| crate::finance::finance_list_service_occurrences(app.clone(), payload.context.clone(), period))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten();
    let input = ReconciliationInput {
        statement_id: statement.id.clone(),
        statement_period: statement.period.clone(),
        statement_snapshot: String::new(),
        lines: statement
            .items
            .iter()
            .map(|item| ReconciliationLine {
                id: item.id.clone(),
                transaction_id: Some(item.transaction_id.clone().unwrap_or_else(|| format!("preview:{}", item.id))),
                purchase_date: item.purchase_date.clone(),
                description: item.description.clone(),
                amount: item.amount.clone(),
                currency: item.currency.clone(),
                item_type: item.item_type.clone(),
                confirmed: true,
                transaction_snapshot: String::new(),
            })
            .collect(),
        services: services
            .into_iter()
            .filter(|service| service.active)
            .map(|service| ReconciliationService {
                id: service.id,
                name: service.name,
                provider: service.provider,
                currency: service.currency,
            })
            .collect(),
        occurrences: occurrences
            .map(|occurrence| ReconciliationOccurrence {
                id: occurrence.id,
                service_id: occurrence.service_id,
                period: occurrence.period,
                paid_amount: occurrence.paid_amount,
                transaction_id: occurrence.transaction_id,
                snapshot: String::new(),
            })
            .collect(),
    };
    Ok(crate::finance_reconciliation::reconcile_card_service_consumption(&input))
}

pub(crate) fn current_month() -> String {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default();
    crate::task_manager_store::format_iso_timestamp(now_ms)[..7].to_string()
}

pub fn finance_salary_draft(raw_result: Value) -> SalaryDraft {
    salary_draft(&raw_result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn transaction(id: &str, kind: &str, amount: &str, date: &str, category: Option<&str>) -> FinanceTransaction {
        serde_json::from_value(json!({
            "id": id, "transactionType": kind, "amount": amount, "currency": "ARS", "effectiveDate": date,
            "accountId": "a1", "destinationAccountId": null, "categoryId": category, "description": "x",
            "source": "app", "status": "confirmed", "actorUserId": null, "sourceArtifactId": null,
            "serviceId": null, "merchantId": null, "operationFingerprint": null, "installmentId": null,
            "sourceReference": null, "rawSource": null, "createdAt": null, "updatedAt": null
        }))
        .expect("transaction")
    }

    fn account() -> FinanceAccount {
        FinanceAccount { id: "a1".into(), name: "Banco".into(), account_type: "bank".into(), currency: "ARS".into(), active: true }
    }

    fn category(id: &str, kind: &str) -> FinanceCategory {
        FinanceCategory { id: id.into(), name: "Súper".into(), kind: kind.into(), active: true, parent_id: None, description: None }
    }

    #[test]
    fn summary_counts_confirmed_records_in_the_range() {
        let range = DateRange { from: "2026-09-01".into(), to: "2026-09-30".into() };
        let transactions = vec![
            transaction("t1", "expense", "100.50", "2026-09-02", Some("c1")),
            transaction("t2", "expense", "20", "2026-09-02", None),
            transaction("t3", "income", "1000", "2026-09-05", None),
            transaction("t4", "expense", "5", "2026-10-01", Some("c1")),
            transaction("t5", "expense", "1,5", "2026-09-03", None),
        ];
        let summary = period_summary(&range, &transactions, &[category("c1", "expense")], &[], &[]).expect("summary");
        assert_eq!(summary.expense_by_currency["ARS"], "120.50");
        assert_eq!(summary.income_by_currency["ARS"], "1000.00");
        assert_eq!(summary.expense_by_category[0].category_name, "Súper");
        assert_eq!(summary.expense_by_day.len(), 1);
        assert_eq!(summary.coverage.uncategorized_expenses, 1);
        assert_eq!(summary.coverage.invalid_transaction_amounts, 1);
        assert_eq!(summary.savings_rate_by_currency["ARS"].as_deref(), Some("0.00"));
        assert!(period_summary(&DateRange { from: "2026-09-30".into(), to: "2026-09-01".into() }, &[], &[], &[], &[]).is_err());
    }

    #[test]
    fn audit_reports_missing_and_mismatched_relations() {
        let mut orphan = transaction("t2", "expense", "5", "2026-09-02", Some("c2"));
        orphan.account_id = "missing".into();
        let input = RelationInput {
            accounts: vec![account()],
            categories: vec![category("c1", "expense"), category("c2", "income")],
            transactions: vec![transaction("t1", "expense", "5", "2026-09-02", Some("c1")), orphan],
            ..RelationInput::default()
        };
        let audit = relation_audit(&input);
        let codes = audit.issues.iter().map(|issue| issue.code).collect::<Vec<_>>();
        assert_eq!(codes, vec!["not-found", "kind-mismatch"]);
        assert_eq!((audit.entity_count, audit.incomplete_entity_count, audit.complete_entity_count), (2, 1, 1));
    }

    #[test]
    fn salary_draft_reads_fenced_json_and_aliases() {
        let raw = json!({ "response": "```json\n{\"empleador\": \"ACME\", \"neto\": \"$ 1.500,50\", \"moneda\": \"ars\", \"conceptos\": [{\"concepto\": \"Jubilación\", \"importe\": 100, \"tipo\": \"Descuento\"}]}\n```" });
        let draft = salary_draft(&raw);
        assert_eq!(draft.employer.as_deref(), Some("ACME"));
        assert_eq!(draft.currency.as_deref(), Some("ARS"));
        assert_eq!(draft.net_amount.as_deref(), Some("1500.5"));
        assert_eq!(draft.concepts.expect("concepts")[0]["conceptType"], "deduction");
    }
}

// ---------------------------------------------------------------------------
// Dashboard insights
// ---------------------------------------------------------------------------

const DASHBOARD_PAGE_SIZE: usize = 50;

/// Filters of the movements list.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionFilters {
    #[serde(default)]
    search: String,
    #[serde(default)]
    category_id: String,
    #[serde(default)]
    currency: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    account_id: String,
    #[serde(default)]
    source: String,
    #[serde(default)]
    service_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavingsFilters {
    #[serde(default)]
    reserve_id: String,
    #[serde(default)]
    currency: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardInsightsPayload {
    context: FinanceContext,
    month: String,
    summary_view: notia_backend_core::finance_insights::SummaryView,
    summary_date: String,
    #[serde(default)]
    filters: TransactionFilters,
    #[serde(default)]
    savings_filters: SavingsFilters,
    #[serde(default)]
    page: usize,
    /// Official dollar rate the screen shows (from `finance_dollar_quotes`).
    #[serde(default)]
    dollar_rate: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    name: String,
    amount: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtRatioSummary {
    ratios: Vec<notia_backend_core::finance_insights::CurrencyRatio>,
    /// Month the ratio belongs to: the one shown, or the latest with data.
    period: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardInsights {
    summary: Option<PeriodSummary>,
    /// Change of each expense category (`categoryId:currency`) against the previous month.
    category_variation: BTreeMap<String, Option<f64>>,
    transactions: Vec<FinanceTransaction>,
    transaction_count: usize,
    page: usize,
    page_count: usize,
    pending_count: usize,
    sources: Vec<String>,
    service_ids: Vec<String>,
    expenses_by_category: Vec<CategoryTotal>,
    savings_movements: Vec<FinanceSavingsMovement>,
    savings_breakdown: BTreeMap<String, String>,
    debt_ratio: DebtRatioSummary,
    /// Debt over income per month and currency, for the evolution chart.
    debt_ratio_series: DebtRatioSeries,
    savings_to_income: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtRatioSeries {
    periods: Vec<String>,
    series: Vec<CurrencySeries>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencySeries {
    currency: String,
    values: Vec<Option<f64>>,
}

fn debt_ratio_series(history: &[crate::finance::FinanceDebtRatioHistoryPoint]) -> DebtRatioSeries {
    let mut points = history.iter().collect::<Vec<_>>();
    points.sort_by(|left, right| left.period.cmp(&right.period));
    let currencies = points.iter().flat_map(|point| point.salary_by_currency.keys().cloned()).collect::<std::collections::BTreeSet<_>>();
    let series = currencies
        .into_iter()
        .map(|currency| {
            let values = points
                .iter()
                .map(|point| {
                    notia_backend_core::finance_insights::debt_ratios(&point.debt_by_currency, &point.salary_by_currency)
                        .into_iter()
                        .find(|ratio| ratio.currency == currency)
                        .map(|ratio| ratio.percentage)
                        .or_else(|| {
                            // A month with salary but no debt is 0 %.
                            let salary = notia_backend_core::finance_insights::cents(point.salary_by_currency.get(&currency)?)?;
                            (salary > 0 && !point.debt_by_currency.contains_key(&currency)).then_some(0.0)
                        })
                })
                .collect::<Vec<_>>();
            CurrencySeries { currency, values }
        })
        .filter(|series| series.values.iter().any(Option::is_some))
        .collect();
    DebtRatioSeries { periods: points.iter().map(|point| point.period.clone()).collect(), series }
}

fn matches_filters(transaction: &FinanceTransaction, filters: &TransactionFilters) -> bool {
    let search = filters.search.trim().to_lowercase();
    let is = |filter: &str, value: &str| filter.is_empty() || filter == value;
    (search.is_empty()
        || transaction.description.to_lowercase().contains(&search)
        || transaction.source.to_lowercase().contains(&search))
        && is(&filters.category_id, transaction.category_id.as_deref().unwrap_or_default())
        && is(&filters.currency, &transaction.currency)
        && is(&filters.status, &transaction.status)
        && is(&filters.account_id, &transaction.account_id)
        && is(&filters.source, &transaction.source)
        && is(&filters.service_id, transaction.service_id.as_deref().unwrap_or_default())
}

/// The latest item that passes `keep`, by date.
fn latest_by_date<T>(items: &[T], date: impl Fn(&T) -> &str, keep: impl Fn(&T) -> bool) -> Option<&T> {
    items.iter().filter(|item| keep(item)).max_by(|left, right| date(left).cmp(date(right)))
}

fn money(amount: &str, currency: &str) -> notia_backend_core::finance_insights::Money {
    notia_backend_core::finance_insights::Money {
        amount: amount.trim().parse::<f64>().unwrap_or(f64::NAN),
        currency: currency.to_string(),
    }
}

/// Everything the Finanzas dashboard shows besides the raw records.
pub fn finance_dashboard_insights(app: crate::host::AppHandle, payload: DashboardInsightsPayload) -> FinanceCommandResult<DashboardInsights> {
    use notia_backend_core::finance_insights as insights;
    let context = payload.context;
    let dashboard = crate::finance::finance_get_dashboard(app.clone(), context.clone(), payload.month.clone())?;

    // Movements list.
    let filtered = dashboard
        .transactions
        .iter()
        .filter(|transaction| matches_filters(transaction, &payload.filters))
        .collect::<Vec<_>>();
    let page_count = filtered.len().div_ceil(DASHBOARD_PAGE_SIZE).max(1);
    let page = payload.page.min(page_count - 1);
    let transactions = filtered
        .iter()
        .skip(page * DASHBOARD_PAGE_SIZE)
        .take(DASHBOARD_PAGE_SIZE)
        .map(|transaction| (*transaction).clone())
        .collect();
    let mut sources = dashboard.transactions.iter().map(|transaction| transaction.source.clone()).collect::<Vec<_>>();
    sources.sort();
    sources.dedup();
    let mut service_ids = dashboard.transactions.iter().filter_map(|transaction| transaction.service_id.clone()).collect::<Vec<_>>();
    service_ids.sort();
    service_ids.dedup();

    // Expenses of the filtered movements by category.
    let names = dashboard.categories.iter().map(|category| (category.id.as_str(), category.name.as_str())).collect::<HashMap<_, _>>();
    let mut by_category = BTreeMap::<String, i128>::new();
    for transaction in filtered.iter().filter(|item| item.status == "confirmed" && item.transaction_type == "expense") {
        let Some(amount) = insights::cents(&transaction.amount) else { continue };
        let name = transaction.category_id.as_deref().and_then(|id| names.get(id)).copied().unwrap_or("Sin categoría");
        *by_category.entry(name.to_string()).or_default() += amount;
    }
    let mut expenses_by_category = by_category.into_iter().collect::<Vec<_>>();
    expenses_by_category.sort_by(|left, right| right.1.cmp(&left.1));

    // Savings movements and their breakdown by type.
    let savings_movements = dashboard
        .savings_movements
        .iter()
        .filter(|movement| {
            (payload.savings_filters.reserve_id.is_empty() || movement.reserve_id == payload.savings_filters.reserve_id)
                && (payload.savings_filters.currency.is_empty() || movement.currency == payload.savings_filters.currency)
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut breakdown = BTreeMap::<String, i128>::new();
    for movement in savings_movements.iter().filter(|movement| movement.status == "confirmed") {
        if let Some(amount) = insights::cents(&movement.amount) {
            *breakdown.entry(movement.movement_type.clone()).or_default() += amount;
        }
    }

    // Debt over income: this month, or the latest month with data.
    let current = insights::debt_ratios(&dashboard.debt_by_currency, &dashboard.salary_by_currency);
    let debt_ratio = if current.is_empty() {
        let mut history = dashboard.debt_ratio_history.iter().collect::<Vec<_>>();
        history.sort_by(|left, right| right.period.cmp(&left.period));
        history
            .into_iter()
            .map(|point| DebtRatioSummary { ratios: insights::debt_ratios(&point.debt_by_currency, &point.salary_by_currency), period: point.period.clone() })
            .find(|summary| !summary.ratios.is_empty())
            .unwrap_or(DebtRatioSummary { ratios: Vec::new(), period: payload.month.clone() })
    } else {
        DebtRatioSummary { ratios: current, period: payload.month.clone() }
    };

    // Savings over the latest net salary.
    let salaries = crate::finance_records::finance_list_salaries(
        app.clone(),
        crate::finance_records::ListPeriodPayload { context: context.clone(), from: None, to: None, merchant_id: None, product_id: None },
    )
    .unwrap_or_default();
    let salary = salaries
        .iter()
        .map(|evolution| &evolution.salary)
        .max_by(|left, right| format!("{}-{}", left.period, left.payment_date).cmp(&format!("{}-{}", right.period, right.payment_date)))
        .map(|salary| money(&salary.net_amount, &salary.currency));
    let exchange = latest_by_date(&dashboard.transactions, |item| item.effective_date.as_str(), |item| item.status == "confirmed" && item.source == "savings_exchange")
        .map(|item| money(&item.amount, &item.currency));
    let exchange_movement = latest_by_date(&dashboard.savings_movements, |item| item.effective_date.as_str(), |item| item.status == "confirmed" && item.source == "savings_exchange")
        .map(|item| money(&item.amount, &item.currency));
    let reserves = dashboard.savings.iter().map(|reserve| money(&reserve.balance, &reserve.currency)).collect::<Vec<_>>();
    let savings_to_income = insights::savings_to_income(salary.as_ref(), exchange.as_ref(), exchange_movement.as_ref(), &reserves, payload.dollar_rate);

    // Summary of the chosen period and, for a month, the change per category.
    let all_transactions = crate::finance::finance_list_all_transactions(app.clone(), context.clone())?;
    let movements = crate::finance::finance_list_all_savings_movements(app.clone(), context.clone())?;
    let summary_of = |(from, to): (String, String)| period_summary(&DateRange { from, to }, &all_transactions, &dashboard.categories, &movements, &dashboard.savings).ok();
    let summary = insights::summary_range(payload.summary_view, &payload.month, &payload.summary_date).and_then(summary_of);
    let mut category_variation = BTreeMap::new();
    if payload.summary_view == insights::SummaryView::Month {
        let previous = insights::shift_month(&payload.month, -1).and_then(|month| insights::month_range(&month)).and_then(summary_of);
        if let (Some(current), Some(previous)) = (&summary, &previous) {
            let key = |item: &ExpenseByCategory| format!("{}:{}", item.category_id.as_deref().unwrap_or("uncategorized"), item.currency);
            let before = previous.expense_by_category.iter().map(|item| (key(item), item.amount.clone())).collect::<HashMap<_, _>>();
            for item in &current.expense_by_category {
                let previous_amount = before.get(&key(item)).map(String::as_str).unwrap_or("0");
                category_variation.insert(key(item), insights::variation(&item.amount, previous_amount));
            }
        }
    }

    Ok(DashboardInsights {
        summary,
        category_variation,
        transactions,
        transaction_count: filtered.len(),
        page,
        page_count,
        pending_count: dashboard.transactions.iter().filter(|transaction| transaction.status == "pending").count(),
        sources,
        service_ids,
        expenses_by_category: expenses_by_category
            .into_iter()
            .map(|(name, amount)| CategoryTotal { name, amount: insights::format_cents(amount) })
            .collect(),
        savings_movements,
        savings_breakdown: breakdown.into_iter().map(|(kind, amount)| (kind, insights::format_cents(amount))).collect(),
        debt_ratio,
        debt_ratio_series: debt_ratio_series(&dashboard.debt_ratio_history),
        savings_to_income,
    })
}

// ---------------------------------------------------------------------------
// Salary evolution
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryAnalysisPayload {
    context: FinanceContext,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryAnalysisPoint {
    #[serde(flatten)]
    point: notia_backend_core::finance_insights::SalaryPoint,
    /// Change against the previous month shown, in pesos and in dollars.
    ars_comparison: Option<notia_backend_core::finance_insights::SalaryComparison>,
    usd_comparison: Option<notia_backend_core::finance_insights::SalaryComparison>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryAnalysis {
    points: Vec<SalaryAnalysisPoint>,
    year_summary: Option<notia_backend_core::finance_insights::SalaryYearSummary>,
    inflation_benchmark: Option<notia_backend_core::finance_insights::SalaryInflationBenchmark>,
    /// Inflation indices could not be read; the salary figures still show.
    inflation_error: Option<String>,
}

/// Net salary per month in pesos and official dollars, its yearly change and
/// how it compares with inflation.
pub async fn finance_salary_analysis(app: crate::host::AppHandle, payload: SalaryAnalysisPayload) -> FinanceCommandResult<SalaryAnalysis> {
    use notia_backend_core::finance_insights as insights;
    let context = payload.context;
    let salaries = crate::host::async_runtime::spawn_blocking(move || {
        crate::finance_records::finance_list_salaries(
            app,
            crate::finance_records::ListPeriodPayload { context, from: None, to: None, merchant_id: None, product_id: None },
        )
    })
    .await
    .map_err(|_| "No se pudieron leer los sueldos.".to_string())??;
    if salaries.is_empty() {
        return Ok(SalaryAnalysis { points: Vec::new(), year_summary: None, inflation_benchmark: None, inflation_error: None });
    }
    let quotes = crate::services::finance_external::finance_historical_dollar_quotes(None, None).await?;
    let mut quotes = quotes.into_iter().map(|quote| (quote.date, quote.sell)).collect::<Vec<_>>();
    quotes.sort_by(|left, right| left.0.cmp(&right.0));
    let inputs = salaries
        .iter()
        .map(|evolution| insights::SalaryInput {
            period: evolution.salary.period.clone(),
            payment_date: evolution.salary.payment_date.clone(),
            net: evolution.salary.net_amount.trim().parse::<f64>().unwrap_or(f64::NAN),
            currency: evolution.salary.currency.clone(),
        })
        .collect::<Vec<_>>();
    let points = insights::salary_points(&inputs, &quotes);
    let year_summary = insights::latest_year_summary(&points);
    let (monthly, annual, inflation_error) = if year_summary.is_some() {
        match crate::services::finance_external::finance_inflation_indices().await {
            Ok(indices) => (
                indices.monthly.into_iter().map(|index| (index.period, index.percent)).collect::<BTreeMap<_, _>>(),
                indices.annual.into_iter().map(|index| (index.period, index.percent)).collect::<BTreeMap<_, _>>(),
                None,
            ),
            Err(error) => (BTreeMap::new(), BTreeMap::new(), Some(error)),
        }
    } else {
        (BTreeMap::new(), BTreeMap::new(), None)
    };
    let inflation_benchmark = insights::latest_inflation_benchmark(&points, &monthly, &annual);
    let analysed = (0..points.len())
        .map(|index| SalaryAnalysisPoint {
            point: points[index].clone(),
            ars_comparison: insights::compare_to_previous(&points, index, false, &monthly),
            usd_comparison: insights::compare_to_previous(&points, index, true, &monthly),
        })
        .collect();
    Ok(SalaryAnalysis { points: analysed, year_summary, inflation_benchmark, inflation_error })
}
