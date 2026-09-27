//! Feriados de Argentina para la Agenda: los nacionales y los bancarios de
//! argentinadatos.com. Cada año se pide una sola vez a cada endpoint y queda
//! en memoria mientras la app está abierta; un año sin datos publicados (404)
//! queda vacío y uno que no se pudo leer se vuelve a pedir pasado un rato.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use chrono::{Datelike, NaiveDate};
use tokio::sync::Mutex;
use serde::{Deserialize, Serialize};

const API: &str = "https://api.argentinadatos.com/v1";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// A year that could not be read is asked again after this long.
const RETRY_AFTER: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum HolidayKind {
    #[serde(rename = "fixed")]
    Fixed,
    #[serde(rename = "move")]
    Movable,
    #[serde(rename = "bridge")]
    Bridge,
    /// Optional for employers; the days only banks close fall here.
    #[serde(rename = "nonwork")]
    NonWorking,
}

impl HolidayKind {
    fn from_api(tipo: &str) -> Self {
        match tipo {
            "inamovible" => Self::Fixed,
            "trasladable" => Self::Movable,
            "puente" => Self::Bridge,
            _ => Self::NonWorking,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Holiday {
    pub date: NaiveDate,
    pub name: String,
    pub kind: HolidayKind,
    /// Banks close that day.
    pub bank: bool,
    /// Only a bank holiday, not a national one.
    pub bank_only: bool,
}

impl Holiday {
    pub fn label(&self) -> &'static str {
        match self.kind {
            HolidayKind::Fixed => "Feriado inamovible",
            HolidayKind::Movable => "Feriado trasladable",
            HolidayKind::Bridge => "Puente turístico",
            HolidayKind::NonWorking if self.bank_only => "Feriado bancario",
            HolidayKind::NonWorking => "Día no laborable",
        }
    }

    /// A day off for everyone: the Agenda counts down to these.
    pub fn is_day_off(&self) -> bool {
        self.kind != HolidayKind::NonWorking
    }
}

/// The holidays of the years a view needs, by date, the most important first.
#[derive(Debug, Clone, Default)]
pub struct HolidayCalendar {
    pub days: BTreeMap<NaiveDate, Vec<Holiday>>,
    /// Years whose holidays could not be read.
    pub unavailable: BTreeSet<i32>,
}

impl HolidayCalendar {
    pub fn on(&self, date: NaiveDate) -> &[Holiday] {
        self.days.get(&date).map(Vec::as_slice).unwrap_or_default()
    }

    /// The first `count` days off from `from` on, one per date.
    pub fn next_days_off(&self, from: NaiveDate, count: usize) -> Vec<&Holiday> {
        self.days
            .range(from..)
            .filter_map(|(_, holidays)| holidays.iter().find(|holiday| holiday.is_day_off()))
            .take(count)
            .collect()
    }

    pub fn extend(&mut self, other: HolidayCalendar) {
        self.days.extend(other.days);
        self.unavailable.extend(other.unavailable);
    }

    fn add_year(&mut self, holidays: &[Holiday]) {
        for holiday in holidays {
            self.days.entry(holiday.date).or_default().push(holiday.clone());
        }
    }
}

#[derive(Debug, Deserialize)]
struct NationalRow {
    fecha: String,
    tipo: String,
    nombre: String,
}

#[derive(Debug, Deserialize)]
struct BankRow {
    fecha: String,
    nombre: String,
}

fn row_date(value: &str, year: i32) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d").ok().filter(|date| date.year() == year)
}

/// Joins the national and the bank lists of `year`, sorted by date and, on
/// the same date, by kind. A day only banks close is a non-working day.
fn merge(year: i32, national: &[NationalRow], bank: &[BankRow]) -> Vec<Holiday> {
    let bank_days: BTreeMap<NaiveDate, &str> = bank
        .iter()
        .filter_map(|row| Some((row_date(&row.fecha, year)?, row.nombre.trim())))
        .collect();
    let mut holidays: Vec<Holiday> = national
        .iter()
        .filter_map(|row| {
            let date = row_date(&row.fecha, year)?;
            let name = row.nombre.trim();
            (!name.is_empty()).then(|| Holiday {
                date,
                name: name.to_string(),
                kind: HolidayKind::from_api(row.tipo.trim()),
                bank: bank_days.contains_key(&date),
                bank_only: false,
            })
        })
        .collect();
    let national_days: BTreeSet<NaiveDate> = holidays.iter().map(|holiday| holiday.date).collect();
    holidays.extend(
        bank_days
            .into_iter()
            .filter(|(date, name)| !national_days.contains(date) && !name.is_empty())
            .map(|(date, name)| Holiday {
                date,
                name: name.to_string(),
                kind: HolidayKind::NonWorking,
                bank: true,
                bank_only: true,
            }),
    );
    holidays.sort_by(|left, right| (left.date, left.kind).cmp(&(right.date, right.kind)));
    holidays
}

enum CachedYear {
    Loaded(Arc<Vec<Holiday>>),
    Failed(Instant),
}

fn cache() -> &'static Mutex<HashMap<i32, CachedYear>> {
    static CACHE: OnceLock<Mutex<HashMap<i32, CachedYear>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

enum Fetch<T> {
    Found(T),
    /// The year has no published list.
    Missing,
}

async fn fetch_list<T: serde::de::DeserializeOwned>(client: &reqwest::Client, url: &str) -> Result<Fetch<Vec<T>>, ()> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|_| ())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Fetch::Missing);
    }
    if !response.status().is_success() {
        return Err(());
    }
    response.json::<Vec<T>>().await.map(Fetch::Found).map_err(|_| ())
}

/// One call to each endpoint for `year`.
async fn fetch_year(year: i32) -> Result<Vec<Holiday>, ()> {
    let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().map_err(|_| ())?;
    let national_url = format!("{API}/feriados/{year}");
    let bank_url = format!("{API}/feriados-bancarios/{year}");
    let national = match fetch_list::<NationalRow>(&client, &national_url).await? {
        Fetch::Found(rows) => rows,
        Fetch::Missing => Vec::new(),
    };
    let bank = match fetch_list::<BankRow>(&client, &bank_url).await? {
        Fetch::Found(rows) => rows,
        Fetch::Missing => Vec::new(),
    };
    Ok(merge(year, &national, &bank))
}

/// The holidays of `years`, read from the cache or asked once per year.
pub async fn calendar(years: impl IntoIterator<Item = i32>) -> HolidayCalendar {
    let mut calendar = HolidayCalendar::default();
    let years: BTreeSet<i32> = years.into_iter().collect();
    // Held while asking, so two views of the same year make a single call.
    let mut cache = cache().lock().await;
    for year in years {
        let cached = match cache.get(&year) {
            Some(CachedYear::Loaded(holidays)) => Some(Ok(holidays.clone())),
            Some(CachedYear::Failed(at)) if at.elapsed() < RETRY_AFTER => Some(Err(())),
            _ => None,
        };
        let result = match cached {
            Some(result) => result,
            None => {
                let fetched = fetch_year(year).await.map(Arc::new);
                match &fetched {
                    Ok(holidays) => cache.insert(year, CachedYear::Loaded(holidays.clone())),
                    Err(()) => {
                        log::error!("No se pudieron leer los feriados de {year}.");
                        cache.insert(year, CachedYear::Failed(Instant::now()))
                    }
                };
                fetched
            }
        };
        match result {
            Ok(holidays) => calendar.add_year(&holidays),
            Err(()) => {
                calendar.unavailable.insert(year);
            }
        }
    }
    calendar
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    fn national(fecha: &str, tipo: &str, nombre: &str) -> NationalRow {
        NationalRow { fecha: fecha.into(), tipo: tipo.into(), nombre: nombre.into() }
    }

    fn bank(fecha: &str, nombre: &str) -> BankRow {
        BankRow { fecha: fecha.into(), nombre: nombre.into() }
    }

    /// A calendar built from the lists, as the view receives it.
    pub(crate) fn calendar_of(year: i32, rows: &[(&str, &str, &str)], banks: &[(&str, &str)]) -> HolidayCalendar {
        let national: Vec<_> = rows.iter().map(|(fecha, tipo, nombre)| national(fecha, tipo, nombre)).collect();
        let bank: Vec<_> = banks.iter().map(|(fecha, nombre)| bank(fecha, nombre)).collect();
        let mut calendar = HolidayCalendar::default();
        calendar.add_year(&merge(year, &national, &bank));
        calendar
    }

    #[test]
    fn national_and_bank_holidays_are_joined_by_date() {
        let holidays = merge(
            2025,
            &[
                national("2025-04-18", "inamovible", "Viernes Santo"),
                national("2025-06-16", "trasladable", "Paso a la Inmortalidad del General Martín Güemes"),
                national("2025-06-20", "inamovible", "Paso a la Inmortalidad del General Manuel Belgrano"),
                national("2025-05-02", "puente", "Puente turístico no laborable"),
                national("2024-12-25", "inamovible", "De otro año"),
                national("2025-08-01", "desconocido", "Otro tipo"),
            ],
            &[
                bank("2025-04-17", "Jueves Santo"),
                bank("2025-04-18", "Viernes Santo"),
                bank("2025-06-16", "Güemes"),
                bank("2025-05-02", "Día no laborable con fines turísticos"),
            ],
        );
        let summary: Vec<_> = holidays
            .iter()
            .map(|holiday| (holiday.date.to_string(), holiday.kind, holiday.bank, holiday.label()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("2025-04-17".to_string(), HolidayKind::NonWorking, true, "Feriado bancario"),
                ("2025-04-18".to_string(), HolidayKind::Fixed, true, "Feriado inamovible"),
                ("2025-05-02".to_string(), HolidayKind::Bridge, true, "Puente turístico"),
                ("2025-06-16".to_string(), HolidayKind::Movable, true, "Feriado trasladable"),
                ("2025-06-20".to_string(), HolidayKind::Fixed, false, "Feriado inamovible"),
                ("2025-08-01".to_string(), HolidayKind::NonWorking, false, "Día no laborable"),
            ]
        );
        assert_eq!(holidays[0].name, "Jueves Santo");
    }

    #[test]
    fn the_countdown_skips_non_working_days() {
        let calendar = calendar_of(
            2025,
            &[("2025-04-18", "inamovible", "Viernes Santo"), ("2025-05-01", "inamovible", "Día del Trabajador")],
            &[("2025-04-17", "Jueves Santo")],
        );
        let next: Vec<_> = calendar.next_days_off(date("2025-04-16"), 2).iter().map(|holiday| holiday.name.clone()).collect();
        assert_eq!(next, vec!["Viernes Santo", "Día del Trabajador"]);
        assert_eq!(calendar.on(date("2025-04-17"))[0].kind, HolidayKind::NonWorking);
        assert!(calendar.on(date("2025-04-19")).is_empty());
    }

    #[test]
    fn kinds_serialize_as_the_view_expects() {
        let kinds: Vec<_> = [HolidayKind::Fixed, HolidayKind::Movable, HolidayKind::Bridge, HolidayKind::NonWorking]
            .iter()
            .map(|kind| serde_json::to_value(kind).unwrap())
            .collect();
        assert_eq!(kinds, vec!["fixed", "move", "bridge", "nonwork"]);
    }
}
