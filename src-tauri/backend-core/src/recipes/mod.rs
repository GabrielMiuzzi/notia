//! Recetas: the meals of a library, one Markdown file each under
//! `recipes/`, with tables for their data and the photo embedded in the
//! file. Every new recipe goes through the library's AI, which checks it,
//! fills what is missing (above all vitamins and minerals) and tells when
//! it is a dish that already exists.
//!
//! This module holds the whole logic and knows neither the filesystem nor
//! the model: the adapter lists and writes the files, scales the photo and
//! makes the AI call (`app/src/recipes.rs`).

pub mod dashboard;
pub mod markdown;
pub mod review;
pub mod tools;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use dashboard::{build_detail, build_grid, RecipeDetail, RecipeGrid, RecipeQuery, RecipeSort};

/// Folder of the library that holds the recipes.
pub const RECIPES_FOLDER: &str = "recipes";
pub const MAX_NAME_CHARS: usize = 120;
pub const MAX_DESCRIPTION_CHARS: usize = 400;
pub const MAX_LINE_CHARS: usize = 300;
pub const MAX_INGREDIENTS: usize = 60;
pub const MAX_STEPS: usize = 40;
pub const MAX_MINUTES: u32 = 24 * 60;
pub const MAX_SERVINGS: u32 = 100;
/// Heaviest serving accepted, in grams.
pub const MAX_SERVING_GRAMS: f64 = 5000.0;
/// A nutrient above this per serving is a typo.
const MAX_NUTRIENT_VALUE: f64 = 100_000.0;
/// Reference diet of the daily values.
pub const REFERENCE_KCAL: f64 = 2_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MealTime {
    Breakfast,
    Lunch,
    Dinner,
    Snack,
}

impl MealTime {
    pub const ALL: [Self; 4] = [Self::Breakfast, Self::Lunch, Self::Dinner, Self::Snack];

    pub fn label(self) -> &'static str {
        match self {
            Self::Breakfast => "Desayuno",
            Self::Lunch => "Almuerzo",
            Self::Dinner => "Cena",
            Self::Snack => "Snack",
        }
    }

    /// The moment named by its label, its id or a common word for it.
    pub fn parse(value: &str) -> Option<Self> {
        match fold(value.trim()).as_str() {
            "desayuno" | "breakfast" | "merienda temprana" => Some(Self::Breakfast),
            "almuerzo" | "lunch" | "comida" => Some(Self::Lunch),
            "cena" | "dinner" => Some(Self::Dinner),
            "snack" | "colacion" | "merienda" | "picada" => Some(Self::Snack),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NutrientGroup {
    Macro,
    Vitamin,
    Mineral,
}

/// A nutrient of the recipe tables: its key, label, unit and daily value.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Nutrient {
    pub key: &'static str,
    pub label: &'static str,
    pub unit: &'static str,
    /// Daily value of reference, for a 2000 kcal diet.
    pub daily: Option<f64>,
    /// The daily value is a limit (sodium): high is bad.
    pub limit: bool,
    pub group: NutrientGroup,
}

const fn nutrient(key: &'static str, label: &'static str, unit: &'static str, daily: Option<f64>, limit: bool, group: NutrientGroup) -> Nutrient {
    Nutrient { key, label, unit, daily, limit, group }
}

pub const NUTRIENTS: [Nutrient; 20] = [
    nutrient("kcal", "Calorías", "kcal", Some(2_000.0), false, NutrientGroup::Macro),
    nutrient("prot", "Proteína", "g", Some(50.0), false, NutrientGroup::Macro),
    nutrient("carb", "Carbohidratos", "g", Some(275.0), false, NutrientGroup::Macro),
    nutrient("grasa", "Grasas", "g", Some(78.0), false, NutrientGroup::Macro),
    nutrient("fibra", "Fibra", "g", Some(28.0), false, NutrientGroup::Macro),
    nutrient("azucar", "Azúcares", "g", None, false, NutrientGroup::Macro),
    nutrient("vitA", "Vitamina A", "µg", Some(900.0), false, NutrientGroup::Vitamin),
    nutrient("vitC", "Vitamina C", "mg", Some(90.0), false, NutrientGroup::Vitamin),
    nutrient("vitD", "Vitamina D", "µg", Some(20.0), false, NutrientGroup::Vitamin),
    nutrient("vitE", "Vitamina E", "mg", Some(15.0), false, NutrientGroup::Vitamin),
    nutrient("vitK", "Vitamina K", "µg", Some(120.0), false, NutrientGroup::Vitamin),
    nutrient("b6", "Vitamina B6", "mg", Some(1.7), false, NutrientGroup::Vitamin),
    nutrient("b12", "Vitamina B12", "µg", Some(2.4), false, NutrientGroup::Vitamin),
    nutrient("folato", "Folato (B9)", "µg", Some(400.0), false, NutrientGroup::Vitamin),
    nutrient("calcio", "Calcio", "mg", Some(1_300.0), false, NutrientGroup::Mineral),
    nutrient("hierro", "Hierro", "mg", Some(18.0), false, NutrientGroup::Mineral),
    nutrient("magnesio", "Magnesio", "mg", Some(420.0), false, NutrientGroup::Mineral),
    nutrient("potasio", "Potasio", "mg", Some(4_700.0), false, NutrientGroup::Mineral),
    nutrient("zinc", "Zinc", "mg", Some(11.0), false, NutrientGroup::Mineral),
    nutrient("sodio", "Sodio", "mg", Some(2_300.0), true, NutrientGroup::Mineral),
];

pub fn nutrient_by_key(key: &str) -> Option<&'static Nutrient> {
    NUTRIENTS.iter().find(|nutrient| nutrient.key == key)
}

/// The nutrient a table row names, by label or key, ignoring case and accents.
pub fn nutrient_by_label(label: &str) -> Option<&'static Nutrient> {
    let wanted = fold(label.trim());
    NUTRIENTS
        .iter()
        .find(|nutrient| fold(nutrient.label) == wanted || fold(nutrient.key) == wanted || fold(nutrient.label).starts_with(&format!("{wanted} (")))
}

/// Photo of a recipe: JPEG (or the format it came in) as base64.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipePhoto {
    pub media_type: String,
    pub base64: String,
}

impl RecipePhoto {
    pub fn data_uri(&self) -> String {
        format!("data:{};base64,{}", self.media_type, self.base64)
    }

    /// A `data:image/…;base64,…` URI.
    pub fn from_data_uri(value: &str) -> Option<Self> {
        let rest = value.trim().strip_prefix("data:")?;
        let (media_type, data) = rest.split_once(";base64,")?;
        let valid_type = media_type.starts_with("image/") && media_type.len() <= 40 && media_type.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '+' | '.' | '-'));
        let valid_data = !data.is_empty() && data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
        (valid_type && valid_data).then(|| Self { media_type: media_type.to_string(), base64: data.to_string() })
    }
}

/// A stored recipe. `nutrition` is per serving, by nutrient key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recipe {
    pub id: String,
    pub name: String,
    pub meal: MealTime,
    pub minutes: Option<u32>,
    pub servings: Option<u32>,
    /// Weight of one serving, in grams: what a meal of another weight is
    /// scaled against.
    #[serde(default)]
    pub serving_grams: Option<f64>,
    pub description: String,
    pub ingredients: Vec<String>,
    pub steps: Vec<String>,
    pub nutrition: BTreeMap<String, f64>,
    pub photo: Option<RecipePhoto>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub ai_reviewed: bool,
    /// Logical path of its file in the library.
    pub path: String,
}

impl Recipe {
    pub fn value(&self, key: &str) -> f64 {
        self.nutrition.get(key).copied().unwrap_or(0.0)
    }

    /// Calories per serving: the stored ones, else from the macros.
    pub fn kcal(&self) -> f64 {
        let stored = self.value("kcal");
        if stored > 0.0 {
            stored
        } else {
            (self.value("prot") * 4.0 + self.value("carb") * 4.0 + self.value("grasa") * 9.0).round()
        }
    }
}

/// What the form or a tool sends. Numbers are optional: the AI fills them.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipeInput {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub meal: Option<MealTime>,
    #[serde(default)]
    pub minutes: Option<u32>,
    #[serde(default)]
    pub servings: Option<u32>,
    #[serde(default)]
    pub serving_grams: Option<f64>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub ingredients: Vec<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    #[serde(default)]
    pub nutrition: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldError {
    pub field: String,
    pub message: String,
}

fn field_error(field: &str, message: &str) -> FieldError {
    FieldError { field: field.to_string(), message: message.to_string() }
}

/// Lines without blanks, bullets or numbers, as a list is kept.
pub fn clean_lines(lines: &[String]) -> Vec<String> {
    lines
        .iter()
        .flat_map(|line| line.lines())
        .map(|line| {
            let line = line.trim();
            let line = line.trim_start_matches(['-', '*', '•']).trim_start();
            let digits = line.chars().take_while(char::is_ascii_digit).count();
            if digits > 0 && line[digits..].starts_with(['.', ')']) {
                line[digits + 1..].trim_start()
            } else {
                line
            }
            .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect()
}

/// Checks and normalizes a recipe before the AI and before saving.
pub fn validate_input(input: &RecipeInput) -> Result<RecipeInput, Vec<FieldError>> {
    let mut errors = Vec::new();
    let name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        errors.push(field_error("name", "Escribí un nombre para guardar la receta."));
    } else if name.chars().count() > MAX_NAME_CHARS {
        errors.push(field_error("name", "El nombre puede tener hasta 120 caracteres."));
    } else if name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | '|')) {
        errors.push(field_error("name", "El nombre no puede tener / \\ ni |."));
    }
    let description = input.description.split_whitespace().collect::<Vec<_>>().join(" ");
    if description.chars().count() > MAX_DESCRIPTION_CHARS {
        errors.push(field_error("description", "La descripción puede tener hasta 400 caracteres."));
    }
    if input.minutes.is_some_and(|minutes| minutes > MAX_MINUTES) {
        errors.push(field_error("minutes", "El tiempo puede ser de hasta 1440 minutos."));
    }
    if input.servings.is_some_and(|servings| servings == 0 || servings > MAX_SERVINGS) {
        errors.push(field_error("servings", "Las porciones van de 1 a 100."));
    }
    if input.serving_grams.is_some_and(|grams| !grams.is_finite() || !(1.0..=MAX_SERVING_GRAMS).contains(&grams)) {
        errors.push(field_error("servingGrams", "El peso por porción va de 1 a 5000 g."));
    }
    let ingredients = clean_lines(&input.ingredients);
    let steps = clean_lines(&input.steps);
    if ingredients.len() > MAX_INGREDIENTS {
        errors.push(field_error("ingredients", "Hasta 60 ingredientes."));
    }
    if steps.len() > MAX_STEPS {
        errors.push(field_error("steps", "Hasta 40 pasos."));
    }
    if ingredients.iter().chain(&steps).any(|line| line.chars().count() > MAX_LINE_CHARS) {
        errors.push(field_error(if ingredients.iter().any(|line| line.chars().count() > MAX_LINE_CHARS) { "ingredients" } else { "steps" }, "Cada línea puede tener hasta 300 caracteres."));
    }
    let mut nutrition = BTreeMap::new();
    for (key, value) in &input.nutrition {
        let Some(nutrient) = nutrient_by_key(key) else {
            errors.push(field_error(key, "Nutriente desconocido."));
            continue;
        };
        if !value.is_finite() || *value < 0.0 || *value > MAX_NUTRIENT_VALUE {
            errors.push(field_error(nutrient.key, "Tiene que ser un número mayor o igual a 0."));
            continue;
        }
        if *value > 0.0 {
            nutrition.insert(nutrient.key.to_string(), round_value(*value));
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    Ok(RecipeInput {
        name,
        meal: input.meal,
        minutes: input.minutes.filter(|minutes| *minutes > 0),
        servings: input.servings,
        serving_grams: input.serving_grams.map(f64::round),
        description,
        ingredients,
        steps,
        nutrition,
    })
}

/// A value rounded to one decimal, or to the unit above 100.
pub fn round_value(value: f64) -> f64 {
    if value >= 100.0 {
        value.round()
    } else {
        (value * 10.0).round() / 10.0
    }
}

/// A number as es-AR writes it: «1.150», «4,5», «0,3».
pub fn format_number(value: f64) -> String {
    let rounded = (value * 10.0).round() / 10.0;
    let negative = rounded < 0.0;
    let absolute = rounded.abs();
    let whole = absolute.trunc() as u64;
    let tenth = ((absolute - absolute.trunc()) * 10.0).round() as u64;
    let digits = whole.to_string();
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(digit);
    }
    let sign = if negative { "-" } else { "" };
    if tenth == 0 {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped},{tenth}")
    }
}

/// Text folded for comparisons: lower case, without accents.
pub fn fold(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .map(|character| match character {
            'á' | 'à' | 'ä' | 'â' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            other => other,
        })
        .collect()
}

const NAME_STOPWORDS: [&str; 14] = ["de", "del", "con", "y", "e", "al", "a", "la", "el", "los", "las", "en", "un", "una"];

fn name_tokens(name: &str) -> Vec<String> {
    let mut tokens = fold(name)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| !token.is_empty() && !NAME_STOPWORDS.contains(token))
        // «milanesas» and «milanesa» are the same dish.
        .map(|token| if token.len() > 4 { token.trim_end_matches('s').to_string() } else { token.to_string() })
        .collect::<Vec<_>>();
    tokens.sort();
    tokens.dedup();
    tokens
}

/// The recipe `name` repeats, if any: the same words, or almost (at least
/// 80 % of them shared), ignoring case, accents, plurals and connectors.
pub fn find_duplicate<'a>(name: &str, recipes: &'a [Recipe], except_id: Option<&str>) -> Option<&'a Recipe> {
    let wanted = name_tokens(name);
    if wanted.is_empty() {
        return None;
    }
    recipes.iter().filter(|recipe| Some(recipe.id.as_str()) != except_id).find(|recipe| {
        let tokens = name_tokens(&recipe.name);
        if tokens == wanted {
            return true;
        }
        let shared = wanted.iter().filter(|token| tokens.contains(token)).count();
        let union = wanted.len() + tokens.len() - shared;
        union > 0 && shared * 10 >= union * 8
    })
}

/// A file name for a recipe, without the characters no platform accepts.
pub fn file_stem(name: &str) -> String {
    let stem = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let stem = stem.trim_matches('.').chars().take(80).collect::<String>();
    if stem.is_empty() {
        "receta".to_string()
    } else {
        stem
    }
}

/// A logical path under `recipes/` that no other recipe uses.
pub fn available_path(name: &str, taken: &[String]) -> String {
    let stem = file_stem(name);
    let taken = taken.iter().map(|path| fold(path)).collect::<Vec<_>>();
    let candidate = |suffix: usize| {
        if suffix == 1 {
            format!("{RECIPES_FOLDER}/{stem}.md")
        } else {
            format!("{RECIPES_FOLDER}/{stem} ({suffix}).md")
        }
    };
    (1..).map(candidate).find(|path| !taken.contains(&fold(path))).expect("a free name")
}

#[cfg(test)]
mod tests;
