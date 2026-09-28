use std::collections::HashSet;

use super::dashboard::{build_dashboard, run_history, DashboardFilter, TimelineEntry, Tone};
use super::labels::{days_phrase, form_summary, in_label, recurrence_label, schedule_label};
use super::schedule::{local_instant, occurrences_on, parse_date, upcoming};
use super::scheduler::{claim_lease, interrupted_runs, plan_action, InstanceKind, Planned, SchedulerLease, LEASE_TTL_MS};
use super::*;

const ZONE: &str = "America/Argentina/Buenos_Aires";

fn zone() -> TimeZone {
    time_zone(ZONE)
}

/// Local moment in Buenos Aires (2026-09-28 is a Monday).
fn at(date: &str, time: &str) -> i64 {
    local_instant(&zone(), parse_date(date).unwrap(), schedule::parse_minute(time).unwrap()).unwrap()
}

fn now() -> i64 {
    at("2026-09-28", "13:42")
}

fn recurring(every: u32, unit: RepeatUnit, weekdays: &[u8], from: Option<&str>, to: Option<&str>) -> AiSchedule {
    AiSchedule::Recurring {
        rule: Recurrence {
            every,
            unit,
            weekdays: weekdays.to_vec(),
            from: from.map(str::to_string),
            to: to.map(str::to_string),
            anchor_date: "2026-09-28".into(),
        },
    }
}

fn action(id: &str, kind: AiActionKind, schedule: AiSchedule) -> AiAction {
    AiAction {
        id: id.into(),
        name: format!("Acción {id}"),
        prompt: format!("Prompt de {id}"),
        kind,
        schedule,
        time_zone: ZONE.into(),
        enabled: true,
        active_since_ms: at("2026-09-27", "00:00"),
        created_at_ms: at("2026-09-27", "00:00"),
        updated_at_ms: at("2026-09-27", "00:00"),
        builtin: None,
    }
}

fn run(id: &str, action: &AiAction, scheduled_for_ms: i64, status: RunStatus, trigger: RunTrigger, created_at_ms: i64) -> AiActionRun {
    AiActionRun {
        id: id.into(),
        action_id: Some(action.id.clone()),
        action_name: action.name.clone(),
        kind: action.kind,
        scheduled_for_ms,
        created_at_ms,
        started_at_ms: Some(created_at_ms),
        finished_at_ms: Some(created_at_ms + 60_000),
        status,
        error: (status == RunStatus::Failed).then(|| "No se pudo enviar por Telegram".into()),
        output_summary: None,
        trigger,
        retry_of: None,
        runner: Some("me".into()),
    }
}

fn input(kind: AiActionKind) -> AiActionInput {
    AiActionInput { kind: Some(kind), name: "Resumen".into(), prompt: "Hacé algo".into(), ..AiActionInput::default() }
}

fn fields(result: Result<ValidAction, Vec<FieldError>>) -> Vec<String> {
    result.expect_err("errors").into_iter().map(|error| error.field).collect()
}

#[test]
fn a_one_time_action_needs_a_future_date_and_time() {
    let mut once = input(AiActionKind::OneShot);
    assert_eq!(fields(validate_input(&once, &zone(), now(), InputOrigin::default())), ["date", "time"]);
    once.date = Some("2026-09-28".into());
    once.time = Some("13:00".into());
    assert_eq!(fields(validate_input(&once, &zone(), now(), InputOrigin::default())), ["time"]);
    // An edit may keep the moment it already had.
    let kept = validate_input(&once, &zone(), now(), InputOrigin { stored_at_ms: Some(at("2026-09-28", "13:00")), ..InputOrigin::default() });
    assert!(kept.is_ok());
    once.time = Some("17:00".into());
    let valid = validate_input(&once, &zone(), now(), InputOrigin::default()).expect("valid");
    assert_eq!(valid.schedule, AiSchedule::Once { at_ms: at("2026-09-28", "17:00") });
    // Name and prompt are required, and the name has a limit.
    once.name = " ".into();
    once.prompt = "x".repeat(MAX_PROMPT_CHARS + 1);
    assert_eq!(fields(validate_input(&once, &zone(), now(), InputOrigin::default())), ["name", "prompt"]);
}

#[test]
fn a_recurrence_follows_the_rules_of_the_form() {
    let mut rule = input(AiActionKind::Recurring);
    rule.every = Some("3".into());
    rule.unit = Some(RepeatUnit::Minutes);
    rule.weekdays = vec![];
    rule.from = Some("21:00".into());
    rule.to = Some("09:00".into());
    assert_eq!(fields(validate_input(&rule, &zone(), now(), InputOrigin::default())), ["every", "weekdays", "to"]);
    rule.unit = Some(RepeatUnit::Days);
    rule.every = Some("0".into());
    rule.from = None;
    rule.weekdays = vec![6, 0, 0];
    assert_eq!(fields(validate_input(&rule, &zone(), now(), InputOrigin::default())), ["every", "from"]);
    rule.every = Some("2".into());
    rule.from = Some("08:00".into());
    let valid = validate_input(&rule, &zone(), now(), InputOrigin::default()).expect("valid");
    let AiSchedule::Recurring { rule } = valid.schedule else { panic!("recurring") };
    // Days and weeks ignore «Hasta»; the days come sorted and unique.
    assert_eq!((rule.weekdays, rule.to, rule.anchor_date.as_str()), (vec![0, 6], None, "2026-09-28"));
}

#[test]
fn every_three_hours_from_nine_to_nine_on_workdays() {
    let schedule = recurring(3, RepeatUnit::Hours, &[0, 1, 2, 3, 4], Some("09:00"), Some("21:00"));
    let monday = occurrences_on(&schedule, &zone(), parse_date("2026-09-28").unwrap());
    let times = monday.iter().map(|ms| labels::time_label(&zone(), *ms)).collect::<Vec<_>>();
    assert_eq!(times, ["09:00", "12:00", "15:00", "18:00", "21:00"]);
    assert!(occurrences_on(&schedule, &zone(), parse_date("2026-10-03").unwrap()).is_empty());
    // Without a window, minutes start at midnight.
    let half_hour = recurring(30, RepeatUnit::Minutes, &[0, 1, 2, 3, 4, 5, 6], None, None);
    assert_eq!(occurrences_on(&half_hour, &zone(), parse_date("2026-09-28").unwrap()).len(), 48);
}

#[test]
fn days_and_weeks_count_from_the_anchor() {
    let every_two_days = recurring(2, RepeatUnit::Days, &[0, 1, 2, 3, 4, 5, 6], Some("08:00"), None);
    let next = upcoming(&every_two_days, &zone(), now(), 3);
    let dates = next.iter().map(|ms| schedule::local_date(&zone(), *ms).to_string()).collect::<Vec<_>>();
    assert_eq!(dates, ["2026-09-30", "2026-10-02", "2026-10-04"]);
    let every_two_weeks = recurring(2, RepeatUnit::Weeks, &[6], Some("20:00"), None);
    let sundays = upcoming(&every_two_weeks, &zone(), now(), 2);
    let dates = sundays.iter().map(|ms| schedule::local_date(&zone(), *ms).to_string()).collect::<Vec<_>>();
    assert_eq!(dates, ["2026-10-04", "2026-10-18"]);
}

#[test]
fn the_cards_say_when_in_spanish() {
    let today = parse_date("2026-09-28").unwrap();
    let label = |schedule: AiSchedule| schedule_label(&schedule, &zone(), today);
    assert_eq!(label(AiSchedule::Once { at_ms: at("2026-09-28", "17:00") }), "Hoy · 17:00");
    assert_eq!(label(AiSchedule::Once { at_ms: at("2026-09-29", "10:00") }), "Mañana · 10:00");
    assert_eq!(label(AiSchedule::Once { at_ms: at("2026-10-01", "09:00") }), "Jue 1 oct · 09:00");
    assert_eq!(label(recurring(1, RepeatUnit::Days, &[0, 1, 2, 3, 4, 5, 6], Some("08:00"), None)), "Todos los días · 08:00");
    assert_eq!(label(recurring(3, RepeatUnit::Hours, &[0, 1, 2, 3, 4, 5, 6], Some("09:00"), Some("21:00"))), "Cada 3 h · 09 a 21 h");
    assert_eq!(label(recurring(1, RepeatUnit::Days, &[0, 1, 2, 3, 4], Some("16:00"), None)), "Lun a Vie · 16:00");
    assert_eq!(label(recurring(1, RepeatUnit::Weeks, &[6], Some("20:00"), None)), "Semanal · Dom 20:00");
    assert_eq!(
        recurrence_label(&Recurrence { every: 1, unit: RepeatUnit::Hours, weekdays: vec![0, 2, 4], from: None, to: None, anchor_date: "2026-09-28".into() }),
        "Cada hora · Lun, Mié, Vie"
    );
    assert_eq!(days_phrase(&[0, 2, 4]), "los lunes, miércoles y viernes");
    assert_eq!(days_phrase(&[5, 6]), "los fines de semana");
    assert!(form_summary(AiActionKind::Recurring, &[0, 1, 2, 3, 4]).contains("de lunes a viernes, y te responde por Telegram"));
    assert_eq!((in_label(48), in_label(120), in_label(65)), ("en 48 min".into(), "en 2 h".into(), "en 1 h 5 min".into()));
}

fn items(dashboard: &AiActionsDashboard) -> Vec<(String, String, Tone, Option<String>)> {
    dashboard
        .timeline
        .iter()
        .filter_map(|entry| match entry {
            TimelineEntry::Item { item } => Some((item.time.clone(), item.name.clone(), item.tone, item.note.clone())),
            TimelineEntry::Now { .. } => None,
        })
        .collect()
}

fn card<'a>(dashboard: &'a AiActionsDashboard, id: &str) -> &'a dashboard::ActionCard {
    dashboard.columns.iter().flat_map(|column| &column.cards).find(|card| card.id == id).expect(id)
}

#[test]
fn the_dashboard_follows_the_state_priority_and_the_next_run() {
    let gastos = action("gastos", AiActionKind::Recurring, recurring(3, RepeatUnit::Hours, &[0, 1, 2, 3, 4], Some("09:00"), Some("21:00")));
    let export = action("export", AiActionKind::OneShot, AiSchedule::Once { at_ms: at("2026-09-28", "11:00") });
    let correos = action("correos", AiActionKind::OneShot, AiSchedule::Once { at_ms: at("2026-09-28", "14:30") });
    let tarjeta = action("tarjeta", AiActionKind::Reminder, AiSchedule::Once { at_ms: at("2026-09-28", "17:00") });
    let viejo = action("viejo", AiActionKind::Reminder, AiSchedule::Once { at_ms: at("2026-09-20", "10:00") });
    let mut huerfanas = action("huerfanas", AiActionKind::Recurring, recurring(1, RepeatUnit::Days, &[0, 1, 2, 3, 4, 5, 6], Some("16:00"), None));
    huerfanas.enabled = false;
    let runs = vec![
        run("r1", &gastos, at("2026-09-28", "09:00"), RunStatus::Success, RunTrigger::Scheduled, at("2026-09-28", "09:00")),
        run("r2", &gastos, at("2026-09-28", "12:00"), RunStatus::Success, RunTrigger::Scheduled, at("2026-09-28", "12:00")),
        run("r3", &export, at("2026-09-28", "11:00"), RunStatus::Failed, RunTrigger::Scheduled, at("2026-09-28", "11:00")),
    ];
    let actions = vec![gastos, export.clone(), correos, tarjeta, viejo, huerfanas];
    let dashboard = build_dashboard(&actions, &runs, now(), &zone(), DashboardFilter::All, "");

    assert_eq!(card(&dashboard, "export").status.label, "Falló · 11:00");
    assert_eq!(card(&dashboard, "export").retry_run_id.as_deref(), Some("r3"));
    assert_eq!(card(&dashboard, "correos").status.label, "Próxima · 14:30");
    assert_eq!(card(&dashboard, "gastos").status.label, "Ejecutada · 12:01");
    assert_eq!(card(&dashboard, "gastos").runs_label.as_deref(), Some("2 de 5 hoy"));
    assert_eq!(card(&dashboard, "gastos").next_label.as_deref(), Some("hoy 15:00"));
    assert_eq!(card(&dashboard, "tarjeta").status.label, "Pendiente · 17:00");
    assert_eq!((card(&dashboard, "huerfanas").status.tone, card(&dashboard, "huerfanas").next_label.as_deref()), (Tone::Paused, Some("—")));
    // A one-time action that ended before today stays in the history only.
    assert!(dashboard.columns.iter().flat_map(|column| &column.cards).all(|card| card.id != "viejo"));

    let timeline = items(&dashboard);
    let first_future = timeline.iter().find(|item| matches!(item.2, Tone::Next | Tone::Pending)).unwrap();
    let next = dashboard.metrics.next.as_ref().unwrap();
    assert_eq!((first_future.0.as_str(), first_future.1.as_str(), first_future.2), (next.time.as_str(), next.name.as_str(), Tone::Next));
    assert_eq!(next.in_label, "en 48 min");
    assert!(timeline.contains(&("12:00".into(), "Acción gastos".into(), Tone::Done, Some("2 de 5".into()))));
    assert!(timeline.contains(&("11:00".into(), "Acción export".into(), Tone::Failed, Some("No se pudo enviar por Telegram".into()))));
    assert!(timeline.contains(&("16:00".into(), "Acción huerfanas".into(), Tone::Paused, Some("Pausada".into()))));
    let now_index = dashboard.timeline.iter().position(|entry| matches!(entry, TimelineEntry::Now { .. })).unwrap();
    assert!(matches!(&dashboard.timeline[now_index + 1], TimelineEntry::Item { item } if item.time == "14:30"));

    assert_eq!((dashboard.metrics.done_today, dashboard.metrics.failed_today), (2, 1));
    // 15, 18 and 21 h of gastos, correos and tarjeta.
    assert_eq!(dashboard.metrics.pending_today, 5);
    assert_eq!(dashboard.metrics.pending_until.as_deref(), Some("Hasta las 21:00"));
    assert_eq!((dashboard.metrics.recurring_active, dashboard.metrics.recurring_total, dashboard.metrics.recurring_paused), (1, 2, 1));
    // The paused occurrence is left out of the progress.
    assert_eq!((dashboard.progress.done, dashboard.progress.total), (2, 8));

    // A retry that works turns the chip into «Reintentada».
    let mut retried = runs.clone();
    let mut retry = run("r4", &export, at("2026-09-28", "11:00"), RunStatus::Success, RunTrigger::Retry, at("2026-09-28", "13:40"));
    retry.retry_of = Some("r3".into());
    retried.push(retry);
    let dashboard = build_dashboard(&actions, &retried, now(), &zone(), DashboardFilter::All, "");
    assert_eq!(card(&dashboard, "export").status.label, "Reintentada · 13:41");
    assert!(items(&dashboard).contains(&("11:00".into(), "Acción export".into(), Tone::Done, Some("Reintentada 13:41".into()))));
    assert_eq!(dashboard.metrics.failed_today, 0);
}

#[test]
fn the_filter_and_the_search_narrow_the_cards_only() {
    let actions = vec![
        action("a", AiActionKind::Reminder, AiSchedule::Once { at_ms: at("2026-09-28", "17:00") }),
        action("b", AiActionKind::Recurring, recurring(1, RepeatUnit::Days, &[0, 1, 2, 3, 4, 5, 6], Some("20:00"), None)),
    ];
    let dashboard = build_dashboard(&actions, &[], now(), &zone(), DashboardFilter::Recurring, "PRÓMPT de b");
    assert_eq!(dashboard.columns.len(), 1);
    assert_eq!(dashboard.columns[0].cards.len(), 1);
    assert_eq!((dashboard.counts.all, dashboard.counts.reminder, dashboard.counts.recurring), (1, 0, 1));
    assert_eq!(items(&dashboard).len(), 2);
}

#[test]
fn occurrences_before_the_action_existed_do_not_show() {
    let mut hourly = action("h", AiActionKind::Recurring, recurring(1, RepeatUnit::Hours, &[0, 1, 2, 3, 4, 5, 6], None, None));
    hourly.active_since_ms = at("2026-09-28", "13:30");
    let dashboard = build_dashboard(&[hourly], &[], now(), &zone(), DashboardFilter::All, "");
    let timeline = items(&dashboard);
    assert_eq!(timeline.first().map(|item| item.0.as_str()), Some("14:00"));
    assert_eq!(timeline.len(), 10);
}

#[test]
fn the_clock_runs_what_is_due_and_skips_what_was_lost() {
    let mut hourly = action("h", AiActionKind::Recurring, recurring(1, RepeatUnit::Hours, &[0, 1, 2, 3, 4, 5, 6], None, None));
    let at_14 = at("2026-09-28", "14:00");
    // First tick at 14:01: 14:00 runs; earlier ones were never seen.
    assert_eq!(plan_action(&hourly, &[], None, at_14 + 60_000), [Planned::Run { scheduled_for_ms: at_14 }]);
    // Back at 14:01 after being closed since 10:30: 11, 12 and 13 h are lost.
    let plans = plan_action(&hourly, &[], Some(at("2026-09-28", "10:30")), at_14 + 60_000);
    assert_eq!(plans.len(), 4);
    assert!(matches!(plans[0], Planned::Skip { reason: scheduler::SKIP_MISSED_RECURRING, .. }));
    assert_eq!(plans[3], Planned::Run { scheduled_for_ms: at_14 });
    // Already planned, or the previous run still going.
    let done = run("r", &hourly, at_14, RunStatus::Running, RunTrigger::Scheduled, at_14);
    assert!(plan_action(&hourly, std::slice::from_ref(&done), Some(at_14), at_14 + 60_000).is_empty());
    let at_15 = at("2026-09-28", "15:00");
    assert_eq!(plan_action(&hourly, &[done], Some(at_15 - 1), at_15 + 1), [Planned::Skip { scheduled_for_ms: at_15, reason: scheduler::SKIP_OVERLAP }]);
    hourly.enabled = false;
    assert!(plan_action(&hourly, &[], None, at_15).is_empty());

    let once = action("o", AiActionKind::OneShot, AiSchedule::Once { at_ms: at_14 });
    assert_eq!(plan_action(&once, &[], None, at_14 + 30 * 60_000), [Planned::Run { scheduled_for_ms: at_14 }]);
    assert!(matches!(plan_action(&once, &[], None, at_14 + 61 * 60_000)[0], Planned::Skip { reason: scheduler::SKIP_MISSED_ONCE, .. }));
    let mut turned_on_later = once.clone();
    turned_on_later.active_since_ms = at_14 + 60_000;
    assert!(plan_action(&turned_on_later, &[], None, at_14 + 2 * 60_000).is_empty());
}

#[test]
fn only_one_instance_holds_the_lease() {
    let now = now();
    let desktop = claim_lease(None, "desktop-1", InstanceKind::Desktop, now).expect("free");
    assert_eq!(desktop.expires_at_ms, now + LEASE_TTL_MS);
    assert!(claim_lease(Some(&desktop), "android-1", InstanceKind::Android, now).is_none());
    assert!(claim_lease(Some(&desktop), "desktop-2", InstanceKind::Desktop, now).is_none());
    assert!(claim_lease(Some(&desktop), "desktop-1", InstanceKind::Desktop, now + 1_000).is_some());
    let server = claim_lease(Some(&desktop), "server-1", InstanceKind::Server, now).expect("the server takes over");
    assert!(claim_lease(Some(&server), "desktop-1", InstanceKind::Desktop, now).is_none());
    let expired = SchedulerLease { expires_at_ms: now, ..server.clone() };
    assert!(claim_lease(Some(&expired), "android-1", InstanceKind::Android, now).is_some());
    // The holder writes it again only when half its time is gone.
    assert!(!scheduler::lease_needs_renewal(Some(&server), "server-1", now + LEASE_TTL_MS / 2 - 1));
    assert!(scheduler::lease_needs_renewal(Some(&server), "server-1", now + LEASE_TTL_MS / 2 + 1));
    assert!(scheduler::lease_needs_renewal(Some(&server), "desktop-1", now));
    assert!(scheduler::lease_needs_renewal(None, "desktop-1", now));
}

#[test]
fn runs_nobody_will_finish_are_interrupted() {
    let hourly = action("h", AiActionKind::Recurring, recurring(1, RepeatUnit::Hours, &[0, 1, 2, 3, 4, 5, 6], None, None));
    let mine = run("mine", &hourly, now(), RunStatus::Running, RunTrigger::Scheduled, now());
    let held = run("held", &hourly, now(), RunStatus::Pending, RunTrigger::Scheduled, now());
    let mut foreign = run("foreign", &hourly, now(), RunStatus::Running, RunTrigger::Scheduled, now() - 7 * 60 * 60 * 1000);
    foreign.runner = Some("other".into());
    let mut recent_foreign = foreign.clone();
    recent_foreign.id = "recent".into();
    recent_foreign.created_at_ms = now();
    let runs = [mine, held, foreign, recent_foreign];
    let in_hand = HashSet::from(["held".to_string()]);
    let ids = interrupted_runs(&runs, "me", &in_hand, now()).into_iter().map(|run| run.id.as_str()).collect::<Vec<_>>();
    assert_eq!(ids, ["mine", "foreign"]);
}

#[test]
fn the_history_lists_the_newest_first_and_the_form_round_trips() {
    let export = action("export", AiActionKind::OneShot, AiSchedule::Once { at_ms: at("2026-09-28", "11:00") });
    let runs = [
        run("r1", &export, at("2026-09-28", "11:00"), RunStatus::Failed, RunTrigger::Scheduled, at("2026-09-28", "11:00")),
        run("r2", &export, at("2026-09-28", "11:00"), RunStatus::Success, RunTrigger::Retry, at("2026-09-28", "13:00")),
    ];
    let history = run_history("export", &runs, now(), &zone());
    assert_eq!((history[0].trigger.as_str(), history[0].status.label.as_str()), ("Reintento", "Reintentada · 13:01"));
    assert_eq!(history[1].note.as_deref(), Some("No se pudo enviar por Telegram"));
    let form = input_from_action(&export);
    assert_eq!((form.date.as_deref(), form.time.as_deref()), (Some("2026-09-28"), Some("11:00")));
}

#[test]
fn the_hourly_review_becomes_a_recurring_action() {
    let review = hourly_review_action("id".into(), ZONE.into(), true, now());
    assert_eq!(review.builtin.as_deref(), Some(BUILTIN_HOURLY_REVIEW));
    assert_eq!(schedule_label(&review.schedule, &zone(), parse_date("2026-09-28").unwrap()), "Cada hora");
    assert!(review.prompt.contains("[SIN_MENSAJE]") && review.prompt.contains("No cambies nada"));
    assert_eq!(library_time_zone(Some(ZONE)), ZONE);
    assert_ne!(library_time_zone(Some("Marte/Olympus")), "Marte/Olympus");
}

#[test]
fn the_prompts_explain_the_run_and_silence_never_mutes_a_reminder() {
    let guidance = prompts::action_guidance(&prompts::ScheduledActionPrompt {
        name: "Registrar gastos".into(),
        kind: AiActionKind::Recurring,
        when: "Cada 3 h · 09 a 21 h".into(),
        test: true,
    });
    assert!(guidance.contains("«Registrar gastos»") && guidance.contains("[SIN_MENSAJE]") && guidance.contains("add_agent_thought"));
    assert!(guidance.contains("prueba"));
    assert!(prompts::is_silent(AiActionKind::Recurring, "[SIN_MENSAJE]"));
    assert!(!prompts::is_silent(AiActionKind::Reminder, "[SIN_MENSAJE]"));
    assert_eq!(prompts::outgoing_message(" Hecho ", true), "[Prueba] Hecho");
    assert!(prompts::action_request("Gastos", " Cargá ", "2026-09-28 13:42", false).ends_with("«Gastos»]\nCargá"));
    assert!(prompts::sent_thought(&"n".repeat(200), &"m".repeat(2_000)).chars().count() <= crate::agent_workspace::MAX_THOUGHT_CHARS);
}
