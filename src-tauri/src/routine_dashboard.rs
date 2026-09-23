//! Pure derivation of the Rutina dashboard from the persisted data. Every
//! percentage, streak and score shown by the view is computed here.

use chrono::{Datelike, Duration, NaiveDate};
use serde::Serialize;

use crate::routine::{
    weekday_index, RoutineData, TaskRecord, DAY_NAMES, HISTORY_DAYS, LIFE_CATEGORIES,
};

const MONTH_NAMES: [&str; 12] = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
];
/// Palette keys; the view maps them to theme tokens.
const TASK_COLORS: [&str; 4] = ["urgent", "high", "medium", "low"];
const ROUTINE_ACCENTS: [&str; 7] = [
    "slate", "medium", "high", "teal", "gold", "violet", "urgent",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineDashboard {
    pub today: String,
    pub month_label: String,
    pub categories: Vec<&'static str>,
    pub nav: RoutineNav,
    pub routines: Vec<RoutineView>,
    pub tasks: Vec<RoutineTaskView>,
    pub heatmap: RoutineHeatmap,
    pub calendar: RoutineCalendar,
    pub evolution: RoutineEvolution,
    pub weekly: RoutineWeekly,
    pub wheel: RoutineWheel,
    pub current_week: RoutineCurrentWeek,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineNav {
    pub routines: usize,
    pub active_tasks: usize,
    pub best_streak: u32,
    pub today_done: u32,
    pub today_total: u32,
    pub today_pct: Option<u8>,
    pub best_day_pct: Option<u8>,
    pub week_pct: Option<u8>,
    pub month_pct: Option<u8>,
    pub wheel_average: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineView {
    pub id: String,
    pub name: String,
    pub accent: &'static str,
    pub task_count: usize,
    /// Reason the routine cannot be deleted, if any.
    pub delete_blocked_reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineTaskView {
    pub id: String,
    pub routine_id: String,
    pub name: String,
    pub category: String,
    pub all_days: bool,
    pub days: Vec<u8>,
    pub days_label: String,
    pub notes: String,
    pub paused: bool,
    pub color: &'static str,
    pub streak: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HeatmapCellState {
    Done,
    Missed,
    Future,
    NotApplicable,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapCell {
    pub day: u32,
    pub state: HeatmapCellState,
    pub is_today: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapRow {
    pub task_id: String,
    pub name: String,
    pub color: &'static str,
    pub streak: u32,
    pub cells: Vec<HeatmapCell>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineHeatmap {
    pub days_in_month: u32,
    pub rows: Vec<HeatmapRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub day: u32,
    pub is_today: bool,
    pub pct: Option<u8>,
    /// Intensity bucket 1..=5 when `pct` is present.
    pub level: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineCalendar {
    /// Empty cells before day 1 in a Monday-first grid.
    pub leading_blanks: u32,
    pub days: Vec<CalendarDay>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayPct {
    pub day: u32,
    pub pct: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineEvolution {
    pub current: Vec<DayPct>,
    pub previous: Vec<DayPct>,
    pub best_day: Option<DayPct>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekBar {
    pub label: String,
    pub current_pct: Option<u8>,
    pub previous_pct: Option<u8>,
    pub is_current_week: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWeekly {
    pub weeks: Vec<WeekBar>,
    pub best_streak: u32,
    pub month_done: u32,
    pub month_total: u32,
    pub month_pct: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WheelAxis {
    pub category: &'static str,
    pub current: u8,
    pub previous: u8,
    pub goal: u8,
    pub goal_pct: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWheel {
    pub axes: Vec<WheelAxis>,
    pub average: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekTask {
    pub task_id: String,
    pub routine_id: String,
    pub name: String,
    pub completed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekDay {
    pub date: String,
    pub day_name: &'static str,
    pub date_label: String,
    pub is_today: bool,
    pub is_weekend: bool,
    /// Completions can only be recorded for today or past days.
    pub is_editable: bool,
    pub done: u32,
    pub total: u32,
    pub pct: Option<u8>,
    pub tasks: Vec<WeekTask>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineWeek {
    /// `None` for the week that combines every routine.
    pub routine_id: Option<String>,
    pub pct: Option<u8>,
    pub days: Vec<WeekDay>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineCurrentWeek {
    pub range_label: String,
    /// Every routine together, for the "Todos" tab.
    pub all: RoutineWeek,
    pub routines: Vec<RoutineWeek>,
}

pub fn percent(done: u32, total: u32) -> Option<u8> {
    (total > 0).then(|| ((done as f64 / total as f64) * 100.0).round() as u8)
}

fn js_hash(id: &str) -> u32 {
    id.encode_utf16().fold(0u32, |hash, unit| {
        hash.wrapping_mul(31).wrapping_add(unit as u32)
    })
}

fn task_color(id: &str) -> &'static str {
    TASK_COLORS[(js_hash(id) % TASK_COLORS.len() as u32) as usize]
}

fn routine_accent(id: &str) -> &'static str {
    ROUTINE_ACCENTS[(js_hash(id) % ROUTINE_ACCENTS.len() as u32) as usize]
}

pub fn month_name(month: u32) -> &'static str {
    MONTH_NAMES[(month - 1) as usize]
}

fn date_label(date: NaiveDate) -> String {
    format!("{} {}", date.day(), &month_name(date.month())[..3])
}

fn first_of_month(year: i32, month: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(year, month, 1).expect("valid month")
}

fn previous_month(date: NaiveDate) -> (i32, u32) {
    if date.month() == 1 {
        (date.year() - 1, 12)
    } else {
        (date.year(), date.month() - 1)
    }
}

fn days_in_month(year: i32, month: u32) -> u32 {
    let next = if month == 12 {
        first_of_month(year + 1, 1)
    } else {
        first_of_month(year, month + 1)
    };
    (next - Duration::days(1)).day()
}

fn month_dates(year: i32, month: u32) -> impl Iterator<Item = NaiveDate> {
    (1..=days_in_month(year, month))
        .map(move |day| NaiveDate::from_ymd_opt(year, month, day).expect("valid day"))
}

pub fn monday_of(date: NaiveDate) -> NaiveDate {
    date - Duration::days(weekday_index(date) as i64)
}

/// Active tasks of `date`, optionally within one routine.
pub fn tasks_on<'a>(
    data: &'a RoutineData,
    date: NaiveDate,
    routine_id: Option<&str>,
) -> Vec<&'a TaskRecord> {
    let weekday = weekday_index(date);
    data.tasks
        .iter()
        .filter(|task| task.is_active() && task.days.applies(weekday))
        .filter(|task| routine_id.is_none_or(|routine_id| task.routine_id == routine_id))
        .collect()
}

/// `(done, total)` for a day, or `None` when no task applies.
pub fn completion_for_day(
    data: &RoutineData,
    date: NaiveDate,
    routine_id: Option<&str>,
) -> Option<(u32, u32)> {
    let tasks = tasks_on(data, date, routine_id);
    if tasks.is_empty() {
        return None;
    }
    let done = tasks
        .iter()
        .filter(|task| data.is_completed(&task.id, date))
        .count() as u32;
    Some((done, tasks.len() as u32))
}

/// Consecutive applicable days completed up to today. Today still pending
/// does not break the streak because the day is not over yet.
pub fn streak(data: &RoutineData, task: &TaskRecord, today: NaiveDate) -> u32 {
    let mut count = 0;
    for offset in 0..HISTORY_DAYS {
        let date = today - Duration::days(offset);
        if !task.days.applies(weekday_index(date)) {
            continue;
        }
        if data.is_completed(&task.id, date) {
            count += 1;
        } else if offset > 0 {
            break;
        }
    }
    count
}

/// Score 0..=10 of a life category within a month, up to `limit`.
pub fn category_score(
    data: &RoutineData,
    year: i32,
    month: u32,
    category: &str,
    limit: Option<NaiveDate>,
) -> u8 {
    let (mut done, mut total) = (0u32, 0u32);
    for date in month_dates(year, month).take_while(|date| limit.is_none_or(|limit| *date <= limit))
    {
        let weekday = weekday_index(date);
        for task in data.tasks.iter().filter(|task| {
            task.category == category && task.is_active() && task.days.applies(weekday)
        }) {
            total += 1;
            if data.is_completed(&task.id, date) {
                done += 1;
            }
        }
    }
    if total == 0 {
        0
    } else {
        ((done as f64 / total as f64) * 10.0).round() as u8
    }
}

fn month_weeks(year: i32, month: u32) -> Vec<(NaiveDate, Vec<NaiveDate>)> {
    let first = first_of_month(year, month);
    let last = first + Duration::days(days_in_month(year, month) as i64 - 1);
    let mut weeks = Vec::new();
    let mut monday = monday_of(first);
    while monday <= last {
        let days = (0..7)
            .map(|offset| monday + Duration::days(offset))
            .filter(|date| date.month() == month && date.year() == year)
            .collect::<Vec<_>>();
        weeks.push((monday, days));
        monday += Duration::days(7);
    }
    weeks
}

fn range_pct(data: &RoutineData, days: &[NaiveDate], limit: Option<NaiveDate>) -> (u32, u32) {
    days.iter()
        .filter(|date| limit.is_none_or(|limit| **date <= limit))
        .filter_map(|date| completion_for_day(data, *date, None))
        .fold((0, 0), |(done, total), (day_done, day_total)| {
            (done + day_done, total + day_total)
        })
}

fn build_weekly(data: &RoutineData, today: NaiveDate, best_streak: u32) -> RoutineWeekly {
    let current_weeks = month_weeks(today.year(), today.month());
    let (previous_year, previous_month) = previous_month(today);
    let previous_weeks = month_weeks(previous_year, previous_month);
    let current_monday = monday_of(today);
    let (mut month_done, mut month_total) = (0, 0);
    let weeks = (0..current_weeks.len().max(previous_weeks.len()))
        .map(|index| {
            let current = current_weeks.get(index).map(|(monday, days)| {
                let (done, total) = range_pct(data, days, Some(today));
                month_done += done;
                month_total += total;
                (*monday == current_monday, percent(done, total))
            });
            let previous_pct = previous_weeks.get(index).and_then(|(_, days)| {
                let (done, total) = range_pct(data, days, None);
                percent(done, total)
            });
            WeekBar {
                label: format!("S{}", index + 1),
                current_pct: current.and_then(|(_, pct)| pct),
                previous_pct,
                is_current_week: current.is_some_and(|(is_current, _)| is_current),
            }
        })
        .collect();
    RoutineWeekly {
        weeks,
        best_streak,
        month_done,
        month_total,
        month_pct: percent(month_done, month_total),
    }
}

fn day_pct(data: &RoutineData, date: NaiveDate) -> u8 {
    completion_for_day(data, date, None)
        .and_then(|(done, total)| percent(done, total))
        .unwrap_or(0)
}

fn build_evolution(data: &RoutineData, today: NaiveDate) -> RoutineEvolution {
    let current = month_dates(today.year(), today.month())
        .take_while(|date| *date <= today)
        .map(|date| DayPct {
            day: date.day(),
            pct: day_pct(data, date),
        })
        .collect::<Vec<_>>();
    let (previous_year, previous_month) = previous_month(today);
    let previous = month_dates(previous_year, previous_month)
        .map(|date| DayPct {
            day: date.day(),
            pct: day_pct(data, date),
        })
        .collect();
    let best_day = current
        .iter()
        .fold(None::<&DayPct>, |best, day| match best {
            Some(best) if best.pct >= day.pct => Some(best),
            _ => Some(day),
        })
        .filter(|day| day.pct > 0)
        .cloned();
    RoutineEvolution {
        current,
        previous,
        best_day,
    }
}

fn build_calendar(data: &RoutineData, today: NaiveDate) -> RoutineCalendar {
    let first = first_of_month(today.year(), today.month());
    let days = month_dates(today.year(), today.month())
        .map(|date| {
            let pct = (date <= today)
                .then(|| completion_for_day(data, date, None))
                .flatten()
                .and_then(|(done, total)| percent(done, total));
            CalendarDay {
                day: date.day(),
                is_today: date == today,
                pct,
                level: pct.map(|pct| 1 + (pct as u32 * 4).div_ceil(100) as u8),
            }
        })
        .collect();
    RoutineCalendar {
        leading_blanks: weekday_index(first) as u32,
        days,
    }
}

fn build_heatmap(data: &RoutineData, today: NaiveDate, streaks: &[u32]) -> RoutineHeatmap {
    let total_days = days_in_month(today.year(), today.month());
    let rows = data
        .tasks
        .iter()
        .zip(streaks)
        .map(|(task, streak)| HeatmapRow {
            task_id: task.id.clone(),
            name: task.name.clone(),
            color: task_color(&task.id),
            streak: *streak,
            cells: month_dates(today.year(), today.month())
                .map(|date| HeatmapCell {
                    day: date.day(),
                    is_today: date == today,
                    state: if !task.days.applies(weekday_index(date)) {
                        HeatmapCellState::NotApplicable
                    } else if date > today {
                        HeatmapCellState::Future
                    } else if data.is_completed(&task.id, date) {
                        HeatmapCellState::Done
                    } else {
                        HeatmapCellState::Missed
                    },
                })
                .collect(),
        })
        .collect();
    RoutineHeatmap {
        days_in_month: total_days,
        rows,
    }
}

fn build_wheel(data: &RoutineData, today: NaiveDate) -> RoutineWheel {
    let (previous_year, previous_month) = previous_month(today);
    let axes = LIFE_CATEGORIES
        .iter()
        .map(|category| {
            let current = category_score(data, today.year(), today.month(), category, Some(today));
            let goal = data.goal(category);
            WheelAxis {
                category,
                current,
                previous: category_score(data, previous_year, previous_month, category, None),
                goal,
                goal_pct: ((current as f64 / goal as f64) * 100.0).round().min(100.0) as u8,
            }
        })
        .collect::<Vec<_>>();
    let sum = axes.iter().map(|axis| axis.current as f64).sum::<f64>();
    RoutineWheel {
        average: format!("{:.1}", sum / LIFE_CATEGORIES.len() as f64),
        axes,
    }
}

/// Week of one routine, or of every routine when `routine_id` is `None`.
fn routine_week(
    data: &RoutineData,
    today: NaiveDate,
    week: &[NaiveDate],
    routine_id: Option<&str>,
) -> RoutineWeek {
    let (mut week_done, mut week_total) = (0, 0);
    let days = week
        .iter()
        .enumerate()
        .map(|(index, date)| {
            let tasks = tasks_on(data, *date, routine_id);
            let done = tasks
                .iter()
                .filter(|task| data.is_completed(&task.id, *date))
                .count() as u32;
            let total = tasks.len() as u32;
            if *date <= today {
                week_done += done;
                week_total += total;
            }
            WeekDay {
                date: date.format("%Y-%m-%d").to_string(),
                day_name: DAY_NAMES[index],
                date_label: date_label(*date),
                is_today: *date == today,
                is_weekend: index >= 5,
                is_editable: *date <= today,
                done,
                total,
                pct: percent(done, total),
                tasks: tasks
                    .iter()
                    .map(|task| WeekTask {
                        task_id: task.id.clone(),
                        routine_id: task.routine_id.clone(),
                        name: task.name.clone(),
                        completed: data.is_completed(&task.id, *date),
                    })
                    .collect(),
            }
        })
        .collect();
    RoutineWeek {
        routine_id: routine_id.map(str::to_string),
        pct: percent(week_done, week_total),
        days,
    }
}

fn build_current_week(data: &RoutineData, today: NaiveDate) -> RoutineCurrentWeek {
    let monday = monday_of(today);
    let week = (0..7)
        .map(|offset| monday + Duration::days(offset))
        .collect::<Vec<_>>();
    let sunday = monday + Duration::days(6);
    RoutineCurrentWeek {
        range_label: format!(
            "Lunes {} — domingo {}",
            date_label(monday),
            date_label(sunday)
        ),
        all: routine_week(data, today, &week, None),
        routines: data
            .routines
            .iter()
            .map(|routine| routine_week(data, today, &week, Some(&routine.id)))
            .collect(),
    }
}

/// Report of one month up to `today`, used by the agent for summaries of the
/// current or a past month.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineMonthReport {
    pub month: String,
    pub month_label: String,
    pub complete: bool,
    pub done: u32,
    pub total: u32,
    pub pct: Option<u8>,
    pub best_day: Option<DayPct>,
    pub days: Vec<MonthReportDay>,
    pub weeks: Vec<MonthReportWeek>,
    pub categories: Vec<MonthReportCategory>,
    pub tasks: Vec<MonthReportTask>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthReportDay {
    pub date: String,
    pub done: u32,
    pub total: u32,
    pub pct: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthReportWeek {
    pub label: String,
    pub from: String,
    pub to: String,
    pub pct: Option<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthReportCategory {
    pub category: &'static str,
    pub score: u8,
    pub goal: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthReportTask {
    pub task_id: String,
    pub name: String,
    pub routine_id: String,
    pub paused: bool,
    pub applicable_days: u32,
    pub done_days: u32,
    pub pct: Option<u8>,
}

pub fn build_month_report(
    data: &RoutineData,
    year: i32,
    month: u32,
    today: NaiveDate,
) -> RoutineMonthReport {
    let dates = month_dates(year, month)
        .take_while(|date| *date <= today)
        .collect::<Vec<_>>();
    let days = dates
        .iter()
        .map(|date| {
            let (done, total) = completion_for_day(data, *date, None).unwrap_or((0, 0));
            MonthReportDay {
                date: date.format("%Y-%m-%d").to_string(),
                done,
                total,
                pct: percent(done, total),
            }
        })
        .collect::<Vec<_>>();
    let (done, total) = days.iter().fold((0, 0), |(done, total), day| {
        (done + day.done, total + day.total)
    });
    let best_day = days
        .iter()
        .filter_map(|day| day.pct.map(|pct| (day, pct)))
        .fold(None::<(&MonthReportDay, u8)>, |best, current| match best {
            Some(best) if best.1 >= current.1 => Some(best),
            _ => Some(current),
        })
        .filter(|(_, pct)| *pct > 0)
        .map(|(day, pct)| DayPct {
            day: parse_day(&day.date),
            pct,
        });
    let weeks = month_weeks(year, month)
        .into_iter()
        .filter_map(|(_, week_days)| {
            let first = *week_days.first()?;
            let last = *week_days.last()?;
            (first <= today).then(|| {
                let (done, total) = range_pct(data, &week_days, Some(today));
                (first, last, percent(done, total))
            })
        })
        .enumerate()
        .map(|(index, (first, last, pct))| MonthReportWeek {
            label: format!("S{}", index + 1),
            from: first.format("%Y-%m-%d").to_string(),
            to: last.format("%Y-%m-%d").to_string(),
            pct,
        })
        .collect();
    let categories = LIFE_CATEGORIES
        .iter()
        .map(|category| MonthReportCategory {
            category,
            score: category_score(data, year, month, category, Some(today)),
            goal: data.goal(category),
        })
        .collect();
    let tasks = data
        .tasks
        .iter()
        .map(|task| {
            let applicable = dates
                .iter()
                .filter(|date| task.days.applies(weekday_index(**date)))
                .collect::<Vec<_>>();
            let done_days = applicable
                .iter()
                .filter(|date| data.is_completed(&task.id, ***date))
                .count() as u32;
            MonthReportTask {
                task_id: task.id.clone(),
                name: task.name.clone(),
                routine_id: task.routine_id.clone(),
                paused: !task.is_active(),
                applicable_days: applicable.len() as u32,
                done_days,
                pct: percent(done_days, applicable.len() as u32),
            }
        })
        .collect();
    RoutineMonthReport {
        month: format!("{year:04}-{month:02}"),
        month_label: month_name(month).to_string(),
        complete: dates.len() as u32 == days_in_month(year, month),
        done,
        total,
        pct: percent(done, total),
        best_day,
        days,
        weeks,
        categories,
        tasks,
    }
}

fn parse_day(date: &str) -> u32 {
    date.get(8..10)
        .and_then(|day| day.parse().ok())
        .unwrap_or(0)
}

pub fn build_dashboard(data: &RoutineData, today: NaiveDate) -> RoutineDashboard {
    let streaks = data
        .tasks
        .iter()
        .map(|task| streak(data, task, today))
        .collect::<Vec<_>>();
    let best_streak = streaks.iter().copied().max().unwrap_or(0);
    let weekly = build_weekly(data, today, best_streak);
    let wheel = build_wheel(data, today);
    let evolution = build_evolution(data, today);
    let (today_done, today_total) = completion_for_day(data, today, None).unwrap_or((0, 0));
    let week_days = (0..7)
        .map(|offset| monday_of(today) + Duration::days(offset))
        .collect::<Vec<_>>();
    let (week_done, week_total) = range_pct(data, &week_days, Some(today));
    let routine_count = data.routines.len();
    RoutineDashboard {
        today: today.format("%Y-%m-%d").to_string(),
        month_label: month_name(today.month()).to_string(),
        categories: LIFE_CATEGORIES.to_vec(),
        nav: RoutineNav {
            routines: routine_count,
            active_tasks: data.tasks.iter().filter(|task| task.is_active()).count(),
            best_streak,
            today_done,
            today_total,
            today_pct: percent(today_done, today_total),
            best_day_pct: evolution.best_day.as_ref().map(|day| day.pct),
            week_pct: percent(week_done, week_total),
            month_pct: weekly.month_pct,
            wheel_average: wheel.average.clone(),
        },
        routines: data
            .routines
            .iter()
            .map(|routine| {
                let task_count = data
                    .tasks
                    .iter()
                    .filter(|task| task.routine_id == routine.id)
                    .count();
                RoutineView {
                    id: routine.id.clone(),
                    name: routine.name.clone(),
                    accent: routine_accent(&routine.id),
                    task_count,
                    delete_blocked_reason: if routine_count <= 1 {
                        Some("Necesitás al menos una rutina.".to_string())
                    } else if task_count > 0 {
                        Some("Vaciala primero para poder eliminarla.".to_string())
                    } else {
                        None
                    },
                }
            })
            .collect(),
        tasks: data
            .tasks
            .iter()
            .zip(&streaks)
            .map(|(task, streak)| RoutineTaskView {
                id: task.id.clone(),
                routine_id: task.routine_id.clone(),
                name: task.name.clone(),
                category: task.category.clone(),
                all_days: matches!(task.days, crate::routine::TaskDays::All),
                days: task.days.as_list(),
                days_label: task.days.label(),
                notes: task.notes.clone(),
                paused: !task.is_active(),
                color: task_color(&task.id),
                streak: *streak,
            })
            .collect(),
        heatmap: build_heatmap(data, today, &streaks),
        calendar: build_calendar(data, today),
        evolution,
        weekly,
        wheel,
        current_week: build_current_week(data, today),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routine::{RoutineRecord, RoutineTaskStatus, TaskDays};

    fn date(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").unwrap()
    }

    fn task(id: &str, category: &str, days: TaskDays) -> TaskRecord {
        TaskRecord {
            id: id.into(),
            routine_id: "r1".into(),
            name: id.into(),
            category: category.into(),
            days,
            notes: String::new(),
            status: RoutineTaskStatus::Active,
        }
    }

    fn data() -> RoutineData {
        let mut data = RoutineData {
            routines: vec![RoutineRecord {
                id: "r1".into(),
                name: "Mañana".into(),
            }],
            tasks: vec![
                task("a", "Salud y deporte", TaskDays::All),
                task("b", "Emocional", TaskDays::Only(vec![0])),
            ],
            ..Default::default()
        };
        for day in ["2026-09-20", "2026-09-21", "2026-09-22"] {
            data.completions.insert(("a".into(), date(day)));
        }
        data.completions.insert(("b".into(), date("2026-09-21")));
        data
    }

    #[test]
    fn a_pending_today_does_not_break_the_streak() {
        let data = data();
        let today = date("2026-09-23");
        assert_eq!(streak(&data, &data.tasks[0], today), 3);
        // Only Mondays apply to "b": 21/09 done, 14/09 missing.
        assert_eq!(streak(&data, &data.tasks[1], today), 1);
    }

    #[test]
    fn computes_daily_weekly_and_monthly_percentages() {
        let data = data();
        assert_eq!(
            completion_for_day(&data, date("2026-09-21"), None),
            Some((2, 2))
        );
        assert_eq!(
            completion_for_day(&data, date("2026-09-23"), None),
            Some((0, 1))
        );
        let dashboard = build_dashboard(&data, date("2026-09-23"));
        // Week of 21/09: 21 (2/2), 22 (1/1), 23 (0/1) -> 3/4.
        assert_eq!(dashboard.nav.week_pct, Some(75));
        assert_eq!(dashboard.nav.today_pct, Some(0));
        assert_eq!(dashboard.nav.best_day_pct, Some(100));
        assert_eq!(dashboard.weekly.month_done, 4);
        assert_eq!(
            dashboard.current_week.range_label,
            "Lunes 21 sep — domingo 27 sep"
        );
        assert!(!dashboard.current_week.routines[0].days[3].is_editable);
        assert!(dashboard.current_week.all.routine_id.is_none());
        assert_eq!(dashboard.current_week.all.pct, Some(75));
        assert_eq!(dashboard.current_week.all.days[0].tasks[1].routine_id, "r1");
        assert_eq!(dashboard.calendar.leading_blanks, 1);
        assert_eq!(dashboard.calendar.days[20].level, Some(5));
    }

    #[test]
    fn scores_categories_against_goals() {
        let mut data = data();
        data.goals.insert("Salud y deporte".into(), 5);
        let score = category_score(&data, 2026, 9, "Salud y deporte", Some(date("2026-09-23")));
        // 3 of 23 applicable days.
        assert_eq!(score, 1);
        let wheel = build_wheel(&data, date("2026-09-23"));
        assert_eq!(wheel.axes[0].goal, 5);
        assert_eq!(wheel.axes[0].goal_pct, 20);
    }

    #[test]
    fn splits_months_into_monday_weeks_and_marks_heatmap_cells() {
        let weeks = month_weeks(2026, 9);
        assert_eq!(weeks.len(), 5);
        assert_eq!(weeks[0].1.len(), 6);
        let data = data();
        let heatmap = build_heatmap(&data, date("2026-09-23"), &[3, 1]);
        assert!(matches!(
            heatmap.rows[0].cells[21].state,
            HeatmapCellState::Done
        ));
        assert!(matches!(
            heatmap.rows[0].cells[22].state,
            HeatmapCellState::Missed
        ));
        assert!(matches!(
            heatmap.rows[0].cells[23].state,
            HeatmapCellState::Future
        ));
        assert!(matches!(
            heatmap.rows[1].cells[21].state,
            HeatmapCellState::NotApplicable
        ));
    }

    #[test]
    fn reports_a_past_month_and_the_current_month_up_to_today() {
        let data = data();
        let current = build_month_report(&data, 2026, 9, date("2026-09-23"));
        assert!(!current.complete);
        assert_eq!(current.days.len(), 23);
        assert_eq!(current.done, 4);
        assert_eq!(current.best_day.as_ref().map(|day| day.day), Some(20));
        assert_eq!(current.tasks[1].applicable_days, 3);
        assert_eq!(current.tasks[1].done_days, 1);
        assert_eq!(current.weeks.len(), 4);
        let previous = build_month_report(&data, 2026, 8, date("2026-09-23"));
        assert!(previous.complete);
        assert_eq!(previous.done, 0);
        assert!(previous.best_day.is_none());
    }

    #[test]
    fn matches_the_javascript_color_hash() {
        // (("a" = 97) * 1) % 4 = 1 -> "high"
        assert_eq!(task_color("a"), "high");
        assert_eq!(js_hash("ab"), 97 * 31 + 98);
    }
}
