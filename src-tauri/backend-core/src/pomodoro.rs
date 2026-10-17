//! Pomodoro timer of a library user: phases, pauses, deviations and the
//! events the Task Manager logs. The adapter stores the state per library and
//! user and records the events; the interface only shows the countdown.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::task_manager_ui::{PomodoroDurationsDto, PomodoroEvent, PomodoroPhase};

pub const DEFAULT_WORK_MINUTES: f64 = 25.0;
pub const DEFAULT_SHORT_BREAK_MINUTES: f64 = 5.0;
pub const DEFAULT_LONG_BREAK_MINUTES: f64 = 15.0;
/// Work phases before a long break, unless the person picks 2 to 8.
pub const WORK_CYCLES_BEFORE_LONG_BREAK: u32 = 4;
const WORK_MINUTES: (f64, f64) = (5.0, 90.0);
const SHORT_BREAK_MINUTES: (f64, f64) = (1.0, 30.0);
const LONG_BREAK_MINUTES: (f64, f64) = (5.0, 60.0);
const CYCLES: (u32, u32) = (2, 8);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RunState {
    Idle,
    Running,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub phase: PomodoroPhase,
    pub run_state: RunState,
    pub remaining_seconds: u64,
    /// When the running phase ends (milliseconds since the epoch).
    pub end_timestamp: Option<i64>,
    pub completed_work_cycles: u32,
    pub selected_task_path: Option<String>,
    pub is_deviation_active: bool,
    pub deviation_started_at: Option<i64>,
    pub deviation_base_remaining_seconds: u64,
    /// Deviation accumulated in the current phase, charged when it ends.
    pub phase_deviation_seconds: u64,
    pub durations: PomodoroDurationsDto,
}

/// What the person or the countdown asks of the timer.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum PomodoroAction {
    Read,
    Start,
    Pause,
    Resume,
    Reset,
    SelectTask {
        #[serde(default)]
        task_path: Option<String>,
    },
    SetDurations { durations: PomodoroDurationsDto },
    EnterDeviation,
    ExitDeviation,
    /// The countdown reached zero; completed phases are advanced.
    Tick,
    /// Ends the phase now and leaves the next one ready.
    Skip,
    /// Picks a mode: the timer stops and that mode starts from the top.
    SelectPhase { phase: PomodoroPhase },
}

/// A set of durations the Pomodoro offers.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroPresetDto {
    pub name: String,
    /// «Estándar · 25/5».
    pub label: String,
    pub description: String,
    pub durations: PomodoroDurationsDto,
    pub active: bool,
}

/// The presets, marking the one the durations match.
pub fn presets(current: &PomodoroDurationsDto) -> Vec<PomodoroPresetDto> {
    [
        ("Estándar", 25.0, 5.0, 15.0, "Para tareas moderadas, programación y estudio: mantener un ritmo constante sin quemarse."),
        ("Sprint", 50.0, 10.0, 20.0, "Para trabajo profundo, con bloques largos y pausas más amplias."),
        ("Ligero", 15.0, 3.0, 10.0, "Para el inicio de la jornada, tareas livianas o cuando cuesta arrancar."),
        ("Intenso", 45.0, 7.0, 20.0, "Para foco sostenido, con pausas cortas de recuperación."),
    ]
    .into_iter()
    .map(|(name, work, short, long, description)| {
        let durations = PomodoroDurationsDto {
            work_minutes: work,
            short_break_minutes: short,
            long_break_minutes: long,
            cycles: current.cycles,
        };
        PomodoroPresetDto {
            name: name.to_string(),
            label: format!("{name} · {work}/{short}"),
            description: description.to_string(),
            active: current.work_minutes == work && current.short_break_minutes == short && current.long_break_minutes == long,
            durations,
        }
    })
    .collect()
}

/// Result of an action: the new state and the event to log, with the
/// state it belongs to (its task and durations).
#[derive(Debug, Clone, PartialEq)]
pub struct PomodoroTransition {
    pub state: PomodoroState,
    pub event: Option<(PomodoroEvent, PomodoroState)>,
}

pub fn default_durations() -> PomodoroDurationsDto {
    PomodoroDurationsDto {
        work_minutes: DEFAULT_WORK_MINUTES,
        short_break_minutes: DEFAULT_SHORT_BREAK_MINUTES,
        long_break_minutes: DEFAULT_LONG_BREAK_MINUTES,
        cycles: WORK_CYCLES_BEFORE_LONG_BREAK,
    }
}

pub fn default_state() -> PomodoroState {
    let durations = default_durations();
    PomodoroState {
        phase: PomodoroPhase::Work,
        run_state: RunState::Idle,
        remaining_seconds: phase_seconds(&durations, PomodoroPhase::Work),
        end_timestamp: None,
        completed_work_cycles: 0,
        selected_task_path: None,
        is_deviation_active: false,
        deviation_started_at: None,
        deviation_base_remaining_seconds: 0,
        phase_deviation_seconds: 0,
        durations,
    }
}

/// Whole minutes: work 5–90, short break 1–30, long break 5–60; 2 to 8
/// cycles.
pub fn clamp_durations(durations: &PomodoroDurationsDto) -> PomodoroDurationsDto {
    let clamp = |value: f64, (min, max): (f64, f64), fallback: f64| {
        if value.is_finite() { value.round().clamp(min, max) } else { fallback }
    };
    PomodoroDurationsDto {
        work_minutes: clamp(durations.work_minutes, WORK_MINUTES, DEFAULT_WORK_MINUTES),
        short_break_minutes: clamp(durations.short_break_minutes, SHORT_BREAK_MINUTES, DEFAULT_SHORT_BREAK_MINUTES),
        long_break_minutes: clamp(durations.long_break_minutes, LONG_BREAK_MINUTES, DEFAULT_LONG_BREAK_MINUTES),
        cycles: durations.cycles.clamp(CYCLES.0, CYCLES.1),
    }
}

pub fn phase_seconds(durations: &PomodoroDurationsDto, phase: PomodoroPhase) -> u64 {
    let minutes = match phase {
        PomodoroPhase::Work => durations.work_minutes,
        PomodoroPhase::ShortBreak => durations.short_break_minutes,
        PomodoroPhase::LongBreak => durations.long_break_minutes,
    };
    (minutes * 60.0).max(0.0) as u64
}

/// A stored state (or one kept by older versions in the WebView), with every
/// field valid.
pub fn normalize_state(value: &Value) -> PomodoroState {
    let fallback = default_state();
    if !value.is_object() {
        return fallback;
    }
    let number = |key: &str| value.get(key).and_then(Value::as_f64).filter(|number| number.is_finite());
    let durations = value
        .get("durations")
        .map(|durations| {
            let minutes = |key: &str, fallback: f64| durations.get(key).and_then(Value::as_f64).unwrap_or(fallback);
            clamp_durations(&PomodoroDurationsDto {
                work_minutes: minutes("workMinutes", DEFAULT_WORK_MINUTES),
                short_break_minutes: minutes("shortBreakMinutes", DEFAULT_SHORT_BREAK_MINUTES),
                long_break_minutes: minutes("longBreakMinutes", DEFAULT_LONG_BREAK_MINUTES),
                cycles: minutes("cycles", f64::from(WORK_CYCLES_BEFORE_LONG_BREAK)).max(0.0) as u32,
            })
        })
        .unwrap_or(fallback.durations);
    let phase = serde_json::from_value::<PomodoroPhase>(value.get("phase").cloned().unwrap_or(Value::Null))
        .unwrap_or(PomodoroPhase::Work);
    let run_state =
        serde_json::from_value::<RunState>(value.get("runState").cloned().unwrap_or(Value::Null)).unwrap_or(RunState::Idle);
    let seconds = |key: &str| number(key).map(|number| number.max(0.0).floor() as u64);
    let is_deviation_active = value.get("isDeviationActive").and_then(Value::as_bool).unwrap_or(false);
    PomodoroState {
        phase,
        run_state,
        remaining_seconds: seconds("remainingSeconds").unwrap_or_else(|| phase_seconds(&durations, phase)),
        end_timestamp: number("endTimestamp").map(|number| number as i64),
        completed_work_cycles: seconds("completedWorkCycles").unwrap_or(0).min(u64::from(u32::MAX)) as u32,
        selected_task_path: value
            .get("selectedTaskPath")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string),
        is_deviation_active,
        deviation_started_at: number("deviationStartedAt").filter(|_| is_deviation_active).map(|number| number as i64),
        deviation_base_remaining_seconds: if is_deviation_active { seconds("deviationBaseRemainingSeconds").unwrap_or(0) } else { 0 },
        phase_deviation_seconds: seconds("phaseDeviationSeconds").unwrap_or(0),
        durations,
    }
}

/// Seconds left in the phase at `now_ms`.
pub fn remaining_seconds(state: &PomodoroState, now_ms: i64) -> u64 {
    match (state.run_state, state.end_timestamp) {
        (RunState::Running, Some(end)) => ((end - now_ms).max(0) as u64).div_ceil(1000),
        _ => state.remaining_seconds,
    }
}

fn deviation_elapsed_seconds(state: &PomodoroState, now_ms: i64) -> u64 {
    match (state.is_deviation_active, state.deviation_started_at) {
        (true, Some(started)) => ((now_ms - started).max(0) / 1000) as u64,
        _ => 0,
    }
}

fn break_after(completed_work_cycles: u32, cycles: u32) -> PomodoroPhase {
    if completed_work_cycles % cycles.max(1) == 0 {
        PomodoroPhase::LongBreak
    } else {
        PomodoroPhase::ShortBreak
    }
}

fn run(mut state: PomodoroState, remaining: u64, now_ms: i64) -> PomodoroState {
    state.run_state = RunState::Running;
    state.remaining_seconds = remaining;
    state.end_timestamp = Some(now_ms + remaining as i64 * 1000);
    state
}

/// Advances every phase that ended before `now_ms`.
fn advance(state: &PomodoroState, now_ms: i64) -> (PomodoroState, Vec<PomodoroPhase>) {
    let mut next = state.clone();
    let mut completed = Vec::new();
    if next.is_deviation_active || next.run_state != RunState::Running {
        return (next, completed);
    }
    while let Some(end) = next.end_timestamp.filter(|end| *end <= now_ms) {
        completed.push(next.phase);
        let phase = if next.phase == PomodoroPhase::Work {
            next.completed_work_cycles += 1;
            break_after(next.completed_work_cycles, next.durations.cycles)
        } else {
            PomodoroPhase::Work
        };
        let duration = phase_seconds(&next.durations, phase);
        next.phase = phase;
        next.remaining_seconds = duration;
        next.end_timestamp = Some(end + duration.max(1) as i64 * 1000);
    }
    next.remaining_seconds = remaining_seconds(&next, now_ms);
    (next, completed)
}

/// The timer stopped, without the phase's deviation.
fn stopped(state: &PomodoroState) -> PomodoroState {
    let mut next = state.clone();
    next.run_state = RunState::Idle;
    next.end_timestamp = None;
    next.phase_deviation_seconds = 0;
    next
}

/// The part of the phase that ran before the person left it, to log it.
fn elapsed_event(state: &PomodoroState, now_ms: i64) -> Option<(PomodoroEvent, PomodoroState)> {
    if state.run_state == RunState::Idle {
        return None;
    }
    let elapsed = phase_seconds(&state.durations, state.phase).saturating_sub(remaining_seconds(state, now_ms));
    (elapsed > 0).then(|| {
        let event = PomodoroEvent::Reset {
            phase: state.phase,
            elapsed_seconds: elapsed as f64,
            deviation_seconds: state.phase_deviation_seconds as f64,
            in_deviation: false,
        };
        (event, state.clone())
    })
}

/// Applies an action at `now_ms`.
pub fn apply(state: &PomodoroState, action: PomodoroAction, now_ms: i64) -> PomodoroTransition {
    let unchanged = || PomodoroTransition { state: state.clone(), event: None };
    let changed = |state: PomodoroState| PomodoroTransition { state, event: None };
    match action {
        PomodoroAction::Read => unchanged(),
        PomodoroAction::Start => {
            if state.run_state == RunState::Running || state.is_deviation_active {
                return unchanged();
            }
            let remaining = if state.run_state == RunState::Paused {
                state.remaining_seconds
            } else {
                phase_seconds(&state.durations, state.phase)
            };
            changed(run(state.clone(), remaining, now_ms))
        }
        PomodoroAction::Pause => {
            if state.run_state != RunState::Running || state.is_deviation_active {
                return unchanged();
            }
            let mut next = state.clone();
            next.remaining_seconds = remaining_seconds(state, now_ms);
            next.run_state = RunState::Paused;
            next.end_timestamp = None;
            changed(next)
        }
        PomodoroAction::Resume => {
            if state.run_state != RunState::Paused || state.is_deviation_active {
                return unchanged();
            }
            changed(run(state.clone(), state.remaining_seconds, now_ms))
        }
        PomodoroAction::Reset => {
            let elapsed = if state.is_deviation_active {
                deviation_elapsed_seconds(state, now_ms)
            } else {
                phase_seconds(&state.durations, state.phase).saturating_sub(remaining_seconds(state, now_ms))
            };
            let event = PomodoroEvent::Reset {
                phase: state.phase,
                elapsed_seconds: elapsed as f64,
                deviation_seconds: state.phase_deviation_seconds as f64,
                in_deviation: state.is_deviation_active,
            };
            let mut next = state.clone();
            next.run_state = RunState::Idle;
            next.remaining_seconds = phase_seconds(&state.durations, state.phase);
            next.end_timestamp = None;
            next.is_deviation_active = false;
            next.deviation_started_at = None;
            next.deviation_base_remaining_seconds = 0;
            next.phase_deviation_seconds = 0;
            PomodoroTransition { state: next, event: Some((event, state.clone())) }
        }
        PomodoroAction::SelectTask { task_path } => {
            let mut next = state.clone();
            next.selected_task_path = task_path.filter(|path| !path.trim().is_empty());
            changed(next)
        }
        PomodoroAction::SetDurations { durations } => {
            let mut next = state.clone();
            next.durations = clamp_durations(&durations);
            if next.run_state == RunState::Idle {
                next.remaining_seconds = phase_seconds(&next.durations, next.phase);
                next.end_timestamp = None;
            }
            changed(next)
        }
        PomodoroAction::EnterDeviation => {
            if state.is_deviation_active || state.run_state != RunState::Running {
                return unchanged();
            }
            let remaining = remaining_seconds(state, now_ms);
            let mut next = state.clone();
            next.run_state = RunState::Paused;
            next.remaining_seconds = remaining;
            next.end_timestamp = None;
            next.is_deviation_active = true;
            next.deviation_started_at = Some(now_ms);
            next.deviation_base_remaining_seconds = remaining;
            changed(next)
        }
        PomodoroAction::ExitDeviation => {
            if !state.is_deviation_active {
                return unchanged();
            }
            let elapsed = deviation_elapsed_seconds(state, now_ms);
            let base = state.deviation_base_remaining_seconds;
            let mut next = state.clone();
            next.is_deviation_active = false;
            next.deviation_started_at = None;
            next.deviation_base_remaining_seconds = 0;
            next.phase_deviation_seconds += elapsed;
            let completed_work = state.phase == PomodoroPhase::Work && elapsed >= base;
            let next = if completed_work {
                // The work ran out while away; the break grows in proportion
                // to the overtime.
                let overtime = elapsed - base;
                next.completed_work_cycles += 1;
                next.phase = break_after(next.completed_work_cycles, next.durations.cycles);
                let base_break = phase_seconds(&next.durations, next.phase);
                let work = phase_seconds(&next.durations, PomodoroPhase::Work).max(1);
                let extra = ((overtime * base_break) as f64 / work as f64).round() as u64;
                run(next, base_break + extra, now_ms)
            } else {
                run(next, base.saturating_sub(elapsed), now_ms)
            };
            let event = PomodoroEvent::DeviationEnded { elapsed_seconds: elapsed as f64, completed_work };
            PomodoroTransition { state: next, event: Some((event, state.clone())) }
        }
        PomodoroAction::Skip => {
            if state.is_deviation_active {
                return unchanged();
            }
            let mut next = stopped(state);
            if state.phase == PomodoroPhase::Work {
                next.completed_work_cycles += 1;
                next.phase = break_after(next.completed_work_cycles, next.durations.cycles);
            } else {
                next.phase = PomodoroPhase::Work;
            }
            next.remaining_seconds = phase_seconds(&next.durations, next.phase);
            PomodoroTransition { state: next, event: elapsed_event(state, now_ms) }
        }
        PomodoroAction::SelectPhase { phase } => {
            if state.is_deviation_active || (state.phase == phase && state.run_state == RunState::Idle) {
                return unchanged();
            }
            let mut next = stopped(state);
            next.phase = phase;
            next.remaining_seconds = phase_seconds(&next.durations, phase);
            PomodoroTransition { state: next, event: elapsed_event(state, now_ms) }
        }
        PomodoroAction::Tick => {
            let (next, completed) = advance(state, now_ms);
            if completed.is_empty() {
                return changed(next);
            }
            let event = PomodoroEvent::PhasesCompleted {
                phases: completed,
                deviation_seconds: state.phase_deviation_seconds as f64,
            };
            PomodoroTransition { state: next, event: Some((event, state.clone())) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const MINUTE: i64 = 60_000;

    #[test]
    fn a_running_work_phase_advances_to_breaks_and_reports_them() {
        let started = apply(&default_state(), PomodoroAction::Start, 0).state;
        assert_eq!(started.end_timestamp, Some(25 * MINUTE));
        let transition = apply(&started, PomodoroAction::Tick, 31 * MINUTE);
        assert_eq!(transition.state.phase, PomodoroPhase::Work);
        assert_eq!(transition.state.completed_work_cycles, 1);
        let Some((PomodoroEvent::PhasesCompleted { phases, .. }, _)) = transition.event else {
            panic!("phases");
        };
        assert_eq!(phases, [PomodoroPhase::Work, PomodoroPhase::ShortBreak]);
        let mut fourth = started.clone();
        fourth.completed_work_cycles = 3;
        assert_eq!(apply(&fourth, PomodoroAction::Tick, 25 * MINUTE).state.phase, PomodoroPhase::LongBreak);
    }

    #[test]
    fn pause_and_resume_keep_the_remaining_time() {
        let started = apply(&default_state(), PomodoroAction::Start, 0).state;
        let paused = apply(&started, PomodoroAction::Pause, 10 * MINUTE).state;
        assert_eq!((paused.run_state, paused.remaining_seconds), (RunState::Paused, 15 * 60));
        let resumed = apply(&paused, PomodoroAction::Resume, 20 * MINUTE).state;
        assert_eq!(resumed.end_timestamp, Some(35 * MINUTE));
    }

    #[test]
    fn a_long_deviation_completes_the_work_and_lengthens_the_break() {
        let started = apply(&default_state(), PomodoroAction::Start, 0).state;
        let away = apply(&started, PomodoroAction::EnterDeviation, 20 * MINUTE).state;
        let back = apply(&away, PomodoroAction::ExitDeviation, 30 * MINUTE);
        assert_eq!(back.state.phase, PomodoroPhase::ShortBreak);
        assert_eq!(back.state.remaining_seconds, 5 * 60 + 60);
        assert_eq!(back.state.phase_deviation_seconds, 10 * 60);
        assert!(matches!(back.event, Some((PomodoroEvent::DeviationEnded { completed_work: true, .. }, _))));
    }

    #[test]
    fn reset_reports_the_elapsed_time_and_stored_states_are_normalized() {
        let started = apply(&default_state(), PomodoroAction::Start, 0).state;
        let reset = apply(&started, PomodoroAction::Reset, 10 * MINUTE);
        assert_eq!(reset.state.run_state, RunState::Idle);
        assert!(matches!(reset.event, Some((PomodoroEvent::Reset { elapsed_seconds, .. }, _)) if elapsed_seconds == 600.0));
        let stored = normalize_state(&json!({ "phase": "x", "durations": { "workMinutes": 500 }, "selectedTaskPath": " " }));
        assert_eq!(stored.phase, PomodoroPhase::Work);
        assert_eq!(stored.durations.work_minutes, 90.0);
        assert_eq!(stored.durations.cycles, 4);
        assert_eq!(stored.selected_task_path, None);
    }

    #[test]
    fn skipping_and_picking_a_mode_stop_the_timer_and_log_what_ran() {
        let started = apply(&default_state(), PomodoroAction::Start, 0).state;
        let skipped = apply(&started, PomodoroAction::Skip, 10 * MINUTE);
        assert_eq!((skipped.state.phase, skipped.state.run_state), (PomodoroPhase::ShortBreak, RunState::Idle));
        assert_eq!(skipped.state.completed_work_cycles, 1);
        assert!(matches!(skipped.event, Some((PomodoroEvent::Reset { elapsed_seconds, .. }, _)) if elapsed_seconds == 600.0));
        let long = apply(&skipped.state, PomodoroAction::SelectPhase { phase: PomodoroPhase::LongBreak }, 11 * MINUTE);
        assert_eq!((long.state.phase, long.state.remaining_seconds), (PomodoroPhase::LongBreak, 15 * 60));
        assert!(long.event.is_none());
        // Two cycles: the second work phase leads to the long break.
        let mut two = default_state();
        two.durations.cycles = 2;
        two.completed_work_cycles = 1;
        assert_eq!(apply(&two, PomodoroAction::Skip, 0).state.phase, PomodoroPhase::LongBreak);
        assert!(presets(&default_durations())[0].active);
        assert_eq!(presets(&default_durations())[0].label, "Estándar · 25/5");
    }
}
