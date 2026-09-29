//! Lo que Salud le pide a la IA: el plan diario y la estimación de una
//! comida. Las respuestas se leen con tolerancia y se validan acá: el piso
//! de calorías nunca queda a criterio del modelo.

use jiff::civil::Date;
use serde_json::{json, Value};

use super::{fmt, Measurement, Nutrition, Plan, PlanSource, Profile, activity_label, Sex};

/// Los datos que recibe la IA para armar el plan.
#[derive(Debug, Clone)]
pub struct PlanContext<'a> {
    pub profile: &'a Profile,
    pub age: Option<i64>,
    pub current_kg: f64,
    pub target_kg: f64,
    pub pace: f64,
    pub bmr: f64,
    pub tdee: f64,
    pub floor: f64,
    pub last_measurement: Option<&'a Measurement>,
}

pub fn plan_prompt(context: &PlanContext<'_>) -> (String, String) {
    let system = "Sos un asistente de nutrición. Respondé solo con un objeto JSON válido, sin texto adicional ni backticks.".to_string();
    let data = json!({
        "sexo": if context.profile.sex == Sex::Female { "femenino" } else { "masculino" },
        "edad": context.age,
        "altura_cm": context.profile.height_cm,
        "peso_actual_kg": context.current_kg,
        "peso_objetivo_kg": context.target_kg,
        "ritmo_deseado_kg_semana": context.pace,
        "nivel_actividad": activity_label(context.profile.activity),
        "metabolismo_basal_kcal": context.bmr.round(),
        "gasto_diario_estimado_kcal": context.tdee.round(),
        "composicion_ultima_medicion": context.last_measurement.map(|measurement| json!({
            "fecha": measurement.date,
            "peso": measurement.weight,
            "valores": measurement.values,
        })),
    });
    let user = format!(
        "Armá un plan diario para esta persona.\n\nDatos:\n{}\n\nReglas:\n- Las calorías diarias no pueden ser menores a {} kcal.\n- El ritmo de cambio de peso no puede superar el 1 % del peso actual por semana.\n- Si el IMC del peso objetivo es menor a 18.5, decilo en \"advertencia\".\n- Proteína entre 1.6 y 2.2 g por kg, fibra de al menos 14 g por cada 1000 kcal.\n\nRespondé con esta forma:\n{{\"kcal\": number, \"proteina_g\": number, \"carbohidratos_g\": number, \"grasas_g\": number, \"fibra_g\": number, \"semanas_estimadas\": number, \"resumen\": \"una oración\", \"recomendaciones\": [\"hasta 4 recomendaciones breves\"], \"advertencia\": \"texto o cadena vacía\"}}",
        serde_json::to_string_pretty(&data).unwrap_or_default(),
        fmt(context.floor, 0)
    );
    (system, user)
}

/// El primer objeto JSON de una respuesta (con o sin backticks alrededor).
pub fn json_object(answer: &str) -> Option<Value> {
    let start = answer.find('{')?;
    let end = answer.rfind('}')?;
    (end > start).then(|| serde_json::from_str::<Value>(&answer[start..=end]).ok()).flatten().filter(Value::is_object)
}

fn number(value: &Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => super::parse_number(text),
        _ => None,
    }
    .filter(|number| number.is_finite() && *number >= 0.0)
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string()
}

/// El plan de la IA, con las calorías subidas al piso si hace falta. `None`
/// si falta algún número.
pub fn parse_plan(answer: &str, floor: f64, today: Date) -> Option<Plan> {
    let value = json_object(answer)?;
    let mut notes = Vec::new();
    let mut kcal = number(&value, "kcal")?.round();
    if kcal < floor {
        notes.push(format!("Las calorías propuestas se subieron a {} kcal, el mínimo para tu metabolismo basal.", fmt(floor, 0)));
        kcal = floor;
    }
    let warning = text(&value, "advertencia");
    if !warning.is_empty() {
        notes.push(warning);
    }
    Some(Plan {
        kcal,
        protein_g: number(&value, "proteina_g")?.round(),
        carbs_g: number(&value, "carbohidratos_g")?.round(),
        fat_g: number(&value, "grasas_g")?.round(),
        fiber_g: number(&value, "fibra_g")?.round(),
        weeks: number(&value, "semanas_estimadas")?.round() as i64,
        summary: text(&value, "resumen"),
        recommendations: value
            .get("recomendaciones")
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::trim).filter(|item| !item.is_empty()).take(4).map(str::to_string).collect())
            .unwrap_or_default(),
        notes,
        source: PlanSource::Ai,
        generated_on: today.to_string(),
        floor,
    })
}

pub fn meal_prompt(description: &str, has_photo: bool) -> (String, String) {
    let system = "Sos un asistente de nutrición. Respondé solo con un objeto JSON válido, sin texto adicional ni backticks.".to_string();
    let photo = if has_photo { "\nLa foto del plato va adjunta: usala para estimar la porción." } else { "" };
    let user = format!(
        "Estimá los valores nutricionales de esta comida, tal como la describe una persona en Argentina: \"{}\".{photo}\nSi no aclara cantidades, asumí una porción habitual.\nRespondé con esta forma:\n{{\"nombre\": \"descripción breve del plato\", \"kcal\": number, \"proteina_g\": number, \"carbohidratos_g\": number, \"grasas_g\": number, \"fibra_g\": number}}",
        description.trim()
    );
    (system, user)
}

/// Lo que comió la persona comparado con una receta: la IA calcula las
/// calorías y los macros de esa cantidad (otro peso, ingredientes distintos
/// o lo que se ve en la foto).
pub fn portion_prompt(recipe: &crate::recipes::Recipe, eaten: &str, has_photo: bool) -> (String, String) {
    let system = "Sos nutricionista. Respondé solo con un objeto JSON válido, sin texto adicional ni backticks.".to_string();
    let serving = super::recipe_serving(recipe);
    let data = json!({
        "receta": recipe.name,
        "porcionesDeLaReceta": recipe.servings,
        "pesoPorPorcionG": recipe.serving_grams,
        "ingredientesDeLaReceta": recipe.ingredients,
        "unaPorcion": {
            "kcal": serving.kcal,
            "proteina_g": serving.protein_g,
            "carbohidratos_g": serving.carbs_g,
            "grasas_g": serving.fat_g,
            "fibra_g": serving.fiber_g,
        },
    });
    let photo = if has_photo { "\nLa foto de lo que comió va adjunta: usala para estimar la cantidad." } else { "" };
    let eaten = if eaten.trim().is_empty() { "lo que se ve en la foto" } else { eaten.trim() };
    let user = format!(
        "La persona comió esta receta, pero no exactamente una porción:\n{}\n\nLo que comió: \"{eaten}\".{photo}\nCalculá las calorías y los macros de lo que comió a partir de los valores de una porción, ajustando por la cantidad y por los ingredientes que cambien. Si no hay datos para ajustar, es una porción.\nRespondé con esta forma:\n{{\"porciones\": number, \"kcal\": number, \"proteina_g\": number, \"carbohidratos_g\": number, \"grasas_g\": number, \"fibra_g\": number}}",
        serde_json::to_string_pretty(&data).unwrap_or_default()
    );
    (system, user)
}

/// Los valores de lo que comió según la IA. Sin macros, salen de las
/// porciones que dio; con porciones fuera de 0,05 a 20, `None`.
pub fn parse_portion(answer: &str, serving: Nutrition) -> Option<Nutrition> {
    let value = json_object(answer)?;
    let servings = number(&value, "porciones").filter(|servings| (0.05..=20.0).contains(servings));
    let macros = (|| {
        Some(Nutrition {
            kcal: number(&value, "kcal")?.round(),
            protein_g: super::round1(number(&value, "proteina_g")?),
            carbs_g: super::round1(number(&value, "carbohidratos_g")?),
            fat_g: super::round1(number(&value, "grasas_g")?),
            fiber_g: super::round1(number(&value, "fibra_g").unwrap_or_default()),
        })
    })()
    .filter(|nutrition| nutrition.kcal > 0.0);
    match (macros, servings) {
        (Some(nutrition), _) => Some(nutrition),
        (None, Some(servings)) => Some(super::scale(serving, servings)),
        (None, None) => None,
    }
}

/// La estimación de la IA y, si la dio, un nombre para el plato.
pub fn parse_meal(answer: &str) -> Option<(Nutrition, String)> {
    let value = json_object(answer)?;
    let round1 = super::round1;
    let nutrition = Nutrition {
        kcal: number(&value, "kcal")?.round(),
        protein_g: round1(number(&value, "proteina_g")?),
        carbs_g: round1(number(&value, "carbohidratos_g")?),
        fat_g: round1(number(&value, "grasas_g")?),
        fiber_g: round1(number(&value, "fibra_g").unwrap_or_default()),
    };
    (nutrition.kcal > 0.0).then(|| (nutrition, text(&value, "nombre")))
}
