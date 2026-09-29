//! Agent tools over the recipes. They read the arguments into the same
//! form the dashboard sends, find the recipe a call names and write the
//! confirmation texts and the views the model reads. A photo comes from
//! the message the person sent (`photoFromMessage`, 1 for the first image),
//! which the adapter resolves.

use serde_json::{json, Value};

use super::dashboard::build_detail;
use super::{fold, format_number, MealTime, Recipe, RecipeInput, NUTRIENTS};
use crate::error::{BackendError, BackendErrorCode};

pub const RECIPE_READ_TOOLS: [&str; 2] = ["list_recipes", "get_recipe"];
pub const RECIPE_WRITE_TOOLS: [&str; 3] = ["create_recipe", "update_recipe", "delete_recipe"];
/// Recipes `list_recipes` returns at most.
const MAX_LISTED: usize = 200;

pub fn is_recipe_tool(name: &str) -> bool {
    RECIPE_READ_TOOLS.contains(&name) || is_recipe_write_tool(name)
}

pub fn is_recipe_write_tool(name: &str) -> bool {
    RECIPE_WRITE_TOOLS.contains(&name)
}

fn invalid(message: impl Into<String>) -> BackendError {
    BackendError::invalid_input(message)
}

pub fn text(arguments: &Value, name: &str) -> Option<String> {
    arguments.get(name).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string)
}

/// The recipe a call names: by id, or by exact name without caring about
/// case or accents.
pub fn resolve_recipe<'a>(recipes: &'a [Recipe], arguments: &Value) -> Result<&'a Recipe, BackendError> {
    let reference = text(arguments, "recipe").ok_or_else(|| invalid("Falta recipe."))?;
    if let Some(recipe) = recipes.iter().find(|recipe| recipe.id == reference) {
        return Ok(recipe);
    }
    let wanted = fold(&reference);
    let matches = recipes.iter().filter(|recipe| fold(&recipe.name) == wanted).collect::<Vec<_>>();
    match matches.as_slice() {
        [recipe] => Ok(recipe),
        [] => Err(BackendError::new(BackendErrorCode::NotFound, "No hay una receta con ese id o nombre; buscala con list_recipes.", false)),
        several => Err(invalid(format!(
            "Hay {} recetas llamadas así; usá su id: {}.",
            several.len(),
            several.iter().map(|recipe| recipe.id.as_str()).collect::<Vec<_>>().join(", ")
        ))),
    }
}

fn whole(arguments: &Value, name: &str) -> Result<Option<u32>, BackendError> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .or_else(|| value.as_f64().filter(|number| *number >= 0.0).map(|number| number.round() as u64))
            .or_else(|| value.as_str().and_then(|text| text.trim().parse::<u64>().ok()))
            .map(|number| Some(number as u32))
            .ok_or_else(|| invalid(format!("{name} tiene que ser un número entero."))),
    }
}

fn string_list(arguments: &Value, name: &str) -> Result<Option<Vec<String>>, BackendError> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Array(items)) => Ok(Some(items.iter().filter_map(Value::as_str).map(str::to_string).collect())),
        Some(Value::String(text)) => Ok(Some(text.lines().map(str::to_string).collect())),
        Some(_) => Err(invalid(format!("{name} tiene que ser una lista de textos."))),
    }
}

/// The form of a call on top of `base`: empty for a create, the stored
/// recipe for an update. Fields the call leaves out keep their value;
/// `nutrition` changes only the nutrients it names.
pub fn input_from_arguments(arguments: &Value, mut base: RecipeInput) -> Result<RecipeInput, BackendError> {
    if let Some(name) = arguments.get("name") {
        base.name = name.as_str().ok_or_else(|| invalid("name tiene que ser texto."))?.to_string();
    }
    if let Some(meal) = text(arguments, "meal") {
        base.meal = Some(MealTime::parse(&meal).ok_or_else(|| invalid("meal tiene que ser desayuno, almuerzo, cena o snack."))?);
    }
    if arguments.get("minutes").is_some() {
        base.minutes = whole(arguments, "minutes")?;
    }
    if arguments.get("servings").is_some() {
        base.servings = whole(arguments, "servings")?;
    }
    if let Some(grams) = arguments.get("servingGrams") {
        base.serving_grams = match grams {
            Value::Null => None,
            Value::Number(number) => number.as_f64(),
            Value::String(text) => Some(super::markdown::parse_number(text).ok_or_else(|| invalid("servingGrams tiene que ser un número de gramos."))?),
            _ => return Err(invalid("servingGrams tiene que ser un número de gramos.")),
        };
    }
    if let Some(description) = arguments.get("description") {
        base.description = description.as_str().unwrap_or_default().to_string();
    }
    if let Some(ingredients) = string_list(arguments, "ingredients")? {
        base.ingredients = ingredients;
    }
    if let Some(steps) = string_list(arguments, "steps")? {
        base.steps = steps;
    }
    if let Some(nutrition) = arguments.get("nutrition") {
        let object = nutrition.as_object().ok_or_else(|| invalid("nutrition tiene que ser un objeto con números por porción."))?;
        for (key, value) in object {
            let nutrient = super::nutrient_by_key(key).or_else(|| super::nutrient_by_label(key)).ok_or_else(|| invalid(format!("Nutriente desconocido: {key}.")))?;
            let amount = value
                .as_f64()
                .or_else(|| value.as_str().and_then(super::markdown::parse_number))
                .ok_or_else(|| invalid(format!("{key} tiene que ser un número.")))?;
            base.nutrition.insert(nutrient.key.to_string(), amount);
        }
    }
    Ok(base)
}

/// `photoFromMessage`, the number of the message's image, when sent.
pub fn photo_argument(arguments: &Value) -> Result<Option<usize>, BackendError> {
    match arguments.get("photoFromMessage") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|number| *number >= 1)
            .map(|number| Some(number as usize))
            .ok_or_else(|| invalid("photoFromMessage es el número de la imagen del mensaje, desde 1.")),
    }
}

pub fn remove_photo_argument(arguments: &Value) -> bool {
    arguments.get("removePhoto").and_then(Value::as_bool) == Some(true)
}

/// The form's errors as one message for the model.
pub fn field_errors_message(errors: &[super::FieldError]) -> String {
    let fields = errors.iter().map(|error| format!("{}: {}", error.field, error.message)).collect::<Vec<_>>().join(" ");
    format!("La receta no es válida. {fields}")
}

/// A line with the energy and macros of a recipe.
pub fn nutrition_line(input: &RecipeInput) -> String {
    let value = |key: &str| input.nutrition.get(key).copied().unwrap_or(0.0);
    format!(
        "{} kcal · P {} g · C {} g · G {} g",
        format_number(value("kcal")),
        format_number(value("prot")),
        format_number(value("carb")),
        format_number(value("grasa"))
    )
}

fn filled_micronutrients(input: &RecipeInput) -> usize {
    NUTRIENTS
        .iter()
        .filter(|nutrient| nutrient.group != super::NutrientGroup::Macro)
        .filter(|nutrient| input.nutrition.get(nutrient.key).is_some_and(|value| *value > 0.0))
        .count()
}

pub fn create_summary(input: &RecipeInput, with_photo: bool) -> String {
    let meal = input.meal.map_or("", MealTime::label);
    let photo = if with_photo { " · con foto" } else { "" };
    format!(
        "Guardar la receta «{}» ({meal}) · {}{photo}. La IA la revisó y completó {} vitaminas y minerales.\nIngredientes: {}",
        input.name,
        nutrition_line(input),
        filled_micronutrients(input),
        if input.ingredients.is_empty() { "—".to_string() } else { input.ingredients.join(", ") }
    )
}

pub fn update_summary(recipe: &Recipe, input: &RecipeInput, photo_change: Option<&str>) -> String {
    let mut changes = Vec::new();
    if input.name != recipe.name {
        changes.push(format!("nombre «{}»", input.name));
    }
    if input.meal.is_some_and(|meal| meal != recipe.meal) {
        changes.push(format!("momento {}", input.meal.map_or("", MealTime::label)));
    }
    if input.minutes != recipe.minutes {
        changes.push(format!("tiempo {}", input.minutes.map_or("—".to_string(), |minutes| format!("{minutes} min"))));
    }
    if input.servings != recipe.servings {
        changes.push(format!("porciones {}", input.servings.map_or("—".to_string(), |servings| servings.to_string())));
    }
    if input.serving_grams != recipe.serving_grams {
        changes.push(format!("peso por porción {}", input.serving_grams.map_or("—".to_string(), |grams| format!("{} g", format_number(grams)))));
    }
    if input.description != recipe.description {
        changes.push("descripción".to_string());
    }
    if input.ingredients != recipe.ingredients {
        changes.push("ingredientes".to_string());
    }
    if input.steps != recipe.steps {
        changes.push("preparación".to_string());
    }
    if input.nutrition != recipe.nutrition {
        changes.push(format!("nutrición ({})", nutrition_line(input)));
    }
    if let Some(photo) = photo_change {
        changes.push(photo.to_string());
    }
    if changes.is_empty() {
        format!("Guardar «{}» sin cambios.", recipe.name)
    } else {
        format!("Cambiar la receta «{}»: {}.", recipe.name, changes.join("; "))
    }
}

pub fn delete_summary(recipe: &Recipe) -> String {
    format!("Eliminar la receta «{}» ({}).", recipe.name, recipe.path)
}

/// What `list_recipes` returns.
pub fn list_view(recipes: &[Recipe], arguments: &Value) -> Value {
    let query = text(arguments, "query").map(|query| fold(&query)).unwrap_or_default();
    let meal = text(arguments, "meal").and_then(|meal| MealTime::parse(&meal));
    let items = recipes
        .iter()
        .filter(|recipe| meal.is_none_or(|meal| recipe.meal == meal))
        .filter(|recipe| query.is_empty() || fold(&recipe.name).contains(&query) || recipe.ingredients.iter().any(|line| fold(line).contains(&query)))
        .take(MAX_LISTED)
        .map(|recipe| {
            json!({
                "id": recipe.id,
                "name": recipe.name,
                "meal": recipe.meal.label(),
                "kcal": recipe.kcal(),
                "protein": recipe.value("prot"),
                "minutes": recipe.minutes,
                "hasPhoto": recipe.photo.is_some(),
                "path": recipe.path,
            })
        })
        .collect::<Vec<_>>();
    json!({ "total": recipes.len(), "recipes": items })
}

/// What `get_recipe` returns: the whole recipe with its values per serving.
pub fn detail_view(recipe: &Recipe) -> Value {
    let detail = build_detail(recipe);
    json!({
        "id": recipe.id,
        "name": recipe.name,
        "meal": recipe.meal.label(),
        "description": recipe.description,
        "minutes": recipe.minutes,
        "servings": recipe.servings,
        "servingGrams": recipe.serving_grams,
        "ingredients": recipe.ingredients,
        "steps": recipe.steps,
        "nutritionPerServing": NUTRIENTS.iter().map(|nutrient| json!({
            "key": nutrient.key,
            "label": nutrient.label,
            "value": recipe.value(nutrient.key),
            "unit": nutrient.unit,
        })).collect::<Vec<_>>(),
        "vitamins": detail.vitamins.iter().map(|row| format!("{}: {} ({})", row.label, row.amount_label, row.percent_label)).collect::<Vec<_>>(),
        "minerals": detail.minerals.iter().map(|row| format!("{}: {} ({})", row.label, row.amount_label, row.percent_label)).collect::<Vec<_>>(),
        "hasPhoto": recipe.photo.is_some(),
        "aiReviewed": recipe.ai_reviewed,
        "path": recipe.path,
    })
}
