//! The file of a recipe: a small frontmatter (id, dates, AI review), the
//! title, the description, the photo embedded as a `data:` image, and tables
//! for its data, nutrition, vitamins and minerals, followed by the
//! ingredients and the steps. Parsing is lenient, so a file edited by hand
//! still reads: unknown rows are skipped and missing parts stay empty.

use std::collections::BTreeMap;

use super::{format_number, nutrient_by_label, MealTime, NutrientGroup, Recipe, RecipePhoto, NUTRIENTS};

const DATA_HEADING: &str = "Datos";
const NUTRITION_HEADING: &str = "Nutrición por porción";
const VITAMINS_HEADING: &str = "Vitaminas";
const MINERALS_HEADING: &str = "Minerales";
const INGREDIENTS_HEADING: &str = "Ingredientes";
const STEPS_HEADING: &str = "Preparación";

/// A table cell without the characters that would break the table.
fn cell(value: &str) -> String {
    value.replace('|', "/").replace(['\n', '\r'], " ").trim().to_string()
}

/// A number as the table keeps it: dot decimals, so it reads back exactly.
fn table_number(value: f64) -> String {
    let rounded = super::round_value(value);
    if rounded.fract() == 0.0 {
        format!("{}", rounded as i64)
    } else {
        format!("{rounded:.1}")
    }
}

fn nutrient_table(recipe: &Recipe, group: NutrientGroup, first_column: &str) -> String {
    let mut table = format!("| {first_column} | Cantidad | Unidad |\n|---|---|---|\n");
    for nutrient in NUTRIENTS.iter().filter(|nutrient| nutrient.group == group) {
        table.push_str(&format!("| {} | {} | {} |\n", nutrient.label, table_number(recipe.value(nutrient.key)), nutrient.unit));
    }
    table
}

pub fn render_recipe(recipe: &Recipe) -> String {
    let mut text = String::new();
    text.push_str("---\n");
    text.push_str("tipo: receta\n");
    text.push_str(&format!("id: {}\n", recipe.id));
    text.push_str(&format!("creado: {}\n", recipe.created_at_ms));
    text.push_str(&format!("actualizado: {}\n", recipe.updated_at_ms));
    text.push_str(&format!("revisadaPorIa: {}\n", recipe.ai_reviewed));
    text.push_str("---\n\n");
    text.push_str(&format!("# {}\n\n", recipe.name.trim()));
    if !recipe.description.trim().is_empty() {
        text.push_str(&format!("{}\n\n", recipe.description.trim()));
    }
    if let Some(photo) = &recipe.photo {
        text.push_str(&format!("![Foto de {}]({})\n\n", cell(&recipe.name), photo.data_uri()));
    }
    text.push_str(&format!("## {DATA_HEADING}\n\n| Campo | Valor |\n|---|---|\n"));
    text.push_str(&format!("| Momento | {} |\n", recipe.meal.label()));
    text.push_str(&format!("| Tiempo | {} |\n", recipe.minutes.map(|minutes| format!("{minutes} min")).unwrap_or_default()));
    text.push_str(&format!("| Porciones | {} |\n", recipe.servings.map(|servings| servings.to_string()).unwrap_or_default()));
    text.push_str(&format!("| Peso por porción | {} |\n", recipe.serving_grams.map(|grams| format!("{} g", table_number(grams))).unwrap_or_default()));
    text.push_str(&format!("| Calorías por porción | {} kcal |\n\n", format_number(recipe.kcal())));
    text.push_str(&format!("## {NUTRITION_HEADING}\n\n{}\n", nutrient_table(recipe, NutrientGroup::Macro, "Nutriente")));
    text.push_str(&format!("## {VITAMINS_HEADING}\n\n{}\n", nutrient_table(recipe, NutrientGroup::Vitamin, "Vitamina")));
    text.push_str(&format!("## {MINERALS_HEADING}\n\n{}\n", nutrient_table(recipe, NutrientGroup::Mineral, "Mineral")));
    text.push_str(&format!("## {INGREDIENTS_HEADING}\n\n"));
    for ingredient in &recipe.ingredients {
        text.push_str(&format!("- {}\n", ingredient.trim()));
    }
    text.push_str(&format!("\n## {STEPS_HEADING}\n\n"));
    for (index, step) in recipe.steps.iter().enumerate() {
        text.push_str(&format!("{}. {}\n", index + 1, step.trim()));
    }
    text
}

/// Frontmatter fields and the body after it.
fn split_frontmatter(text: &str) -> (BTreeMap<String, String>, &str) {
    let mut fields = BTreeMap::new();
    let Some(rest) = text.strip_prefix("---\n").or_else(|| text.strip_prefix("---\r\n")) else {
        return (fields, text);
    };
    let Some(end) = rest.find("\n---") else {
        return (fields, text);
    };
    for line in rest[..end].lines() {
        if let Some((key, value)) = line.split_once(':') {
            fields.insert(key.trim().to_string(), value.trim().trim_matches('"').to_string());
        }
    }
    let body = &rest[end + 4..];
    (fields, body.trim_start_matches(['\r', '\n']))
}

/// The cells of a table row, or none when the line is not one.
fn row_cells(line: &str) -> Option<Vec<String>> {
    let line = line.trim();
    if !line.starts_with('|') {
        return None;
    }
    let cells = line.trim_matches('|').split('|').map(|cell| cell.trim().to_string()).collect::<Vec<_>>();
    // The separator row.
    if cells.iter().all(|cell| !cell.is_empty() && cell.chars().all(|c| matches!(c, '-' | ':' | ' '))) {
        return None;
    }
    Some(cells)
}

/// A number written with a dot or a comma decimal, with or without unit.
pub fn parse_number(value: &str) -> Option<f64> {
    let digits = value
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | ',' | ' '))
        .filter(|c| *c != ' ')
        .collect::<String>();
    if digits.is_empty() {
        return None;
    }
    // «1.150» (thousands) or «4,5» (decimal) or «4.5».
    let normalized = if digits.contains(',') {
        digits.replace('.', "").replace(',', ".")
    } else if digits.matches('.').count() == 1 && digits.split('.').nth(1).is_some_and(|decimals| decimals.len() == 3) && digits.len() > 4 {
        digits.replace('.', "")
    } else {
        digits
    };
    normalized.parse::<f64>().ok().filter(|number| number.is_finite() && *number >= 0.0)
}

/// Id of a file without one in its frontmatter: stable for its path.
fn path_id(path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in path.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("recipe-{hash:016x}")
}

fn strip_list_marker(line: &str) -> &str {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")) {
        return rest.trim();
    }
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 && line[digits..].starts_with(". ") {
        return line[digits + 2..].trim();
    }
    line
}

/// The file without its embedded photos, for the model: a photo is hundreds
/// of kilobytes of base64 that it cannot use as text.
pub fn without_photos(text: &str) -> String {
    const MARKER: &str = "](data:image/";
    let mut result = String::with_capacity(text.len().min(64 * 1024));
    let mut rest = text;
    while let Some(start) = rest.find(MARKER) {
        let Some(length) = rest[start..].find(')') else { break };
        result.push_str(&rest[..start]);
        result.push_str("](foto embebida)");
        rest = &rest[start + length + 1..];
    }
    result.push_str(rest);
    result
}

/// Reads a recipe file. `None` when it is not a recipe (no title).
pub fn parse_recipe(path: &str, text: &str) -> Option<Recipe> {
    let (fields, body) = split_frontmatter(text);
    let mut name = String::new();
    let mut description = Vec::<String>::new();
    let mut photo = None;
    let mut section = String::new();
    let mut meal = None;
    let mut minutes = None;
    let mut servings = None;
    let mut serving_grams = None;
    let mut nutrition = BTreeMap::new();
    let mut ingredients = Vec::new();
    let mut steps = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(title) = trimmed.strip_prefix("# ") {
            if name.is_empty() {
                name = title.trim().to_string();
            }
            continue;
        }
        if let Some(heading) = trimmed.strip_prefix("## ") {
            section = super::fold(heading.trim());
            continue;
        }
        if trimmed.starts_with("![") {
            if let Some(start) = trimmed.find("](") {
                let uri = trimmed[start + 2..].trim_end_matches(')');
                photo = photo.or_else(|| RecipePhoto::from_data_uri(uri));
            }
            continue;
        }
        if trimmed.is_empty() {
            continue;
        }
        match section.as_str() {
            "" => description.push(trimmed.to_string()),
            s if s == super::fold(DATA_HEADING) => {
                if let Some(cells) = row_cells(trimmed) {
                    let (label, value) = (super::fold(cells.first().map(String::as_str).unwrap_or_default()), cells.get(1).cloned().unwrap_or_default());
                    match label.as_str() {
                        "momento" => meal = MealTime::parse(&value),
                        "tiempo" => minutes = parse_number(&value).map(|number| number.round() as u32).filter(|number| *number > 0),
                        "porciones" => servings = parse_number(&value).map(|number| number.round() as u32).filter(|number| *number > 0),
                        "peso por porcion" => serving_grams = parse_number(&value).filter(|grams| *grams > 0.0),
                        _ => {}
                    }
                }
            }
            s if s == super::fold(INGREDIENTS_HEADING) => ingredients.push(strip_list_marker(trimmed).to_string()),
            s if s == super::fold(STEPS_HEADING) => steps.push(strip_list_marker(trimmed).to_string()),
            _ => {
                if let Some(cells) = row_cells(trimmed) {
                    let Some(nutrient) = cells.first().and_then(|label| nutrient_by_label(label)) else {
                        continue;
                    };
                    if let Some(value) = cells.get(1).and_then(|value| parse_number(value)).filter(|value| *value > 0.0) {
                        nutrition.insert(nutrient.key.to_string(), value);
                    }
                }
            }
        }
    }
    if name.is_empty() {
        return None;
    }
    let number = |key: &str| fields.get(key).and_then(|value| value.parse::<i64>().ok());
    let created_at_ms = number("creado").unwrap_or_default();
    Some(Recipe {
        id: fields.get("id").filter(|id| !id.trim().is_empty()).cloned().unwrap_or_else(|| path_id(path)),
        name,
        meal: meal.unwrap_or(MealTime::Lunch),
        minutes,
        servings,
        serving_grams,
        description: description.join(" "),
        ingredients: ingredients.into_iter().filter(|line| !line.is_empty()).collect(),
        steps: steps.into_iter().filter(|line| !line.is_empty()).collect(),
        nutrition,
        photo,
        created_at_ms,
        updated_at_ms: number("actualizado").unwrap_or(created_at_ms),
        ai_reviewed: fields.get("revisadaPorIa").is_some_and(|value| value == "true"),
        path: path.to_string(),
    })
}
