use std::collections::BTreeMap;

use serde_json::json;

use super::dashboard::{build_detail, build_grid, NutrientTone, RecipeQuery, RecipeSort};
use super::markdown::{parse_number, parse_recipe, render_recipe, without_photos};
use super::review::{apply_review, parse_review, review_prompt, reviewed_duplicate};
use super::tools::{create_summary, input_from_arguments, photo_argument, resolve_recipe, update_summary};
use super::*;

fn nutrition(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
    pairs.iter().map(|(key, value)| (key.to_string(), *value)).collect()
}

fn recipe(id: &str, name: &str, meal: MealTime, created: i64, pairs: &[(&str, f64)]) -> Recipe {
    Recipe {
        id: id.into(),
        name: name.into(),
        meal,
        minutes: Some(25),
        servings: Some(2),
        serving_grams: Some(350.0),
        description: format!("Descripción de {name}"),
        ingredients: vec!["1 taza de quinoa".into(), "2 filetes de salmón".into()],
        steps: vec!["Cocinar la quinoa.".into(), "Dorar el salmón.".into()],
        nutrition: nutrition(pairs),
        photo: None,
        created_at_ms: created,
        updated_at_ms: created,
        ai_reviewed: true,
        path: format!("recipes/{name}.md"),
    }
}

fn bowl() -> Recipe {
    recipe(
        "s1",
        "Bowl de quinoa, salmón y palta",
        MealTime::Lunch,
        8,
        &[("kcal", 610.0), ("prot", 36.0), ("carb", 48.0), ("grasa", 30.0), ("fibra", 10.0), ("azucar", 4.0), ("vitA", 180.0), ("vitD", 11.0), ("vitE", 4.5), ("b12", 3.2), ("potasio", 1_200.0), ("sodio", 420.0)],
    )
}

#[test]
fn a_recipe_file_round_trips_with_its_tables_and_photo() {
    let mut original = bowl();
    original.photo = Some(RecipePhoto { media_type: "image/jpeg".into(), base64: "QUJD".into() });
    let text = render_recipe(&original);
    assert!(text.contains("| Momento | Almuerzo |") && text.contains("| Vitamina E | 4.5 | mg |") && text.contains("| Potasio | 1200 | mg |"));
    assert!(text.contains("| Peso por porción | 350 g |"));
    assert!(text.contains("![Foto de Bowl de quinoa, salmón y palta](data:image/jpeg;base64,QUJD)"));
    assert!(text.contains("- 1 taza de quinoa") && text.contains("2. Dorar el salmón."));
    let parsed = parse_recipe(&original.path, &text).expect("recipe");
    assert_eq!(parsed, original);
    // The model reads it without the base64.
    let plain = without_photos(&text);
    assert!(plain.contains("![Foto de Bowl de quinoa, salmón y palta](foto embebida)") && !plain.contains("QUJD"));
    assert!(plain.contains("| Potasio | 1200 | mg |"));
}

#[test]
fn a_file_edited_by_hand_still_reads() {
    let text = "# Guiso de lentejas\n\nClásico de invierno.\n\n## Datos\n\n| Campo | Valor |\n|---|---|\n| Momento | cena |\n| Tiempo | 60 min |\n\n## Vitaminas\n\n| Vitamina | Cantidad |\n|---|---|\n| folato | 340 |\n| Vitamina C | 22,5 mg |\n| Otra cosa | 9 |\n\n## Ingredientes\n\n* 2 tazas de lentejas\n- 1 cebolla\n\n## Preparación\n\n1. Rehogar.\n2) Cocinar.\n";
    let parsed = parse_recipe("recipes/guiso.md", text).expect("recipe");
    assert_eq!((parsed.name.as_str(), parsed.meal, parsed.minutes, parsed.servings), ("Guiso de lentejas", MealTime::Dinner, Some(60), None));
    assert_eq!(parsed.nutrition, nutrition(&[("folato", 340.0), ("vitC", 22.5)]));
    assert_eq!(parsed.ingredients, ["2 tazas de lentejas", "1 cebolla"]);
    assert_eq!(parsed.description, "Clásico de invierno.");
    // Without an id in the frontmatter, the id comes from the path.
    assert!(parsed.id.starts_with("recipe-"));
    assert!(parse_recipe("recipes/nada.md", "sin título").is_none());
    assert_eq!((parse_number("1.150"), parse_number("4,5"), parse_number("0.3 mg")), (Some(1_150.0), Some(4.5), Some(0.3)));
}

#[test]
fn the_form_is_validated_and_cleaned() {
    let input = RecipeInput {
        name: "  Tarta   de zapallitos ".into(),
        servings: Some(0),
        nutrition: nutrition(&[("prot", -1.0)]),
        ..RecipeInput::default()
    };
    let errors = validate_input(&input).expect_err("errors");
    assert_eq!(errors.iter().map(|error| error.field.as_str()).collect::<Vec<_>>(), ["servings", "prot"]);
    let valid = validate_input(&RecipeInput {
        name: "  Tarta   de zapallitos ".into(),
        ingredients: vec!["- 200 g de harina\n\n2 huevos".into()],
        steps: vec!["1. Precalentar".into()],
        nutrition: nutrition(&[("vitC", 12.345), ("vitD", 0.0)]),
        ..RecipeInput::default()
    })
    .expect("valid");
    assert_eq!(valid.name, "Tarta de zapallitos");
    assert_eq!(valid.ingredients, ["200 g de harina", "2 huevos"]);
    assert_eq!(valid.steps, ["Precalentar"]);
    assert_eq!(valid.nutrition, nutrition(&[("vitC", 12.3)]));
    assert!(validate_input(&RecipeInput { name: "a/b".into(), ..RecipeInput::default() }).is_err());
}

#[test]
fn a_repeated_dish_is_found_by_its_name() {
    let recipes = [bowl(), recipe("s3", "Milanesas de berenjena al horno", MealTime::Dinner, 6, &[])];
    assert_eq!(find_duplicate("bowl de QUINOA salmon y palta", &recipes, None).map(|r| r.id.as_str()), Some("s1"));
    assert_eq!(find_duplicate("Milanesa de berenjena al horno", &recipes, None).map(|r| r.id.as_str()), Some("s3"));
    assert!(find_duplicate("Milanesas de pollo", &recipes, None).is_none());
    assert!(find_duplicate("Bowl de quinoa, salmón y palta", &recipes, Some("s1")).is_none());
    assert_eq!(available_path("Bowl: quinoa/palta", &["recipes/Bowl quinoa palta.md".into()]), "recipes/Bowl quinoa palta (2).md");
}

#[test]
fn the_review_fills_what_is_missing_and_keeps_what_was_loaded() {
    let input = RecipeInput {
        name: "Tostadas con huevo".into(),
        meal: Some(MealTime::Breakfast),
        nutrition: nutrition(&[("prot", 19.0)]),
        ..RecipeInput::default()
    };
    let (system, user) = review_prompt(&input, &[bowl()], true, false);
    assert!(system.contains("\"vitA\" (Vitamina A, µg)") && system.contains("duplicateOf"));
    assert!(user.contains("Tostadas con huevo") && user.contains("Bowl de quinoa") && user.contains("La foto del plato va adjunta."));
    let answer = "```json\n{\"description\":\"Pan de masa madre con huevo\",\"meal\":\"cena\",\"minutes\":15,\"servings\":1,\"ingredients\":[\"2 rebanadas de pan\",\"2 huevos\"],\"steps\":[\"Tostar\"],\"nutrition\":{\"kcal\":340,\"prot\":30,\"vitA\":\"330\",\"Vitamina K\":290,\"xyz\":1},\"duplicateOf\":null}\n```";
    let review = parse_review(answer).expect("review");
    assert_eq!(review.duplicate_of, None);
    let merged = apply_review(&input, &review);
    assert_eq!(merged.meal, Some(MealTime::Breakfast));
    assert_eq!(merged.nutrition, nutrition(&[("kcal", 340.0), ("prot", 19.0), ("vitA", 330.0), ("vitK", 290.0)]));
    assert_eq!((merged.minutes, merged.servings, merged.description.as_str()), (Some(15), Some(1), "Pan de masa madre con huevo"));
    assert!(parse_review("no sé").is_none());
    let duplicate = parse_review("{\"nutrition\":{\"kcal\":1},\"duplicateOf\":\"bowl de quinoa, salmon y palta\"}").expect("review");
    assert_eq!(reviewed_duplicate(&duplicate, &[bowl()], None).map(|r| r.id.as_str()), Some("s1"));
}

#[test]
fn the_grid_filters_searches_and_sorts() {
    let recipes = [
        bowl(),
        recipe("s2", "Avena nocturna", MealTime::Breakfast, 7, &[("kcal", 380.0), ("prot", 16.0)]),
        recipe("s6", "Yogur con granola", MealTime::Snack, 3, &[("prot", 14.0), ("carb", 44.0), ("grasa", 9.0)]),
    ];
    let grid = build_grid(&recipes, &RecipeQuery::default());
    assert_eq!(grid.cards.iter().map(|card| card.id.as_str()).collect::<Vec<_>>(), ["s1", "s2", "s6"]);
    assert_eq!((grid.count_label.as_str(), grid.short_count_label.as_str()), ("3 recetas en tu recetario", "3 recetas"));
    assert_eq!(build_grid(&recipes[..1], &RecipeQuery::default()).short_count_label, "1 receta");
    // Calories from the macros when they were not stored.
    assert_eq!(grid.cards[2].kcal_label, "313 kcal");
    let by_kcal = build_grid(&recipes, &RecipeQuery { sort: RecipeSort::Kcal, ..RecipeQuery::default() });
    assert_eq!(by_kcal.cards[0].id, "s6");
    let salmon = build_grid(&recipes, &RecipeQuery { query: "SALMÓN".into(), ..RecipeQuery::default() });
    assert_eq!(salmon.cards.len(), 3);
    let snacks = build_grid(&recipes, &RecipeQuery { meal: Some(MealTime::Snack), query: "granola".into(), ..RecipeQuery::default() });
    assert_eq!((snacks.cards.len(), snacks.filters.iter().find(|filter| filter.selected).map(|filter| filter.label.as_str())), (1, Some("Snack")));
    let none = build_grid(&recipes, &RecipeQuery { query: "pizza".into(), ..RecipeQuery::default() });
    assert_eq!(none.empty.map(|empty| empty.action), Some("clear".to_string()));
    assert_eq!(build_grid(&[], &RecipeQuery::default()).empty.map(|empty| empty.action), Some("new".to_string()));
}

#[test]
fn the_detail_shows_daily_values_and_the_sodium_limit() {
    let mut salty = bowl();
    salty.nutrition.insert("sodio".into(), 710.0);
    let detail = build_detail(&salty);
    assert_eq!((detail.kcal_label.as_str(), detail.kcal_share_label.as_str()), ("610", "31% de una dieta de 2000 kcal"));
    assert_eq!(detail.fiber_label, "10 g · 36% VD");
    assert_eq!((detail.fiber_amount_label.as_str(), detail.fiber_daily_label.as_str()), ("10 g", "36% VD"));
    let row = |rows: &[super::dashboard::NutrientRow], key: &str| rows.iter().find(|row| row.key == key).cloned().expect(key);
    let b12 = row(&detail.vitamins, "b12");
    assert_eq!((b12.amount_label.as_str(), b12.percent_label.as_str(), b12.bar, b12.tone), ("3,2 µg", "133% VD", 100, NutrientTone::Over));
    let sodium = row(&detail.minerals, "sodio");
    assert_eq!((sodium.percent_label.as_str(), sodium.tone), ("31% del límite diario, alto", NutrientTone::Limit));
    assert_eq!(detail.macros.iter().map(|share| share.percent_label.as_str()).collect::<Vec<_>>(), ["24% de las calorías", "32% de las calorías", "45% de las calorías"]);
    assert_eq!(detail.macros.iter().map(|share| share.short_percent_label.as_str()).collect::<Vec<_>>(), ["24% kcal", "32% kcal", "45% kcal"]);
    assert_eq!(detail.servings_label.as_deref(), Some("2 porciones de 350 g"));
    assert_eq!((format_number(1_150.0), format_number(0.3), format_number(4.0)), ("1.150".into(), "0,3".into(), "4".into()));
}

#[test]
fn the_tools_read_their_arguments_on_top_of_the_recipe() {
    let recipes = [bowl()];
    assert_eq!(resolve_recipe(&recipes, &json!({"recipe": "bowl de quinoa, salmon y palta"})).expect("name").id, "s1");
    assert!(resolve_recipe(&recipes, &json!({"recipe": "otra"})).is_err());
    let created = input_from_arguments(
        &json!({"name": "Hummus", "meal": "merienda", "servings": "4", "ingredients": ["1 lata de garbanzos"], "nutrition": {"kcal": 260, "Vitamina C": "9"}}),
        RecipeInput::default(),
    )
    .expect("create");
    assert_eq!((created.meal, created.servings), (Some(MealTime::Snack), Some(4)));
    assert_eq!(created.nutrition, nutrition(&[("kcal", 260.0), ("vitC", 9.0)]));
    assert!(create_summary(&created, true).starts_with("Guardar la receta «Hummus» (Snack) · 260 kcal · P 0 g"));
    let stored = build_detail(&bowl()).form;
    let updated = input_from_arguments(&json!({"minutes": 30, "nutrition": {"prot": 40}}), stored.clone()).expect("update");
    assert_eq!((updated.minutes, updated.nutrition.get("prot"), updated.nutrition.get("vitA")), (Some(30), Some(&40.0), Some(&180.0)));
    let summary = update_summary(&bowl(), &updated, Some("foto nueva"));
    assert!(summary.contains("tiempo 30 min") && summary.contains("nutrición") && summary.contains("foto nueva"), "{summary}");
    assert_eq!(photo_argument(&json!({"photoFromMessage": 1})).expect("photo"), Some(1));
    assert!(photo_argument(&json!({"photoFromMessage": 0})).is_err());
    assert!(input_from_arguments(&json!({"meal": "brunch"}), stored).is_err());
}
