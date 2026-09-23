//! Calendar holidays: validation and merge of provider data. The network
//! adapter fetches the raw series; this module decides what the UI shows.

use serde::Serialize;
use serde_json::Value;

use crate::error::BackendError;

pub const MIN_HOLIDAY_YEAR: i32 = 2016;
pub const MAX_HOLIDAY_YEAR: i32 = 2100;
const MAX_HOLIDAYS_PER_SERIES: usize = 200;
const MAX_NAME_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HolidayKind {
    National,
    Bank,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarHolidayDto {
    pub date: String,
    pub name: String,
    pub kind: HolidayKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub fn validate_holiday_year(year: i32) -> Result<(), BackendError> {
    if (MIN_HOLIDAY_YEAR..=MAX_HOLIDAY_YEAR).contains(&year) {
        Ok(())
    } else {
        Err(BackendError::invalid_input("El año del calendario no es válido."))
    }
}

fn is_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn series(value: &Value, year: i32, kind: HolidayKind) -> Result<Vec<CalendarHolidayDto>, BackendError> {
    let items = value
        .as_array()
        .ok_or_else(|| BackendError::invalid_input("El proveedor de feriados devolvió un formato inesperado."))?;
    let prefix = format!("{year}-");
    Ok(items
        .iter()
        .filter_map(|item| {
            let date = item.get("fecha")?.as_str()?;
            let name = item.get("nombre")?.as_str()?.trim();
            (is_iso_date(date) && date.starts_with(&prefix) && !name.is_empty()).then(|| CalendarHolidayDto {
                date: date.to_string(),
                name: name.chars().take(MAX_NAME_CHARS).collect(),
                kind,
                detail: match kind {
                    HolidayKind::National => item
                        .get("tipo")
                        .and_then(Value::as_str)
                        .map(|detail| detail.chars().take(MAX_NAME_CHARS).collect()),
                    HolidayKind::Bank => None,
                },
            })
        })
        .take(MAX_HOLIDAYS_PER_SERIES)
        .collect())
}

/// Merges national and bank holidays of `year`, one per date (bank data
/// wins on the same day, as before), sorted by date.
pub fn merge_argentina_holidays(
    year: i32,
    national: &Value,
    bank: &Value,
) -> Result<Vec<CalendarHolidayDto>, BackendError> {
    validate_holiday_year(year)?;
    let mut by_date = std::collections::BTreeMap::new();
    for holiday in series(national, year, HolidayKind::National)? {
        by_date.insert(holiday.date.clone(), holiday);
    }
    for holiday in series(bank, year, HolidayKind::Bank)? {
        by_date.insert(holiday.date.clone(), holiday);
    }
    Ok(by_date.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_filters_and_sorts_holidays() {
        let holidays = merge_argentina_holidays(
            2026,
            &json!([
                { "fecha": "2026-05-25", "nombre": "Revolución", "tipo": "inamovible" },
                { "fecha": "2025-01-01", "nombre": "Otro año" },
                { "fecha": "mal", "nombre": "X" },
            ]),
            &json!([{ "fecha": "2026-01-02", "nombre": "Bancario" }]),
        )
        .expect("merge");
        assert_eq!(holidays.len(), 2);
        assert_eq!(holidays[0].date, "2026-01-02");
        assert_eq!(holidays[0].kind, HolidayKind::Bank);
        assert_eq!(holidays[1].detail.as_deref(), Some("inamovible"));
        assert!(merge_argentina_holidays(2015, &json!([]), &json!([])).is_err());
        assert!(merge_argentina_holidays(2026, &json!({}), &json!([])).is_err());
    }
}
