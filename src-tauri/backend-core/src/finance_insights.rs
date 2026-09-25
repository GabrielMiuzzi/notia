//! Figures the Finanzas screen shows about the salary: its months in pesos
//! and dollars, the change over a year and how it compares with inflation.

use std::collections::BTreeMap;

use serde::Serialize;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn months_shift_and_span_their_days() {
        assert_eq!(month_range("2024-02"), Some(("2024-02-01".into(), "2024-02-29".into())));
        assert_eq!(shift_month("2024-01", -1).as_deref(), Some("2023-12"));
        assert_eq!(shift_month("2024-13", 1), None);
    }

    #[test]
    fn salaries_are_compared_in_pesos_dollars_and_against_inflation() {
        let salary = |period: &str, net: f64| SalaryInput { period: period.into(), payment_date: format!("{period}-05"), net, currency: "ARS".into() };
        let quotes = vec![("2024-01-01".to_string(), 100.0), ("2025-01-01".to_string(), 200.0)];
        let points = salary_points(&[salary("2024-01", 1000.0), salary("2025-01", 3000.0)], &quotes);
        assert_eq!(points[0], SalaryPoint { period: "2024-01".into(), ars: 1000.0, usd: 10.0 });
        assert_eq!(points[1].usd, 15.0);
        let summary = year_summary_at(&points, "2025-01").expect("summary");
        assert_eq!((summary.ars_variation_percent, summary.usd_variation_percent, summary.month_count), (200.0, 50.0, 1));
        let monthly = (1..=12).filter_map(|offset| shift_month("2024-01", offset)).map(|period| (period, 10.0)).collect::<BTreeMap<_, _>>();
        let annual = BTreeMap::from([("2025-01".to_string(), 200.0)]);
        let benchmark = inflation_benchmark(&summary, &monthly, &annual).expect("benchmark");
        assert_eq!(benchmark.ipc_accumulated_percent, 213.84);
        assert_eq!(benchmark.ars_vs_annual_percentage_points, 0.0);
    }
}
