//! The recipes dashboard, computed whole here: the grid with its filters,
//! search and order, and the detail of a recipe with its energy, macros,
//! vitamins and minerals as percentages of the daily values.

use serde::{Deserialize, Serialize};

use super::{fold, format_number, MealTime, NutrientGroup, Recipe, RecipeInput, NUTRIENTS, REFERENCE_KCAL};

/// A limited nutrient (sodium) from this share of its limit is high.
const HIGH_LIMIT_PERCENT: u32 = 25;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecipeSort {
    #[default]
    Recent,
    Kcal,
    Protein,
    Name,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeQuery {
    #[serde(default)]
    pub meal: Option<MealTime>,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub sort: RecipeSort,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacroShare {
    pub key: String,
    pub label: String,
    pub initial: String,
    pub grams_label: String,
    /// Share of the calories, 0 to 100.
    pub percent: f64,
    pub percent_label: String,
    /// «24% kcal», the share as the phone layout shows it.
    pub short_percent_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeCard {
    pub id: String,
    pub name: String,
    pub meal: MealTime,
    pub meal_label: String,
    pub kcal_label: String,
    pub minutes_label: Option<String>,
    pub macros: Vec<MacroShare>,
    pub has_photo: bool,
    /// Changes when the recipe changes, so the interface reloads its photo.
    pub photo_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MealFilter {
    pub meal: Option<MealTime>,
    pub label: String,
    pub selected: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmptyState {
    pub title: String,
    pub text: String,
    /// `new` or `clear`.
    pub action: String,
    pub action_label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeGrid {
    pub total: usize,
    pub count_label: String,
    /// «8 recetas», the count as the phone layout shows it.
    pub short_count_label: String,
    pub filters: Vec<MealFilter>,
    pub sort: RecipeSort,
    pub cards: Vec<RecipeCard>,
    pub empty: Option<EmptyState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NutrientTone {
    Normal,
    /// At or above the daily value.
    Over,
    /// A limited nutrient at a high share of its limit.
    Limit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NutrientRow {
    pub key: String,
    pub label: String,
    pub amount_label: String,
    /// Bar length, 0 to 100.
    pub bar: u32,
    pub percent_label: String,
    pub tone: NutrientTone,
    pub limit: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeDetail {
    pub id: String,
    pub name: String,
    pub meal: MealTime,
    pub meal_label: String,
    pub description: String,
    pub minutes_label: Option<String>,
    pub servings_label: Option<String>,
    pub has_photo: bool,
    pub photo_key: String,
    pub kcal_label: String,
    pub kcal_share_label: String,
    pub macros: Vec<MacroShare>,
    pub fiber_label: String,
    /// The fiber split for the phone layout: «10 g» and «36% VD».
    pub fiber_amount_label: String,
    pub fiber_daily_label: String,
    pub sugar_label: String,
    pub vitamins: Vec<NutrientRow>,
    pub minerals: Vec<NutrientRow>,
    pub ingredients: Vec<String>,
    pub steps: Vec<String>,
    pub ai_reviewed: bool,
    pub path: String,
    /// The recipe as the form edits it.
    pub form: RecipeInput,
}

fn photo_key(recipe: &Recipe) -> String {
    format!("{}-{}", recipe.id, recipe.updated_at_ms)
}

/// The calorie shares of protein, carbohydrates and fat.
fn macro_shares(recipe: &Recipe) -> Vec<MacroShare> {
    let parts = [("prot", "Proteína", 4.0), ("carb", "Carbohidratos", 4.0), ("grasa", "Grasas", 9.0)];
    let energy = parts.iter().map(|(key, _, factor)| recipe.value(key) * factor).collect::<Vec<_>>();
    let total = energy.iter().sum::<f64>();
    parts
        .iter()
        .zip(energy)
        .map(|((key, label, _), part)| {
            let percent = if total > 0.0 { (part / total * 1000.0).round() / 10.0 } else { 0.0 };
            MacroShare {
                key: key.to_string(),
                label: label.to_string(),
                initial: label.chars().next().map(String::from).unwrap_or_default(),
                grams_label: format!("{} g", format_number(recipe.value(key))),
                percent,
                percent_label: format!("{}% de las calorías", percent.round()),
                short_percent_label: format!("{}% kcal", percent.round()),
            }
        })
        .collect()
}

fn matches_query(recipe: &Recipe, query: &str) -> bool {
    let query = fold(query.trim());
    query.is_empty() || fold(&recipe.name).contains(&query) || recipe.ingredients.iter().any(|ingredient| fold(ingredient).contains(&query))
}

fn count_label(total: usize) -> String {
    format!("{} en tu recetario", short_count_label(total))
}

fn short_count_label(total: usize) -> String {
    if total == 1 {
        "1 receta".to_string()
    } else {
        format!("{total} recetas")
    }
}

pub fn build_grid(recipes: &[Recipe], query: &RecipeQuery) -> RecipeGrid {
    let mut list = recipes
        .iter()
        .filter(|recipe| query.meal.is_none_or(|meal| recipe.meal == meal) && matches_query(recipe, &query.query))
        .collect::<Vec<_>>();
    match query.sort {
        RecipeSort::Recent => list.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms).then_with(|| a.name.cmp(&b.name))),
        RecipeSort::Kcal => list.sort_by(|a, b| a.kcal().total_cmp(&b.kcal()).then_with(|| a.name.cmp(&b.name))),
        RecipeSort::Protein => list.sort_by(|a, b| b.value("prot").total_cmp(&a.value("prot")).then_with(|| a.name.cmp(&b.name))),
        RecipeSort::Name => list.sort_by(|a, b| fold(&a.name).cmp(&fold(&b.name))),
    }
    let empty = if recipes.is_empty() {
        Some(EmptyState {
            title: "Todavía no cargaste comidas".into(),
            text: "Sumá tu primera receta con su foto y su información nutricional.".into(),
            action: "new".into(),
            action_label: "Nueva comida".into(),
        })
    } else if list.is_empty() {
        Some(EmptyState {
            title: "No hay recetas que coincidan".into(),
            text: "Probá con otro nombre o ingrediente, o cambiá el filtro.".into(),
            action: "clear".into(),
            action_label: "Limpiar filtros".into(),
        })
    } else {
        None
    };
    let filters = std::iter::once(None)
        .chain(MealTime::ALL.into_iter().map(Some))
        .map(|meal| MealFilter {
            meal,
            label: meal.map_or("Todas", MealTime::label).to_string(),
            selected: meal == query.meal,
        })
        .collect();
    RecipeGrid {
        total: recipes.len(),
        count_label: count_label(recipes.len()),
        short_count_label: short_count_label(recipes.len()),
        filters,
        sort: query.sort,
        cards: list
            .into_iter()
            .map(|recipe| RecipeCard {
                id: recipe.id.clone(),
                name: recipe.name.clone(),
                meal: recipe.meal,
                meal_label: recipe.meal.label().to_string(),
                kcal_label: format!("{} kcal", format_number(recipe.kcal())),
                minutes_label: recipe.minutes.map(|minutes| format!("{minutes} min")),
                macros: macro_shares(recipe),
                has_photo: recipe.photo.is_some(),
                photo_key: photo_key(recipe),
            })
            .collect(),
        empty,
    }
}

fn nutrient_rows(recipe: &Recipe, group: NutrientGroup) -> Vec<NutrientRow> {
    NUTRIENTS
        .iter()
        .filter(|nutrient| nutrient.group == group)
        .map(|nutrient| {
            let value = recipe.value(nutrient.key);
            let percent = nutrient.daily.map_or(0, |daily| (value / daily * 100.0).round() as u32);
            let (tone, percent_label) = if nutrient.limit {
                if percent >= HIGH_LIMIT_PERCENT {
                    (NutrientTone::Limit, format!("{percent}% del límite diario, alto"))
                } else {
                    (NutrientTone::Normal, format!("{percent}% del límite diario"))
                }
            } else if percent >= 100 {
                (NutrientTone::Over, format!("{percent}% VD"))
            } else {
                (NutrientTone::Normal, format!("{percent}% VD"))
            };
            NutrientRow {
                key: nutrient.key.to_string(),
                label: nutrient.label.to_string(),
                amount_label: format!("{} {}", format_number(value), nutrient.unit),
                bar: percent.min(100),
                percent_label,
                tone,
                limit: nutrient.limit,
            }
        })
        .collect()
}

/// «2 porciones de 350 g», «1 porción», «Porción de 350 g».
fn servings_label(recipe: &Recipe) -> Option<String> {
    let grams = recipe.serving_grams.map(|grams| format!("{} g", format_number(grams)));
    match (recipe.servings, grams) {
        (Some(1), Some(grams)) => Some(format!("1 porción de {grams}")),
        (Some(1), None) => Some("1 porción".to_string()),
        (Some(servings), Some(grams)) => Some(format!("{servings} porciones de {grams}")),
        (Some(servings), None) => Some(format!("{servings} porciones")),
        (None, Some(grams)) => Some(format!("Porción de {grams}")),
        (None, None) => None,
    }
}

pub fn build_detail(recipe: &Recipe) -> RecipeDetail {
    let kcal = recipe.kcal();
    let fiber = recipe.value("fibra");
    let fiber_amount_label = format!("{} g", format_number(fiber));
    let fiber_daily_label = format!("{}% VD", (fiber / 28.0 * 100.0).round());
    RecipeDetail {
        id: recipe.id.clone(),
        name: recipe.name.clone(),
        meal: recipe.meal,
        meal_label: recipe.meal.label().to_string(),
        description: recipe.description.clone(),
        minutes_label: recipe.minutes.map(|minutes| format!("{minutes} min")),
        servings_label: servings_label(recipe),
        has_photo: recipe.photo.is_some(),
        photo_key: photo_key(recipe),
        kcal_label: format_number(kcal),
        kcal_share_label: format!("{}% de una dieta de 2000 kcal", (kcal / REFERENCE_KCAL * 100.0).round()),
        macros: macro_shares(recipe),
        fiber_label: format!("{fiber_amount_label} · {fiber_daily_label}"),
        fiber_amount_label,
        fiber_daily_label,
        sugar_label: format!("{} g", format_number(recipe.value("azucar"))),
        vitamins: nutrient_rows(recipe, NutrientGroup::Vitamin),
        minerals: nutrient_rows(recipe, NutrientGroup::Mineral),
        ingredients: recipe.ingredients.clone(),
        steps: recipe.steps.clone(),
        ai_reviewed: recipe.ai_reviewed,
        path: recipe.path.clone(),
        form: RecipeInput {
            name: recipe.name.clone(),
            meal: Some(recipe.meal),
            minutes: recipe.minutes,
            servings: recipe.servings,
            serving_grams: recipe.serving_grams,
            description: recipe.description.clone(),
            ingredients: recipe.ingredients.clone(),
            steps: recipe.steps.clone(),
            nutrition: recipe.nutrition.clone(),
        },
    }
}
