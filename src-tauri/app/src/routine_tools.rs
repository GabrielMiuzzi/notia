//! Agent tools over Rutina. Arguments reference routines and tasks by id or
//! by name; every write is resolved and validated inside a transaction, so the
//! preview shown before confirmation is exactly what the execution applies.

use chrono::{Datelike, Duration, NaiveDate};
use rusqlite::Connection;
use serde_json::{json, Value};
use crate::host::Emitter;

use crate::routine::{
    apply_mutation, canonical_category, load_data, parse_date, resolve_routine, resolve_task,
    weekday_index, with_transaction, RoutineCommandError, RoutineContext, RoutineMutation,
    RoutineMutationOutcome, RoutineResult, RoutineTaskStatus, TaskDays, DAY_NAMES, HISTORY_DAYS,
    ROUTINE_DATA_CHANGED_EVENT,
};
use crate::routine_dashboard::{build_dashboard, build_month_report, completion_for_day, tasks_on};

pub const ROUTINE_READ_TOOLS: [&str; 4] = [
    "get_routine_dashboard",
    "get_routine_day",
    "list_routine_history",
    "get_routine_month_report",
];
pub const ROUTINE_WRITE_TOOLS: [&str; 9] = [
    "save_routine",
    "delete_routine",
    "save_routine_task",
    "set_routine_task_status",
    "delete_routine_task",
    "restore_routine_task",
    "reorder_routine_tasks",
    "set_routine_completions",
    "set_routine_goal",
];
const MAX_COMPLETION_ITEMS: usize = 31;
const MAX_HISTORY_DAYS: i64 = 92;

pub fn is_routine_tool(name: &str) -> bool {
    ROUTINE_READ_TOOLS.contains(&name) || is_routine_write_tool(name)
}

pub fn is_routine_write_tool(name: &str) -> bool {
    ROUTINE_WRITE_TOOLS.contains(&name)
}

fn text(arguments: &Value, name: &str) -> Option<String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn required(arguments: &Value, name: &str) -> RoutineResult<String> {
    text(arguments, name)
        .ok_or_else(|| RoutineCommandError::validation(format!("Falta el campo {name}.")))
}

fn optional_date(arguments: &Value, name: &str, today: NaiveDate) -> RoutineResult<NaiveDate> {
    text(arguments, name).map_or(Ok(today), |value| parse_date(&value))
}

/// `date` (YYYY-MM-DD) or `daysAgo` (0 = hoy, 1 = ayer), resolved against the
/// local date of the device so relative requests never depend on UTC.
fn day_argument(arguments: &Value, today: NaiveDate) -> RoutineResult<NaiveDate> {
    match (text(arguments, "date"), arguments.get("daysAgo")) {
        (Some(_), Some(_)) => Err(RoutineCommandError::validation(
            "Indicá date o daysAgo, no ambos.",
        )),
        (None, Some(value)) => value
            .as_u64()
            .filter(|days| *days as i64 <= HISTORY_DAYS)
            .map(|days| today - Duration::days(days as i64))
            .ok_or_else(|| {
                RoutineCommandError::validation(format!(
                    "daysAgo debe ser un entero entre 0 y {HISTORY_DAYS}."
                ))
            }),
        (date, None) => date.map_or(Ok(today), |value| parse_date(&value)),
    }
}

fn month_argument(arguments: &Value, today: NaiveDate) -> RoutineResult<(i32, u32)> {
    let Some(value) = text(arguments, "month") else {
        return Ok((today.year(), today.month()));
    };
    let first = NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d")
        .map_err(|_| RoutineCommandError::validation("month debe tener formato YYYY-MM."))?;
    if first > today {
        return Err(RoutineCommandError::validation(
            "No hay datos de meses futuros.",
        ));
    }
    if first < today - Duration::days(HISTORY_DAYS) {
        return Err(RoutineCommandError::validation(format!(
            "El historial disponible abarca los últimos {HISTORY_DAYS} días."
        )));
    }
    Ok((first.year(), first.month()))
}

/// `"all"` or an array of weekdays (0 = lunes). `None` when absent.
fn days_argument(arguments: &Value) -> RoutineResult<Option<Option<Vec<u8>>>> {
    match arguments.get("days") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) if value.trim().eq_ignore_ascii_case("all") => Ok(Some(None)),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .filter(|day| *day <= 6)
                    .map(|day| day as u8)
                    .ok_or_else(|| {
                        RoutineCommandError::validation(
                            "Los días deben ir de 0 (lunes) a 6 (domingo).",
                        )
                    })
            })
            .collect::<RoutineResult<Vec<_>>>()
            .map(|days| Some(Some(days))),
        Some(_) => Err(RoutineCommandError::validation(
            "days debe ser \"all\" o una lista de días de 0 (lunes) a 6 (domingo).",
        )),
    }
}

fn single_routine_id(connection: &Connection, owner: &str) -> RoutineResult<String> {
    let mut ids = connection
        .prepare("SELECT id FROM routine_routines WHERE owner_user_id=?1")?
        .query_map([owner], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    if ids.len() == 1 {
        Ok(ids.remove(0))
    } else {
        Err(RoutineCommandError::validation(
            "Indicá en qué rutina va la tarea.",
        ))
    }
}

/// Resolves tool arguments into validated mutations with stable ids.
fn tool_mutations(
    connection: &Connection,
    owner: &str,
    name: &str,
    arguments: &Value,
    today: NaiveDate,
) -> RoutineResult<Vec<RoutineMutation>> {
    let mutation = match name {
        "save_routine" => RoutineMutation::SaveRoutine {
            id: text(arguments, "routine")
                .map(|reference| {
                    resolve_routine(connection, owner, &reference).map(|routine| routine.id)
                })
                .transpose()?,
            name: required(arguments, "name")?,
        },
        "delete_routine" => RoutineMutation::DeleteRoutine {
            id: resolve_routine(connection, owner, &required(arguments, "routine")?)?.id,
        },
        "save_routine_task" => {
            let existing = text(arguments, "task")
                .map(|reference| resolve_task(connection, owner, &reference, None, false))
                .transpose()?;
            let routine_id = match text(arguments, "routine") {
                Some(reference) => resolve_routine(connection, owner, &reference)?.id,
                None => match &existing {
                    Some(task) => task.routine_id.clone(),
                    None => single_routine_id(connection, owner)?,
                },
            };
            let days = match (days_argument(arguments)?, &existing) {
                (Some(days), _) => days,
                (None, Some(task)) => match &task.days {
                    TaskDays::All => None,
                    TaskDays::Only(days) => Some(days.clone()),
                },
                (None, None) => None,
            };
            RoutineMutation::SaveTask {
                id: existing.as_ref().map(|task| task.id.clone()),
                routine_id,
                name: text(arguments, "name")
                    .or_else(|| existing.as_ref().map(|task| task.name.clone()))
                    .ok_or_else(|| RoutineCommandError::validation("Falta el campo name."))?,
                category: text(arguments, "category")
                    .or_else(|| existing.as_ref().map(|task| task.category.clone()))
                    .ok_or_else(|| RoutineCommandError::validation("Falta el campo category."))?,
                days,
                notes: arguments
                    .get("notes")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| existing.as_ref().map(|task| task.notes.clone()))
                    .unwrap_or_default(),
            }
        }
        "set_routine_task_status" => RoutineMutation::SetTaskStatus {
            id: resolve_task(
                connection,
                owner,
                &required(arguments, "task")?,
                None,
                false,
            )?
            .id,
            status: match required(arguments, "status")?.as_str() {
                "active" => RoutineTaskStatus::Active,
                "paused" => RoutineTaskStatus::Paused,
                _ => {
                    return Err(RoutineCommandError::validation(
                        "status debe ser active o paused.",
                    ))
                }
            },
        },
        "delete_routine_task" => RoutineMutation::DeleteTask {
            id: resolve_task(
                connection,
                owner,
                &required(arguments, "task")?,
                None,
                false,
            )?
            .id,
        },
        "restore_routine_task" => RoutineMutation::RestoreTask {
            id: resolve_task(connection, owner, &required(arguments, "task")?, None, true)?.id,
        },
        "reorder_routine_tasks" => {
            let routine = resolve_routine(connection, owner, &required(arguments, "routine")?)?;
            let ordered_task_ids = arguments
                .get("tasks")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    RoutineCommandError::validation("Falta la lista tasks con el nuevo orden.")
                })?
                .iter()
                .map(|value| {
                    let reference = value.as_str().unwrap_or_default();
                    resolve_task(connection, owner, reference, Some(&routine.id), false)
                        .map(|task| task.id)
                })
                .collect::<RoutineResult<Vec<_>>>()?;
            RoutineMutation::ReorderTasks {
                routine_id: routine.id,
                ordered_task_ids,
            }
        }
        "set_routine_completions" => {
            let items = arguments
                .get("items")
                .and_then(Value::as_array)
                .filter(|items| !items.is_empty())
                .ok_or_else(|| RoutineCommandError::validation("Falta la lista items."))?;
            if items.len() > MAX_COMPLETION_ITEMS {
                return Err(RoutineCommandError::validation(format!(
                    "Se pueden registrar como máximo {MAX_COMPLETION_ITEMS} marcas por vez."
                )));
            }
            return items
                .iter()
                .map(|item| {
                    Ok(RoutineMutation::SetCompletion {
                        task_id: resolve_task(
                            connection,
                            owner,
                            &required(item, "task")?,
                            None,
                            false,
                        )?
                        .id,
                        date: day_argument(item, today)?.format("%Y-%m-%d").to_string(),
                        completed: item
                            .get("completed")
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                    })
                })
                .collect();
        }
        "set_routine_goal" => RoutineMutation::SetGoal {
            category: canonical_category(&required(arguments, "category")?)?.to_string(),
            goal: arguments
                .get("goal")
                .and_then(Value::as_u64)
                .filter(|goal| (1..=10).contains(goal))
                .ok_or_else(|| {
                    RoutineCommandError::validation("La meta debe ser un entero entre 1 y 10.")
                })? as u8,
        },
        _ => {
            return Err(RoutineCommandError::validation(
                "La tool de Rutina no existe.",
            ))
        }
    };
    Ok(vec![mutation])
}

fn apply_tool(
    connection: &Connection,
    owner: &str,
    name: &str,
    arguments: &Value,
    today: NaiveDate,
) -> RoutineResult<Vec<RoutineMutationOutcome>> {
    tool_mutations(connection, owner, name, arguments, today)?
        .iter()
        .map(|mutation| apply_mutation(connection, owner, mutation, today))
        .collect()
}

/// Validates a write and returns the summary shown in the confirmation. The
/// transaction is rolled back, so nothing is persisted.
pub fn preview_tool(
    app: &crate::host::AppHandle,
    context: &RoutineContext,
    name: &str,
    arguments: &Value,
) -> RoutineResult<String> {
    let outcomes = with_transaction(app, context, false, |transaction, owner, today| {
        apply_tool(transaction, owner, name, arguments, today)
    })?;
    Ok(outcomes
        .iter()
        .map(|outcome| outcome.summary.as_str())
        .collect::<Vec<_>>()
        .join("\n"))
}

pub fn execute_tool(
    app: &crate::host::AppHandle,
    context: &RoutineContext,
    name: &str,
    arguments: &Value,
) -> RoutineResult<Value> {
    if is_routine_write_tool(name) {
        let outcomes = with_transaction(app, context, true, |transaction, owner, today| {
            apply_tool(transaction, owner, name, arguments, today)
        })?;
        let changed = outcomes.iter().any(|outcome| outcome.changed);
        if changed {
            if let Err(error) = app.emit(ROUTINE_DATA_CHANGED_EVENT, ()) {
                log::warn!("[notia:routine] evento de cambio no emitido: {error}");
            }
        }
        return Ok(json!({ "ok": true, "changed": changed, "results": outcomes }));
    }
    with_transaction(app, context, false, |transaction, owner, today| {
        read_tool(transaction, owner, name, arguments, today)
    })
}

fn read_tool(
    connection: &Connection,
    owner: &str,
    name: &str,
    arguments: &Value,
    today: NaiveDate,
) -> RoutineResult<Value> {
    let data = load_data(connection, owner, today - Duration::days(HISTORY_DAYS))?;
    let routine_name = |id: &str| {
        data.routines
            .iter()
            .find(|routine| routine.id == id)
            .map(|routine| routine.name.clone())
            .unwrap_or_default()
    };
    match name {
        "get_routine_dashboard" => {
            let dashboard = build_dashboard(&data, today);
            let pending_today = tasks_on(&data, today, None)
                .into_iter()
                .filter(|task| !data.is_completed(&task.id, today))
                .map(|task| json!({ "id": task.id, "name": task.name, "routine": routine_name(&task.routine_id) }))
                .collect::<Vec<_>>();
            Ok(json!({
                "today": dashboard.today,
                "routines": dashboard.routines.iter().map(|routine| json!({
                    "id": routine.id, "name": routine.name, "taskCount": routine.task_count,
                })).collect::<Vec<_>>(),
                "tasks": dashboard.tasks.iter().map(|task| json!({
                    "id": task.id, "name": task.name, "routine": routine_name(&task.routine_id),
                    "category": task.category, "days": task.days_label, "notes": task.notes,
                    "status": if task.paused { "paused" } else { "active" }, "streak": task.streak,
                })).collect::<Vec<_>>(),
                "todayProgress": {
                    "done": dashboard.nav.today_done, "total": dashboard.nav.today_total,
                    "pct": dashboard.nav.today_pct, "pending": pending_today,
                },
                "week": {
                    "range": dashboard.current_week.range_label,
                    "pct": dashboard.nav.week_pct,
                    "byRoutine": dashboard.current_week.routines.iter().map(|week| json!({
                        "routine": week.routine_id.as_deref().map(&routine_name), "pct": week.pct,
                    })).collect::<Vec<_>>(),
                },
                "weeksOfMonth": dashboard.weekly.weeks.iter().map(|week| json!({
                    "week": week.label, "pct": week.current_pct, "previousMonthPct": week.previous_pct,
                })).collect::<Vec<_>>(),
                "month": {
                    "name": dashboard.month_label, "pct": dashboard.weekly.month_pct,
                    "done": dashboard.weekly.month_done, "total": dashboard.weekly.month_total,
                    "bestStreak": dashboard.weekly.best_streak, "bestDay": dashboard.evolution.best_day,
                },
                "lifeWheel": dashboard.wheel.axes.iter().map(|axis| json!({
                    "category": axis.category, "current": axis.current, "previousMonth": axis.previous, "goal": axis.goal,
                })).collect::<Vec<_>>(),
                "lifeWheelAverage": dashboard.wheel.average,
                "deletedTasks": deleted_tasks(connection, owner)?,
            }))
        }
        "get_routine_day" => {
            let date = day_argument(arguments, today)?;
            let routine_id = text(arguments, "routine")
                .map(|reference| {
                    resolve_routine(connection, owner, &reference).map(|routine| routine.id)
                })
                .transpose()?;
            let tasks = tasks_on(&data, date, routine_id.as_deref());
            let (done, total) =
                completion_for_day(&data, date, routine_id.as_deref()).unwrap_or((0, 0));
            Ok(json!({
                "date": date.format("%Y-%m-%d").to_string(),
                "dayName": DAY_NAMES[weekday_index(date) as usize],
                "editable": date <= today,
                "done": done,
                "total": total,
                "tasks": tasks.iter().map(|task| json!({
                    "id": task.id, "name": task.name, "routine": routine_name(&task.routine_id),
                    "category": task.category, "completed": data.is_completed(&task.id, date),
                })).collect::<Vec<_>>(),
            }))
        }
        "list_routine_history" => {
            let to = optional_date(arguments, "to", today)?;
            let from = optional_date(arguments, "from", to - Duration::days(6))?;
            if from > to || (to - from).num_days() >= MAX_HISTORY_DAYS {
                return Err(RoutineCommandError::validation(format!(
                    "El rango debe ser válido y de hasta {MAX_HISTORY_DAYS} días."
                )));
            }
            if from < today - Duration::days(HISTORY_DAYS) {
                return Err(RoutineCommandError::validation(format!(
                    "El historial disponible abarca los últimos {HISTORY_DAYS} días."
                )));
            }
            let task = text(arguments, "task")
                .map(|reference| resolve_task(connection, owner, &reference, None, false))
                .transpose()?;
            let routine_id = text(arguments, "routine")
                .map(|reference| {
                    resolve_routine(connection, owner, &reference).map(|routine| routine.id)
                })
                .transpose()?;
            let days = (0..=(to - from).num_days())
                .map(|offset| from + Duration::days(offset))
                .map(|date| {
                    let stamp = date.format("%Y-%m-%d").to_string();
                    match &task {
                        Some(task) => json!({
                            "date": stamp,
                            "applies": task.days.applies(weekday_index(date)),
                            "completed": data.is_completed(&task.id, date),
                        }),
                        None => {
                            let tasks = tasks_on(&data, date, routine_id.as_deref());
                            json!({
                                "date": stamp,
                                "done": tasks.iter().filter(|task| data.is_completed(&task.id, date)).count(),
                                "total": tasks.len(),
                                "completed": tasks.iter().filter(|task| data.is_completed(&task.id, date))
                                    .map(|task| task.name.clone()).collect::<Vec<_>>(),
                            })
                        }
                    }
                })
                .collect::<Vec<_>>();
            Ok(json!({
                "from": from.format("%Y-%m-%d").to_string(),
                "to": to.format("%Y-%m-%d").to_string(),
                "task": task.as_ref().map(|task| json!({ "id": task.id, "name": task.name, "days": task.days.label() })),
                "days": days,
            }))
        }
        "get_routine_month_report" => {
            let (year, month) = month_argument(arguments, today)?;
            let report = build_month_report(&data, year, month, today);
            let mut value = serde_json::to_value(&report)
                .map_err(|_| RoutineCommandError::storage("No se pudo armar el informe."))?;
            if let Some(tasks) = value.get_mut("tasks").and_then(Value::as_array_mut) {
                for task in tasks {
                    let routine = task["routineId"]
                        .as_str()
                        .map(&routine_name)
                        .unwrap_or_default();
                    task["routine"] = Value::String(routine);
                }
            }
            Ok(value)
        }
        _ => Err(RoutineCommandError::validation(
            "La tool de Rutina no existe.",
        )),
    }
}

/// Most recently deleted tasks, which `restore_routine_task` can bring back.
fn deleted_tasks(connection: &Connection, owner: &str) -> RoutineResult<Vec<Value>> {
    Ok(connection
        .prepare(
            "SELECT t.id, t.name, r.name, t.deleted_at FROM routine_tasks t
             JOIN routine_routines r ON r.id = t.routine_id
             WHERE t.owner_user_id=?1 AND t.deleted_at IS NOT NULL
             ORDER BY t.deleted_at DESC LIMIT 20",
        )?
        .query_map([owner], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "routine": row.get::<_, String>(2)?,
                "deletedAt": row.get::<_, String>(3)?,
            }))
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routine::tests::{connection, date, seed_routine, seed_task};

    const OWNER: &str = "user-owner";

    fn run(
        connection: &Connection,
        name: &str,
        arguments: Value,
    ) -> RoutineResult<Vec<RoutineMutationOutcome>> {
        apply_tool(connection, OWNER, name, &arguments, date("2026-09-23"))
    }

    #[test]
    fn every_routine_tool_is_in_the_backend_catalog() {
        let catalog = notia_backend_core::canonical_tool_catalog();
        for name in ROUTINE_READ_TOOLS.iter().chain(ROUTINE_WRITE_TOOLS.iter()) {
            let tool = catalog
                .iter()
                .find(|tool| tool.name == *name)
                .unwrap_or_else(|| panic!("{name}"));
            assert_eq!(tool.read_only, ROUTINE_READ_TOOLS.contains(name), "{name}");
            assert_eq!(tool.requires_confirmation, !tool.read_only, "{name}");
        }
    }

    #[test]
    fn creates_a_task_by_routine_name_and_marks_it_done_today() {
        let connection = connection();
        seed_routine(&connection, "Mañana");
        seed_routine(&connection, "Noche");
        let created = run(&connection, "save_routine_task", json!({
            "name": "Estirar", "routine": "noche", "category": "salud y deporte", "days": [0, 2, 4],
        }))
        .expect("create");
        assert!(created[0].summary.contains("L X V"));
        let marked = run(
            &connection,
            "set_routine_completions",
            json!({ "items": [{ "task": "estirar" }] }),
        )
        .expect("complete");
        assert!(marked[0].changed);
        let day = read_tool(
            &connection,
            OWNER,
            "get_routine_day",
            &json!({}),
            date("2026-09-23"),
        )
        .expect("day");
        assert_eq!(day["done"], 1);
        assert_eq!(day["tasks"][0]["completed"], true);
    }

    #[test]
    fn resolves_relative_days_and_reports_months() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        let task = seed_task(&connection, &routine, "Leer", None);
        let marked = run(
            &connection,
            "set_routine_completions",
            json!({ "items": [{ "task": "leer", "daysAgo": 1 }] }),
        )
        .expect("yesterday");
        assert!(marked[0].summary.contains("22/09/2026"));
        let both = json!({ "items": [{ "task": "leer", "daysAgo": 1, "date": "2026-09-22" }] });
        assert!(run(&connection, "set_routine_completions", both).is_err());
        let today = date("2026-09-23");
        let report = read_tool(
            &connection,
            OWNER,
            "get_routine_month_report",
            &json!({}),
            today,
        )
        .expect("report");
        assert_eq!(report["month"], "2026-09");
        assert_eq!(report["done"], 1);
        assert_eq!(report["tasks"][0]["routine"], "Mañana");
        let future = read_tool(
            &connection,
            OWNER,
            "get_routine_month_report",
            &json!({ "month": "2026-10" }),
            today,
        );
        assert!(future.is_err());
        run(&connection, "delete_routine_task", json!({ "task": task })).expect("delete");
        let dashboard = read_tool(
            &connection,
            OWNER,
            "get_routine_dashboard",
            &json!({}),
            today,
        )
        .expect("dashboard");
        assert_eq!(dashboard["deletedTasks"][0]["name"], "Leer");
        assert!(dashboard["weeksOfMonth"]
            .as_array()
            .is_some_and(|weeks| !weeks.is_empty()));
    }

    #[test]
    fn requires_a_routine_when_the_user_has_several() {
        let connection = connection();
        seed_routine(&connection, "Mañana");
        seed_routine(&connection, "Noche");
        let error = run(
            &connection,
            "save_routine_task",
            json!({ "name": "Leer", "category": "Emocional" }),
        )
        .unwrap_err();
        assert_eq!(error.message, "Indicá en qué rutina va la tarea.");
    }

    #[test]
    fn partial_updates_keep_unspecified_fields() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        seed_task(&connection, &routine, "Correr", Some(vec![5, 6]));
        run(
            &connection,
            "save_routine_task",
            json!({ "task": "correr", "notes": "5 km" }),
        )
        .expect("update");
        let data = load_data(&connection, OWNER, date("2026-01-01")).expect("data");
        assert_eq!(data.tasks[0].days, TaskDays::Only(vec![5, 6]));
        assert_eq!(data.tasks[0].notes, "5 km");
        assert_eq!(data.tasks[0].category, "Salud y deporte");
    }

    #[test]
    fn restores_a_deleted_task_by_name_and_limits_history_ranges() {
        let connection = connection();
        let routine = seed_routine(&connection, "Mañana");
        seed_task(&connection, &routine, "Meditar", None);
        run(
            &connection,
            "delete_routine_task",
            json!({ "task": "meditar" }),
        )
        .expect("delete");
        run(
            &connection,
            "restore_routine_task",
            json!({ "task": "Meditar" }),
        )
        .expect("restore");
        let too_long = read_tool(
            &connection,
            OWNER,
            "list_routine_history",
            &json!({ "from": "2026-01-01", "to": "2026-09-23" }),
            date("2026-09-23"),
        );
        assert!(too_long.is_err());
        let week = read_tool(
            &connection,
            OWNER,
            "list_routine_history",
            &json!({}),
            date("2026-09-23"),
        )
        .expect("history");
        assert_eq!(week["days"].as_array().map(Vec::len), Some(7));
    }
}
