//! Management planner of a Task Manager board: gives every active task a
//! start and an end in working hours, respecting its dependencies, the date
//! its column releases it and that each person does one task at a time.
//!
//! Everything here is pure. Hours count working time from the start of the
//! plan (`WorkCalendar::origin`); `Plan::date_time` turns them into local
//! date-times.

use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};

use jiff::civil::DateTime;

use crate::task_board_plan::{
    division_with_offset, next_sprint, TaskBoardMemberDto, TaskBoardPlanDto, TaskColumnKind, WorkCalendar,
};
use crate::task_manager_tools::TaskPriority;

/// Hours under this are treated as equal.
pub const EPS: f64 = 1e-3;
/// A task with less slack than this is critical.
pub const CRITICAL_SLACK_HOURS: f64 = 0.05;
const MIN_DURATION_HOURS: f64 = 0.5;
const DURATION_STEP_HOURS: f64 = 0.25;
const MAX_CRITICAL_CHAINS: usize = 3;
const CHAIN_ARROW: &str = " → ";
const CHAIN_SEPARATOR: &str = "  ·  ";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct PlannerTask {
    /// Ticket id.
    pub id: String,
    /// Logical path, identity for the UI.
    pub task_path: String,
    pub title: String,
    pub column_kind: TaskColumnKind,
    pub column_name: String,
    pub column_color: String,
    pub priority: TaskPriority,
    pub in_progress: bool,
    pub blocked: bool,
    /// `None` or <= 0: unestimated.
    pub estimate_hours: Option<f64>,
    /// Live dedicated hours.
    pub spent_hours: f64,
    pub people: Vec<String>,
    /// Ticket ids; unknown ids are ignored.
    pub depends_on: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannerInput {
    /// Board column order, then card order.
    pub tasks: Vec<PlannerTask>,
    pub plan: TaskBoardPlanDto,
    /// Device local time.
    pub now: DateTime,
    pub members: Vec<TaskBoardMemberDto>,
    /// Name of the person looking (for «(vos)»).
    pub viewer: Option<String>,
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/// The task before or after another one of the same person.
#[derive(Debug, Clone, PartialEq)]
pub struct ResourceLink {
    /// Index in `Plan::tasks`.
    pub task: usize,
    pub person: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlannedTask {
    pub task: PlannerTask,
    /// «A», «B»… «AA» after «Z».
    pub letter: String,
    /// Remaining hours the plan gives the task.
    pub duration: f64,
    /// Without estimate: it lasts one workday.
    pub unestimated: bool,
    /// Earliest hour its column lets it start.
    pub release: f64,
    /// Hour its release and predecessors allow it to start.
    pub ready: f64,
    pub start: f64,
    pub finish: f64,
    /// People whose previous task it waited for.
    pub waits_for: Vec<String>,
    /// Late start of the plan without people, used to break ties.
    pub unleveled_late_start: f64,
    /// Indexes in `Plan::tasks` of its direct dependencies.
    pub predecessors: Vec<usize>,
    pub successors: Vec<usize>,
    pub resource_predecessors: Vec<ResourceLink>,
    pub resource_successors: Vec<ResourceLink>,
}

impl PlannedTask {
    /// Hours it waited for a person after it was ready.
    pub fn wait(&self) -> f64 {
        (self.start - self.ready).max(0.0)
    }

    pub fn waits(&self) -> bool {
        self.start - self.ready > EPS
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub calendar: WorkCalendar,
    pub hours_per_day: f64,
    /// Planned tasks in letter order.
    pub tasks: Vec<PlannedTask>,
}

impl Plan {
    /// Local date-time `hours` of work after the start of the plan. An end
    /// on a day boundary reads as the end of that day.
    pub fn date_time(&self, hours: f64, is_end: bool) -> DateTime {
        self.calendar.date_time_at(hours, is_end)
    }

    pub fn index_of_path(&self, task_path: &str) -> Option<usize> {
        self.tasks.iter().position(|task| task.task.task_path == task_path)
    }
}

/// Letter of the task at `index`: A…Z, then AA, AB…
pub fn task_letter(index: usize) -> String {
    let mut rest = index + 1;
    let mut letters = Vec::new();
    while rest > 0 {
        rest -= 1;
        letters.push(char::from(b'A' + (rest % 26) as u8));
        rest /= 26;
    }
    letters.into_iter().rev().collect()
}

fn duration_of(task: &PlannerTask, hours_per_day: f64) -> (f64, bool) {
    match task.estimate_hours {
        Some(estimate) if estimate.is_finite() && estimate > 0.0 => {
            let spent = if task.spent_hours.is_finite() { task.spent_hours.max(0.0) } else { 0.0 };
            let remaining = ((estimate - spent).max(0.0) / DURATION_STEP_HOURS).round() * DURATION_STEP_HOURS;
            (remaining.max(MIN_DURATION_HOURS), false)
        }
        _ => (hours_per_day, true),
    }
}

/// People of a task without blanks or repeats.
fn people_of(task: &PlannerTask) -> Vec<String> {
    let mut people: Vec<String> = Vec::new();
    for person in &task.people {
        let person = person.trim();
        if !person.is_empty() && !people.iter().any(|known| known == person) {
            people.push(person.to_string());
        }
    }
    people
}

/// Order where every task follows its predecessors. A cycle is broken by
/// taking the first task still pending.
fn topological_order(predecessors: &[Vec<usize>], successors: &[Vec<usize>]) -> Vec<usize> {
    let count = predecessors.len();
    let mut missing = predecessors.iter().map(Vec::len).collect::<Vec<_>>();
    let mut placed = vec![false; count];
    let mut order = Vec::with_capacity(count);
    let mut queue = (0..count).filter(|index| missing[*index] == 0).collect::<VecDeque<_>>();
    loop {
        while let Some(index) = queue.pop_front() {
            if placed[index] {
                continue;
            }
            placed[index] = true;
            order.push(index);
            for &next in &successors[index] {
                if !placed[next] && missing[next] > 0 {
                    missing[next] -= 1;
                    if missing[next] == 0 {
                        queue.push_back(next);
                    }
                }
            }
        }
        match (0..count).find(|index| !placed[*index]) {
            Some(index) => queue.push_back(index),
            None => break,
        }
    }
    order
}

/// Late starts of the plan with dependencies and releases only.
fn unleveled_late_starts(
    order: &[usize],
    predecessors: &[Vec<usize>],
    successors: &[Vec<usize>],
    durations: &[f64],
    releases: &[f64],
) -> Vec<f64> {
    let count = durations.len();
    let mut early = vec![None::<f64>; count];
    for &index in order {
        let start = predecessors[index]
            .iter()
            .filter_map(|pred| early[*pred].map(|value| value + durations[*pred]))
            .fold(releases[index], f64::max);
        early[index] = Some(start);
    }
    let end = (0..count).map(|index| early[index].unwrap_or(0.0) + durations[index]).fold(0.0, f64::max);
    let mut late_finish = vec![None::<f64>; count];
    for &index in order.iter().rev() {
        let finish = successors[index]
            .iter()
            .filter_map(|next| late_finish[*next].map(|value| value - durations[*next]))
            .fold(end, f64::min);
        late_finish[index] = Some(finish);
    }
    (0..count).map(|index| late_finish[index].unwrap_or(end) - durations[index]).collect()
}

/// Plans the tasks of the board (spec 9.1–9.5).
pub fn plan(input: &PlannerInput) -> Plan {
    let calendar = WorkCalendar::new(&input.plan, input.now);
    let hours_per_day = calendar.hours_per_day();
    let today = input.now.date();
    let next_sprint_release = calendar.hours_at_date(next_sprint(&input.plan, today).start).max(0.0);
    let next_division_release = calendar.hours_at_date(division_with_offset(&input.plan, today, 1).start).max(0.0);

    let sources = input.tasks.iter().filter(|task| task.column_kind.is_planned()).collect::<Vec<_>>();
    let mut by_id: HashMap<&str, usize> = HashMap::new();
    for (index, task) in sources.iter().enumerate() {
        by_id.entry(task.id.as_str()).or_insert(index);
    }
    let count = sources.len();
    let mut predecessors = vec![Vec::new(); count];
    let mut successors = vec![Vec::new(); count];
    for (index, task) in sources.iter().enumerate() {
        for id in &task.depends_on {
            if let Some(&pred) = by_id.get(id.as_str()) {
                if pred != index && !predecessors[index].contains(&pred) {
                    predecessors[index].push(pred);
                    successors[pred].push(index);
                }
            }
        }
    }
    let durations_flags = sources.iter().map(|task| duration_of(task, hours_per_day)).collect::<Vec<_>>();
    let durations = durations_flags.iter().map(|(hours, _)| *hours).collect::<Vec<_>>();
    let releases = sources
        .iter()
        .map(|task| match task.column_kind {
            TaskColumnKind::NextSprint => next_sprint_release,
            TaskColumnKind::NextDivision => next_division_release,
            _ => 0.0,
        })
        .collect::<Vec<_>>();
    let order = topological_order(&predecessors, &successors);
    let late_starts = unleveled_late_starts(&order, &predecessors, &successors, &durations, &releases);

    let mut person_ids: HashMap<String, usize> = HashMap::new();
    let mut persons: Vec<String> = Vec::new();
    let people = sources
        .iter()
        .map(|task| {
            people_of(task)
                .into_iter()
                .map(|name| {
                    *person_ids.entry(name.clone()).or_insert_with(|| {
                        persons.push(name);
                        persons.len() - 1
                    })
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    // Serial schedule: one task per person, gaps filled by later tasks.
    let mut busy: Vec<Vec<(f64, f64, usize)>> = vec![Vec::new(); persons.len()];
    let mut done = vec![false; count];
    let mut starts = vec![0.0; count];
    let mut finishes = vec![0.0; count];
    let mut readies = vec![0.0; count];
    let mut waits_for = vec![Vec::new(); count];
    let mut pending = (0..count).collect::<Vec<_>>();
    let ranks = |a: usize, b: usize| -> Ordering {
        let (left, right) = (sources[a], sources[b]);
        right
            .in_progress
            .cmp(&left.in_progress)
            .then_with(|| right.priority.cmp(&left.priority))
            .then_with(|| late_starts[a].partial_cmp(&late_starts[b]).unwrap_or(Ordering::Equal))
            .then_with(|| a.cmp(&b))
    };
    while !pending.is_empty() {
        let position = pending
            .iter()
            .enumerate()
            .filter(|(_, index)| predecessors[**index].iter().all(|pred| done[*pred]))
            .min_by(|(_, a), (_, b)| ranks(**a, **b))
            .map(|(position, _)| position)
            .unwrap_or(0);
        let index = pending.remove(position);
        let duration = durations[index];
        let ready = predecessors[index]
            .iter()
            .filter(|pred| done[**pred])
            .map(|pred| finishes[*pred])
            .fold(releases[index], f64::max);
        let mut start = ready;
        loop {
            let mut moved = false;
            for &person in &people[index] {
                for &(from, to, _) in &busy[person] {
                    if from < start + duration - EPS && to > start + EPS {
                        start = to;
                        moved = true;
                    }
                }
            }
            if !moved {
                break;
            }
        }
        if start - ready > EPS {
            waits_for[index] = people[index]
                .iter()
                .filter(|person| busy[**person].iter().any(|(_, to, _)| (to - start).abs() < EPS))
                .map(|person| persons[*person].clone())
                .collect();
        }
        for &person in &people[index] {
            busy[person].push((start, start + duration, index));
        }
        readies[index] = ready;
        starts[index] = start;
        finishes[index] = start + duration;
        done[index] = true;
    }

    let mut resource_predecessors = vec![Vec::<ResourceLink>::new(); count];
    let mut resource_successors = vec![Vec::<ResourceLink>::new(); count];
    for (person, intervals) in busy.iter_mut().enumerate() {
        intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(Ordering::Equal).then(a.2.cmp(&b.2)));
        for pair in intervals.windows(2) {
            let (prev, next) = (pair[0].2, pair[1].2);
            if predecessors[next].contains(&prev) || resource_predecessors[next].iter().any(|link| link.task == prev) {
                continue;
            }
            resource_predecessors[next].push(ResourceLink { task: prev, person: persons[person].clone() });
            resource_successors[prev].push(ResourceLink { task: next, person: persons[person].clone() });
        }
    }

    let tasks = sources
        .iter()
        .enumerate()
        .map(|(index, task)| PlannedTask {
            task: (*task).clone(),
            letter: task_letter(index),
            duration: durations[index],
            unestimated: durations_flags[index].1,
            release: releases[index],
            ready: readies[index],
            start: starts[index],
            finish: finishes[index],
            waits_for: std::mem::take(&mut waits_for[index]),
            unleveled_late_start: late_starts[index],
            predecessors: std::mem::take(&mut predecessors[index]),
            successors: std::mem::take(&mut successors[index]),
            resource_predecessors: std::mem::take(&mut resource_predecessors[index]),
            resource_successors: std::mem::take(&mut resource_successors[index]),
        })
        .collect();
    Plan { calendar, hours_per_day, tasks }
}

// ---------------------------------------------------------------------------
// Critical path
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TaskSlack {
    pub late_start: f64,
    pub late_finish: f64,
    /// Late start minus start, in hours (never negative).
    pub slack: f64,
    pub critical: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    /// Largest visible finish.
    pub end: f64,
    /// Same index as `Plan::tasks`; `None` when the task is not visible.
    pub tasks: Vec<Option<TaskSlack>>,
    /// Up to three chains of tight critical tasks, as `Plan::tasks` indexes.
    pub critical_chains: Vec<Vec<usize>>,
    /// «B → E → F  ·  C → D», or «—» without critical tasks.
    pub critical_path: String,
}

impl Analysis {
    pub fn is_visible(&self, index: usize) -> bool {
        self.tasks.get(index).is_some_and(Option::is_some)
    }

    pub fn is_critical(&self, index: usize) -> bool {
        self.tasks.get(index).copied().flatten().is_some_and(|slack| slack.critical)
    }

    /// Both critical and the second starts when the first ends.
    pub fn is_tight(&self, plan: &Plan, from: usize, to: usize) -> bool {
        self.is_critical(from)
            && self.is_critical(to)
            && (plan.tasks[from].finish - plan.tasks[to].start).abs() < CRITICAL_SLACK_HOURS
    }

    /// Visible dependencies, then visible previous tasks of the same people.
    pub fn visible_predecessors(&self, plan: &Plan, index: usize) -> Vec<usize> {
        let task = &plan.tasks[index];
        let mut list = task.predecessors.iter().copied().filter(|pred| self.is_visible(*pred)).collect::<Vec<_>>();
        for link in &task.resource_predecessors {
            if self.is_visible(link.task) && !list.contains(&link.task) {
                list.push(link.task);
            }
        }
        list
    }

    pub fn visible_successors(&self, plan: &Plan, index: usize) -> Vec<usize> {
        let task = &plan.tasks[index];
        let mut list = task.successors.iter().copied().filter(|next| self.is_visible(*next)).collect::<Vec<_>>();
        for link in &task.resource_successors {
            if self.is_visible(link.task) && !list.contains(&link.task) {
                list.push(link.task);
            }
        }
        list
    }
}

/// Indexes of the visible tasks ordered by start, then letter.
pub fn by_start(plan: &Plan, indexes: impl IntoIterator<Item = usize>) -> Vec<usize> {
    let mut list = indexes.into_iter().collect::<Vec<_>>();
    list.sort_by(|a, b| {
        plan.tasks[*a].start.partial_cmp(&plan.tasks[*b].start).unwrap_or(Ordering::Equal).then(a.cmp(b))
    });
    list
}

/// Backward pass over the tasks whose `task_path` is in `visible`, with
/// dependencies and same-person links (spec 9.6).
pub fn analyze(plan: &Plan, visible: &HashSet<String>) -> Analysis {
    let count = plan.tasks.len();
    let shown = (0..count).filter(|index| visible.contains(&plan.tasks[*index].task.task_path)).collect::<Vec<_>>();
    let end = shown.iter().map(|index| plan.tasks[*index].finish).fold(0.0, f64::max);
    let mut analysis =
        Analysis { end, tasks: vec![None; count], critical_chains: Vec::new(), critical_path: "—".to_string() };
    // Every link goes forward in time, so the latest start is solved first.
    let mut late_finish = vec![None::<f64>; count];
    for &index in by_start(plan, shown.iter().copied()).iter().rev() {
        let task = &plan.tasks[index];
        let nexts = task
            .successors
            .iter()
            .copied()
            .chain(task.resource_successors.iter().map(|link| link.task))
            .filter(|next| visible.contains(&plan.tasks[*next].task.task_path));
        let finish = nexts
            .filter_map(|next| late_finish[next].map(|value| value - plan.tasks[next].duration))
            .fold(end, f64::min);
        late_finish[index] = Some(finish);
    }
    for &index in &shown {
        let task = &plan.tasks[index];
        let finish = late_finish[index].unwrap_or(end);
        let late_start = finish - task.duration;
        let slack = ((late_start - task.start) * 100.0).round().max(0.0) / 100.0;
        analysis.tasks[index] =
            Some(TaskSlack { late_start, late_finish: finish, slack, critical: slack < CRITICAL_SLACK_HOURS });
    }

    let roots = by_start(
        plan,
        shown.iter().copied().filter(|index| {
            analysis.is_critical(*index)
                && !analysis.visible_predecessors(plan, *index).iter().any(|pred| analysis.is_tight(plan, *pred, *index))
        }),
    );
    let mut chains = Vec::new();
    for root in roots {
        if chains.len() >= MAX_CRITICAL_CHAINS {
            break;
        }
        walk_chain(plan, &analysis, root, &mut vec![root], &mut chains);
    }
    chains.truncate(MAX_CRITICAL_CHAINS);
    if !chains.is_empty() {
        analysis.critical_path = chains
            .iter()
            .map(|chain| chain.iter().map(|index| plan.tasks[*index].letter.as_str()).collect::<Vec<_>>().join(CHAIN_ARROW))
            .collect::<Vec<_>>()
            .join(CHAIN_SEPARATOR);
    }
    analysis.critical_chains = chains;
    analysis
}

fn walk_chain(plan: &Plan, analysis: &Analysis, index: usize, path: &mut Vec<usize>, chains: &mut Vec<Vec<usize>>) {
    if chains.len() >= MAX_CRITICAL_CHAINS {
        return;
    }
    let nexts = analysis
        .visible_successors(plan, index)
        .into_iter()
        .filter(|next| analysis.is_tight(plan, index, *next) && !path.contains(next))
        .collect::<Vec<_>>();
    if nexts.is_empty() {
        chains.push(path.clone());
        return;
    }
    for next in nexts {
        path.push(next);
        walk_chain(plan, analysis, next, path, chains);
        path.pop();
    }
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

/// Whether adding «`task` depends on `candidate`» would close a cycle: it
/// does when `candidate` already depends on `task`, directly or not, or is
/// `task` itself.
pub fn creates_cycle(depends_on: &HashMap<String, Vec<String>>, task: &str, candidate: &str) -> bool {
    if task == candidate {
        return true;
    }
    let mut seen: HashSet<&str> = HashSet::new();
    let mut stack = vec![candidate];
    while let Some(current) = stack.pop() {
        for dependency in depends_on.get(current).into_iter().flatten() {
            if dependency == task {
                return true;
            }
            if seen.insert(dependency.as_str()) {
                stack.push(dependency.as_str());
            }
        }
    }
    false
}

/// Tasks that depend on `index`, directly or not, through dependencies:
/// none of them can become its predecessor.
pub fn transitive_dependents(plan: &Plan, index: usize) -> HashSet<usize> {
    let mut seen = HashSet::new();
    let mut stack = vec![index];
    while let Some(current) = stack.pop() {
        for &next in &plan.tasks[current].successors {
            if seen.insert(next) {
                stack.push(next);
            }
        }
    }
    seen
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use jiff::civil::date;
    use std::time::Instant;

    pub(crate) fn task(id: &str) -> PlannerTask {
        PlannerTask {
            id: id.to_string(),
            task_path: format!("Tareas/{id}.md"),
            title: format!("Tarea {id}"),
            column_kind: TaskColumnKind::CurrentSprint,
            column_name: "Sprint actual".to_string(),
            column_color: "#4FD1C5".to_string(),
            priority: TaskPriority::Medium,
            in_progress: false,
            blocked: false,
            estimate_hours: Some(1.0),
            spent_hours: 0.0,
            people: Vec::new(),
            depends_on: Vec::new(),
        }
    }

    pub(crate) fn with(mut task: PlannerTask, hours: f64, people: &[&str], priority: TaskPriority) -> PlannerTask {
        task.estimate_hours = Some(hours);
        task.people = people.iter().map(|person| person.to_string()).collect();
        task.priority = priority;
        task
    }

    pub(crate) fn after(mut task: PlannerTask, ids: &[&str]) -> PlannerTask {
        task.depends_on = ids.iter().map(|id| id.to_string()).collect();
        task
    }

    pub(crate) fn member(name: &str, color: &str) -> TaskBoardMemberDto {
        TaskBoardMemberDto { name: name.to_string(), color: color.to_string(), is_owner: false }
    }

    /// Monday 19/10/2026 09:00, workday 09:00–18:00 Monday to Friday.
    pub(crate) fn input(tasks: Vec<PlannerTask>) -> PlannerInput {
        PlannerInput {
            tasks,
            plan: TaskBoardPlanDto::default(),
            now: date(2026, 10, 19).at(9, 0, 0, 0),
            members: vec![member("P1", "#4FD1C5"), member("P2", "#6C8EFF")],
            viewer: None,
        }
    }

    fn at(day: i8, hour: i8) -> DateTime {
        date(2026, 10, day).at(hour, 0, 0, 0)
    }

    fn span(plan: &Plan, letter: &str) -> (DateTime, DateTime) {
        let task = plan.tasks.iter().find(|task| task.letter == letter).expect("task");
        (plan.date_time(task.start, false), plan.date_time(task.finish, true))
    }

    fn found<'a>(plan: &'a Plan, letter: &str) -> &'a PlannedTask {
        plan.tasks.iter().find(|task| task.letter == letter).expect("task")
    }

    fn all_visible(plan: &Plan) -> HashSet<String> {
        plan.tasks.iter().map(|task| task.task.task_path.clone()).collect()
    }

    #[test]
    fn letters_follow_the_alphabet_and_go_on_after_z() {
        assert_eq!(task_letter(0), "A");
        assert_eq!(task_letter(25), "Z");
        assert_eq!(task_letter(26), "AA");
        assert_eq!(task_letter(27), "AB");
        assert_eq!(task_letter(701), "ZZ");
        assert_eq!(task_letter(702), "AAA");
    }

    #[test]
    fn notes_stay_out_and_durations_use_the_remaining_hours() {
        let mut note = task("N");
        note.column_kind = TaskColumnKind::Notes;
        let mut spent = with(task("S"), 4.0, &[], TaskPriority::Medium);
        spent.spent_hours = 1.1;
        let mut over = with(task("O"), 2.0, &[], TaskPriority::Medium);
        over.spent_hours = 5.0;
        let plan = plan(&input(vec![note, spent, over]));
        assert_eq!(plan.tasks.len(), 2);
        assert_eq!(plan.tasks[0].letter, "A");
        assert_eq!(plan.tasks[0].duration, 3.0);
        assert_eq!(plan.tasks[1].duration, 0.5);
    }

    #[test]
    fn case_1_one_person_does_two_tasks_in_a_row() {
        let plan = plan(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Urgent),
            with(task("B"), 4.0, &["P1"], TaskPriority::Medium),
        ]));
        assert_eq!(span(&plan, "A"), (at(19, 9), at(19, 13)));
        assert_eq!(span(&plan, "B"), (at(19, 13), at(19, 17)));
        let b = found(&plan, "B");
        assert!(b.waits());
        assert_eq!(b.waits_for, vec!["P1".to_string()]);
    }

    #[test]
    fn an_overdue_task_goes_before_an_urgent_one() {
        let plan = plan(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Urgent),
            with(task("B"), 2.0, &["P1"], TaskPriority::Overdue),
        ]));
        assert_eq!(span(&plan, "B"), (at(19, 9), at(19, 11)));
        assert_eq!(span(&plan, "A"), (at(19, 11), at(19, 15)));
    }

    #[test]
    fn case_2_the_task_in_progress_goes_first() {
        let mut a = with(task("A"), 2.0, &["P1"], TaskPriority::Medium);
        a.in_progress = true;
        let plan = plan(&input(vec![a, with(task("B"), 3.0, &["P1"], TaskPriority::Urgent)]));
        assert_eq!(span(&plan, "A"), (at(19, 9), at(19, 11)));
        assert_eq!(span(&plan, "B"), (at(19, 11), at(19, 14)));
    }

    #[test]
    fn case_3_a_task_of_two_people_waits_for_both() {
        let plan = plan(&input(vec![
            with(task("A"), 3.0, &["P1", "P2"], TaskPriority::Medium),
            with(task("B"), 2.0, &["P1"], TaskPriority::Urgent),
            with(task("C"), 4.0, &["P2"], TaskPriority::High),
        ]));
        assert_eq!(span(&plan, "B"), (at(19, 9), at(19, 11)));
        assert_eq!(span(&plan, "C"), (at(19, 9), at(19, 13)));
        assert_eq!(span(&plan, "A"), (at(19, 13), at(19, 16)));
        assert_eq!(found(&plan, "A").waits_for, vec!["P2".to_string()]);
    }

    #[test]
    fn case_4_a_dependency_is_not_a_wait() {
        let plan = plan(&input(vec![
            with(task("A"), 5.0, &["P1"], TaskPriority::Medium),
            after(with(task("B"), 2.0, &["P2"], TaskPriority::Medium), &["A"]),
        ]));
        assert_eq!(span(&plan, "B"), (at(19, 14), at(19, 16)));
        assert!(!found(&plan, "B").waits());
    }

    #[test]
    fn case_5_a_task_crosses_into_the_next_day() {
        let plan = plan(&input(vec![with(task("A"), 12.0, &[], TaskPriority::Medium)]));
        assert_eq!(span(&plan, "A").1, at(20, 12));
    }

    #[test]
    fn case_6_an_end_on_the_day_boundary_reads_as_18() {
        let plan = plan(&input(vec![with(task("A"), 9.0, &[], TaskPriority::Medium)]));
        assert_eq!(span(&plan, "A").1, at(19, 18));
    }

    #[test]
    fn case_7_the_weekend_is_skipped() {
        // X fills Monday to Friday 16:00, so A starts on Friday at 16:00.
        let plan = plan(&input(vec![
            with(task("X"), 43.0, &[], TaskPriority::Medium),
            after(with(task("A"), 5.0, &[], TaskPriority::Medium), &["X"]),
        ]));
        assert_eq!(span(&plan, "B"), (at(23, 16), at(26, 12)));
    }

    #[test]
    fn case_8_a_later_task_fills_the_gap_of_a_person() {
        let plan = plan(&input(vec![
            with(task("A"), 2.0, &["P1"], TaskPriority::Urgent),
            after(with(task("B"), 3.0, &["P1"], TaskPriority::Medium), &["X"]),
            with(task("C"), 2.0, &["P1"], TaskPriority::Low),
            with(task("X"), 5.0, &["P2"], TaskPriority::Medium),
        ]));
        assert_eq!(span(&plan, "D"), (at(19, 9), at(19, 14)));
        assert_eq!(span(&plan, "A"), (at(19, 9), at(19, 11)));
        assert_eq!(span(&plan, "C"), (at(19, 11), at(19, 13)));
        assert_eq!(span(&plan, "B"), (at(19, 14), at(19, 17)));
    }

    #[test]
    fn case_9_a_dependency_that_closes_a_cycle_is_detected() {
        let depends_on = HashMap::from([
            ("A".to_string(), vec!["B".to_string()]),
            ("B".to_string(), vec!["C".to_string()]),
        ]);
        assert!(creates_cycle(&depends_on, "B", "A"));
        assert!(creates_cycle(&depends_on, "C", "A"));
        assert!(creates_cycle(&depends_on, "A", "A"));
        assert!(!creates_cycle(&depends_on, "A", "C"));
        assert!(!creates_cycle(&depends_on, "A", "D"));
    }

    #[test]
    fn a_cycle_in_the_saved_dependencies_is_broken_by_the_first_task() {
        let plan = plan(&input(vec![
            after(with(task("A"), 2.0, &[], TaskPriority::Medium), &["B"]),
            after(with(task("B"), 3.0, &[], TaskPriority::Medium), &["A"]),
        ]));
        assert_eq!(span(&plan, "A"), (at(19, 9), at(19, 11)));
        assert_eq!(span(&plan, "B"), (at(19, 11), at(19, 14)));
        let dependents = transitive_dependents(&plan, 0);
        assert!(dependents.contains(&1));
    }

    #[test]
    fn case_10_the_critical_path_follows_the_same_person() {
        let plan = plan(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("B"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("C"), 2.0, &["P2"], TaskPriority::Medium),
        ]));
        let analysis = analyze(&plan, &all_visible(&plan));
        assert_eq!(plan.date_time(analysis.end, true), at(19, 17));
        assert_eq!(analysis.critical_path, "A → B");
        assert_eq!(found(&plan, "B").resource_predecessors[0].task, 0);
        let c = analysis.tasks[2].expect("visible");
        assert_eq!(c.slack, 6.0);
        assert!(!c.critical);
        assert!(analysis.is_critical(0) && analysis.is_critical(1));
    }

    #[test]
    fn critical_chains_are_joined_and_hidden_tasks_do_not_count() {
        let plan = plan(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("B"), 4.0, &["P2"], TaskPriority::Medium),
            with(task("C"), 2.0, &[], TaskPriority::Medium),
        ]));
        let analysis = analyze(&plan, &all_visible(&plan));
        assert_eq!(analysis.critical_path, "A  ·  B");
        let only_c = HashSet::from([plan.tasks[2].task.task_path.clone()]);
        let analysis = analyze(&plan, &only_c);
        assert_eq!(analysis.critical_path, "C");
        assert!(!analysis.is_visible(0));
    }

    #[test]
    fn case_11_the_next_division_releases_its_tasks() {
        let mut next = with(task("A"), 3.0, &[], TaskPriority::Medium);
        next.column_kind = TaskColumnKind::NextDivision;
        let plan = plan(&input(vec![next]));
        // 1 January 2027 is a Friday.
        assert_eq!(span(&plan, "A").0, date(2027, 1, 1).at(9, 0, 0, 0));
    }

    #[test]
    fn the_next_sprint_releases_its_tasks() {
        let mut next = with(task("A"), 3.0, &[], TaskPriority::Medium);
        next.column_kind = TaskColumnKind::NextSprint;
        let plan = plan(&input(vec![next]));
        assert_eq!(span(&plan, "A").0, at(26, 9));
    }

    #[test]
    fn case_14_an_unestimated_task_lasts_one_workday() {
        let mut open = task("A");
        open.estimate_hours = None;
        let mut zero = task("B");
        zero.estimate_hours = Some(0.0);
        let plan = plan(&input(vec![open, zero]));
        assert!(plan.tasks.iter().all(|task| task.unestimated && task.duration == 9.0));
    }

    #[test]
    fn the_plan_starts_at_the_current_working_time() {
        let mut later = input(vec![with(task("A"), 2.0, &[], TaskPriority::Medium)]);
        later.now = date(2026, 10, 19).at(17, 0, 0, 0);
        let plan = plan(&later);
        assert_eq!(span(&plan, "A"), (at(19, 17), at(20, 10)));
    }

    /// 200 tasks with dependencies, 7 people.
    pub(crate) fn big_board() -> PlannerInput {
        let people = ["Ana", "Beto", "Caro", "Dani", "Eli", "Fede", "Gabi"];
        let tasks = (0..200)
            .map(|index| {
                let mut item = with(
                    task(&format!("T{index}")),
                    1.0 + (index % 7) as f64,
                    &[people[index % 7], people[(index * 3 + 1) % 7]][..1 + index % 2],
                    [TaskPriority::Low, TaskPriority::Medium, TaskPriority::High, TaskPriority::Urgent][index % 4],
                );
                if index >= 3 {
                    item.depends_on = vec![format!("T{}", index - 3), format!("T{}", index / 2)];
                }
                if index % 11 == 0 {
                    item.estimate_hours = None;
                }
                item
            })
            .collect();
        let mut board = input(tasks);
        board.members = people.iter().map(|name| member(name, "#4FD1C5")).collect();
        board
    }

    #[test]
    fn two_hundred_tasks_plan_and_analyze_fast() {
        let board = big_board();
        let started = Instant::now();
        let plan = plan(&board);
        let analysis = analyze(&plan, &all_visible(&plan));
        let elapsed = started.elapsed();
        println!("plan + analyze of 200 tasks: {elapsed:?}");
        assert_eq!(plan.tasks.len(), 200);
        assert!(analysis.end > 0.0);
        assert!(elapsed.as_millis() < 500);
    }
}
