//! Weather for Home and the agent, from Open-Meteo (no key needed). Answers
//! stay in memory for 15 minutes per place, so Home can ask again whenever it
//! reloads; when Open-Meteo cannot be reached, a recent answer is used.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{Duration as ChronoDuration, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::agenda_view::{weekday_index, WEEKDAY_LONG, WEEKDAY_SHORT};
use crate::backend::weather::{
    condition, condition_at, configured_location, forecast_url, geocoding_url, parse_forecast, parse_locations, parse_weather_tool,
    search_query, validate_location, wind_direction, with_weather_location, Forecast, Sky, WeatherLocation,
    HOME_FORECAST_DAYS, MAX_SEARCH_RESULTS,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter};

/// Emitted after the library's place changes, so Home reads the weather again.
const WEATHER_PLACE_CHANGED_EVENT: &str = "notia:weather-place-changed";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const FRESH_FOR: Duration = Duration::from_secs(15 * 60);
/// An older answer still stands in when Open-Meteo cannot be reached.
const STALE_FOR: Duration = Duration::from_secs(6 * 60 * 60);
/// Hours between the columns of Home's hourly row, after «Ahora».
const HOUR_STEP: i64 = 3;
const HOURLY_COLUMNS: i64 = 4;
/// Days Home's chip shows after today.
const CHIP_DAYS: usize = 3;
/// Other places a tool search mentions.
const OTHER_MATCHES: usize = 4;

fn unreachable() -> BackendError {
    BackendError::new(BackendErrorCode::ProviderUnavailable, "No se pudo consultar el clima. Revisá la conexión a internet.", true)
}

async fn get_json(url: &str) -> Result<Value, BackendError> {
    let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().map_err(|_| unreachable())?;
    let response = client.get(url).header(reqwest::header::ACCEPT, "application/json").send().await.map_err(|_| unreachable())?;
    if !response.status().is_success() {
        return Err(unreachable());
    }
    response.json::<Value>().await.map_err(|_| unreachable())
}

type Cache = Mutex<HashMap<String, (Instant, Forecast)>>;

fn cache() -> &'static Cache {
    static CACHE: OnceLock<Cache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cached(key: &str, max_age: Duration) -> Option<Forecast> {
    let cache = cache().lock().ok()?;
    cache.get(key).filter(|(at, _)| at.elapsed() < max_age).map(|(_, forecast)| forecast.clone())
}

/// The forecast of `location` for `days` days, from the cache when fresh.
async fn forecast(location: &WeatherLocation, days: u32) -> Result<Forecast, BackendError> {
    let url = forecast_url(location, days);
    if let Some(forecast) = cached(&url, FRESH_FOR) {
        return Ok(forecast);
    }
    match get_json(&url).await.and_then(|answer| parse_forecast(&answer)) {
        Ok(forecast) => {
            if let Ok(mut cache) = cache().lock() {
                cache.retain(|_, (at, _)| at.elapsed() < STALE_FOR);
                cache.insert(url, (Instant::now(), forecast.clone()));
            }
            Ok(forecast)
        }
        Err(error) => cached(&url, STALE_FOR).ok_or(error),
    }
}

async fn search(query: &str, count: u32) -> Result<Vec<WeatherLocation>, BackendError> {
    let query = search_query(query)?;
    Ok(parse_locations(&get_json(&geocoding_url(&query, count)).await?))
}

fn library_location(app: &AppHandle, library_id: &str) -> (WeatherLocation, bool) {
    let config = crate::library_config::read_library_config(app, library_id).ok().flatten();
    configured_location(config.as_ref())
}

// ---------- Words ----------

/// «18°»; never «-0°».
fn degrees(value: f64) -> String {
    let rounded = value.round();
    format!("{}°", if rounded == 0.0 { 0.0 } else { rounded })
}

fn rain_label(probability: Option<u8>) -> Option<String> {
    probability.filter(|value| *value > 0).map(|value| format!("{value} %"))
}

fn parse_hour(time: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(time, "%Y-%m-%dT%H:%M").ok()
}

fn parse_day(date: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

// ---------- Home ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeWeatherNow {
    temp: String,
    condition: &'static str,
    sky: Sky,
    feels: String,
    humidity: String,
    /// «14 km/h E».
    wind: String,
    /// Local time of the reading at the place, «16:00».
    updated: String,
    max: String,
    min: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeWeatherHour {
    label: String,
    sky: Sky,
    temp: String,
    /// «20 %», or «—» without rain.
    rain: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeWeatherDay {
    /// «Hoy», «Dom»…
    day: String,
    sky: Sky,
    /// «70 %», or empty without rain.
    rain: String,
    min: String,
    max: String,
    /// Where the day's range starts and how wide it is on the week's scale, in percent.
    bar_left: u8,
    bar_width: u8,
    /// «Dom: Lluvia, 12° a 17°, lluvia 70 %».
    title: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HomeWeather {
    /// «Buenos Aires».
    place: String,
    now: HomeWeatherNow,
    /// The next days on the chip.
    next: Vec<HomeWeatherDay>,
    hours: Vec<HomeWeatherHour>,
    days: Vec<HomeWeatherDay>,
}

fn home_weather(place: &WeatherLocation, forecast: &Forecast) -> Result<HomeWeather, BackendError> {
    let now_time = parse_hour(&forecast.current.time).ok_or_else(unreachable)?;
    let today = now_time.date();
    let rain_at = |time: NaiveDateTime| {
        let key = time.format("%Y-%m-%dT%H:00").to_string();
        forecast.hourly.iter().find(|hour| hour.time == key)
    };
    let (sky, words) = condition_at(forecast.current.code, forecast.current.is_day);
    let mut hours = vec![HomeWeatherHour {
        label: "Ahora".into(),
        sky,
        temp: degrees(forecast.current.temperature),
        rain: rain_label(rain_at(now_time).and_then(|hour| hour.rain_probability)).unwrap_or_else(|| "—".into()),
    }];
    let whole_hour = now_time.with_minute(0).unwrap_or(now_time);
    for step in 1..=HOURLY_COLUMNS {
        let time = whole_hour + ChronoDuration::hours(HOUR_STEP * step);
        if let Some(hour) = rain_at(time) {
            hours.push(HomeWeatherHour {
                label: format!("{:02}:00", time.hour()),
                sky: condition_at(hour.code, hour.is_day).0,
                temp: degrees(hour.temperature),
                rain: rain_label(hour.rain_probability).unwrap_or_else(|| "—".into()),
            });
        }
    }
    let days_ahead: Vec<_> = forecast
        .daily
        .iter()
        .filter_map(|day| Some((parse_day(&day.date)?, day)))
        .filter(|(date, _)| *date >= today)
        .take(HOME_FORECAST_DAYS as usize)
        .collect();
    let low = days_ahead.iter().map(|(_, day)| day.min).fold(f64::INFINITY, f64::min);
    let high = days_ahead.iter().map(|(_, day)| day.max).fold(f64::NEG_INFINITY, f64::max);
    let span = (high - low).max(1.0);
    let days: Vec<HomeWeatherDay> = days_ahead
        .iter()
        .map(|(date, day)| {
            let (sky, words) = condition(day.code);
            let name = if *date == today { "Hoy".to_string() } else { WEEKDAY_SHORT[weekday_index(*date)].to_string() };
            let rain = rain_label(day.rain_probability);
            HomeWeatherDay {
                title: format!(
                    "{name}: {words}, {} a {}{}",
                    degrees(day.min),
                    degrees(day.max),
                    rain.as_ref().map(|rain| format!(", lluvia {rain}")).unwrap_or_default()
                ),
                day: name,
                sky,
                rain: rain.unwrap_or_default(),
                min: degrees(day.min),
                max: degrees(day.max),
                bar_left: ((day.min - low) / span * 100.0).round().clamp(0.0, 100.0) as u8,
                bar_width: ((day.max - day.min) / span * 100.0).round().clamp(6.0, 100.0) as u8,
            }
        })
        .collect();
    let today_range = days_ahead.first().map(|(_, day)| (degrees(day.max), degrees(day.min)));
    let (max, min) = today_range.unwrap_or_else(|| ("—".into(), "—".into()));
    Ok(HomeWeather {
        place: place.name.clone(),
        now: HomeWeatherNow {
            temp: degrees(forecast.current.temperature),
            condition: words,
            sky,
            feels: degrees(forecast.current.feels_like),
            humidity: format!("{} %", forecast.current.humidity.round()),
            wind: format!("{} km/h {}", forecast.current.wind_speed.round(), wind_direction(forecast.current.wind_direction)),
            updated: now_time.format("%H:%M").to_string(),
            max,
            min,
        },
        next: days.iter().skip(1).take(CHIP_DAYS).map(clone_day).collect(),
        hours,
        days,
    })
}

fn clone_day(day: &HomeWeatherDay) -> HomeWeatherDay {
    HomeWeatherDay {
        day: day.day.clone(),
        sky: day.sky,
        rain: day.rain.clone(),
        min: day.min.clone(),
        max: day.max.clone(),
        bar_left: day.bar_left,
        bar_width: day.bar_width,
        title: day.title.clone(),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherLibraryPayload {
    library_id: String,
}

/// The weather Home shows for the library's place.
pub(crate) async fn weather_home(app: AppHandle, payload: WeatherLibraryPayload) -> Result<HomeWeather, BackendError> {
    let (place, _) = library_location(&app, &payload.library_id);
    let forecast = forecast(&place, HOME_FORECAST_DAYS).await?;
    home_weather(&place, &forecast)
}

// ---------- Settings ----------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherPlaceView {
    label: String,
    is_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherPlaceOption {
    location: WeatherLocation,
    label: String,
}

pub(crate) fn weather_get_location(app: AppHandle, payload: WeatherLibraryPayload) -> Result<WeatherPlaceView, BackendError> {
    let (place, is_default) = library_location(&app, &payload.library_id);
    Ok(WeatherPlaceView { label: place.label(), is_default })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherSearchPayload {
    query: String,
}

pub(crate) async fn weather_search_locations(payload: WeatherSearchPayload) -> Result<Vec<WeatherPlaceOption>, BackendError> {
    Ok(search(&payload.query, MAX_SEARCH_RESULTS)
        .await?
        .into_iter()
        .map(|location| WeatherPlaceOption { label: location.label(), location })
        .collect())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeatherSetLocationPayload {
    library_id: String,
    location: Value,
}

pub(crate) fn weather_set_location(app: AppHandle, payload: WeatherSetLocationPayload) -> Result<WeatherPlaceView, BackendError> {
    let location = validate_location(&payload.location)?;
    crate::library_config::update_library_config(&app, &payload.library_id, |config| with_weather_location(&config, &location))?;
    if let Err(error) = app.emit(WEATHER_PLACE_CHANGED_EVENT, ()) {
        log::error!("[notia:weather] evento de cambio de lugar no emitido: {error}");
    }
    Ok(WeatherPlaceView { label: location.label(), is_default: false })
}

// ---------- The agent's tool ----------

fn tool_result(place: &WeatherLocation, is_library_place: bool, others: &[WeatherLocation], forecast: &Forecast, days: u32, hours: u32) -> Value {
    let current = &forecast.current;
    let now = parse_hour(&current.time);
    let day_rows: Vec<Value> = forecast
        .daily
        .iter()
        .filter(|day| now.is_none_or(|now| parse_day(&day.date).is_none_or(|date| date >= now.date())))
        .take(days as usize)
        .map(|day| {
            json!({
                "date": day.date,
                "weekday": parse_day(&day.date).map(|date| WEEKDAY_LONG[weekday_index(date)]),
                "condition": condition(day.code).1,
                "minC": day.min.round(),
                "maxC": day.max.round(),
                "rainProbabilityPercent": day.rain_probability,
                "precipitationMm": day.precipitation,
            })
        })
        .collect();
    let first_hour = now.map(|now| now.format("%Y-%m-%dT%H:00").to_string()).unwrap_or_default();
    let hour_rows: Vec<Value> = forecast
        .hourly
        .iter()
        .filter(|hour| hour.time >= first_hour)
        .take(hours as usize)
        .map(|hour| {
            json!({
                "time": hour.time,
                "condition": condition(hour.code).1,
                "temperatureC": hour.temperature.round(),
                "rainProbabilityPercent": hour.rain_probability,
            })
        })
        .collect();
    let mut result = json!({
        "ok": true,
        "source": "Open-Meteo",
        "location": { "name": place.name, "label": place.label(), "timezone": forecast.timezone, "isLibraryPlace": is_library_place },
        "now": {
            "localTime": current.time,
            "condition": condition(current.code).1,
            "temperatureC": current.temperature.round(),
            "feelsLikeC": current.feels_like.round(),
            "humidityPercent": current.humidity.round(),
            "windKmh": current.wind_speed.round(),
            "windFrom": wind_direction(current.wind_direction),
            "isDay": current.is_day,
        },
        "days": day_rows,
    });
    if !hour_rows.is_empty() {
        result["hours"] = json!(hour_rows);
    }
    if !others.is_empty() {
        result["otherMatches"] = json!(others.iter().map(WeatherLocation::label).collect::<Vec<_>>());
    }
    result
}

/// `get_weather`: the library's place, or the first place named `location`.
pub(crate) fn execute_tool(app: &AppHandle, library_id: &str, arguments: &Value) -> Result<Value, BackendError> {
    let request = parse_weather_tool(arguments)?;
    crate::host::async_runtime::block_on(async {
        let (place, others, is_library_place) = match &request.location {
            Some(name) => {
                let mut found = search(name, OTHER_MATCHES as u32 + 1).await?;
                if found.is_empty() {
                    return Err(BackendError::invalid_input(format!(
                        "No encontré el lugar «{name}». Probá con otro nombre o agregá la provincia o el país."
                    )));
                }
                let place = found.remove(0);
                (place, found, false)
            }
            None => {
                let (place, _) = library_location(app, library_id);
                (place, Vec::new(), true)
            }
        };
        // Hourly rows past the days asked still need their days.
        let days = request.days.max(request.hours.div_ceil(24) + 1);
        let forecast = forecast(&place, days).await?;
        Ok(tool_result(&place, is_library_place, &others, &forecast, request.days, request.hours))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::weather::default_location;

    fn sample() -> Forecast {
        let hourly: Vec<Value> = (0..48).map(|hour| json!(format!("2026-09-{:02}T{:02}:00", 27 + hour / 24, hour % 24))).collect();
        parse_forecast(&json!({
            "timezone": "America/Argentina/Buenos_Aires",
            "current": { "time": "2026-09-27T10:30", "temperature_2m": 18.4, "apparent_temperature": 17.0, "relative_humidity_2m": 64,
                "weather_code": 2, "wind_speed_10m": 15.2, "wind_direction_10m": 135, "is_day": 1 },
            "hourly": {
                "time": hourly,
                "temperature_2m": (0..48).map(|hour| 10.0 + f64::from(hour % 24) / 2.0).collect::<Vec<_>>(),
                "weather_code": (0..48).map(|hour| match hour { 22 => 61, 16 => 1, _ => 3 }).collect::<Vec<_>>(),
                "is_day": (0..48).map(|hour| u8::from((7..20).contains(&(hour % 24)))).collect::<Vec<_>>(),
                "precipitation_probability": (0..48).map(|hour| if hour == 22 { 40 } else { 0 }).collect::<Vec<_>>()
            },
            "daily": {
                "time": ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"],
                "weather_code": [0, 2, 63, 3, 0],
                "temperature_2m_max": [30.0, 21.0, 17.0, 19.0, 22.0],
                "temperature_2m_min": [5.0, 11.0, 12.0, 10.0, 9.0],
                "precipitation_probability_max": [0, 10, 70, 20, 0],
                "precipitation_sum": [0.0, 0.1, 6.0, 0.4, 0.0]
            }
        }))
        .unwrap()
    }

    #[test]
    fn home_shows_now_the_next_hours_and_the_week() {
        let weather = home_weather(&default_location(), &sample()).unwrap();
        assert_eq!(weather.place, "Buenos Aires");
        assert_eq!((weather.now.temp.as_str(), weather.now.condition, weather.now.sky), ("18°", "Parcialmente nublado", Sky::Partly));
        assert_eq!((weather.now.feels.as_str(), weather.now.humidity.as_str(), weather.now.wind.as_str()), ("17°", "64 %", "15 km/h SE"));
        assert_eq!((weather.now.updated.as_str(), weather.now.max.as_str(), weather.now.min.as_str()), ("10:30", "21°", "11°"));
        let hours: Vec<_> = weather.hours.iter().map(|hour| (hour.label.as_str(), hour.temp.as_str(), hour.rain.as_str())).collect();
        assert_eq!(hours, [("Ahora", "18°", "—"), ("13:00", "17°", "—"), ("16:00", "18°", "—"), ("19:00", "20°", "—"), ("22:00", "21°", "40 %")]);
        assert_eq!(weather.hours[4].sky, Sky::Rain);
        assert_eq!(weather.hours[2].sky, Sky::Sun);
        // Yesterday is left out; the bars share the week's scale.
        let days: Vec<_> = weather.days.iter().map(|day| (day.day.as_str(), day.rain.as_str(), day.bar_left, day.bar_width)).collect();
        assert_eq!(days, [("Hoy", "10 %", 15, 77), ("Lun", "70 %", 23, 38), ("Mar", "20 %", 8, 69), ("Mié", "", 0, 100)]);
        assert_eq!(weather.days[1].title, "Lun: Lluvia, 12° a 17°, lluvia 70 %");
        assert_eq!(weather.next.iter().map(|day| day.day.as_str()).collect::<Vec<_>>(), ["Lun", "Mar", "Mié"]);
    }

    #[test]
    fn temperatures_never_read_minus_zero() {
        assert_eq!(degrees(-0.4), "0°");
        assert_eq!(degrees(-2.6), "-3°");
        assert_eq!(rain_label(Some(0)), None);
    }

    #[test]
    fn the_tool_answers_with_the_days_and_hours_asked() {
        let others = [WeatherLocation { name: "San Martín".into(), admin1: Some("Mendoza".into()), country: Some("Argentina".into()), latitude: -33.0, longitude: -68.4, timezone: None }];
        let result = tool_result(&default_location(), false, &others, &sample(), 2, 3);
        assert_eq!(result["location"]["label"], "Buenos Aires, Ciudad Autónoma de Buenos Aires, Argentina");
        assert_eq!(result["now"]["windFrom"], "SE");
        assert_eq!(result["days"].as_array().map(Vec::len), Some(2));
        assert_eq!(result["days"][0]["date"], "2026-09-27");
        assert_eq!(result["days"][1]["weekday"], "lunes");
        assert_eq!(result["days"][1]["condition"], "Lluvia");
        let hours: Vec<_> = result["hours"].as_array().unwrap().iter().map(|hour| hour["time"].as_str().unwrap()).collect();
        assert_eq!(hours, ["2026-09-27T10:00", "2026-09-27T11:00", "2026-09-27T12:00"]);
        assert_eq!(result["otherMatches"][0], "San Martín, Mendoza, Argentina");
        let without_hours = tool_result(&default_location(), true, &[], &sample(), 1, 0);
        assert!(without_hours.get("hours").is_none() && without_hours.get("otherMatches").is_none());
    }
}
