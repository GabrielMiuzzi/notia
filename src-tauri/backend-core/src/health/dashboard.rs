//! El tablero de Salud listo para mostrar: textos, barras, el gráfico de peso
//! y los datos de los formularios. React no calcula nada.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use super::reference::{bmi_range, bmi_state, range_for, state, Range, Tone};
use super::{
    active_plan, activity_label, day_label, day_month, days_ago, fmt, long_date, meals_of, parse_date, shift_days, short_date,
    signed, total, vitals, weekday_narrow, HealthData, MacroKey, MealCategory, MetricGroup, Plan, PlanSource, Sex, Vitals,
    ACTIVITIES, METRICS, PACES,
};

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeightRange {
    #[serde(rename = "30")]
    Days30,
    #[default]
    #[serde(rename = "90")]
    Days90,
    #[serde(rename = "365")]
    Year,
    #[serde(rename = "all")]
    All,
}

impl WeightRange {
    const ALL: [Self; 4] = [Self::Days30, Self::Days90, Self::Year, Self::All];

    fn id(self) -> &'static str {
        match self {
            Self::Days30 => "30",
            Self::Days90 => "90",
            Self::Year => "365",
            Self::All => "all",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Days30 => "30 días",
            Self::Days90 => "90 días",
            Self::Year => "1 año",
            Self::All => "Todo",
        }
    }

    fn days(self) -> Option<i64> {
        match self {
            Self::Days30 => Some(30),
            Self::Days90 => Some(90),
            Self::Year => Some(365),
            Self::All => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQuery {
    /// Día de la alimentación; hoy si falta.
    pub food_date: Option<String>,
    #[serde(default)]
    pub weight_range: WeightRange,
    /// Medición elegida; la última si falta.
    pub measurement_date: Option<String>,
}

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateChip {
    pub label: String,
    pub tone: Tone,
}

fn chip(label: &str, tone: Tone) -> StateChip {
    StateChip { label: label.to_string(), tone }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarSegment {
    pub label: String,
    pub tone: Tone,
    /// Ancho relativo del tramo.
    pub flex: f64,
    pub active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkerKind {
    Value,
    Goal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarMarker {
    /// 0 a 100.
    pub position: f64,
    pub kind: MarkerKind,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarTick {
    pub position: f64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeBar {
    pub segments: Vec<BarSegment>,
    pub markers: Vec<BarMarker>,
    pub ticks: Vec<BarTick>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub chips: Vec<String>,
    pub bmi: Option<StateChip>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalLegend {
    pub label: String,
    pub state: Option<StateChip>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BmiPanel {
    pub value_label: String,
    pub state: StateChip,
    pub message: String,
    pub bar: RangeBar,
    pub today_label: String,
    pub goal: Option<GoalLegend>,
    pub healthy_range_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub value: String,
    pub label: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartPoint {
    /// 0 (izquierda) a 1.
    pub x: f64,
    /// 0 (abajo) a 1.
    pub y: f64,
    pub label: String,
    pub value_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartTick {
    pub at: f64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightChart {
    pub points: Vec<ChartPoint>,
    pub y_ticks: Vec<ChartTick>,
    pub x_ticks: Vec<ChartTick>,
    pub goal: Option<ChartTick>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightRow {
    pub date: String,
    pub date_label: String,
    pub kg_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightPanel {
    pub current_label: String,
    pub summary: String,
    pub ranges: Vec<Choice>,
    pub chart: Option<WeightChart>,
    pub empty_text: String,
    pub entries: Vec<WeightRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanView {
    pub kcal_label: String,
    pub source_label: String,
    pub weeks_label: Option<String>,
    pub summary: String,
    pub notes: Vec<String>,
    pub recommendations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectivePanel {
    pub target_kg: Option<f64>,
    pub pace: f64,
    pub paces: Vec<Choice>,
    pub difference_label: Option<String>,
    pub target_bmi_label: Option<String>,
    pub target_state: Option<StateChip>,
    pub low_bmi_warning: bool,
    pub can_plan: bool,
    pub plan: Option<PlanView>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatRow {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroIndicator {
    pub key: String,
    pub label: String,
    pub value_label: String,
    pub target_label: String,
    pub percent_label: String,
    /// 0 a 100.
    pub progress: f64,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroPill {
    pub key: String,
    pub short: String,
    pub label: String,
    pub value_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MealRow {
    pub id: String,
    pub name: String,
    pub kcal_label: String,
    pub pills: Vec<MacroPill>,
    /// Los valores guardados, para editarla.
    pub values: RecentMeal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MealGroup {
    pub id: String,
    pub label: String,
    pub kcal_label: Option<String>,
    pub meals: Vec<MealRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoodPanel {
    pub date: String,
    pub day_label: String,
    pub previous_date: String,
    pub next_date: Option<String>,
    pub total_label: String,
    pub target_label: String,
    pub progress: f64,
    pub over: bool,
    pub remaining_label: String,
    pub stats: Vec<StatRow>,
    pub footnote: String,
    pub macros: Vec<MacroIndicator>,
    pub groups: Vec<MealGroup>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterDay {
    pub date: String,
    pub day_label: String,
    pub fill: f64,
    pub met: bool,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterPanel {
    pub ml: i64,
    /// 0 a 1.
    pub ratio: f64,
    pub percent_label: String,
    pub liters_label: String,
    pub goal_label: String,
    pub basis_label: String,
    pub aria_label: String,
    pub week: Vec<WaterDay>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyPart {
    pub key: String,
    pub label: String,
    pub detail: String,
    /// 0 a 100.
    pub share: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    pub key: String,
    pub label: String,
    pub value_label: String,
    pub unit: Option<String>,
    pub delta_label: Option<String>,
    pub bar: Option<RangeBar>,
    pub state: Option<StateChip>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricGroupView {
    pub id: String,
    pub title: String,
    pub metrics: Vec<MetricRow>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositionPanel {
    pub date: String,
    pub subtitle: String,
    pub dates: Vec<Choice>,
    pub strip_title: String,
    pub parts: Vec<BodyPart>,
    pub groups: Vec<MetricGroupView>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileForm {
    pub birth_date: String,
    pub sex: String,
    pub height_cm: Option<f64>,
    pub activity: f64,
    pub weight_kg: Option<f64>,
    pub activities: Vec<Choice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentMeal {
    pub category: String,
    pub name: String,
    pub kcal: f64,
    pub protein_g: f64,
    pub carbs_g: f64,
    pub fat_g: f64,
    pub fiber_g: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MealForm {
    pub suggested_category: String,
    pub categories: Vec<Choice>,
    /// Hasta 5 por categoría, las más recientes sin repetir.
    pub recent: Vec<RecentMeal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementField {
    pub key: String,
    pub label: String,
    pub unit: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementFieldGroup {
    pub id: String,
    pub title: String,
    pub fields: Vec<MeasurementField>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDashboard {
    pub today: String,
    pub has_profile: bool,
    pub header: Header,
    pub bmi: Option<BmiPanel>,
    pub weight: WeightPanel,
    pub objective: ObjectivePanel,
    pub food: Option<FoodPanel>,
    pub water: Option<WaterPanel>,
    pub composition: Option<CompositionPanel>,
    pub profile_form: ProfileForm,
    pub meal_form: MealForm,
    pub measurement_fields: Vec<MeasurementFieldGroup>,
}

// ---------------------------------------------------------------------------
// Armado
// ---------------------------------------------------------------------------

pub fn build_dashboard(data: &HealthData, query: &DashboardQuery, today: Date, hour: u32) -> HealthDashboard {
    let vitals = vitals(data, today);
    let sex = data.profile.as_ref().map(|profile| profile.sex).unwrap_or(Sex::Male);
    HealthDashboard {
        today: today.to_string(),
        has_profile: data.profile.is_some(),
        header: header(data, &vitals),
        bmi: bmi_panel(data, &vitals),
        weight: weight_panel(data, &vitals, query.weight_range, today),
        objective: objective_panel(data, &vitals),
        food: food_panel(data, &vitals, query.food_date.as_deref(), today),
        water: water_panel(data, &vitals, today),
        composition: composition_panel(data, &vitals, sex, query.measurement_date.as_deref()),
        profile_form: profile_form(data, &vitals),
        meal_form: meal_form(data, hour),
        measurement_fields: measurement_fields(),
    }
}

fn header(data: &HealthData, vitals: &Vitals) -> Header {
    let Some(profile) = &data.profile else {
        return Header { chips: Vec::new(), bmi: None };
    };
    let mut chips = Vec::new();
    if let Some(age) = vitals.age {
        chips.push(format!("{age} años"));
    }
    chips.push(format!("{} cm", fmt(profile.height_cm, 0)));
    if let Some(kg) = vitals.current_kg {
        chips.push(format!("{} kg", fmt(kg, 1)));
    }
    let bmi = vitals.bmi.map(|bmi| {
        let (label, tone) = bmi_state(bmi);
        chip(&format!("IMC {}, {}", fmt(bmi, 1), label.to_lowercase()), tone)
    });
    Header { chips, bmi }
}

/// La barra de un rango con la posición del valor y otras marcas.
pub fn range_bar(range: &Range, value: Option<f64>, goal: Option<f64>, ticks: bool) -> RangeBar {
    let position = |x: f64| (((x - range.min) / (range.max - range.min)) * 100.0).clamp(0.0, 100.0);
    let mut pieces = Vec::new();
    let mut from = range.min;
    for segment in &range.segments {
        let to = segment.until.min(range.max);
        if to > from {
            pieces.push((segment, from, to));
        }
        from = from.max(to);
        if from >= range.max {
            break;
        }
    }
    let active = value.map(|value| pieces.iter().position(|(_, _, to)| value < *to).unwrap_or(pieces.len().saturating_sub(1)));
    let segments = pieces
        .iter()
        .enumerate()
        .map(|(index, (segment, from, to))| BarSegment {
            label: segment.label.to_string(),
            tone: segment.tone,
            flex: to - from,
            active: active == Some(index),
        })
        .collect();
    let mut markers = Vec::new();
    if let Some(goal) = goal {
        markers.push(BarMarker { position: position(goal), kind: MarkerKind::Goal });
    }
    if let Some(value) = value {
        markers.push(BarMarker { position: position(value), kind: MarkerKind::Value });
    }
    let ticks = if ticks {
        pieces[..pieces.len().saturating_sub(1)]
            .iter()
            .map(|(_, _, to)| BarTick { position: position(*to), label: fmt(*to, 1) })
            .collect()
    } else {
        Vec::new()
    };
    RangeBar { segments, markers, ticks }
}

fn bmi_panel(data: &HealthData, vitals: &Vitals) -> Option<BmiPanel> {
    let profile = data.profile.as_ref()?;
    let bmi = vitals.bmi?;
    let current = vitals.current_kg?;
    let (label, tone) = bmi_state(bmi);
    let squared = (profile.height_cm / 100.0).powi(2);
    let healthy_min = 18.5 * squared;
    let healthy_max = 24.9 * squared;
    let message = if current > healthy_max {
        format!("Estás {} kg por encima del rango normal para tu altura.", fmt(current - healthy_max, 1))
    } else if current < healthy_min {
        format!("Te faltan {} kg para entrar en el rango normal para tu altura.", fmt(healthy_min - current, 1))
    } else {
        "Estás dentro del rango normal para tu altura.".to_string()
    };
    let goal_bmi = data.objective.target_kg.and_then(|target| super::bmi(target, profile.height_cm));
    Some(BmiPanel {
        value_label: fmt(bmi, 1),
        state: chip(label, tone),
        message,
        bar: range_bar(&bmi_range(), Some(bmi), goal_bmi, true),
        today_label: format!("Hoy {}", fmt(bmi, 1)),
        goal: goal_bmi.map(|goal| {
            let (label, tone) = bmi_state(goal);
            GoalLegend { label: format!("Con tu objetivo {}", fmt(goal, 1)), state: Some(chip(label, tone)) }
        }),
        healthy_range_label: format!("Peso normal para tu altura: {} a {} kg", fmt(healthy_min, 1), fmt(healthy_max, 1)),
    })
}

/// Un paso «redondo» para el eje, con hasta 6 marcas.
fn axis_step(span: f64) -> f64 {
    [1.0, 2.0, 5.0, 10.0, 20.0, 25.0, 50.0, 100.0].into_iter().find(|step| span / step <= 6.0).unwrap_or(100.0)
}

fn weight_chart(points: &[(Date, f64)], goal: Option<f64>) -> Option<WeightChart> {
    if points.len() < 2 {
        return None;
    }
    let values = points.iter().map(|(_, kg)| *kg).chain(goal);
    let (low, high) = values.fold((f64::MAX, f64::MIN), |(low, high), kg| (low.min(kg), high.max(kg)));
    let (y_min, y_max) = ((low - 1.0).floor(), (high + 1.0).ceil());
    let span = (y_max - y_min).max(1.0);
    let y = |kg: f64| (kg - y_min) / span;
    let last = (points.len() - 1) as f64;
    let step = axis_step(span);
    let mut y_ticks = Vec::new();
    let mut tick = (y_min / step).ceil() * step;
    while tick <= y_max + 1e-9 {
        y_ticks.push(ChartTick { at: y(tick), label: fmt(tick, 1) });
        tick += step;
    }
    let tick_count = points.len().min(6);
    let mut x_ticks = Vec::new();
    for index in 0..tick_count {
        let point = if tick_count == 1 { 0 } else { (index as f64 * last / (tick_count - 1) as f64).round() as usize };
        x_ticks.push(ChartTick { at: point as f64 / last, label: day_month(points[point].0) });
    }
    x_ticks.dedup_by(|a, b| a.at == b.at);
    Some(WeightChart {
        points: points
            .iter()
            .enumerate()
            .map(|(index, (date, kg))| ChartPoint {
                x: index as f64 / last,
                y: y(*kg),
                label: short_date(*date),
                value_label: format!("{} kg", fmt(*kg, 1)),
            })
            .collect(),
        y_ticks,
        x_ticks,
        goal: goal.map(|goal| ChartTick { at: y(goal), label: format!("Objetivo {} kg", fmt(goal, 1)) }),
    })
}

fn weight_panel(data: &HealthData, vitals: &Vitals, range: WeightRange, today: Date) -> WeightPanel {
    let from = range.days().map(|days| days_ago(today, days));
    let series = data
        .weights
        .iter()
        .filter_map(|entry| parse_date(&entry.date).map(|date| (date, entry.kg)))
        .filter(|(date, _)| from.map_or(true, |from| *date >= from))
        .collect::<Vec<_>>();
    let mut summary = Vec::new();
    if series.len() > 1 {
        let change = series[series.len() - 1].1 - series[0].1;
        summary.push(format!("{} kg en el período.", signed(change, 1)));
    }
    if let (Some(target), Some(current)) = (data.objective.target_kg, vitals.current_kg) {
        let missing = current - target;
        if missing.abs() >= 0.1 {
            summary.push(format!("Te faltan {} kg para tu objetivo.", fmt(missing.abs(), 1)));
        }
    }
    WeightPanel {
        current_label: vitals.current_kg.map(|kg| fmt(kg, 1)).unwrap_or_else(|| "—".to_string()),
        summary: summary.join(" "),
        ranges: WeightRange::ALL
            .iter()
            .map(|option| Choice { value: option.id().to_string(), label: option.label().to_string(), selected: *option == range })
            .collect(),
        chart: weight_chart(&series, data.objective.target_kg),
        empty_text: "Cargá al menos dos pesos para ver tu evolución.".to_string(),
        entries: data
            .weights
            .iter()
            .rev()
            .map(|entry| WeightRow {
                date: entry.date.clone(),
                date_label: parse_date(&entry.date).map(short_date).unwrap_or_else(|| entry.date.clone()),
                kg_label: format!("{} kg", fmt(entry.kg, 1)),
            })
            .collect(),
    }
}

fn plan_view(plan: &Plan) -> PlanView {
    PlanView {
        kcal_label: fmt(plan.kcal, 0),
        source_label: match plan.source {
            PlanSource::Ai => "Plan con IA",
            PlanSource::Calculated => "Plan calculado",
        }
        .to_string(),
        weeks_label: (plan.weeks > 0).then(|| format!("Tiempo estimado: {} semanas.", plan.weeks)),
        summary: plan.summary.clone(),
        notes: plan.notes.clone(),
        recommendations: plan.recommendations.clone(),
    }
}

fn objective_panel(data: &HealthData, vitals: &Vitals) -> ObjectivePanel {
    let target = data.objective.target_kg;
    let target_bmi = target.zip(data.profile.as_ref()).and_then(|(target, profile)| super::bmi(target, profile.height_cm));
    ObjectivePanel {
        target_kg: target,
        pace: data.objective.pace,
        paces: PACES
            .iter()
            .map(|pace| Choice {
                value: pace.to_string(),
                label: format!("{} kg", fmt(*pace, 2)),
                selected: (pace - data.objective.pace).abs() < 1e-6,
            })
            .collect(),
        difference_label: target.zip(vitals.current_kg).map(|(target, current)| format!("{} kg", signed(target - current, 1))),
        target_bmi_label: target_bmi.map(|bmi| fmt(bmi, 1)),
        target_state: target_bmi.map(|bmi| {
            let (label, tone) = bmi_state(bmi);
            chip(label, tone)
        }),
        low_bmi_warning: target_bmi.is_some_and(|bmi| bmi < 18.5),
        can_plan: target.is_some() && vitals.tdee.is_some(),
        plan: data.plan.as_ref().map(plan_view),
    }
}

fn macro_indicator(key: MacroKey, value: f64, target: f64) -> MacroIndicator {
    let percent = if target > 0.0 { value / target * 100.0 } else { 0.0 };
    let rest = target - value;
    MacroIndicator {
        key: key.id().to_string(),
        label: key.label().to_string(),
        value_label: fmt(value, 0),
        target_label: format!("/ {} g", fmt(target, 0)),
        percent_label: format!("{} %", fmt(percent, 0)),
        progress: percent.min(100.0),
        status: if rest >= 0.5 {
            format!("Faltan {} g", fmt(rest, 0))
        } else if rest <= -0.5 {
            format!("{} g por encima", fmt(-rest, 0))
        } else {
            "Objetivo cumplido".to_string()
        },
    }
}

fn pills(nutrition: &super::Nutrition) -> Vec<MacroPill> {
    MacroKey::ALL
        .iter()
        .map(|key| MacroPill {
            key: key.id().to_string(),
            short: key.short().to_string(),
            label: key.label().to_string(),
            value_label: format!("{} g", fmt(nutrition.get(*key), 1)),
        })
        .collect()
}

fn food_panel(data: &HealthData, vitals: &Vitals, date: Option<&str>, today: Date) -> Option<FoodPanel> {
    let plan = active_plan(data, vitals)?;
    let date = date.and_then(parse_date).filter(|date| *date <= today).unwrap_or(today);
    let key = date.to_string();
    let meals = meals_of(data, &key);
    let sum = total(&meals);
    let over = sum.kcal > plan.kcal;
    let footnote = format!(
        "{}{}",
        if vitals.bmr_from_scale {
            "Metabolismo basal tomado de tu balanza."
        } else {
            "Metabolismo basal estimado con la fórmula de Mifflin-St Jeor."
        },
        if data.plan.is_none() { " Sin plan activo: los objetivos son de mantenimiento." } else { "" }
    );
    Some(FoodPanel {
        date: key,
        day_label: day_label(date, today),
        previous_date: shift_days(date, -1).to_string(),
        next_date: (date < today).then(|| shift_days(date, 1).to_string()),
        total_label: fmt(sum.kcal, 0),
        target_label: format!("de {} kcal", fmt(plan.kcal, 0)),
        progress: if plan.kcal > 0.0 { (sum.kcal / plan.kcal * 100.0).min(100.0) } else { 0.0 },
        over,
        remaining_label: if over {
            format!("{} kcal por encima del objetivo", fmt(sum.kcal - plan.kcal, 0))
        } else {
            format!("Quedan {} kcal", fmt(plan.kcal - sum.kcal, 0))
        },
        stats: vec![
            StatRow { label: "Gasto diario estimado".into(), value: format!("{} kcal", fmt(vitals.tdee.unwrap_or_default(), 0)) },
            StatRow { label: "Objetivo del día".into(), value: format!("{} kcal", fmt(plan.kcal, 0)) },
            StatRow { label: "Metabolismo basal".into(), value: format!("{} kcal", fmt(vitals.bmr.unwrap_or_default(), 0)) },
        ],
        footnote,
        macros: MacroKey::ALL.iter().map(|key| macro_indicator(*key, sum.get(*key), key.of_plan(plan))).collect(),
        groups: MealCategory::ALL
            .iter()
            .map(|category| {
                let items = meals.iter().filter(|meal| meal.category == *category).collect::<Vec<_>>();
                let subtotal = items.iter().map(|meal| meal.nutrition.kcal).sum::<f64>();
                MealGroup {
                    id: category.id().to_string(),
                    label: category.label().to_string(),
                    kcal_label: (!items.is_empty()).then(|| format!("{} kcal", fmt(subtotal, 0))),
                    meals: items
                        .iter()
                        .map(|meal| MealRow {
                            id: meal.id.clone(),
                            name: meal.name.clone(),
                            kcal_label: format!("{} kcal", fmt(meal.nutrition.kcal, 0)),
                            pills: pills(&meal.nutrition),
                            values: recent_meal(meal),
                        })
                        .collect(),
                }
            })
            .collect(),
    })
}

fn liters(ml: i64) -> String {
    format!("{} L", fmt(ml as f64 / 1000.0, 2))
}

fn water_panel(data: &HealthData, vitals: &Vitals, today: Date) -> Option<WaterPanel> {
    data.profile.as_ref()?;
    let goal = vitals.water_goal_ml.unwrap_or(2500).max(1);
    let ml = data.water.get(&today.to_string()).copied().unwrap_or_default();
    let ratio = (ml as f64 / goal as f64).min(1.0);
    Some(WaterPanel {
        ml,
        ratio,
        percent_label: format!("{}%", (ratio * 100.0).round()),
        liters_label: liters(ml),
        goal_label: format!("de {}", liters(goal)),
        basis_label: "Según tu altura y peso".to_string(),
        aria_label: format!("{ml} de {goal} ml"),
        week: (0..7)
            .rev()
            .map(|back| {
                let date = days_ago(today, back);
                let ml = data.water.get(&date.to_string()).copied().unwrap_or_default();
                WaterDay {
                    date: date.to_string(),
                    day_label: weekday_narrow(date).to_string(),
                    fill: (ml as f64 / goal as f64 * 100.0).min(100.0),
                    met: ml >= goal,
                    title: liters(ml),
                }
            })
            .collect(),
    })
}

fn composition_panel(data: &HealthData, vitals: &Vitals, sex: Sex, selected: Option<&str>) -> Option<CompositionPanel> {
    let measurements = &data.measurements;
    let index = selected
        .and_then(|date| measurements.iter().position(|measurement| measurement.date == date))
        .or(measurements.len().checked_sub(1))?;
    let measurement = &measurements[index];
    let previous = index.checked_sub(1).map(|previous| &measurements[previous]);
    let date = parse_date(&measurement.date);

    let mut parts = [("fat", "Grasa", "grasaKg"), ("muscle", "Músculo", "musculoKg"), ("bone", "Huesos", "huesosKg")]
        .iter()
        .filter_map(|(key, label, metric)| measurement.value(metric).map(|kg| (*key, *label, kg)))
        .collect::<Vec<_>>();
    let known = parts.iter().map(|(_, _, kg)| kg).sum::<f64>();
    if measurement.weight - known > 0.2 {
        parts.push(("other", "Otros", super::round1(measurement.weight - known)));
    }
    let total = parts.iter().map(|(_, _, kg)| kg).sum::<f64>().max(f64::MIN_POSITIVE);

    let groups = MetricGroup::ALL
        .iter()
        .map(|group| MetricGroupView {
            id: group.id().to_string(),
            title: group.title().to_string(),
            metrics: METRICS
                .iter()
                .filter(|metric| metric.group == *group)
                .map(|metric| {
                    let value = measurement.value(metric.key);
                    let delta = value.zip(previous.and_then(|previous| previous.value(metric.key))).map(|(now, before)| now - before);
                    MetricRow {
                        key: metric.key.to_string(),
                        label: metric.label.to_string(),
                        value_label: value.map(|value| fmt(value, metric.decimals)).unwrap_or_else(|| "—".to_string()),
                        unit: value.filter(|_| !metric.unit.is_empty()).map(|_| metric.unit.to_string()),
                        delta_label: delta.filter(|delta| delta.abs() > 0.001).map(|delta| signed(delta, metric.decimals)),
                        bar: value.and_then(|value| range_for(metric.key, sex).map(|range| range_bar(&range, Some(value), None, false))),
                        state: value.and_then(|value| state(metric.key, value, sex, vitals.age)).map(|(label, tone)| chip(label, tone)),
                    }
                })
                .collect(),
        })
        .collect();

    Some(CompositionPanel {
        date: measurement.date.clone(),
        subtitle: format!(
            "Medición del {}{}",
            date.map(long_date).unwrap_or_else(|| measurement.date.clone()),
            if previous.is_some() { ", comparada con la anterior" } else { "" }
        ),
        dates: measurements
            .iter()
            .rev()
            .map(|item| Choice {
                value: item.date.clone(),
                label: parse_date(&item.date).map(short_date).unwrap_or_else(|| item.date.clone()),
                selected: item.date == measurement.date,
            })
            .collect(),
        strip_title: format!("Tu peso de {} kg se reparte así", fmt(measurement.weight, 1)),
        parts: parts
            .iter()
            .map(|(key, label, kg)| BodyPart {
                key: key.to_string(),
                label: label.to_string(),
                detail: format!("{} kg ({} %)", fmt(*kg, 1), fmt(kg / total * 100.0, 0)),
                share: kg / total * 100.0,
            })
            .collect(),
        groups,
    })
}

fn profile_form(data: &HealthData, vitals: &Vitals) -> ProfileForm {
    let profile = data.profile.as_ref();
    let activity = profile.map(|profile| profile.activity).unwrap_or(super::DEFAULT_ACTIVITY);
    ProfileForm {
        birth_date: profile.map(|profile| profile.birth_date.clone()).unwrap_or_default(),
        sex: profile.map(|profile| profile.sex.id()).unwrap_or("M").to_string(),
        height_cm: profile.map(|profile| profile.height_cm),
        activity,
        weight_kg: vitals.current_kg,
        activities: ACTIVITIES
            .iter()
            .map(|(value, label)| Choice { value: value.to_string(), label: label.to_string(), selected: activity_label(activity) == Some(label) })
            .collect(),
    }
}

fn recent_meal(meal: &super::Meal) -> RecentMeal {
    RecentMeal {
        category: meal.category.id().to_string(),
        name: meal.name.clone(),
        kcal: meal.nutrition.kcal,
        protein_g: meal.nutrition.protein_g,
        carbs_g: meal.nutrition.carbs_g,
        fat_g: meal.nutrition.fat_g,
        fiber_g: meal.nutrition.fiber_g,
    }
}

fn meal_form(data: &HealthData, hour: u32) -> MealForm {
    let suggested = MealCategory::for_hour(hour);
    let mut meals = data.meals.iter().collect::<Vec<_>>();
    meals.sort_by(|a, b| b.date.cmp(&a.date).then(b.created_at_ms.cmp(&a.created_at_ms)));
    let mut seen = std::collections::HashSet::new();
    let mut per_category = std::collections::HashMap::<MealCategory, usize>::new();
    let mut recent = Vec::new();
    for meal in meals {
        let key = (meal.category, super::fold(&meal.name));
        let count = per_category.entry(meal.category).or_default();
        if *count >= 5 || !seen.insert(key) {
            continue;
        }
        *count += 1;
        recent.push(recent_meal(meal));
    }
    MealForm {
        suggested_category: suggested.id().to_string(),
        categories: MealCategory::ALL
            .iter()
            .map(|category| Choice { value: category.id().to_string(), label: category.label().to_string(), selected: *category == suggested })
            .collect(),
        recent,
    }
}

fn measurement_fields() -> Vec<MeasurementFieldGroup> {
    MetricGroup::ALL
        .iter()
        .map(|group| MeasurementFieldGroup {
            id: group.id().to_string(),
            title: group.title().to_string(),
            fields: METRICS
                .iter()
                .filter(|metric| metric.group == *group)
                .map(|metric| MeasurementField { key: metric.key.to_string(), label: metric.label.to_string(), unit: metric.unit.to_string() })
                .collect(),
        })
        .collect()
}
