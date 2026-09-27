//! Weather from Open-Meteo (open-meteo.com): the library's location, the
//! request URLs, reading the answers and the words for each WMO weather code.
//! The app makes the calls and formats what each view shows.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::error::BackendError;
use crate::mail_accounts::percent_encode;

/// Section of the library configuration that holds the weather location.
pub const WEATHER_KEY: &str = "weather";
pub const FORECAST_API: &str = "https://api.open-meteo.com/v1/forecast";
pub const GEOCODING_API: &str = "https://geocoding-api.open-meteo.com/v1/search";
/// Days Open-Meteo forecasts at most.
pub const MAX_FORECAST_DAYS: u32 = 16;
/// Days the Home dashboard shows.
pub const HOME_FORECAST_DAYS: u32 = 7;
const DEFAULT_TOOL_DAYS: u32 = 3;
const MAX_TOOL_HOURS: u32 = 48;
const MAX_NAME_CHARS: usize = 120;
const MAX_TIME_ZONE_CHARS: usize = 64;
/// Places a search returns.
pub const MAX_SEARCH_RESULTS: u32 = 8;
const MIN_QUERY_CHARS: usize = 2;

/// A place the forecast is asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherLocation {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    pub latitude: f64,
    pub longitude: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
}

impl WeatherLocation {
    /// «San Martín, Provincia de Mendoza, Argentina».
    pub fn label(&self) -> String {
        let mut parts = vec![self.name.as_str()];
        for part in [&self.admin1, &self.country].into_iter().flatten() {
            if !parts.iter().any(|existing| existing.eq_ignore_ascii_case(part)) {
                parts.push(part);
            }
        }
        parts.join(", ")
    }
}

/// Buenos Aires, until the library chooses a place.
pub fn default_location() -> WeatherLocation {
    WeatherLocation {
        name: "Buenos Aires".into(),
        admin1: Some("Ciudad Autónoma de Buenos Aires".into()),
        country: Some("Argentina".into()),
        latitude: -34.6131,
        longitude: -58.3772,
        timezone: Some("America/Argentina/Buenos_Aires".into()),
    }
}

fn clean_text(value: Option<&Value>, field: &str, required: bool) -> Result<Option<String>, BackendError> {
    let text = value.and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty());
    match text {
        None if required => Err(BackendError::invalid_input(format!("Falta {field} del lugar."))),
        None => Ok(None),
        Some(text) if text.chars().count() > MAX_NAME_CHARS || text.chars().any(char::is_control) => {
            Err(BackendError::invalid_input(format!("{field} del lugar no es válido.")))
        }
        Some(text) => Ok(Some(text.to_string())),
    }
}

fn coordinate(value: Option<&Value>, limit: f64, field: &str) -> Result<f64, BackendError> {
    value
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite() && number.abs() <= limit)
        .ok_or_else(|| BackendError::invalid_input(format!("La {field} del lugar no es válida.")))
}

/// A place sent by a client or read from Open-Meteo, checked field by field.
pub fn validate_location(value: &Value) -> Result<WeatherLocation, BackendError> {
    let timezone = value
        .get("timezone")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|zone| !zone.is_empty())
        .map(|zone| {
            let valid = zone.len() <= MAX_TIME_ZONE_CHARS
                && zone.chars().all(|char| char.is_ascii_alphanumeric() || matches!(char, '/' | '_' | '-' | '+'));
            valid.then(|| zone.to_string()).ok_or_else(|| BackendError::invalid_input("La zona horaria del lugar no es válida."))
        })
        .transpose()?;
    Ok(WeatherLocation {
        name: clean_text(value.get("name"), "El nombre", true)?.unwrap_or_default(),
        admin1: clean_text(value.get("admin1"), "La provincia", false)?,
        country: clean_text(value.get("country"), "El país", false)?,
        latitude: coordinate(value.get("latitude"), 90.0, "latitud")?,
        longitude: coordinate(value.get("longitude"), 180.0, "longitud")?,
        timezone,
    })
}

/// The stored section, or nothing when it is missing or invalid.
pub fn normalize_weather_config(value: Option<&Value>) -> Option<Value> {
    let location = validate_location(value?.get("location")?).ok()?;
    Some(json!({ "location": location }))
}

/// The library's place and whether it is the default one.
pub fn configured_location(config: Option<&Value>) -> (WeatherLocation, bool) {
    config
        .and_then(|config| config.get(WEATHER_KEY))
        .and_then(|section| section.get("location"))
        .and_then(|location| validate_location(location).ok())
        .map_or_else(|| (default_location(), true), |location| (location, false))
}

/// The configuration with `location` as the weather place.
pub fn with_weather_location(config: &Value, location: &WeatherLocation) -> Value {
    let mut config = config.clone();
    if let Some(object) = config.as_object_mut() {
        object.insert(WEATHER_KEY.into(), json!({ "location": location }));
    }
    config
}

// ---------- Requests ----------

/// Current conditions, hourly and daily forecast for `days` days, in the
/// place's own time zone.
pub fn forecast_url(location: &WeatherLocation, days: u32) -> String {
    format!(
        "{FORECAST_API}?latitude={:.4}&longitude={:.4}\
         &current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day\
         &hourly=temperature_2m,weather_code,precipitation_probability,is_day\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum\
         &timezone=auto&forecast_days={}",
        location.latitude,
        location.longitude,
        days.clamp(1, MAX_FORECAST_DAYS)
    )
}

/// A search of places by name, in Spanish.
pub fn search_query(query: &str) -> Result<String, BackendError> {
    let query = query.trim();
    if query.chars().count() < MIN_QUERY_CHARS {
        return Err(BackendError::invalid_input("Escribí al menos dos letras del lugar."));
    }
    if query.chars().count() > MAX_NAME_CHARS || query.chars().any(char::is_control) {
        return Err(BackendError::invalid_input("El lugar a buscar no es válido."));
    }
    Ok(query.to_string())
}

pub fn geocoding_url(query: &str, count: u32) -> String {
    format!("{GEOCODING_API}?name={}&count={}&language=es&format=json", percent_encode(query), count.clamp(1, MAX_SEARCH_RESULTS))
}

/// The places of a geocoding answer; none when nothing matched.
pub fn parse_locations(value: &Value) -> Vec<WeatherLocation> {
    value
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|result| validate_location(result).ok())
        .collect()
}

// ---------- The forecast ----------

#[derive(Debug, Clone, PartialEq)]
pub struct CurrentWeather {
    /// Local time of the place, `YYYY-MM-DDTHH:MM`.
    pub time: String,
    pub temperature: f64,
    pub feels_like: f64,
    pub humidity: f64,
    pub code: u8,
    pub wind_speed: f64,
    pub wind_direction: f64,
    pub is_day: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HourlyWeather {
    pub time: String,
    pub temperature: f64,
    pub code: u8,
    pub rain_probability: Option<u8>,
    pub is_day: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DailyWeather {
    /// `YYYY-MM-DD`.
    pub date: String,
    pub code: u8,
    pub max: f64,
    pub min: f64,
    pub rain_probability: Option<u8>,
    pub precipitation: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Forecast {
    pub timezone: String,
    pub current: CurrentWeather,
    pub hourly: Vec<HourlyWeather>,
    pub daily: Vec<DailyWeather>,
}

fn invalid_answer() -> BackendError {
    BackendError::invalid_input("Open-Meteo devolvió un pronóstico incompleto.")
}

fn number(value: &Value, key: &str) -> Result<f64, BackendError> {
    value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite()).ok_or_else(invalid_answer)
}

fn column<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn code(value: Option<&Value>) -> u8 {
    value.and_then(Value::as_u64).and_then(|code| u8::try_from(code).ok()).unwrap_or(u8::MAX)
}

fn percent(value: Option<&Value>) -> Option<u8> {
    value.and_then(Value::as_f64).filter(|number| number.is_finite()).map(|number| number.clamp(0.0, 100.0).round() as u8)
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|number| number.is_finite())
}

/// A forecast answer; rows with missing numbers are left out.
pub fn parse_forecast(value: &Value) -> Result<Forecast, BackendError> {
    let current = value.get("current").ok_or_else(invalid_answer)?;
    let current = CurrentWeather {
        time: current.get("time").and_then(Value::as_str).ok_or_else(invalid_answer)?.to_string(),
        temperature: number(current, "temperature_2m")?,
        feels_like: number(current, "apparent_temperature")?,
        humidity: number(current, "relative_humidity_2m")?,
        code: code(current.get("weather_code")),
        wind_speed: number(current, "wind_speed_10m")?,
        wind_direction: number(current, "wind_direction_10m")?,
        is_day: current.get("is_day").and_then(Value::as_u64) != Some(0),
    };
    let hourly_block = value.get("hourly").unwrap_or(&Value::Null);
    let temperatures = column(hourly_block, "temperature_2m");
    let codes = column(hourly_block, "weather_code");
    let rain = column(hourly_block, "precipitation_probability");
    let daylight = column(hourly_block, "is_day");
    let hourly = column(hourly_block, "time")
        .iter()
        .enumerate()
        .filter_map(|(index, time)| {
            Some(HourlyWeather {
                time: time.as_str()?.to_string(),
                temperature: finite(temperatures.get(index))?,
                code: code(codes.get(index)),
                rain_probability: percent(rain.get(index)),
                is_day: daylight.get(index).and_then(Value::as_u64) != Some(0),
            })
        })
        .collect();
    let daily_block = value.get("daily").unwrap_or(&Value::Null);
    let codes = column(daily_block, "weather_code");
    let maxima = column(daily_block, "temperature_2m_max");
    let minima = column(daily_block, "temperature_2m_min");
    let rain = column(daily_block, "precipitation_probability_max");
    let sums = column(daily_block, "precipitation_sum");
    let daily = column(daily_block, "time")
        .iter()
        .enumerate()
        .filter_map(|(index, date)| {
            Some(DailyWeather {
                date: date.as_str()?.to_string(),
                code: code(codes.get(index)),
                max: finite(maxima.get(index))?,
                min: finite(minima.get(index))?,
                rain_probability: percent(rain.get(index)),
                precipitation: finite(sums.get(index)),
            })
        })
        .collect();
    Ok(Forecast {
        timezone: value.get("timezone").and_then(Value::as_str).unwrap_or("UTC").to_string(),
        current,
        hourly,
        daily,
    })
}

/// The skies the views draw.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sky {
    Sun,
    Partly,
    Cloud,
    Rain,
    /// A clear or partly cloudy night.
    Night,
}

/// Words and sky of a WMO weather code.
pub fn condition(code: u8) -> (Sky, &'static str) {
    match code {
        0 => (Sky::Sun, "Despejado"),
        1 => (Sky::Sun, "Mayormente despejado"),
        2 => (Sky::Partly, "Parcialmente nublado"),
        3 => (Sky::Cloud, "Nublado"),
        45 | 48 => (Sky::Cloud, "Niebla"),
        51 | 53 | 55 => (Sky::Rain, "Llovizna"),
        56 | 57 => (Sky::Rain, "Llovizna helada"),
        61 => (Sky::Rain, "Lluvia débil"),
        63 => (Sky::Rain, "Lluvia"),
        65 => (Sky::Rain, "Lluvia fuerte"),
        66 | 67 => (Sky::Rain, "Lluvia helada"),
        71 | 73 | 75 => (Sky::Cloud, "Nieve"),
        77 => (Sky::Cloud, "Nieve granulada"),
        80 | 81 => (Sky::Rain, "Chaparrones"),
        82 => (Sky::Rain, "Chaparrones fuertes"),
        85 | 86 => (Sky::Cloud, "Chaparrones de nieve"),
        95 => (Sky::Rain, "Tormenta"),
        96 | 99 => (Sky::Rain, "Tormenta con granizo"),
        _ => (Sky::Cloud, "Sin datos"),
    }
}

/// Words and sky of a WMO code at a moment: a clear night shows the moon.
pub fn condition_at(code: u8, is_day: bool) -> (Sky, &'static str) {
    match condition(code) {
        (Sky::Sun | Sky::Partly, words) if !is_day => (Sky::Night, words),
        other => other,
    }
}

/// Where the wind blows from: «N», «NE», «E», «SE», «S», «SO», «O», «NO».
pub fn wind_direction(degrees: f64) -> &'static str {
    const POINTS: [&str; 8] = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
    let index = ((degrees.rem_euclid(360.0) + 22.5) / 45.0).floor() as usize % 8;
    POINTS[index]
}

// ---------- The agent's tool ----------

/// What `get_weather` asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WeatherToolRequest {
    /// A place to search; `None` uses the library's.
    pub location: Option<String>,
    pub days: u32,
    pub hours: u32,
}

pub fn parse_weather_tool(arguments: &Value) -> Result<WeatherToolRequest, BackendError> {
    let location = arguments
        .get("location")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|location| !location.is_empty())
        .map(search_query)
        .transpose()?;
    let whole = |key: &str, default: u32, range: std::ops::RangeInclusive<u32>| -> Result<u32, BackendError> {
        match arguments.get(key) {
            None | Some(Value::Null) => Ok(default),
            Some(value) => value
                .as_u64()
                .and_then(|number| u32::try_from(number).ok())
                .filter(|number| range.contains(number))
                .ok_or_else(|| BackendError::invalid_input(format!("{key} debe ser un entero entre {} y {}.", range.start(), range.end()))),
        }
    };
    Ok(WeatherToolRequest {
        location,
        days: whole("days", DEFAULT_TOOL_DAYS, 1..=MAX_FORECAST_DAYS)?,
        hours: whole("hours", 0, 0..=MAX_TOOL_HOURS)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer() -> Value {
        json!({
            "timezone": "America/Argentina/Buenos_Aires",
            "current": { "time": "2026-09-27T16:00", "temperature_2m": 18.6, "apparent_temperature": 17.5, "relative_humidity_2m": 70,
                "weather_code": 2, "wind_speed_10m": 13.6, "wind_direction_10m": 110, "is_day": 1 },
            "hourly": { "time": ["2026-09-27T16:00", "2026-09-27T17:00", "2026-09-27T18:00"], "temperature_2m": [18.6, null, 17.0],
                "weather_code": [2, 3, 61], "precipitation_probability": [10, 20, 55], "is_day": [1, 1, 0] },
            "daily": { "time": ["2026-09-27", "2026-09-28"], "weather_code": [95, 51], "temperature_2m_max": [18.6, 19.0],
                "temperature_2m_min": [13.6, 14.5], "precipitation_probability_max": [76, null], "precipitation_sum": [14.2, 0.2] }
        })
    }

    #[test]
    fn the_forecast_is_read_and_rows_without_numbers_are_left_out() {
        let forecast = parse_forecast(&answer()).unwrap();
        assert_eq!(forecast.current.time, "2026-09-27T16:00");
        assert_eq!(forecast.current.code, 2);
        assert!(forecast.current.is_day);
        assert_eq!(forecast.hourly.iter().map(|hour| hour.time.as_str()).collect::<Vec<_>>(), ["2026-09-27T16:00", "2026-09-27T18:00"]);
        assert_eq!(forecast.hourly[1].rain_probability, Some(55));
        assert!(forecast.hourly[0].is_day && !forecast.hourly[1].is_day);
        assert_eq!(forecast.daily[0].rain_probability, Some(76));
        assert_eq!(forecast.daily[1].rain_probability, None);
        assert_eq!(forecast.daily[0].precipitation, Some(14.2));
        assert!(parse_forecast(&json!({ "hourly": {} })).is_err());
    }

    #[test]
    fn codes_become_words_and_skies() {
        assert_eq!(condition(0), (Sky::Sun, "Despejado"));
        assert_eq!(condition(2), (Sky::Partly, "Parcialmente nublado"));
        assert_eq!(condition(45), (Sky::Cloud, "Niebla"));
        assert_eq!(condition(63), (Sky::Rain, "Lluvia"));
        assert_eq!(condition(95), (Sky::Rain, "Tormenta"));
        assert_eq!(condition(200), (Sky::Cloud, "Sin datos"));
        assert_eq!(condition_at(1, false), (Sky::Night, "Mayormente despejado"));
        assert_eq!(condition_at(63, false), (Sky::Rain, "Lluvia"));
        assert_eq!(condition_at(0, true), (Sky::Sun, "Despejado"));
        assert_eq!([0.0, 110.0, 130.0, 200.0, 350.0, -45.0].map(wind_direction), ["N", "E", "SE", "S", "N", "NO"]);
    }

    #[test]
    fn places_are_validated_and_labelled() {
        let found = parse_locations(&json!({ "results": [
            { "name": "San Martin", "latitude": -33.08, "longitude": -68.47, "country": "Argentina", "admin1": "Provincia de Mendoza", "timezone": "America/Argentina/Mendoza" },
            { "name": "Fuera", "latitude": 120.0, "longitude": 0.0 },
            { "name": "Buenos Aires", "latitude": -34.6, "longitude": -58.4, "admin1": "Buenos Aires", "country": "Argentina" }
        ] }));
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].label(), "San Martin, Provincia de Mendoza, Argentina");
        assert_eq!(found[1].label(), "Buenos Aires, Argentina");
        assert!(parse_locations(&json!({ "generationtime_ms": 0.2 })).is_empty());
        assert!(validate_location(&json!({ "name": "x", "latitude": 0, "longitude": 0, "timezone": "../etc" })).is_err());
        assert!(validate_location(&json!({ "name": " ", "latitude": 0, "longitude": 0 })).is_err());
    }

    #[test]
    fn the_library_keeps_its_place_and_falls_back_to_buenos_aires() {
        assert_eq!(configured_location(None), (default_location(), true));
        let cordoba = WeatherLocation { name: "Córdoba".into(), admin1: None, country: Some("Argentina".into()), latitude: -31.41, longitude: -64.18, timezone: None };
        let config = with_weather_location(&json!({ "version": 1 }), &cordoba);
        assert_eq!(configured_location(Some(&config)), (cordoba.clone(), false));
        assert_eq!(normalize_weather_config(config.get(WEATHER_KEY)), Some(json!({ "location": cordoba })));
        assert_eq!(normalize_weather_config(Some(&json!({ "location": { "name": "x" } }))), None);
    }

    #[test]
    fn requests_are_built_and_bounded() {
        let url = forecast_url(&default_location(), 40);
        assert!(url.starts_with("https://api.open-meteo.com/v1/forecast?latitude=-34.6131&longitude=-58.3772&current="));
        assert!(url.ends_with("&timezone=auto&forecast_days=16"));
        assert_eq!(geocoding_url("San Martín", 50), "https://geocoding-api.open-meteo.com/v1/search?name=San%20Mart%C3%ADn&count=8&language=es&format=json");
        assert!(search_query("a").is_err());
        assert_eq!(search_query("  Rosario ").unwrap(), "Rosario");
    }

    #[test]
    fn the_tool_takes_a_place_days_and_hours() {
        assert_eq!(parse_weather_tool(&json!({})).unwrap(), WeatherToolRequest { location: None, days: 3, hours: 0 });
        assert_eq!(
            parse_weather_tool(&json!({ "location": "Mar del Plata", "days": 7, "hours": 12 })).unwrap(),
            WeatherToolRequest { location: Some("Mar del Plata".into()), days: 7, hours: 12 }
        );
        assert!(parse_weather_tool(&json!({ "days": 0 })).is_err());
        assert!(parse_weather_tool(&json!({ "hours": 100 })).is_err());
        assert!(parse_weather_tool(&json!({ "days": "tres" })).is_err());
    }
}
