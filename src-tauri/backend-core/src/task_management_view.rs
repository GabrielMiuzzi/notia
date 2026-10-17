//! Management screen of a Task Manager board: KPIs, Gantt, CPM network and
//! CPM table, built from the planner. The interface paints these values as
//! they come: every date, label, slack and pixel position is decided here.

use std::collections::{HashMap, HashSet};

use jiff::civil::{Date, Weekday};
use serde::{Deserialize, Serialize};

use crate::task_board_plan::{
    date_range, date_time_label, day_month, days_between, division_at, division_label, division_title,
    division_with_offset, divisions_of_year, fiscal_year_label, fold, hours_label, month_long, next_sprint,
    sprint_at, sprints_between, weekday_day_month, weekday_short, CalendarSpan,
};
use crate::task_planner::{
    analyze, by_start, plan, transitive_dependents, Analysis, Plan, PlannedTask, PlannerInput, EPS,
};

const TARGET_WIDTH_PX: f64 = 1100.0;
const MIN_DAY_PX: f64 = 14.0;
const MAX_DAY_PX: f64 = 64.0;
const DAILY_FROM_DAY_PX: f64 = 34.0;
const TASK_ROW_HEIGHT: f64 = 50.0;
const PERSON_ROW_HEIGHT: f64 = 52.0;
const BAR_TOP: f64 = 10.0;
const TASK_BAR_HEIGHT: f64 = 30.0;
const PERSON_BAR_HEIGHT: f64 = 32.0;
const MIN_BAR_PX: f64 = 14.0;
const MIN_WAIT_PX: f64 = 4.0;
const MIN_SLACK_PX: f64 = 3.0;
const SPRINT_INSET_PX: f64 = 2.0;
const MIN_SPRINT_PX: f64 = 10.0;
const LONG_SPRINT_LABEL_PX: f64 = 120.0;
const MAX_AVATARS: usize = 3;
const NET_PAD: f64 = 28.0;
const NODE_WIDTH: f64 = 184.0;
const NODE_HEIGHT: f64 = 100.0;
const COLUMN_STEP: f64 = 236.0;
const ROW_STEP: f64 = 124.0;
const ENDPOINT_SIZE: f64 = 56.0;
const EDGE_GAP: f64 = 3.0;
const MIN_CURVE_DX: f64 = 36.0;
/// Rows from the end of the table whose popover opens upwards.
const POPOVER_UP_ROWS: usize = 6;
const NOT_APPLICABLE: &str = "—";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagementRangeMode {
    /// Only the sprints with tasks, or the whole division when they fill it.
    #[default]
    Auto,
    Sprints,
    Division,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagementGroupBy {
    #[default]
    Task,
    Person,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRequest {
    /// Divisions after (or before) the current one.
    #[serde(default)]
    pub division_offset: i32,
    #[serde(default)]
    pub range_mode: ManagementRangeMode,
    #[serde(default)]
    pub group_by: ManagementGroupBy,
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementViewDto {
    /// The board has no active task to plan.
    pub empty: bool,
    pub empty_label: String,
    /// «9»: hours of the workday.
    pub hours_per_day: String,
    pub division_offset: i32,
    pub range_mode: ManagementRangeMode,
    pub group_by: ManagementGroupBy,
    pub kpis: Vec<ManagementKpiDto>,
    pub divisions: DivisionPickerDto,
    pub range: ManagementRangeDto,
    pub gantt: GanttDto,
    pub network: CpmNetworkDto,
    pub table: CpmTableDto,
    /// «B → E → F  ·  C», or «—».
    pub critical_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagementKpiKind {
    Range,
    TeamLoad,
    MostLoaded,
    Finish,
}

/// Color of a value: primary text, teal, amber or coral.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ManagementTone {
    Primary,
    Teal,
    Amber,
    Coral,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementKpiDto {
    pub kind: ManagementKpiKind,
    pub label: String,
    pub value: String,
    pub sub: String,
    pub tone: ManagementTone,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DivisionPickerDto {
    /// «Q4 2026».
    pub title: String,
    /// «2026» or «2026/27».
    pub fiscal_year_label: String,
    pub tabs: Vec<DivisionTabDto>,
    pub previous_offset: i32,
    pub next_offset: i32,
    /// «Hoy» shows only away from the current division.
    pub show_today: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DivisionTabDto {
    /// «Q1».
    pub label: String,
    /// «1 oct – 31 dic».
    pub tooltip: String,
    /// Offset to request to show this division.
    pub offset: i32,
    pub selected: bool,
    /// Today falls in it.
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementRangeDto {
    /// «Q4 2026», «Sprints 20–22» or «Sprint 21».
    pub title: String,
    /// «Gantt · Sprint 21 · Q4 2026».
    pub heading: String,
    /// «12 oct – 25 oct · ajustado a los sprints con tareas».
    pub subtitle: String,
    pub whole_division: bool,
    pub days: i64,
    pub modes: Vec<RangeModeOptionDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeModeOptionDto {
    pub mode: ManagementRangeMode,
    /// «Auto · Q», «Auto · 3 sprints», «Sprints», «Q completo».
    pub label: String,
    pub tooltip: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupByOptionDto {
    pub group_by: ManagementGroupBy,
    pub label: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttDto {
    /// Width of the timeline in px.
    pub width: f64,
    pub px_per_day: f64,
    /// Ticks per day (otherwise per week).
    pub daily: bool,
    /// «Tarea» or «Persona».
    pub head_label: String,
    /// «5 tareas» or «3 filas · 5 tareas».
    pub count_label: String,
    pub group_options: Vec<GroupByOptionDto>,
    pub months: Vec<GanttMonthDto>,
    pub sprints: Vec<GanttSprintDto>,
    pub ticks: Vec<GanttTickDto>,
    pub weekends: Vec<GanttSpanDto>,
    pub sprint_lines: Vec<f64>,
    /// The «now» line, when today is in the range.
    pub now_x: Option<f64>,
    pub rows: Vec<GanttRowDto>,
    /// «No hay tareas planificadas en Q4 2026.»
    pub no_rows_label: String,
    pub outside: Option<GanttOutsideDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttMonthDto {
    pub x: f64,
    pub width: f64,
    /// «octubre 2026», «noviembre».
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SprintBandKind {
    Current,
    Next,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttSprintDto {
    pub x: f64,
    pub width: f64,
    /// «Sprint 21 · actual» when wide enough, otherwise «S21».
    pub label: String,
    /// «Sprint 21 · 12 oct – 25 oct».
    pub tooltip: String,
    pub kind: SprintBandKind,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttTickDto {
    pub x: f64,
    pub width: f64,
    /// «lun» or «sem».
    pub top: String,
    /// «19» or «19 oct».
    pub bottom: String,
    pub today: bool,
    pub weekend: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttSpanDto {
    pub x: f64,
    pub width: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GanttRowKind {
    Task,
    Person,
}

/// A person as an avatar: initials over the board color (`None` when the
/// person has none, or for «Sin asignar»).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonChipDto {
    pub name: String,
    pub initials: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttRowDto {
    pub key: String,
    pub kind: GanttRowKind,
    pub height: f64,
    /// Task rows: letter of the task.
    pub letter: Option<String>,
    pub critical: bool,
    /// Task title, or person name with « (vos)».
    pub title: String,
    /// «lun 19 oct · 09:00 → mar 20 oct · 15:00» or «2 tareas · 8 h en Q4».
    pub sub: String,
    /// Task rows: up to three people.
    pub avatars: Vec<PersonChipDto>,
    /// Person rows: the person.
    pub person: Option<PersonChipDto>,
    /// Person rows: the «Sin asignar» row.
    pub unassigned: bool,
    /// Tasks of the row, for the shared highlight.
    pub task_paths: Vec<String>,
    pub bars: Vec<GanttBarDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttBarDto {
    pub task_path: String,
    pub letter: String,
    pub x: f64,
    pub width: f64,
    pub top: f64,
    pub height: f64,
    /// «A · 7 h», or «A · título» by person.
    pub label: String,
    /// «A · título · lun 19 oct · 09:00 → lun 19 oct · 16:00 · crítica».
    pub tooltip: String,
    pub critical: bool,
    pub blocked: bool,
    /// The task starts before the range.
    pub clipped_left: bool,
    /// The task ends after the range.
    pub clipped_right: bool,
    pub delay_ms: u32,
    /// Waiting for a person, before the bar.
    pub wait: Option<GanttSegmentDto>,
    /// Slack, after the bar up to the late finish.
    pub slack: Option<GanttSegmentDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttSegmentDto {
    pub x: f64,
    pub width: f64,
    pub top: f64,
    pub height: f64,
    pub tooltip: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GanttOutsideDto {
    /// «2 tareas terminaron antes · 3 tareas están planificadas después de Q4.»
    pub text: String,
    /// «Ver Q1 2027 →» when some task comes later.
    pub later_label: Option<String>,
    pub next_offset: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmNetworkDto {
    pub width: f64,
    pub height: f64,
    pub node_width: f64,
    pub node_height: f64,
    pub endpoint_size: f64,
    pub start: Option<CpmEndpointDto>,
    pub finish: Option<CpmEndpointDto>,
    pub nodes: Vec<CpmNodeDto>,
    pub edges: Vec<CpmEdgeDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmEndpointDto {
    pub x: f64,
    pub y: f64,
    /// «Inicio» or «Fin».
    pub label: String,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmNodeDto {
    pub task_path: String,
    pub letter: String,
    pub title: String,
    /// «título · GA, DM».
    pub tooltip: String,
    pub x: f64,
    pub y: f64,
    pub level: usize,
    pub critical: bool,
    pub unestimated: bool,
    /// Values in working hours, comma decimals.
    pub early_start: String,
    pub duration: String,
    pub early_finish: String,
    pub late_start: String,
    pub slack: String,
    pub late_finish: String,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CpmEdgeKind {
    Dependency,
    Resource,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmEdgeDto {
    pub key: String,
    /// Task path, or `None` for «Inicio».
    pub from: Option<String>,
    /// Task path, or `None` for «Fin».
    pub to: Option<String>,
    pub kind: CpmEdgeKind,
    /// Both ends critical and back to back.
    pub critical: bool,
    /// SVG cubic path.
    pub d: String,
    pub delay_ms: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmTableDto {
    /// «Fechas calculadas con las horas restantes, la jornada de 9 h…».
    pub description: String,
    /// «Crearía un ciclo».
    pub cycle_note: String,
    /// Visible tasks that the popover offers as predecessors, by letter.
    pub candidates: Vec<PredecessorCandidateDto>,
    pub rows: Vec<CpmRowDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PredecessorCandidateDto {
    pub task_path: String,
    pub letter: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpmRowDto {
    pub task_path: String,
    pub letter: String,
    pub title: String,
    /// Column of the task and its color.
    pub group: String,
    pub group_color: String,
    /// «sin estimar (9 h por defecto)».
    pub unestimated_note: Option<String>,
    pub people: Vec<PersonChipDto>,
    /// «Sin asignar» without people.
    pub unassigned_label: Option<String>,
    /// «4 h».
    pub remaining: String,
    /// Letters of its planned dependencies.
    pub predecessors: Vec<String>,
    /// Paths of all its dependencies: what to send back when editing.
    pub dependency_paths: Vec<String>,
    /// Candidates (by letter) that would close a cycle.
    pub cycle_letters: Vec<String>,
    /// «Editar predecesoras de A».
    pub edit_label: String,
    /// «A empieza después de».
    pub popover_title: String,
    /// «Predecesoras de A».
    pub popover_label: String,
    pub popover_above: bool,
    pub start_label: String,
    /// «Espera a Gabriel».
    pub wait_label: Option<String>,
    pub end_label: String,
    pub late_start_label: String,
    /// «6 h».
    pub slack_label: String,
    pub critical: bool,
    /// «Crítica» or «Con holgura».
    pub route_label: String,
    pub delay_ms: u32,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn next_day(date: Date) -> Date {
    date.tomorrow().unwrap_or(date)
}

fn plural(count: usize, one: &str, many: &str) -> String {
    format!("{count} {}", if count == 1 { one } else { many })
}

fn hours(value: f64) -> String {
    format!("{} h", hours_label(value))
}

/// First letters of the first two words: «Gabriel Díaz» → «GD».
fn initials(name: &str) -> String {
    name.split_whitespace().take(2).filter_map(|word| word.chars().next()).collect::<String>().to_uppercase()
}

fn first_name(name: &str) -> &str {
    name.split_whitespace().next().unwrap_or(name)
}

/// Number for an SVG path: up to two decimals.
fn svg_number(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded}")
    }
}

fn curve(x1: f64, y1: f64, x2: f64, y2: f64) -> String {
    let dx = MIN_CURVE_DX.max((x2 - x1) / 2.0);
    format!(
        "M{} {} C{} {} {} {} {} {}",
        svg_number(x1),
        svg_number(y1),
        svg_number(x1 + dx),
        svg_number(y1),
        svg_number(x2 - dx),
        svg_number(y2),
        svg_number(x2),
        svg_number(y2)
    )
}

/// Colors of the board people, by folded name.
struct People {
    colors: HashMap<String, String>,
    viewer: Option<String>,
}

impl People {
    fn new(input: &PlannerInput) -> Self {
        Self {
            colors: input.members.iter().map(|member| (fold(&member.name), member.color.clone())).collect(),
            viewer: input.viewer.as_deref().map(fold).filter(|viewer| !viewer.is_empty()),
        }
    }

    fn chip(&self, name: &str) -> PersonChipDto {
        PersonChipDto { name: name.to_string(), initials: initials(name), color: self.colors.get(&fold(name)).cloned() }
    }

    fn is_viewer(&self, name: &str) -> bool {
        self.viewer.as_deref() == Some(fold(name).as_str())
    }
}

/// The visible days of the Gantt and their scale.
struct Timeline {
    start: Date,
    end: Date,
    px_per_day: f64,
    width: f64,
    day_start_minutes: f64,
    minutes_per_day: f64,
}

impl Timeline {
    fn new(start: Date, end: Date, day_start_minutes: u16, hours_per_day: f64) -> Self {
        let days = (days_between(start, end) + 1).max(1);
        let px_per_day = (TARGET_WIDTH_PX / days as f64).round().clamp(MIN_DAY_PX, MAX_DAY_PX);
        Self {
            start,
            end,
            px_per_day,
            width: days as f64 * px_per_day,
            day_start_minutes: f64::from(day_start_minutes),
            minutes_per_day: (hours_per_day * 60.0).max(1.0),
        }
    }

    fn days(&self) -> i64 {
        days_between(self.start, self.end) + 1
    }

    fn day_x(&self, date: Date) -> f64 {
        (days_between(self.start, date) as f64 * self.px_per_day).round()
    }

    fn x_of(&self, plan: &Plan, hours: f64, is_end: bool) -> f64 {
        let moment = plan.date_time(hours, is_end && hours >= EPS);
        let minutes = f64::from(moment.hour()) * 60.0 + f64::from(moment.minute());
        let fraction = ((minutes - self.day_start_minutes) / self.minutes_per_day).clamp(0.0, 1.0);
        self.day_x(moment.date()) + fraction * self.px_per_day
    }

    fn clip(&self, x: f64) -> f64 {
        x.clamp(0.0, self.width)
    }
}

/// What every part of the screen shares.
struct Context<'a> {
    input: &'a PlannerInput,
    plan: &'a Plan,
    analysis: &'a Analysis,
    people: People,
    /// Visible tasks in letter order.
    shown: Vec<usize>,
    division: CalendarSpan,
    division_label: String,
    division_start_hours: f64,
    division_end_hours: f64,
}

impl Context<'_> {
    fn task(&self, index: usize) -> &PlannedTask {
        &self.plan.tasks[index]
    }

    fn start_label(&self, index: usize) -> String {
        date_time_label(self.plan.date_time(self.task(index).start, false))
    }

    fn end_label(&self, index: usize) -> String {
        date_time_label(self.plan.date_time(self.task(index).finish, true))
    }

    fn slack(&self, index: usize) -> f64 {
        self.analysis.tasks[index].map(|slack| slack.slack).unwrap_or(0.0)
    }

    fn late_finish(&self, index: usize) -> f64 {
        self.analysis.tasks[index].map(|slack| slack.late_finish).unwrap_or(self.task(index).finish)
    }

    fn late_start(&self, index: usize) -> f64 {
        self.analysis.tasks[index].map(|slack| slack.late_start).unwrap_or(self.task(index).start)
    }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

/// Builds everything the Management screen renders (spec 9.7–9.8).
pub fn management_view(input: &PlannerInput, request: &ManagementRequest) -> ManagementViewDto {
    let plan = plan(input);
    let settings = &input.plan;
    let today = input.now.date();
    let calendar = &plan.calendar;
    let current_division = division_at(settings, today);
    let division = division_with_offset(settings, today, request.division_offset);
    let division_start_hours = calendar.hours_at_date(division.start);
    let division_end_hours = calendar.hours_at_date(next_day(division.end));

    let mut shown = Vec::new();
    let (mut before, mut after) = (0, 0);
    let mut span: Option<(Date, Date)> = None;
    for (index, task) in plan.tasks.iter().enumerate() {
        let start_date = plan.date_time(task.start, false).date();
        let end_date = plan.date_time(task.finish, true).date();
        let inside = task.finish > division_start_hours + EPS
            && task.start < division_end_hours - EPS
            && end_date >= division.start
            && start_date <= division.end;
        if inside {
            shown.push(index);
            let from = start_date.max(division.start);
            let to = end_date.min(division.end);
            span = Some(span.map_or((from, to), |(a, b)| (a.min(from), b.max(to))));
        } else if end_date < division.start {
            before += 1;
        } else if start_date > division.end {
            after += 1;
        }
    }
    let visible = shown.iter().map(|index| plan.tasks[*index].task.task_path.clone()).collect::<HashSet<_>>();
    let analysis = analyze(&plan, &visible);
    let context = Context {
        input,
        plan: &plan,
        analysis: &analysis,
        people: People::new(input),
        shown,
        division_label: division_label(settings, &division),
        division,
        division_start_hours,
        division_end_hours,
    };

    let divisions = division_picker(&context, request.division_offset, &current_division);
    let (range, timeline) = visible_range(&context, request.range_mode, span);
    let kpis = if plan.tasks.is_empty() { Vec::new() } else { kpis(&context, &range, &timeline) };
    let gantt = gantt(&context, request, &timeline, before, after);
    let network = network(&context);
    let table = table(&context);
    ManagementViewDto {
        empty: plan.tasks.is_empty(),
        empty_label: "No hay tareas activas para planificar en este tablero.".to_string(),
        hours_per_day: hours_label(plan.hours_per_day),
        division_offset: request.division_offset,
        range_mode: request.range_mode,
        group_by: request.group_by,
        kpis,
        divisions,
        range,
        gantt,
        network,
        table,
        critical_path: analysis.critical_path.clone(),
    }
}

fn division_picker(context: &Context, offset: i32, current: &CalendarSpan) -> DivisionPickerDto {
    let settings = &context.input.plan;
    let selected = &context.division;
    let tabs = divisions_of_year(settings, selected.year)
        .iter()
        .map(|division| DivisionTabDto {
            label: division_label(settings, division),
            tooltip: date_range(division.start, division.end),
            offset: offset + division.number as i32 - selected.number as i32,
            selected: division.number == selected.number,
            current: division.year == current.year && division.number == current.number,
        })
        .collect();
    DivisionPickerDto {
        title: division_title(settings, selected),
        fiscal_year_label: fiscal_year_label(settings, selected.year),
        tabs,
        previous_offset: offset - 1,
        next_offset: offset + 1,
        show_today: offset != 0,
    }
}

fn sprints_title(sprints: &[CalendarSpan]) -> String {
    match sprints {
        [] => String::new(),
        [only] => format!("Sprint {}", only.number),
        [first, .., last] if last.number > first.number => format!("Sprints {}–{}", first.number, last.number),
        [first, .., last] => format!("Sprint {} → {}", first.number, last.number),
    }
}

fn visible_range(
    context: &Context,
    mode: ManagementRangeMode,
    span: Option<(Date, Date)>,
) -> (ManagementRangeDto, Timeline) {
    let settings = &context.input.plan;
    let division = &context.division;
    let prefix = settings.division_prefix.trim();
    let in_division = sprints_between(settings, division.start, division.end);
    let covered = span
        .map(|(from, to)| {
            in_division.iter().filter(|sprint| sprint.end >= from && sprint.start <= to).cloned().collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let fills_division = covered.len() >= 2.max(in_division.len().saturating_sub(1));
    let whole = covered.is_empty()
        || mode == ManagementRangeMode::Division
        || (mode == ManagementRangeMode::Auto && fills_division);
    let (start, end) = match (whole, covered.first(), covered.last()) {
        (false, Some(first), Some(last)) => (first.start.max(division.start), last.end.min(division.end)),
        _ => (division.start, division.end),
    };
    let timeline = Timeline::new(start, end, settings.day_start_minutes, context.plan.hours_per_day);
    let division_name = division_title(settings, division);
    let title = if whole { division_name.clone() } else { sprints_title(&covered) };
    let heading =
        if whole { format!("Gantt · {division_name}") } else { format!("Gantt · {title} · {division_name}") };
    let reason = match (whole, mode) {
        (true, ManagementRangeMode::Auto) if !covered.is_empty() => format!("las tareas ocupan casi todo el {prefix}"),
        (true, _) => format!("{prefix} completo"),
        (false, ManagementRangeMode::Auto) => "ajustado a los sprints con tareas".to_string(),
        (false, _) => "solo sprints con tareas".to_string(),
    };
    let auto_label = match (mode, whole) {
        (ManagementRangeMode::Auto, true) => format!("Auto · {prefix}"),
        (ManagementRangeMode::Auto, false) => format!("Auto · {}", plural(covered.len(), "sprint", "sprints")),
        _ => "Auto".to_string(),
    };
    let modes = [
        (ManagementRangeMode::Auto, auto_label, format!("Elige solo entre los sprints con tareas y el {prefix} completo")),
        (ManagementRangeMode::Sprints, "Sprints".to_string(), "Solo los sprints que ocupan las tareas".to_string()),
        (ManagementRangeMode::Division, format!("{prefix} completo"), "Toda la división".to_string()),
    ]
    .into_iter()
    .map(|(option, label, tooltip)| RangeModeOptionDto { mode: option, label, tooltip, selected: option == mode })
    .collect();
    let range = ManagementRangeDto {
        title,
        heading,
        subtitle: format!("{} · {reason}", date_range(start, end)),
        whole_division: whole,
        days: timeline.days(),
        modes,
    };
    (range, timeline)
}

fn kpis(context: &Context, range: &ManagementRangeDto, timeline: &Timeline) -> Vec<ManagementKpiDto> {
    let plan = context.plan;
    let calendar = &plan.calendar;
    let today = context.input.now.date();
    let origin = calendar.origin();
    let hours_per_day = plan.hours_per_day;

    // Capacity of one person from now (or the range start) to its end.
    let from = timeline.start.max(origin.date());
    let mut work_days = 0usize;
    let mut day = from;
    while day <= timeline.end {
        if calendar.is_work_day(day) {
            work_days += 1;
        }
        day = next_day(day);
    }
    let used_today = if from == origin.date() && work_days > 0 {
        (f64::from(origin.hour()) * 60.0 + f64::from(origin.minute()) - f64::from(context.input.plan.day_start_minutes))
            / 60.0
    } else {
        0.0
    };
    let person_capacity = (work_days as f64 * hours_per_day - used_today.max(0.0)).max(0.0);
    let range_start = calendar.hours_at_date(timeline.start);
    let range_end = calendar.hours_at_date(next_day(timeline.end));
    let load_of = |index: usize| {
        let task = context.task(index);
        (task.finish.min(range_end) - task.start.max(range_start)).max(0.0)
    };

    let mut names: Vec<String> = context.input.members.iter().map(|member| member.name.clone()).collect();
    for &index in &context.shown {
        for person in &context.task(index).task.people {
            if !names.iter().any(|name| fold(name) == fold(person)) {
                names.push(person.clone());
            }
        }
    }
    let mut loads = names
        .iter()
        .map(|name| {
            let folded = fold(name);
            let load = context
                .shown
                .iter()
                .filter(|index| context.task(**index).task.people.iter().any(|person| fold(person) == folded))
                .map(|index| load_of(*index))
                .sum::<f64>();
            (name.clone(), load)
        })
        .collect::<Vec<_>>();
    loads.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let team_load = loads.iter().map(|(_, load)| load).sum::<f64>();
    let unassigned_load = context
        .shown
        .iter()
        .filter(|index| context.task(**index).task.people.is_empty())
        .map(|index| load_of(*index))
        .sum::<f64>();
    let member_count = context.input.members.len();
    let team_capacity = person_capacity * member_count.max(1) as f64;
    let total_load = team_load + unassigned_load;
    let team_percent = if team_capacity > 0.0 { (total_load / team_capacity * 100.0).round() as i64 } else { 0 };
    let mut team_sub = format!(
        "{team_percent}% de {} × {} h/día",
        plural(member_count, "persona", "personas"),
        hours_label(hours_per_day)
    );
    if unassigned_load > EPS {
        team_sub.push_str(&format!(" · {} sin asignar", hours(unassigned_load)));
    }

    let top = loads.first().filter(|(_, load)| *load > EPS);
    let top_percent = match top {
        Some((_, load)) if person_capacity > 0.0 => (load / person_capacity * 100.0).round() as i64,
        _ => 0,
    };
    let finish = (!context.shown.is_empty()).then(|| plan.date_time(context.analysis.end, true));

    vec![
        ManagementKpiDto {
            kind: ManagementKpiKind::Range,
            label: "Rango".to_string(),
            value: range.title.clone(),
            sub: format!(
                "{} · {}",
                date_range(timeline.start, timeline.end),
                if context.division.end < today {
                    "finalizado".to_string()
                } else {
                    format!("{} por delante", plural(work_days, "día hábil", "días hábiles"))
                }
            ),
            tone: ManagementTone::Primary,
        },
        ManagementKpiDto {
            kind: ManagementKpiKind::TeamLoad,
            label: "Carga del equipo".to_string(),
            value: format!("{} / {}", hours(total_load), hours(team_capacity)),
            sub: team_sub,
            tone: if team_percent > 100 { ManagementTone::Coral } else { ManagementTone::Teal },
        },
        ManagementKpiDto {
            kind: ManagementKpiKind::MostLoaded,
            label: "Más cargado".to_string(),
            value: top
                .map(|(name, load)| format!("{} · {}", first_name(name), hours(*load)))
                .unwrap_or_else(|| NOT_APPLICABLE.to_string()),
            sub: if top.is_some() {
                format!("{top_percent}% de su capacidad en el rango")
            } else {
                "Nadie tiene tareas asignadas".to_string()
            },
            tone: if top_percent > 100 {
                ManagementTone::Coral
            } else if top_percent > 80 {
                ManagementTone::Amber
            } else {
                ManagementTone::Primary
            },
        },
        ManagementKpiDto {
            kind: ManagementKpiKind::Finish,
            label: "Fin de lo planificado".to_string(),
            value: finish.map(|end| weekday_day_month(end.date())).unwrap_or_else(|| NOT_APPLICABLE.to_string()),
            sub: match finish {
                Some(end) => format!(
                    "{:02}:{:02} · ruta crítica {}",
                    end.hour(),
                    end.minute(),
                    context.analysis.critical_path
                ),
                None => format!("Sin tareas en {}", context.division_label),
            },
            tone: ManagementTone::Coral,
        },
    ]
}

// ---------------------------------------------------------------------------
// Gantt
// ---------------------------------------------------------------------------

fn gantt(
    context: &Context,
    request: &ManagementRequest,
    timeline: &Timeline,
    before: usize,
    after: usize,
) -> GanttDto {
    let settings = &context.input.plan;
    let calendar = &context.plan.calendar;
    let now = context.input.now;
    let today = now.date();
    let px = timeline.px_per_day;
    let daily = px >= DAILY_FROM_DAY_PX;

    let mut months = Vec::new();
    let mut month = timeline.start.first_of_month();
    while month <= timeline.end {
        let from = month.max(timeline.start);
        let to = month.last_of_month().min(timeline.end);
        let year = if month.month() == 1 || months.is_empty() { format!(" {}", month.year()) } else { String::new() };
        months.push(GanttMonthDto {
            x: timeline.day_x(from),
            width: timeline.day_x(to) + px - timeline.day_x(from),
            label: format!("{}{year}", month_long(month.month())),
        });
        month = next_day(month.last_of_month());
    }

    let current_sprint = sprint_at(settings, today);
    let following_sprint = next_sprint(settings, today);
    let range_sprints = sprints_between(settings, timeline.start, timeline.end);
    let sprints = range_sprints
        .iter()
        .map(|sprint| {
            let from = sprint.start.max(timeline.start);
            let to = sprint.end.min(timeline.end);
            let width = MIN_SPRINT_PX
                .max(timeline.day_x(to) + px - timeline.day_x(from) - 2.0 * SPRINT_INSET_PX);
            let kind = if sprint.start == current_sprint.start {
                SprintBandKind::Current
            } else if sprint.start == following_sprint.start {
                SprintBandKind::Next
            } else {
                SprintBandKind::Other
            };
            let label = if width > LONG_SPRINT_LABEL_PX {
                let suffix = match kind {
                    SprintBandKind::Current => " · actual",
                    SprintBandKind::Next => " · siguiente",
                    SprintBandKind::Other => "",
                };
                format!("Sprint {}{suffix}", sprint.number)
            } else {
                format!("S{}", sprint.number)
            };
            GanttSprintDto {
                x: timeline.day_x(from) + SPRINT_INSET_PX,
                width,
                label,
                tooltip: format!("Sprint {} · {}", sprint.number, date_range(sprint.start, sprint.end)),
                kind,
            }
        })
        .collect();
    let sprint_lines = range_sprints
        .iter()
        .filter(|sprint| sprint.start > timeline.start)
        .map(|sprint| timeline.day_x(sprint.start))
        .collect();

    let mut ticks = Vec::new();
    let mut weekends = Vec::new();
    let mut day = timeline.start;
    while day <= timeline.end {
        let weekend = !calendar.is_work_day(day);
        let x = timeline.day_x(day);
        if daily {
            ticks.push(GanttTickDto {
                x,
                width: px,
                top: weekday_short(day).to_string(),
                bottom: day.day().to_string(),
                today: day == today,
                weekend,
            });
        } else if day.weekday() == Weekday::Monday || day == timeline.start {
            let week_end = day.checked_add(jiff::Span::new().days(6)).unwrap_or(day);
            ticks.push(GanttTickDto {
                x,
                width: (7.0 * px).min(timeline.width - x),
                top: "sem".to_string(),
                bottom: day_month(day),
                today: day <= today && today <= week_end,
                weekend: false,
            });
        }
        if weekend {
            weekends.push(GanttSpanDto { x, width: px });
        }
        day = next_day(day);
    }
    let now_x = (timeline.start <= today && today <= timeline.end).then(|| {
        let minutes = f64::from(now.hour()) * 60.0 + f64::from(now.minute());
        let fraction = ((minutes - timeline.day_start_minutes) / timeline.minutes_per_day).clamp(0.0, 1.0);
        timeline.day_x(today) + (fraction * px).round()
    });

    let order = by_start(context.plan, context.shown.iter().copied());
    let rows = match request.group_by {
        ManagementGroupBy::Task => order
            .iter()
            .enumerate()
            .map(|(position, index)| task_row(context, timeline, *index, position))
            .collect::<Vec<_>>(),
        ManagementGroupBy::Person => person_rows(context, timeline, &order),
    };
    let count_label = match request.group_by {
        ManagementGroupBy::Task => plural(context.shown.len(), "tarea", "tareas"),
        ManagementGroupBy::Person => {
            format!("{} · {}", plural(rows.len(), "fila", "filas"), plural(context.shown.len(), "tarea", "tareas"))
        }
    };

    let mut parts = Vec::new();
    if before > 0 {
        parts.push(if before == 1 { "1 tarea terminó antes".to_string() } else { format!("{before} tareas terminaron antes") });
    }
    if after > 0 {
        let what = if after == 1 {
            "1 tarea está planificada después".to_string()
        } else {
            format!("{after} tareas están planificadas después")
        };
        parts.push(format!("{what} de {}", context.division_label));
    }
    let next_offset = request.division_offset + 1;
    let outside = (!parts.is_empty()).then(|| GanttOutsideDto {
        text: format!("{}.", parts.join(" · ")),
        later_label: (after > 0).then(|| {
            format!("Ver {} →", division_title(settings, &division_with_offset(settings, today, next_offset)))
        }),
        next_offset,
    });

    GanttDto {
        width: timeline.width,
        px_per_day: px,
        daily,
        head_label: match request.group_by {
            ManagementGroupBy::Task => "Tarea",
            ManagementGroupBy::Person => "Persona",
        }
        .to_string(),
        count_label,
        group_options: [(ManagementGroupBy::Task, "Por tarea"), (ManagementGroupBy::Person, "Por persona")]
            .into_iter()
            .map(|(group_by, label)| GroupByOptionDto {
                group_by,
                label: label.to_string(),
                selected: group_by == request.group_by,
            })
            .collect(),
        months,
        sprints,
        ticks,
        weekends,
        sprint_lines,
        now_x,
        rows,
        no_rows_label: format!("No hay tareas planificadas en {}.", division_title(settings, &context.division)),
        outside,
    }
}

fn bar(context: &Context, timeline: &Timeline, index: usize, order: usize, compact: bool) -> GanttBarDto {
    let task = context.task(index);
    let height = if compact { PERSON_BAR_HEIGHT } else { TASK_BAR_HEIGHT };
    let critical = context.analysis.is_critical(index);
    let slack = context.slack(index);
    let x0 = timeline.x_of(context.plan, task.start, false);
    let x1 = timeline.x_of(context.plan, task.finish, true);
    let (left, right) = (timeline.clip(x0), timeline.clip(x1));
    let clipped_left = x0 < -0.5;
    let clipped_right = x1 > timeline.width + 0.5;
    let inset = |clipped: bool| if clipped { 0.0 } else { 1.0 };
    let width = MIN_BAR_PX.max((right - left).round() - inset(clipped_left) - inset(clipped_right));
    let wait_x = timeline.clip(timeline.x_of(context.plan, task.ready, false));
    let wait = (!compact && task.waits() && left - wait_x > MIN_WAIT_PX).then(|| GanttSegmentDto {
        x: wait_x.round(),
        width: (left - wait_x).round().max(0.0),
        top: BAR_TOP,
        height,
        tooltip: format!("Espera a {} ({})", task.waits_for.join(", "), hours(task.wait())),
    });
    let slack_end = timeline.clip(timeline.x_of(context.plan, context.late_finish(index), true));
    let slack_segment = (!compact && slack > 0.05 && slack_end > right + MIN_SLACK_PX).then(|| GanttSegmentDto {
        x: right.round() - 1.0,
        width: (slack_end - right).round().max(0.0),
        top: BAR_TOP + 4.0,
        height: height - 8.0,
        tooltip: format!("Holgura: {}", hours(slack)),
    });
    let title = &task.task.title;
    GanttBarDto {
        task_path: task.task.task_path.clone(),
        letter: task.letter.clone(),
        x: left.round() + inset(clipped_left),
        width,
        top: BAR_TOP,
        height,
        label: if compact {
            format!("{} · {title}", task.letter)
        } else {
            format!("{} · {}", task.letter, hours(task.duration))
        },
        tooltip: format!(
            "{} · {title} · {} → {}{}",
            task.letter,
            context.start_label(index),
            context.end_label(index),
            if critical { " · crítica".to_string() } else { format!(" · holgura {}", hours(slack)) }
        ),
        critical,
        blocked: task.task.blocked,
        clipped_left,
        clipped_right,
        delay_ms: 160 + order as u32 * 45,
        wait,
        slack: slack_segment,
    }
}

fn task_row(context: &Context, timeline: &Timeline, index: usize, position: usize) -> GanttRowDto {
    let task = context.task(index);
    GanttRowDto {
        key: task.task.task_path.clone(),
        kind: GanttRowKind::Task,
        height: TASK_ROW_HEIGHT,
        letter: Some(task.letter.clone()),
        critical: context.analysis.is_critical(index),
        title: task.task.title.clone(),
        sub: format!("{} → {}", context.start_label(index), context.end_label(index)),
        avatars: task.task.people.iter().take(MAX_AVATARS).map(|person| context.people.chip(person)).collect(),
        person: None,
        unassigned: false,
        task_paths: vec![task.task.task_path.clone()],
        bars: vec![bar(context, timeline, index, position, false)],
    }
}

fn person_rows(context: &Context, timeline: &Timeline, order: &[usize]) -> Vec<GanttRowDto> {
    let mut names: Vec<String> = context.input.members.iter().map(|member| member.name.clone()).collect();
    for &index in order {
        for person in &context.task(index).task.people {
            if !names.iter().any(|name| fold(name) == fold(person)) {
                names.push(person.clone());
            }
        }
    }
    let mut groups = names
        .into_iter()
        .map(|name| {
            let folded = fold(&name);
            let list = order
                .iter()
                .copied()
                .filter(|index| context.task(*index).task.people.iter().any(|person| fold(person) == folded))
                .collect::<Vec<_>>();
            (Some(name), list)
        })
        .filter(|(_, list)| !list.is_empty())
        .collect::<Vec<_>>();
    let unassigned =
        order.iter().copied().filter(|index| context.task(*index).task.people.is_empty()).collect::<Vec<_>>();
    if !unassigned.is_empty() {
        groups.push((None, unassigned));
    }
    groups
        .into_iter()
        .enumerate()
        .map(|(row, (name, list))| {
            let in_division = list
                .iter()
                .map(|index| {
                    let task = context.task(*index);
                    (task.finish.min(context.division_end_hours) - task.start.max(context.division_start_hours)).max(0.0)
                })
                .sum::<f64>();
            let sub = format!(
                "{} · {} en {}",
                plural(list.len(), "tarea", "tareas"),
                hours(in_division),
                context.division_label
            );
            let (key, title, person) = match &name {
                Some(name) => (
                    format!("person:{name}"),
                    if context.people.is_viewer(name) { format!("{name} (vos)") } else { name.clone() },
                    context.people.chip(name),
                ),
                None => (
                    "person:".to_string(),
                    "Sin asignar".to_string(),
                    PersonChipDto { name: "Sin asignar".to_string(), initials: "?".to_string(), color: None },
                ),
            };
            GanttRowDto {
                key,
                kind: GanttRowKind::Person,
                height: PERSON_ROW_HEIGHT,
                letter: None,
                critical: false,
                title,
                sub,
                avatars: Vec::new(),
                person: Some(person),
                unassigned: name.is_none(),
                task_paths: list.iter().map(|index| context.task(*index).task.task_path.clone()).collect(),
                bars: list
                    .iter()
                    .enumerate()
                    .map(|(position, index)| bar(context, timeline, *index, row * 3 + position, true))
                    .collect(),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// CPM network
// ---------------------------------------------------------------------------

fn network(context: &Context) -> CpmNetworkDto {
    let plan = context.plan;
    let analysis = context.analysis;
    let order = by_start(plan, context.shown.iter().copied());
    // Every link goes forward in time: predecessors come first in `order`.
    let mut levels = vec![0usize; plan.tasks.len()];
    for &index in &order {
        levels[index] = analysis
            .visible_predecessors(plan, index)
            .iter()
            .filter(|pred| plan.tasks[**pred].start < plan.tasks[index].start)
            .map(|pred| levels[*pred] + 1)
            .max()
            .unwrap_or(0);
    }
    let max_level = order.iter().map(|index| levels[*index]).max().unwrap_or(0);
    let mut columns = vec![Vec::new(); max_level + 1];
    for &index in &order {
        columns[levels[index]].push(index);
    }
    let max_rows = columns.iter().map(Vec::len).max().unwrap_or(0).max(1);
    let height = NET_PAD * 2.0 + max_rows as f64 * ROW_STEP - (ROW_STEP - NODE_HEIGHT);
    let first_x = NET_PAD + ENDPOINT_SIZE + 56.0;
    let mut place = vec![(0.0, 0.0, 0usize); plan.tasks.len()];
    for (level, column) in columns.iter().enumerate() {
        for (row, index) in column.iter().enumerate() {
            place[*index] = (
                first_x + level as f64 * COLUMN_STEP,
                NET_PAD + (max_rows - column.len()) as f64 * ROW_STEP / 2.0 + row as f64 * ROW_STEP,
                row,
            );
        }
    }
    let finish_x = first_x + max_level as f64 * COLUMN_STEP + NODE_WIDTH + 56.0;
    let has_nodes = !order.is_empty();
    let endpoint_y = height / 2.0 - ENDPOINT_SIZE / 2.0;
    let endpoint_mid = endpoint_y + ENDPOINT_SIZE / 2.0;

    let mut edges: Vec<CpmEdgeDto> = Vec::new();
    let mut push = |from: Option<&PlannedTask>, to: Option<&PlannedTask>, kind, critical, d| {
        let path = |task: Option<&PlannedTask>| task.map(|task| task.task.task_path.clone());
        let name = |task: Option<&PlannedTask>, end: &str| task.map_or(end.to_string(), |task| task.letter.clone());
        let key = format!(
            "{}>{}{}",
            name(from, "inicio"),
            name(to, "fin"),
            if kind == CpmEdgeKind::Resource { ":r" } else { "" }
        );
        let delay_ms = 420 + edges.len() as u32 * 35;
        edges.push(CpmEdgeDto { key, from: path(from), to: path(to), kind, critical, d, delay_ms });
    };
    for &index in &context.shown {
        let task = &plan.tasks[index];
        let (x, y, _) = place[index];
        let mid = y + NODE_HEIGHT / 2.0;
        let critical = analysis.is_critical(index);
        if analysis.visible_predecessors(plan, index).is_empty() {
            push(
                None,
                Some(task),
                CpmEdgeKind::Dependency,
                critical && (task.start - task.release).abs() < 0.05,
                curve(NET_PAD + ENDPOINT_SIZE, endpoint_mid, x - EDGE_GAP, mid),
            );
        }
        for &pred in task.predecessors.iter().filter(|pred| analysis.is_visible(**pred)) {
            let (px, py, _) = place[pred];
            push(
                Some(&plan.tasks[pred]),
                Some(task),
                CpmEdgeKind::Dependency,
                analysis.is_tight(plan, pred, index),
                curve(px + NODE_WIDTH, py + NODE_HEIGHT / 2.0, x - EDGE_GAP, mid),
            );
        }
        for link in task.resource_predecessors.iter().filter(|link| analysis.is_visible(link.task)) {
            let (px, py, _) = place[link.task];
            push(
                Some(&plan.tasks[link.task]),
                Some(task),
                CpmEdgeKind::Resource,
                analysis.is_tight(plan, link.task, index),
                curve(px + NODE_WIDTH, py + NODE_HEIGHT / 2.0, x - EDGE_GAP, mid),
            );
        }
        if analysis.visible_successors(plan, index).is_empty() {
            push(
                Some(task),
                None,
                CpmEdgeKind::Dependency,
                critical,
                curve(x + NODE_WIDTH, mid, finish_x - EDGE_GAP, endpoint_mid),
            );
        }
    }

    let nodes = context
        .shown
        .iter()
        .map(|&index| {
            let task = &plan.tasks[index];
            let (x, y, row) = place[index];
            let people = task.task.people.iter().map(|person| initials(person)).collect::<Vec<_>>();
            CpmNodeDto {
                task_path: task.task.task_path.clone(),
                letter: task.letter.clone(),
                title: task.task.title.clone(),
                tooltip: if people.is_empty() {
                    task.task.title.clone()
                } else {
                    format!("{} · {}", task.task.title, people.join(", "))
                },
                x,
                y,
                level: levels[index],
                critical: analysis.is_critical(index),
                unestimated: task.unestimated,
                early_start: hours_label(task.start),
                duration: hours_label(task.duration),
                early_finish: hours_label(task.finish),
                late_start: hours_label(context.late_start(index)),
                slack: hours_label(context.slack(index)),
                late_finish: hours_label(context.late_finish(index)),
                delay_ms: 120 + levels[index] as u32 * 90 + row as u32 * 40,
            }
        })
        .collect();
    let endpoint = |x: f64, label: &str, delay_ms: u32| CpmEndpointDto { x, y: endpoint_y, label: label.to_string(), delay_ms };
    CpmNetworkDto {
        width: if has_nodes { finish_x + ENDPOINT_SIZE + NET_PAD } else { 0.0 },
        height: if has_nodes { height } else { 0.0 },
        node_width: NODE_WIDTH,
        node_height: NODE_HEIGHT,
        endpoint_size: ENDPOINT_SIZE,
        start: has_nodes.then(|| endpoint(NET_PAD, "Inicio", 60)),
        finish: has_nodes.then(|| endpoint(finish_x, "Fin", 180 + (max_level as u32 + 1) * 90)),
        nodes,
        edges,
    }
}

// ---------------------------------------------------------------------------
// CPM table
// ---------------------------------------------------------------------------

fn table(context: &Context) -> CpmTableDto {
    let plan = context.plan;
    let hours_per_day = hours_label(plan.hours_per_day);
    let path_of_id = context
        .input
        .tasks
        .iter()
        .rev()
        .map(|task| (task.id.as_str(), task.task_path.as_str()))
        .collect::<HashMap<_, _>>();
    let count = context.shown.len();
    let rows = context
        .shown
        .iter()
        .enumerate()
        .map(|(position, &index)| {
            let task = &plan.tasks[index];
            let critical = context.analysis.is_critical(index);
            let dependents = transitive_dependents(plan, index);
            let mut dependency_paths: Vec<String> = Vec::new();
            for id in &task.task.depends_on {
                if let Some(path) = path_of_id.get(id.as_str()) {
                    if *path != task.task.task_path && !dependency_paths.iter().any(|known| known == path) {
                        dependency_paths.push(path.to_string());
                    }
                }
            }
            let cycle_letters = context
                .shown
                .iter()
                .filter(|other| **other != index && dependents.contains(other) && !task.predecessors.contains(other))
                .map(|other| plan.tasks[*other].letter.clone())
                .collect();
            let wait_label = (task.waits() && !task.waits_for.is_empty()).then(|| {
                format!("Espera a {}", task.waits_for.iter().map(|name| first_name(name)).collect::<Vec<_>>().join(", "))
            });
            CpmRowDto {
                task_path: task.task.task_path.clone(),
                letter: task.letter.clone(),
                title: task.task.title.clone(),
                group: task.task.column_name.clone(),
                group_color: task.task.column_color.clone(),
                unestimated_note: task.unestimated.then(|| format!("sin estimar ({hours_per_day} h por defecto)")),
                people: task.task.people.iter().take(MAX_AVATARS).map(|person| context.people.chip(person)).collect(),
                unassigned_label: task.task.people.is_empty().then(|| "Sin asignar".to_string()),
                remaining: hours(task.duration),
                predecessors: task.predecessors.iter().map(|pred| plan.tasks[*pred].letter.clone()).collect(),
                dependency_paths,
                cycle_letters,
                edit_label: format!("Editar predecesoras de {}", task.letter),
                popover_title: format!("{} empieza después de", task.letter),
                popover_label: format!("Predecesoras de {}", task.letter),
                popover_above: position > 3 && position + POPOVER_UP_ROWS >= count,
                start_label: context.start_label(index),
                wait_label,
                end_label: context.end_label(index),
                late_start_label: date_time_label(plan.date_time(context.late_start(index), false)),
                slack_label: hours(context.slack(index)),
                critical,
                route_label: if critical { "Crítica" } else { "Con holgura" }.to_string(),
                delay_ms: position as u32 * 35,
            }
        })
        .collect();
    CpmTableDto {
        description: format!(
            "Fechas calculadas con las horas restantes, la jornada de {hours_per_day} h y una tarea por persona a la vez. Editá las predecesoras para recalcular."
        ),
        cycle_note: "Crearía un ciclo".to_string(),
        candidates: context
            .shown
            .iter()
            .map(|index| {
                let task = &plan.tasks[*index];
                PredecessorCandidateDto {
                    task_path: task.task.task_path.clone(),
                    letter: task.letter.clone(),
                    title: task.task.title.clone(),
                }
            })
            .collect(),
        rows,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::task_board_plan::TaskBoardPlanDto;
    use crate::task_manager_tools::TaskPriority;
    use crate::task_planner::creates_cycle;
    use crate::task_board_plan::TaskColumnKind;
    use crate::task_planner::tests::{after, big_board, input, task, with};
    use std::time::Instant;

    fn view(input: &PlannerInput) -> ManagementViewDto {
        management_view(input, &ManagementRequest::default())
    }

    fn kpi(view: &ManagementViewDto, kind: ManagementKpiKind) -> &ManagementKpiDto {
        view.kpis.iter().find(|kpi| kpi.kind == kind).expect("kpi")
    }

    #[test]
    fn the_request_reads_camel_case_with_defaults() {
        let request: ManagementRequest = serde_json::from_str(r#"{"rangeMode":"sprints"}"#).unwrap();
        assert_eq!(request.division_offset, 0);
        assert_eq!(request.range_mode, ManagementRangeMode::Sprints);
        assert_eq!(request.group_by, ManagementGroupBy::Task);
        let request: ManagementRequest =
            serde_json::from_str(r#"{"divisionOffset":-1,"rangeMode":"division","groupBy":"person"}"#).unwrap();
        assert_eq!((request.division_offset, request.range_mode, request.group_by), (-1, ManagementRangeMode::Division, ManagementGroupBy::Person));
    }

    #[test]
    fn an_empty_board_shows_the_empty_state() {
        let mut note = task("A");
        note.column_kind = TaskColumnKind::Notes;
        let view = view(&input(vec![note]));
        assert!(view.empty);
        assert!(view.kpis.is_empty());
        assert!(view.network.start.is_none());
        assert_eq!(view.gantt.no_rows_label, "No hay tareas planificadas en Q4 2026.");
    }

    #[test]
    fn case_12_auto_range_takes_only_the_sprint_with_tasks() {
        let view = view(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Urgent),
            with(task("B"), 4.0, &["P1"], TaskPriority::Medium),
        ]));
        assert!(!view.range.whole_division);
        assert_eq!(view.range.title, "Sprint 21");
        assert_eq!(view.range.heading, "Gantt · Sprint 21 · Q4 2026");
        assert_eq!(view.range.subtitle, "12 oct – 25 oct · ajustado a los sprints con tareas");
        assert_eq!(view.range.modes[0].label, "Auto · 1 sprint");
        assert!(view.range.modes[0].selected);
        assert_eq!(view.range.days, 14);
        // 1100 / 14 days ≈ 79 px, capped at 64: daily ticks.
        assert_eq!(view.gantt.px_per_day, 64.0);
        assert!(view.gantt.daily);
        assert_eq!(view.gantt.width, 14.0 * 64.0);
        assert_eq!(view.gantt.ticks[0].top, "lun");
        assert_eq!(view.gantt.ticks[0].bottom, "12");
        assert!(view.gantt.ticks[7].today);
        assert!(view.gantt.ticks[5].weekend);
        assert_eq!(view.gantt.sprints[0].label, "Sprint 21 · actual");
        assert_eq!(view.gantt.sprints[0].kind, SprintBandKind::Current);
        assert_eq!(view.gantt.months[0].label, "octubre 2026");
        assert_eq!(view.gantt.now_x, Some(7.0 * 64.0));
        assert_eq!(view.gantt.weekends.len(), 4);
        // A runs 09:00–13:00 of the eighth day.
        let a = &view.gantt.rows[0].bars[0];
        assert_eq!((a.x, a.width), (7.0 * 64.0 + 1.0, (4.0 / 9.0 * 64.0_f64).round() - 2.0));
        assert_eq!(a.label, "A · 4 h");
        assert_eq!(view.gantt.rows[1].sub, "lun 19 oct · 13:00 → lun 19 oct · 17:00");
        assert!(view.gantt.rows[1].bars[0].wait.is_some());
        assert_eq!(view.gantt.rows[1].bars[0].wait.as_ref().unwrap().tooltip, "Espera a P1 (4 h)");
    }

    #[test]
    fn case_12_tasks_over_most_sprints_show_the_whole_division() {
        let mut sprints = input(vec![with(task("A"), 420.0, &[], TaskPriority::Medium)]);
        let view = view(&sprints);
        assert!(view.range.whole_division);
        assert_eq!(view.range.title, "Q4 2026");
        assert_eq!(view.range.heading, "Gantt · Q4 2026");
        assert_eq!(view.range.modes[0].label, "Auto · Q");
        assert_eq!(view.range.subtitle, "1 oct – 31 dic · las tareas ocupan casi todo el Q");
        // 92 days: 12 px per day, raised to 14, weekly ticks.
        assert_eq!(view.gantt.px_per_day, 14.0);
        assert!(!view.gantt.daily);
        assert_eq!(view.gantt.ticks[0].top, "sem");
        assert!(view.gantt.sprints.iter().any(|band| band.label == "Sprint 22 · siguiente" && band.kind == SprintBandKind::Next));
        // Forcing sprints keeps only the sprints with tasks.
        let forced = management_view(
            &sprints,
            &ManagementRequest { range_mode: ManagementRangeMode::Sprints, ..ManagementRequest::default() },
        );
        assert_eq!(forced.range.title, "Sprints 21–26");
        assert_eq!(forced.range.subtitle, "12 oct – 31 dic · solo sprints con tareas");
        assert_eq!(forced.range.modes[0].label, "Auto");
        sprints.tasks[0].estimate_hours = Some(4.0);
        let forced = management_view(
            &sprints,
            &ManagementRequest { range_mode: ManagementRangeMode::Division, ..ManagementRequest::default() },
        );
        assert_eq!(forced.range.subtitle, "1 oct – 31 dic · Q completo");
    }

    #[test]
    fn case_13_the_division_picker_follows_the_board_divisions() {
        let board = input(vec![with(task("A"), 4.0, &[], TaskPriority::Medium)]);
        let quarters = view(&board);
        assert_eq!(quarters.divisions.tabs.len(), 4);
        let q4 = &quarters.divisions.tabs[3];
        assert_eq!((q4.label.as_str(), q4.tooltip.as_str()), ("Q4", "1 oct – 31 dic"));
        assert!(q4.selected && q4.current);
        assert_eq!(quarters.divisions.fiscal_year_label, "2026");
        assert_eq!(quarters.divisions.tabs[0].offset, -3);
        let mut five = board.clone();
        five.plan = TaskBoardPlanDto { divisions_per_year: 5, ..TaskBoardPlanDto::default() };
        let parts = view(&five);
        assert_eq!(parts.divisions.tabs.len(), 5);
        assert_eq!(parts.divisions.tabs[0].tooltip, "1 ene – 14 mar");
        assert_eq!(parts.divisions.tabs[3].tooltip, "8 ago – 19 oct");
        assert_eq!(parts.divisions.tabs[4].tooltip, "20 oct – 31 dic");
        assert!(parts.divisions.tabs[3].current);
    }

    #[test]
    fn the_today_button_shows_away_from_the_current_division() {
        let board = input(vec![with(task("A"), 4.0, &[], TaskPriority::Medium)]);
        assert!(!view(&board).divisions.show_today);
        let next = management_view(&board, &ManagementRequest { division_offset: 1, ..ManagementRequest::default() });
        assert!(next.divisions.show_today);
        assert_eq!(next.divisions.title, "Q1 2027");
        assert_eq!(next.divisions.fiscal_year_label, "2027");
        assert!(next.divisions.tabs[0].selected);
        assert!(next.divisions.tabs.iter().all(|tab| !tab.current));
        assert_eq!(next.divisions.tabs[3].offset, 4);
        assert_eq!((next.divisions.previous_offset, next.divisions.next_offset), (0, 2));
    }

    #[test]
    fn tasks_outside_the_division_are_counted_in_the_footer() {
        let mut later = with(task("B"), 3.0, &[], TaskPriority::Medium);
        later.column_kind = TaskColumnKind::NextDivision;
        let board = input(vec![with(task("A"), 4.0, &[], TaskPriority::Medium), later]);
        let current = view(&board);
        let outside = current.gantt.outside.as_ref().expect("outside");
        assert_eq!(outside.text, "1 tarea está planificada después de Q4.");
        assert_eq!(outside.later_label.as_deref(), Some("Ver Q1 2027 →"));
        assert_eq!(outside.next_offset, 1);
        assert_eq!(current.gantt.rows.len(), 1);
        let next = management_view(&board, &ManagementRequest { division_offset: 1, ..ManagementRequest::default() });
        let outside = next.gantt.outside.as_ref().expect("outside");
        assert_eq!(outside.text, "1 tarea terminó antes.");
        assert!(outside.later_label.is_none());
        assert_eq!(next.gantt.rows[0].letter.as_deref(), Some("B"));
        // 1 January 2027 falls in the last sprint of 2026.
        assert_eq!(next.range.title, "Sprint 26");
        assert_eq!(kpi(&next, ManagementKpiKind::Range).sub, "1 ene – 3 ene · 1 día hábil por delante");
    }

    #[test]
    fn kpis_flag_the_overloaded_team_and_the_busiest_person() {
        let mut tasks = vec![
            with(task("A"), 40.0, &["P1"], TaskPriority::Medium),
            with(task("B"), 4.0, &["P2"], TaskPriority::Medium),
        ];
        tasks.extend((0..6).map(|index| with(task(&format!("U{index}")), 9.0, &[], TaskPriority::Low)));
        let view = view(&input(tasks));
        assert_eq!(view.range.title, "Sprint 21");
        let range = kpi(&view, ManagementKpiKind::Range);
        assert_eq!(range.value, "Sprint 21");
        assert_eq!(range.sub, "12 oct – 25 oct · 5 días hábiles por delante");
        let team = kpi(&view, ManagementKpiKind::TeamLoad);
        assert_eq!(team.value, "98 h / 90 h");
        assert_eq!(team.sub, "109% de 2 personas × 9 h/día · 54 h sin asignar");
        assert_eq!(team.tone, ManagementTone::Coral);
        let busiest = kpi(&view, ManagementKpiKind::MostLoaded);
        assert_eq!(busiest.value, "P1 · 40 h");
        assert_eq!(busiest.sub, "89% de su capacidad en el rango");
        assert_eq!(busiest.tone, ManagementTone::Amber);
        let finish = kpi(&view, ManagementKpiKind::Finish);
        assert_eq!(finish.value, "vie 23 oct");
        assert_eq!(finish.sub, "13:00 · ruta crítica A");
        let light = view_light();
        assert_eq!(kpi(&light, ManagementKpiKind::TeamLoad).tone, ManagementTone::Teal);
        assert_eq!(kpi(&light, ManagementKpiKind::MostLoaded).tone, ManagementTone::Primary);
    }

    fn view_light() -> ManagementViewDto {
        view(&input(vec![with(task("A"), 4.0, &["P1"], TaskPriority::Medium)]))
    }

    #[test]
    fn rows_group_by_person_with_the_unassigned_last() {
        let mut board = input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("B"), 4.0, &["P1", "P2"], TaskPriority::Medium),
            with(task("C"), 2.0, &[], TaskPriority::Medium),
        ]);
        board.viewer = Some("p1".to_string());
        let view = management_view(&board, &ManagementRequest { group_by: ManagementGroupBy::Person, ..ManagementRequest::default() });
        let rows = &view.gantt.rows;
        assert_eq!(rows.iter().map(|row| row.title.as_str()).collect::<Vec<_>>(), ["P1 (vos)", "P2", "Sin asignar"]);
        assert_eq!(rows[0].sub, "2 tareas · 8 h en Q4");
        assert_eq!(rows[0].bars[1].label, "B · Tarea B");
        assert_eq!(rows[0].bars[0].height, 32.0);
        assert!(rows[0].bars[0].slack.is_none());
        assert!(rows[2].unassigned);
        assert_eq!(rows[2].person.as_ref().unwrap().initials, "?");
        assert_eq!(rows[0].person.as_ref().unwrap().color.as_deref(), Some("#4FD1C5"));
        assert_eq!(view.gantt.head_label, "Persona");
        assert_eq!(view.gantt.count_label, "3 filas · 3 tareas");
    }

    #[test]
    fn the_table_offers_predecessors_and_marks_cycles() {
        let mut open = task("D");
        open.estimate_hours = None;
        let board = input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Medium),
            after(with(task("B"), 2.0, &["P2"], TaskPriority::Medium), &["A", "missing"]),
            after(with(task("C"), 2.0, &[], TaskPriority::Medium), &["B"]),
            open,
        ]);
        let view = view(&board);
        let table = &view.table;
        assert_eq!(table.candidates.iter().map(|c| c.letter.as_str()).collect::<Vec<_>>(), ["A", "B", "C", "D"]);
        assert_eq!(table.cycle_note, "Crearía un ciclo");
        let a = &table.rows[0];
        assert_eq!(a.cycle_letters, ["B", "C"]);
        assert!(a.predecessors.is_empty());
        let b = &table.rows[1];
        assert_eq!(b.predecessors, ["A"]);
        assert_eq!(b.dependency_paths, ["Tareas/A.md"]);
        assert_eq!(b.cycle_letters, ["C"]);
        assert_eq!(b.start_label, "lun 19 oct · 13:00");
        assert!(b.wait_label.is_none());
        assert_eq!(b.popover_title, "B empieza después de");
        assert_eq!(b.edit_label, "Editar predecesoras de B");
        // The flags agree with creates_cycle on the saved dependencies.
        let depends_on: HashMap<String, Vec<String>> =
            board.tasks.iter().map(|task| (task.id.clone(), task.depends_on.clone())).collect();
        assert!(creates_cycle(&depends_on, "A", "C") && !creates_cycle(&depends_on, "C", "A"));
        let d = &table.rows[3];
        assert_eq!(d.unestimated_note.as_deref(), Some("sin estimar (9 h por defecto)"));
        assert_eq!(d.remaining, "9 h");
        assert_eq!(d.unassigned_label.as_deref(), Some("Sin asignar"));
        assert!(table.description.contains("la jornada de 9 h"));
        assert_eq!(view.network.nodes.iter().find(|node| node.letter == "D").unwrap().duration, "9");
    }

    #[test]
    fn case_10_the_network_links_tasks_of_the_same_person() {
        let view = view(&input(vec![
            with(task("A"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("B"), 4.0, &["P1"], TaskPriority::Medium),
            with(task("C"), 2.0, &["P2"], TaskPriority::Medium),
        ]));
        assert_eq!(view.critical_path, "A → B");
        let network = &view.network;
        let a = &network.nodes[0];
        let b = &network.nodes[1];
        assert_eq!((a.x, a.level, b.level), (140.0, 0, 1));
        assert_eq!(b.x, 140.0 + 236.0);
        assert_eq!((a.early_start.as_str(), a.early_finish.as_str(), a.slack.as_str()), ("0", "4", "0"));
        let c = &network.nodes[2];
        assert_eq!((c.slack.as_str(), c.late_start.as_str(), c.late_finish.as_str()), ("6", "6", "8"));
        assert!(!c.critical);
        assert_eq!(network.height, 56.0 + 2.0 * 124.0 - 24.0);
        let resource = network.edges.iter().find(|edge| edge.kind == CpmEdgeKind::Resource).expect("resource");
        assert_eq!((resource.from.as_deref(), resource.to.as_deref()), (Some("Tareas/A.md"), Some("Tareas/B.md")));
        assert!(resource.critical);
        assert!(resource.d.starts_with("M324 "));
        assert_eq!(network.start.as_ref().unwrap().label, "Inicio");
        assert_eq!(network.finish.as_ref().unwrap().x, 140.0 + 236.0 + 184.0 + 56.0);
        assert_eq!(view.table.rows[2].slack_label, "6 h");
        assert_eq!(view.table.rows[2].route_label, "Con holgura");
        assert_eq!(view.table.rows[1].wait_label.as_deref(), Some("Espera a P1"));
        let finish = kpi(&view, ManagementKpiKind::Finish);
        assert_eq!((finish.value.as_str(), finish.sub.as_str()), ("lun 19 oct", "17:00 · ruta crítica A → B"));
        let c_bar = &view.gantt.rows.iter().find(|row| row.letter.as_deref() == Some("C")).unwrap().bars[0];
        assert_eq!(c_bar.slack.as_ref().unwrap().tooltip, "Holgura: 6 h");
    }

    #[test]
    fn two_hundred_tasks_build_the_view_fast() {
        let board = big_board();
        let started = Instant::now();
        let view = management_view(&board, &ManagementRequest::default());
        let by_person =
            management_view(&board, &ManagementRequest { group_by: ManagementGroupBy::Person, ..ManagementRequest::default() });
        let elapsed = started.elapsed();
        println!("two management views of 200 tasks: {elapsed:?}");
        assert!(!view.empty);
        assert!(by_person.gantt.rows.len() <= 8);
        assert!(elapsed.as_millis() < 500);
    }
}
