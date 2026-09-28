//! Decisions of the clock that runs the actions: which occurrences are due,
//! which ones are lost, and which instance may run them.
//!
//! Only one instance runs the clock of a library at a time. It holds a
//! lease stored with the library; the headless server takes it over from
//! the desktop app, and the desktop app from Android. An instance that
//! stops renewing it loses it when it expires.

use std::collections::HashSet;

use jiff::tz::TimeZone;
use serde::{Deserialize, Serialize};

use super::schedule::{day_bounds, local_date, occurrences_between};
use super::{time_zone, AiAction, AiActionRun, AiSchedule, RunStatus, RunTrigger};

/// A recurring occurrence runs within this time of its moment; later, it
/// is lost.
pub const DUE_GRACE_MS: i64 = 2 * 60 * 1000;
/// A one-time action due while Notia was closed still runs this long after
/// its moment.
pub const MISSED_ONCE_GRACE_MS: i64 = 60 * 60 * 1000;
/// How long a lease lasts without being renewed.
pub const LEASE_TTL_MS: i64 = 90 * 1000;
/// A run of another instance still waiting or running after this long is
/// considered interrupted.
pub const FOREIGN_RUN_TIMEOUT_MS: i64 = 6 * 60 * 60 * 1000;

pub const SKIP_OVERLAP: &str = "La ejecución anterior seguía en curso.";
pub const SKIP_MISSED_ONCE: &str = "Venció con Notia cerrada hace más de una hora.";
pub const SKIP_MISSED_RECURRING: &str = "Notia no estaba abierta a esa hora.";
pub const INTERRUPTED: &str = "Se interrumpió: Notia se cerró antes de terminar.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Planned {
    Run { scheduled_for_ms: i64 },
    Skip { scheduled_for_ms: i64, reason: &'static str },
}

/// What the clock does with an action now. `runs` are the action's runs;
/// `last_check_ms` is the clock's previous tick (none on its first one).
pub fn plan_action(action: &AiAction, runs: &[AiActionRun], last_check_ms: Option<i64>, now_ms: i64) -> Vec<Planned> {
    if !action.enabled {
        return Vec::new();
    }
    let zone = time_zone(&action.time_zone);
    let mine = runs.iter().filter(|run| run.action_id.as_deref() == Some(action.id.as_str())).collect::<Vec<_>>();
    let planned = mine
        .iter()
        .filter(|run| run.trigger == RunTrigger::Scheduled)
        .map(|run| run.scheduled_for_ms)
        .collect::<HashSet<_>>();
    let busy = mine.iter().any(|run| run.status.is_active());
    match &action.schedule {
        AiSchedule::Once { at_ms } => {
            // Turned on again after its moment: it is not recovered.
            if *at_ms > now_ms || planned.contains(at_ms) || *at_ms < action.active_since_ms {
                return Vec::new();
            }
            let plan = if now_ms - at_ms > MISSED_ONCE_GRACE_MS {
                Planned::Skip { scheduled_for_ms: *at_ms, reason: SKIP_MISSED_ONCE }
            } else if busy {
                Planned::Skip { scheduled_for_ms: *at_ms, reason: SKIP_OVERLAP }
            } else {
                Planned::Run { scheduled_for_ms: *at_ms }
            };
            vec![plan]
        }
        AiSchedule::Recurring { .. } => plan_recurring(action, &zone, &planned, busy, last_check_ms, now_ms),
    }
}

fn plan_recurring(
    action: &AiAction,
    zone: &TimeZone,
    planned: &HashSet<i64>,
    busy: bool,
    last_check_ms: Option<i64>,
    now_ms: i64,
) -> Vec<Planned> {
    // Lost occurrences are recorded for today only; older ones just pass.
    let today_start = day_bounds(zone, local_date(zone, now_ms)).0;
    let from = last_check_ms.unwrap_or(now_ms - DUE_GRACE_MS).max(today_start).max(action.active_since_ms);
    let mut due = occurrences_between(&action.schedule, zone, from, now_ms + 1)
        .into_iter()
        .filter(|instant| !planned.contains(instant))
        .collect::<Vec<_>>();
    let runnable = due.iter().rposition(|instant| now_ms - instant <= DUE_GRACE_MS).map(|index| due.remove(index));
    let mut plans = due
        .into_iter()
        .map(|scheduled_for_ms| Planned::Skip { scheduled_for_ms, reason: SKIP_MISSED_RECURRING })
        .collect::<Vec<_>>();
    if let Some(scheduled_for_ms) = runnable {
        plans.push(if busy {
            Planned::Skip { scheduled_for_ms, reason: SKIP_OVERLAP }
        } else {
            Planned::Run { scheduled_for_ms }
        });
    }
    plans
}

/// Kind of instance, by priority to hold the lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InstanceKind {
    Android,
    Desktop,
    Server,
}

impl InstanceKind {
    fn priority(self) -> u8 {
        match self {
            Self::Android => 1,
            Self::Desktop => 2,
            Self::Server => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerLease {
    pub holder: String,
    pub kind: InstanceKind,
    pub expires_at_ms: i64,
}

/// The lease this instance holds after trying to take or renew it, or none
/// when another instance keeps it: a missing or expired lease is free, its
/// holder renews it and a higher kind takes it over.
pub fn claim_lease(current: Option<&SchedulerLease>, me: &str, kind: InstanceKind, now_ms: i64) -> Option<SchedulerLease> {
    let free = match current {
        None => true,
        Some(lease) => lease.holder == me || lease.expires_at_ms <= now_ms || kind.priority() > lease.kind.priority(),
    };
    free.then(|| SchedulerLease { holder: me.to_string(), kind, expires_at_ms: now_ms + LEASE_TTL_MS })
}

/// Whether this instance must write the lease now: to take it, or to renew
/// it when less than half its time is left. The rest of the ticks only
/// read, so an idle clock never writes (on Android each write copies the
/// database back through SAF).
pub fn lease_needs_renewal(current: Option<&SchedulerLease>, me: &str, now_ms: i64) -> bool {
    current.is_none_or(|lease| lease.holder != me || lease.expires_at_ms - now_ms < LEASE_TTL_MS / 2)
}

/// Runs left waiting or running that nobody will finish: this instance's
/// when it no longer has them in hand (it restarted), another instance's
/// after `FOREIGN_RUN_TIMEOUT_MS`.
pub fn interrupted_runs<'a>(runs: &'a [AiActionRun], me: &str, in_hand: &HashSet<String>, now_ms: i64) -> Vec<&'a AiActionRun> {
    runs.iter()
        .filter(|run| run.status.is_active())
        .filter(|run| match run.runner.as_deref() {
            Some(runner) if runner == me => !in_hand.contains(&run.id),
            _ => now_ms - run.created_at_ms > FOREIGN_RUN_TIMEOUT_MS,
        })
        .collect()
}

/// Whether a run is finished (it no longer changes).
pub fn is_final(status: RunStatus) -> bool {
    matches!(status, RunStatus::Success | RunStatus::Failed | RunStatus::Skipped)
}
