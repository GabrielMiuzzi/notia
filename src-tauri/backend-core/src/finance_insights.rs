//! Figures the Finanzas dashboard shows beside its records: the period of the
//! summary, debt and savings ratios and the change of each category against
//! the previous month. Amounts are decimal strings with up to two decimals.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Period the summary covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SummaryView {
    Day,
    Week,
    Month,
}

/// Amount in cents; `None` for anything but `123` or `123.4` / `123.45`.
pub fn cents(value: &str) -> Option<i128> {
    let value = value.trim();
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let digits = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(whole) || (value.contains('.') && (!digits(fraction) || fraction.len() > 2)) {
        return None;
    }
    let fraction = format!("{fraction:0<2}");
    Some(whole.parse::<i128>().ok()? * 100 + fraction.parse::<i128>().ok()?)
}

pub fn format_cents(value: i128) -> String {
    let sign = if value < 0 { "-" } else { "" };
    let absolute = value.abs();
    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

// Civil dates (proleptic Gregorian), for ranges without a date library.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

fn parse_month(month: &str) -> Option<(i64, i64)> {
    let (year, month) = month.split_once('-')?;
    let (year, month) = (year.parse::<i64>().ok()?, month.parse::<i64>().ok()?);
    (year > 0 && (1..=12).contains(&month)).then_some((year, month))
}

fn parse_date(date: &str) -> Option<i64> {
    let mut parts = date.splitn(3, '-');
    let (year, month, day) = (parts.next()?.parse().ok()?, parts.next()?.parse().ok()?, parts.next()?.parse::<i64>().ok()?);
    let days = days_from_civil(year, month, day);
    (civil_from_days(days) == (year, month, day)).then_some(days)
}

fn format_date(days: i64) -> String {
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

/// `YYYY-MM` shifted by whole months.
pub fn shift_month(month: &str, offset: i64) -> Option<String> {
    let (year, month) = parse_month(month)?;
    let index = year * 12 + (month - 1) + offset;
    Some(format!("{:04}-{:02}", index.div_euclid(12), index.rem_euclid(12) + 1))
}

/// First and last day of a month.
pub fn month_range(month: &str) -> Option<(String, String)> {
    let (year, month_number) = parse_month(month)?;
    let first = days_from_civil(year, month_number, 1);
    let next = shift_month(month, 1).and_then(|next| parse_month(&next))?;
    Some((format_date(first), format_date(days_from_civil(next.0, next.1, 1) - 1)))
}

/// Dates of the summary: the day, its Monday-to-Sunday week, or the month.
pub fn summary_range(view: SummaryView, month: &str, date: &str) -> Option<(String, String)> {
    match view {
        SummaryView::Month => month_range(month),
        SummaryView::Day => parse_date(date).map(|_| (date.to_string(), date.to_string())),
        SummaryView::Week => {
            let days = parse_date(date)?;
            // 1970-01-01 was a Thursday.
            let weekday = (days + 3).rem_euclid(7);
            let monday = days - weekday;
            Some((format_date(monday), format_date(monday + 6)))
        }
    }
}

/// Debt over income of one currency, in percent with one decimal (floored).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyRatio {
    pub currency: String,
    pub percentage: f64,
}

pub fn debt_ratios(debt: &BTreeMap<String, String>, income: &BTreeMap<String, String>) -> Vec<CurrencyRatio> {
    debt.iter()
        .filter_map(|(currency, amount)| {
            let income = cents(income.get(currency)?)?;
            let debt = cents(amount)?;
            (income > 0).then(|| CurrencyRatio { currency: currency.clone(), percentage: ((debt * 1_000) / income) as f64 / 10.0 })
        })
        .collect()
}

/// Money of a record: amount and currency.
#[derive(Debug, Clone, PartialEq)]
pub struct Money {
    pub amount: f64,
    pub currency: String,
}

/// Savings over the latest net salary, in percent. The last exchange to
/// savings counts when there is one (in the salary currency, converted with
/// the dollar rate otherwise); if not, the balance of every reserve.
pub fn savings_to_income(
    salary: Option<&Money>,
    latest_exchange: Option<&Money>,
    latest_exchange_movement: Option<&Money>,
    reserves: &[Money],
    dollar_rate: Option<f64>,
) -> Option<f64> {
    let salary = salary.filter(|salary| salary.amount.is_finite() && salary.amount > 0.0)?;
    let rate = dollar_rate.filter(|rate| *rate > 0.0);
    let savings = match latest_exchange {
        Some(exchange) if exchange.currency == salary.currency => exchange.amount,
        Some(exchange) => match latest_exchange_movement.filter(|movement| movement.currency == salary.currency) {
            Some(movement) => movement.amount,
            None => match rate {
                Some(_) if salary.currency == "ARS" => exchange.amount,
                Some(rate) => exchange.amount / rate,
                None => 0.0,
            },
        },
        None => reserves
            .iter()
            .filter(|reserve| reserve.amount.is_finite())
            .map(|reserve| {
                if reserve.currency == salary.currency {
                    reserve.amount
                } else {
                    match rate {
                        Some(rate) if salary.currency == "ARS" => reserve.amount * rate,
                        Some(rate) => reserve.amount / rate,
                        None => 0.0,
                    }
                }
            })
            .sum(),
    };
    Some(savings / salary.amount * 100.0)
}

/// Percent change against the previous value; `None` without a base.
pub fn variation(current: &str, previous: &str) -> Option<f64> {
    let (current, previous) = (current.trim().parse::<f64>().ok()?, previous.trim().parse::<f64>().ok()?);
    (previous > 0.0).then(|| (current - previous) / previous * 100.0)
}

// ---------------------------------------------------------------------------
// Salary evolution
// ---------------------------------------------------------------------------

/// A salary receipt: period, payment date, net amount and currency.
#[derive(Debug, Clone, PartialEq)]
pub struct SalaryInput {
    pub period: String,
    pub payment_date: String,
    pub net: f64,
    pub currency: String,
}

/// Net salary of a month in pesos and in official dollars.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryPoint {
    pub period: String,
    pub ars: f64,
    pub usd: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryComparison {
    pub salary_change_percent: f64,
    pub ipc_accumulated_percent: Option<f64>,
    pub ipc_difference_percentage_points: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryYearSummary {
    pub current_period: String,
    pub comparison_period: String,
    pub month_count: usize,
    pub ars_variation_percent: f64,
    pub usd_variation_percent: f64,
    pub average_ars: f64,
    pub average_usd: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SalaryInflationBenchmark {
    pub period: String,
    pub ipc_accumulated_percent: f64,
    pub annual_inflation_percent: f64,
    pub ars_vs_ipc_percentage_points: f64,
    pub ars_vs_annual_percentage_points: f64,
    pub usd_vs_ipc_percentage_points: f64,
    pub usd_vs_annual_percentage_points: f64,
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn months_between(from: &str, to: &str) -> Option<i64> {
    let (from, to) = (parse_month(from)?, parse_month(to)?);
    Some((to.0 - from.0) * 12 + to.1 - from.1)
}

/// Salaries of each month in pesos and dollars, with the official selling
/// rate of the payment day (or the last one before it). `quotes` are
/// `(date, sell)` sorted by date.
pub fn salary_points(salaries: &[SalaryInput], quotes: &[(String, f64)]) -> Vec<SalaryPoint> {
    let mut totals = BTreeMap::<String, SalaryPoint>::new();
    for salary in salaries {
        let rate = quotes.iter().rev().find(|(date, _)| date.as_str() <= salary.payment_date.as_str()).map(|(_, sell)| *sell);
        let Some(rate) = rate.filter(|rate| *rate > 0.0) else { continue };
        if !salary.net.is_finite() || salary.net < 0.0 {
            continue;
        }
        let point = totals.entry(salary.period.clone()).or_insert_with(|| SalaryPoint { period: salary.period.clone(), ars: 0.0, usd: 0.0 });
        if salary.currency == "ARS" {
            point.ars += salary.net;
            point.usd += salary.net / rate;
        } else {
            point.ars += salary.net * rate;
            point.usd += salary.net;
        }
    }
    totals.into_values().collect()
}

/// Accumulated inflation of the months after `from` up to `months` later,
/// when every month is known.
fn accumulated_inflation(from: &str, months: i64, monthly: &BTreeMap<String, f64>) -> Option<f64> {
    let mut factor = 1.0;
    for offset in 1..=months {
        factor *= 1.0 + monthly.get(&shift_month(from, offset)?)? / 100.0;
    }
    Some(round2((factor - 1.0) * 100.0))
}

/// Change of a point against the previous one, and the inflation between them.
pub fn compare_to_previous(points: &[SalaryPoint], index: usize, in_dollars: bool, monthly: &BTreeMap<String, f64>) -> Option<SalaryComparison> {
    let (previous, current) = (points.get(index.checked_sub(1)?)?, points.get(index)?);
    let value = |point: &SalaryPoint| if in_dollars { point.usd } else { point.ars };
    if value(previous) == 0.0 || !value(previous).is_finite() || !value(current).is_finite() {
        return None;
    }
    let salary_change_percent = round2((value(current) - value(previous)) / value(previous) * 100.0);
    let ipc = months_between(&previous.period, &current.period)
        .filter(|months| *months > 0)
        .and_then(|months| accumulated_inflation(&previous.period, months, monthly));
    Some(SalaryComparison {
        salary_change_percent,
        ipc_accumulated_percent: ipc,
        ipc_difference_percentage_points: ipc.map(|ipc| round2(salary_change_percent - ipc)),
    })
}

/// Twelve-month summary ending at `period`: change against the same month
/// a year before and the monthly average of the months in between.
pub fn year_summary_at(points: &[SalaryPoint], period: &str) -> Option<SalaryYearSummary> {
    let current = points.iter().find(|point| point.period == period && parse_month(&point.period).is_some())?;
    let comparison_period = shift_month(&current.period, -12)?;
    let comparison = points.iter().find(|point| point.period == comparison_period)?;
    if comparison.ars == 0.0 || comparison.usd == 0.0 {
        return None;
    }
    let rolling = points
        .iter()
        .filter(|point| point.period.as_str() > comparison_period.as_str() && point.period.as_str() <= current.period.as_str())
        .collect::<Vec<_>>();
    if rolling.is_empty() {
        return None;
    }
    let change = |start: f64, end: f64| round2((end - start) / start * 100.0);
    Some(SalaryYearSummary {
        current_period: current.period.clone(),
        comparison_period,
        month_count: rolling.len(),
        ars_variation_percent: change(comparison.ars, current.ars),
        usd_variation_percent: change(comparison.usd, current.usd),
        average_ars: rolling.iter().map(|point| point.ars).sum::<f64>() / rolling.len() as f64,
        average_usd: rolling.iter().map(|point| point.usd).sum::<f64>() / rolling.len() as f64,
    })
}

/// Summary of the latest month.
pub fn latest_year_summary(points: &[SalaryPoint]) -> Option<SalaryYearSummary> {
    let latest = points.iter().filter(|point| parse_month(&point.period).is_some()).map(|point| point.period.as_str()).max()?;
    year_summary_at(points, latest)
}

/// Salary change of a year against inflation of the same months.
pub fn inflation_benchmark(summary: &SalaryYearSummary, monthly: &BTreeMap<String, f64>, annual: &BTreeMap<String, f64>) -> Option<SalaryInflationBenchmark> {
    let ipc = accumulated_inflation(&summary.comparison_period, 12, monthly)?;
    let annual_inflation = *annual.get(&summary.current_period)?;
    Some(SalaryInflationBenchmark {
        period: summary.current_period.clone(),
        ipc_accumulated_percent: ipc,
        annual_inflation_percent: annual_inflation,
        ars_vs_ipc_percentage_points: round2(summary.ars_variation_percent - ipc),
        ars_vs_annual_percentage_points: round2(summary.ars_variation_percent - annual_inflation),
        usd_vs_ipc_percentage_points: round2(summary.usd_variation_percent - ipc),
        usd_vs_annual_percentage_points: round2(summary.usd_variation_percent - annual_inflation),
    })
}

/// The benchmark of the latest month that has a full year of salaries and inflation.
pub fn latest_inflation_benchmark(points: &[SalaryPoint], monthly: &BTreeMap<String, f64>, annual: &BTreeMap<String, f64>) -> Option<SalaryInflationBenchmark> {
    let mut periods = points.iter().map(|point| point.period.as_str()).collect::<Vec<_>>();
    periods.sort_unstable_by(|left, right| right.cmp(left));
    periods.dedup();
    periods
        .into_iter()
        .filter_map(|period| year_summary_at(points, period))
        .find_map(|summary| inflation_benchmark(&summary, monthly, annual))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn money(amount: f64, currency: &str) -> Money {
        Money { amount, currency: currency.into() }
    }

    #[test]
    fn amounts_are_read_as_cents() {
        assert_eq!(cents("12.5"), Some(1250));
        assert_eq!(cents("7"), Some(700));
        assert_eq!(cents("1.234"), None);
        assert_eq!(cents("-3"), None);
        assert_eq!(format_cents(-1205), "-12.05");
    }

    #[test]
    fn summary_ranges_cover_the_day_week_or_month() {
        assert_eq!(month_range("2024-02"), Some(("2024-02-01".into(), "2024-02-29".into())));
        assert_eq!(shift_month("2024-01", -1).as_deref(), Some("2023-12"));
        assert_eq!(summary_range(SummaryView::Week, "2026-09", "2026-09-23"), Some(("2026-09-21".into(), "2026-09-27".into())));
        assert_eq!(summary_range(SummaryView::Day, "2026-09", "2026-02-30"), None);
    }

    #[test]
    fn salaries_are_compared_in_pesos_dollars_and_against_inflation() {
        let salary = |period: &str, net: f64| SalaryInput { period: period.into(), payment_date: format!("{period}-05"), net, currency: "ARS".into() };
        let quotes = vec![("2024-01-01".to_string(), 100.0), ("2025-01-01".to_string(), 200.0)];
        let points = salary_points(&[salary("2024-01", 1000.0), salary("2025-01", 3000.0)], &quotes);
        assert_eq!(points[0], SalaryPoint { period: "2024-01".into(), ars: 1000.0, usd: 10.0 });
        assert_eq!(points[1].usd, 15.0);
        let summary = latest_year_summary(&points).expect("summary");
        assert_eq!((summary.ars_variation_percent, summary.usd_variation_percent, summary.month_count), (200.0, 50.0, 1));
        let monthly = (1..=12).filter_map(|offset| shift_month("2024-01", offset)).map(|period| (period, 10.0)).collect::<BTreeMap<_, _>>();
        let annual = BTreeMap::from([("2025-01".to_string(), 200.0)]);
        let benchmark = latest_inflation_benchmark(&points, &monthly, &annual).expect("benchmark");
        assert_eq!(benchmark.ipc_accumulated_percent, 213.84);
        assert_eq!(benchmark.ars_vs_annual_percentage_points, 0.0);
        let comparison = compare_to_previous(&points, 1, false, &monthly).expect("comparison");
        assert_eq!((comparison.salary_change_percent, comparison.ipc_accumulated_percent), (200.0, Some(213.84)));
        assert!(compare_to_previous(&points, 0, false, &monthly).is_none());
    }

    #[test]
    fn ratios_and_variations() {
        let debt = BTreeMap::from([("ARS".to_string(), "333.33".to_string()), ("USD".to_string(), "5".to_string())]);
        let income = BTreeMap::from([("ARS".to_string(), "1000".to_string())]);
        assert_eq!(debt_ratios(&debt, &income), vec![CurrencyRatio { currency: "ARS".into(), percentage: 33.3 }]);
        assert_eq!(variation("150", "100"), Some(50.0));
        assert_eq!(variation("150", "0"), None);
        let salary = money(1000.0, "ARS");
        assert_eq!(savings_to_income(Some(&salary), None, None, &[money(10.0, "USD")], Some(100.0)), Some(100.0));
        assert_eq!(savings_to_income(Some(&salary), Some(&money(200.0, "ARS")), None, &[], None), Some(20.0));
        assert_eq!(savings_to_income(None, None, None, &[], None), None);
    }
}
