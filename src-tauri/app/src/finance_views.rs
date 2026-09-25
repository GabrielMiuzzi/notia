//! Derived finance views the interface shows: the period summary, the
//! dashboard figures, the salary evolution and the monthly state of each
//! service. They only read; every write keeps its own validation in
//! `finance*`.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::finance::{
    FinanceCategory, FinanceCommandResult, FinanceContext, FinanceSavingsMovement,
    FinanceSavingsReserve, FinanceTransaction,
};

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
    currency: String,
    amount: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebtRatioSummary {
    ratios: Vec<notia_backend_core::finance_insights::CurrencyRatio>,
    /// Month the ratio belongs to: the one shown, or the latest with data.
    period: String,
}

/// What went to savings in the month: contributions in each reserve's
/// currency, what the bought currency cost, and what was taken out.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedThisMonth {
    contributions_by_currency: BTreeMap<String, String>,
    cost_by_currency: BTreeMap<String, String>,
    withdrawals_by_currency: BTreeMap<String, String>,
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
    /// Cards paid over the salary that paid them, per month and currency.
    debt_ratio_series: DebtRatioSeries,
    services_ratio: DebtRatioSummary,
    /// Services paid over the salary that paid them, per month and currency.
    services_ratio_series: DebtRatioSeries,
    /// Services paid in the month.
    services_paid_by_currency: BTreeMap<String, String>,
    savings_to_income: Option<f64>,
    /// Card statements due in the month: what was paid for the cards.
    card_paid_by_currency: BTreeMap<String, String>,
    /// Card expenses that no loaded statement includes yet.
    card_unpaid_by_currency: BTreeMap<String, String>,
    card_unpaid_count: usize,
    saved_this_month: SavedThisMonth,
    /// Doubts the assistant asks about; answered in the chat or Telegram.
    review_items: Vec<crate::finance_matching::ReviewItem>,
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

type HistoryPoint = crate::finance::FinanceDebtRatioHistoryPoint;

/// A monthly amount over the salary that paid it, per currency. A month
/// without that amount or without salary has no value.
fn ratio_series(history: &[HistoryPoint], amount: impl Fn(&HistoryPoint) -> &BTreeMap<String, String>) -> DebtRatioSeries {
    let mut points = history.iter().collect::<Vec<_>>();
    points.sort_by(|left, right| left.period.cmp(&right.period));
    let currencies = points.iter().flat_map(|point| amount(point).keys().cloned()).collect::<std::collections::BTreeSet<_>>();
    let series = currencies
        .into_iter()
        .map(|currency| {
            let values = points
                .iter()
                .map(|point| {
                    notia_backend_core::finance_insights::debt_ratios(amount(point), &point.salary_by_currency)
                        .into_iter()
                        .find(|ratio| ratio.currency == currency)
                        .map(|ratio| ratio.percentage)
                })
                .collect::<Vec<_>>();
            CurrencySeries { currency, values }
        })
        .filter(|series| series.values.iter().any(Option::is_some))
        .collect();
    DebtRatioSeries { periods: points.iter().map(|point| point.period.clone()).collect(), series }
}

/// The ratio of the month shown, or of the latest month with data.
fn ratio_summary(
    month: &str,
    current: &BTreeMap<String, String>,
    salary: &BTreeMap<String, String>,
    history: &[HistoryPoint],
    amount: impl Fn(&HistoryPoint) -> &BTreeMap<String, String>,
) -> DebtRatioSummary {
    use notia_backend_core::finance_insights::debt_ratios;
    let ratios = debt_ratios(current, salary);
    if !ratios.is_empty() {
        return DebtRatioSummary { ratios, period: month.to_string() };
    }
    let mut points = history.iter().filter(|point| point.period.as_str() <= month).collect::<Vec<_>>();
    points.sort_by(|left, right| right.period.cmp(&left.period));
    points
        .into_iter()
        .map(|point| DebtRatioSummary { ratios: debt_ratios(amount(point), &point.salary_by_currency), period: point.period.clone() })
        .find(|summary| !summary.ratios.is_empty())
        .unwrap_or(DebtRatioSummary { ratios: Vec::new(), period: month.to_string() })
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

fn counted(status: &str) -> bool {
    matches!(status, "confirmed" | "corrected")
}

/// Expenses by category and currency; pesos and dollars never add up.
fn expenses_by_category(transactions: &[&FinanceTransaction], names: &HashMap<&str, &str>) -> Vec<CategoryTotal> {
    let mut totals = BTreeMap::<(String, String), i128>::new();
    for transaction in transactions.iter().filter(|item| counted(&item.status) && item.transaction_type == "expense") {
        let Some(amount) = cents(&transaction.amount) else { continue };
        let name = transaction.category_id.as_deref().and_then(|id| names.get(id)).copied().unwrap_or("Sin categoría");
        *totals.entry((name.to_string(), transaction.currency.clone())).or_default() += amount;
    }
    let mut rows = totals.into_iter().collect::<Vec<_>>();
    rows.sort_by(|left, right| left.0 .1.cmp(&right.0 .1).then(right.1.cmp(&left.1)));
    rows.into_iter()
        .map(|((name, currency), amount)| CategoryTotal { name, currency, amount: format_cents(amount) })
        .collect()
}

fn saved_this_month(transactions: &[FinanceTransaction], movements: &[FinanceSavingsMovement]) -> SavedThisMonth {
    let mut contributions = BTreeMap::new();
    let mut withdrawals = BTreeMap::new();
    for movement in movements.iter().filter(|movement| counted(&movement.status)) {
        match movement.movement_type.as_str() {
            "contribution" => add_to(&mut contributions, &movement.currency, &movement.amount),
            "withdrawal" => add_to(&mut withdrawals, &movement.currency, &movement.amount),
            _ => false,
        };
    }
    let mut cost = BTreeMap::new();
    for transaction in transactions.iter().filter(|transaction| {
        transaction.transaction_type == "exchange"
            && counted(&transaction.status)
            && movements.iter().any(|movement| {
                movement.linked_transaction_id.as_deref() == Some(transaction.id.as_str())
                    && movement.movement_type == "contribution"
            })
    }) {
        add_to(&mut cost, &transaction.currency, &transaction.amount);
    }
    SavedThisMonth {
        contributions_by_currency: contributions,
        cost_by_currency: cost,
        withdrawals_by_currency: withdrawals,
    }
}

fn formatted(totals: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    totals.iter().map(|(currency, amount)| (currency.clone(), format_cents(cents(amount).unwrap_or_default()))).collect()
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

    let names = dashboard.categories.iter().map(|category| (category.id.as_str(), category.name.as_str())).collect::<HashMap<_, _>>();
    let expenses_by_category = expenses_by_category(&filtered, &names);

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
    for movement in savings_movements.iter().filter(|movement| counted(&movement.status)) {
        if let Some(amount) = insights::cents(&movement.amount) {
            *breakdown.entry(movement.movement_type.clone()).or_default() += amount;
        }
    }

    // Cards and services paid over the salary that paid them: this month,
    // or the latest month with data.
    let debt_ratio = ratio_summary(&payload.month, &dashboard.debt_by_currency, &dashboard.salary_by_currency, &dashboard.debt_ratio_history, |point| &point.debt_by_currency);
    let services_ratio = ratio_summary(&payload.month, &dashboard.services_by_currency, &dashboard.salary_by_currency, &dashboard.debt_ratio_history, |point| &point.services_by_currency);

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

    let connection = crate::finance::validate_context(&context, &app)?;
    // Summary of the chosen period and, for a month, the change per category.
    let movements = crate::finance::finance_list_all_savings_movements(app.clone(), context.clone())?;
    let summary_of = |(from, to): (String, String)| {
        let transactions = crate::finance::list_transactions_between(&connection, &from, &to).ok()?;
        period_summary(&DateRange { from, to }, &transactions, &dashboard.categories, &movements, &dashboard.savings).ok()
    };
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

    // Card expenses waiting for their statement, whatever month they were bought.
    let mut card_unpaid_by_currency = BTreeMap::new();
    let unpaid = connection
        .prepare("SELECT currency,amount FROM finance_transactions WHERE status=?1 AND deleted_at IS NULL AND transaction_type='expense'")
        .and_then(|mut statement| {
            statement
                .query_map([crate::finance_matching::CARD_UNPAID], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|error| error.to_string())?;
    for (currency, amount) in &unpaid {
        add_to(&mut card_unpaid_by_currency, currency, amount);
    }
    let review_items = crate::finance_matching::list_review_items(&connection, Some("pending"), 20)?;
    drop(connection);

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
        expenses_by_category,
        savings_movements,
        savings_breakdown: breakdown.into_iter().map(|(kind, amount)| (kind, insights::format_cents(amount))).collect(),
        debt_ratio,
        debt_ratio_series: ratio_series(&dashboard.debt_ratio_history, |point| &point.debt_by_currency),
        services_ratio,
        services_ratio_series: ratio_series(&dashboard.debt_ratio_history, |point| &point.services_by_currency),
        services_paid_by_currency: dashboard.services_by_currency.clone(),
        savings_to_income,
        card_paid_by_currency: dashboard.debt_by_currency.clone(),
        card_unpaid_by_currency: formatted(&card_unpaid_by_currency),
        card_unpaid_count: unpaid.len(),
        saved_this_month: saved_this_month(&dashboard.transactions, &dashboard.savings_movements),
        review_items,
    })
}

/// State of each active service in a month, as the services list shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceMonthStatus {
    service_id: String,
    name: String,
    provider: Option<String>,
    currency: String,
    expected_amount: String,
    paid_amount: Option<String>,
    due_day: Option<i64>,
    /// `paid`, `pending` or `not-applicable`.
    status: &'static str,
    occurrence_id: Option<String>,
}

pub(crate) fn service_month_status(
    services: Vec<crate::finance::FinanceService>,
    occurrences: &[crate::finance::FinanceServiceOccurrence],
) -> Vec<ServiceMonthStatus> {
    services
        .into_iter()
        .filter(|service| service.active)
        .map(|service| {
            let occurrence = occurrences.iter().find(|occurrence| occurrence.service_id == service.id);
            let status = match occurrence {
                Some(occurrence) if occurrence.paid_amount.is_some() || occurrence.transaction_id.is_some() => "paid",
                Some(occurrence) if matches!(occurrence.status.as_str(), "discarded" | "rejected") => "not-applicable",
                _ => "pending",
            };
            ServiceMonthStatus {
                service_id: service.id,
                name: service.name,
                provider: service.provider,
                currency: service.currency,
                expected_amount: occurrence.map_or(service.expected_amount, |occurrence| occurrence.expected_amount.clone()),
                paid_amount: occurrence.and_then(|occurrence| occurrence.paid_amount.clone()),
                due_day: service.due_day,
                status,
                occurrence_id: occurrence.map(|occurrence| occurrence.id.clone()),
            }
        })
        .collect()
}

pub fn finance_service_month_status(
    app: crate::host::AppHandle,
    context: FinanceContext,
    period: String,
) -> FinanceCommandResult<Vec<ServiceMonthStatus>> {
    let services = crate::finance::finance_list_services(app.clone(), context.clone())?;
    let occurrences = crate::finance::finance_list_service_occurrences(app, context, period)?;
    Ok(service_month_status(services, &occurrences))
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
