//! Holiday provider (ArgentinaDatos) with timeout, bounded responses and an
//! in-memory cache per year. Validation and merging live in the core.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notia_backend_core::calendar::{merge_argentina_holidays, validate_holiday_year, CalendarHolidayDto};
use notia_backend_core::{BackendError, BackendErrorCode};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_RESPONSE_BYTES: usize = 512 * 1024;
const HOLIDAYS_URL: &str = "https://api.argentinadatos.com/v1/feriados";
const BANK_HOLIDAYS_URL: &str = "https://api.argentinadatos.com/v1/feriados-bancarios";

#[derive(Default)]
pub(crate) struct CalendarHolidaysState {
    cache: Mutex<HashMap<i32, (Instant, Vec<CalendarHolidayDto>)>>,
}

fn unavailable() -> BackendError {
    BackendError::new(
        BackendErrorCode::ProviderUnavailable,
        "No se pudieron obtener los feriados.",
        true,
    )
}

async fn fetch_series(client: &reqwest::Client, url: String) -> Result<serde_json::Value, BackendError> {
    let response = tokio::time::timeout(
        REQUEST_TIMEOUT,
        client.get(url).header(reqwest::header::ACCEPT, "application/json").send(),
    )
    .await
    .map_err(|_| unavailable())?
    .map_err(|_| unavailable())?;
    if !response.status().is_success() {
        return Err(unavailable());
    }
    let bytes = tokio::time::timeout(REQUEST_TIMEOUT, response.bytes())
        .await
        .map_err(|_| unavailable())?
        .map_err(|_| unavailable())?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(unavailable());
    }
    serde_json::from_slice(&bytes).map_err(|_| unavailable())
}

/// National and bank holidays of `year` for the calendar view.
#[tauri::command]
pub(crate) async fn calendar_argentina_holidays(
    year: i32,
    state: tauri::State<'_, CalendarHolidaysState>,
) -> Result<Vec<CalendarHolidayDto>, BackendError> {
    validate_holiday_year(year)?;
    if let Some((fetched_at, holidays)) = state.cache.lock().ok().and_then(|cache| cache.get(&year).cloned()) {
        if fetched_at.elapsed() < CACHE_TTL {
            return Ok(holidays);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| unavailable())?;
    let national = fetch_series(&client, format!("{HOLIDAYS_URL}/{year}")).await?;
    let bank = fetch_series(&client, format!("{BANK_HOLIDAYS_URL}/{year}")).await?;
    let holidays = merge_argentina_holidays(year, &national, &bank)?;
    if let Ok(mut cache) = state.cache.lock() {
        cache.insert(year, (Instant::now(), holidays.clone()));
    }
    Ok(holidays)
}
