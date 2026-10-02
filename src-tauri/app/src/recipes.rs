//! Recetas of a library (the rules are in `backend_core::recipes`).
//!
//! Each recipe is a Markdown file under `recipes/`, listed live (a folder
//! read on desktop, the SAF tree on Android) and read and written through
//! the library's document adapter. A photo is decoded, scaled down and
//! embedded as JPEG. Every new recipe goes through the library's AI before
//! it is saved; a repeated dish is refused. The dashboard's commands and the
//! agent's tools share this module, and every change emits
//! `RECIPES_CHANGED_EVENT` with the library id.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::backend::recipes::markdown::{parse_recipe, render_recipe};
use crate::backend::recipes::review::{apply_review, parse_review, review_prompt, reviewed_duplicate};
use crate::backend::recipes::tools::{self as recipe_tools};
use crate::backend::recipes::{
    available_path, build_detail, build_grid, find_duplicate, validate_input, FieldError, MealTime, Recipe, RecipeDetail, RecipeGrid,
    RecipeInput, RecipePhoto, RecipeQuery, RECIPES_FOLDER,
};
use crate::backend::{BackendError, BackendErrorCode};
use crate::host::{AppHandle, Emitter, Manager};
use crate::library_registry::{LibraryBindingRegistry, LibraryBindingRoot};

pub(crate) use crate::backend::recipes::tools::{is_recipe_tool, is_recipe_write_tool};

pub(crate) const RECIPES_CHANGED_EVENT: &str = "notia://recipes-changed";
/// A photo larger than this is refused before decoding it.
const MAX_PHOTO_BYTES: usize = 15 * 1024 * 1024;
/// Longest side of a stored photo, in pixels.
const PHOTO_MAX_SIDE: u32 = 1024;
const PHOTO_QUALITY: u8 = 82;
/// The review reads a photo on the library's model, which can be slow.
const REVIEW_TIMEOUT: Duration = Duration::from_secs(180);
/// A reviewed recipe waits this long for its confirmation.
const PENDING_TTL: Duration = Duration::from_secs(30 * 60);

// ---------------------------------------------------------------------------
// Errors and context
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecipesErrorCode {
    Validation,
    NotFound,
    Duplicate,
    Ai,
    Storage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipesError {
    pub code: RecipesErrorCode,
    pub message: String,
    pub fields: Vec<FieldError>,
    /// The existing recipe a new one repeats.
    pub duplicate_id: Option<String>,
}

impl RecipesError {
    fn new(code: RecipesErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), fields: Vec::new(), duplicate_id: None }
    }

    fn validation(fields: Vec<FieldError>) -> Self {
        Self { fields, ..Self::new(RecipesErrorCode::Validation, "Revisá los campos marcados.") }
    }

    fn duplicate(existing: &Recipe) -> Self {
        Self {
            duplicate_id: Some(existing.id.clone()),
            ..Self::new(RecipesErrorCode::Duplicate, format!("Ya tenés esta comida en el recetario: «{}». No se guardó otra igual.", existing.name))
        }
    }

    fn not_found() -> Self {
        Self::new(RecipesErrorCode::NotFound, "La receta ya no existe.")
    }
}

impl From<BackendError> for RecipesError {
    fn from(error: BackendError) -> Self {
        let code = match error.code {
            BackendErrorCode::NotFound => RecipesErrorCode::NotFound,
            BackendErrorCode::InvalidInput => RecipesErrorCode::Validation,
            _ => RecipesErrorCode::Storage,
        };
        Self::new(code, error.message)
    }
}

pub type RecipesResult<T> = Result<T, RecipesError>;

/// The error a tool returns to the model.
pub(crate) fn tool_error(error: RecipesError) -> BackendError {
    match error.code {
        RecipesErrorCode::Validation if !error.fields.is_empty() => BackendError::invalid_input(recipe_tools::field_errors_message(&error.fields)),
        RecipesErrorCode::Validation => BackendError::invalid_input(error.message),
        RecipesErrorCode::Duplicate => BackendError::new(
            BackendErrorCode::Conflict,
            format!("{} Su id es {}: preguntale al usuario si quiere actualizarla con update_recipe.", error.message, error.duplicate_id.unwrap_or_default()),
            false,
        ),
        RecipesErrorCode::NotFound => BackendError::new(BackendErrorCode::NotFound, error.message, false),
        RecipesErrorCode::Ai => BackendError::new(BackendErrorCode::ProviderUnavailable, error.message, true),
        RecipesErrorCode::Storage => BackendError::new(BackendErrorCode::Storage, error.message, true),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecipesContext {
    pub library_id: String,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or_default()
}

/// Whether a logical path is a recipe file, which only the recipe tools write.
pub(crate) fn is_recipe_path(path: &str) -> bool {
    let path = path.trim_start_matches('/');
    path.len() > RECIPES_FOLDER.len() + 1
        && path[..RECIPES_FOLDER.len()].eq_ignore_ascii_case(RECIPES_FOLDER)
        && path.as_bytes()[RECIPES_FOLDER.len()] == b'/'
        && path.to_ascii_lowercase().ends_with(".md")
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

fn visible_recipe_file(name: &str) -> bool {
    !name.starts_with('.') && !name.starts_with('_') && name.to_ascii_lowercase().ends_with(".md")
}

/// Logical paths of the files in `recipes/`, read now (not from the index,
/// which may lag behind a write).
fn recipe_paths(app: &AppHandle, library_id: &str) -> RecipesResult<Vec<String>> {
    let binding = app.state::<LibraryBindingRegistry>().lookup(library_id)?;
    match &binding.root {
        Some(LibraryBindingRoot::Desktop { canonical_root }) => {
            let Ok(entries) = std::fs::read_dir(canonical_root.join(RECIPES_FOLDER)) else {
                return Ok(Vec::new());
            };
            let mut paths = entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .filter(|name| visible_recipe_file(name))
                .map(|name| format!("{RECIPES_FOLDER}/{name}"))
                .collect::<Vec<_>>();
            paths.sort();
            Ok(paths)
        }
        Some(LibraryBindingRoot::Android { tree_uri }) => android_recipe_paths(app, tree_uri.as_str()),
        None => Err(RecipesError::new(RecipesErrorCode::Storage, "La biblioteca no está disponible.")),
    }
}

/// The recipe files of an Android library: the folder is found level by
/// level and listed alone, without walking the whole library. (The listing
/// of the whole library brought `<tree>/<path>` and was compared with
/// `recipes/`, so Android never found a recipe.)
#[cfg(target_os = "android")]
fn android_recipe_paths(app: &AppHandle, tree_uri: &str) -> RecipesResult<Vec<String>> {
    use crate::mobile_directory_picker::{self as picker, AndroidDirectoryPickerState};
    let unreadable = || RecipesError::new(RecipesErrorCode::Storage, "No se pudo leer la biblioteca Android; volvé a autorizar la carpeta.");
    let state = app.state::<AndroidDirectoryPickerState>();
    let folder = match picker::resolve_android_path_by_walking(state.inner(), tree_uri, &[RECIPES_FOLDER.to_string()]) {
        Some(Some(folder)) => folder,
        Some(None) => return Ok(Vec::new()),
        None => return Err(unreadable()),
    };
    let mut paths = picker::list_android_folder(state.inner(), &folder)
        .map_err(|_| unreadable())?
        .into_iter()
        .filter(|(name, is_file)| *is_file && visible_recipe_file(name))
        .map(|(name, _)| format!("{RECIPES_FOLDER}/{name}"))
        .collect::<Vec<_>>();
    paths.sort();
    Ok(paths)
}

#[cfg(not(target_os = "android"))]
fn android_recipe_paths(_app: &AppHandle, _tree_uri: &str) -> RecipesResult<Vec<String>> {
    Err(RecipesError::new(RecipesErrorCode::Storage, "La biblioteca no está disponible."))
}

pub(crate) fn load_recipes(app: &AppHandle, library_id: &str) -> RecipesResult<Vec<Recipe>> {
    let paths = recipe_paths(app, library_id)?;
    Ok(crate::library_documents::with_documents(app, library_id, |documents| {
        let mut recipes = Vec::with_capacity(paths.len());
        for path in &paths {
            // A file that cannot be read or is not a recipe is left out.
            if let Ok(Some(text)) = documents.read(path) {
                recipes.extend(parse_recipe(path, &text));
            }
        }
        Ok(recipes)
    })?)
}

fn load_recipe(recipes: &[Recipe], id: &str) -> RecipesResult<Recipe> {
    recipes.iter().find(|recipe| recipe.id == id).cloned().ok_or_else(RecipesError::not_found)
}

fn write_recipe(app: &AppHandle, library_id: &str, recipe: &Recipe) -> RecipesResult<()> {
    crate::library_documents::with_documents(app, library_id, |documents| {
        documents.adapter.upsert_text_locator(&documents.locator(&recipe.path)?, &render_recipe(recipe))
    })?;
    Ok(())
}

fn delete_file(app: &AppHandle, library_id: &str, path: &str) -> RecipesResult<()> {
    crate::library_documents::with_documents(app, library_id, |documents| documents.adapter.delete_locator(&documents.locator(path)?))?;
    Ok(())
}

fn changed(app: &AppHandle, library_id: &str) {
    let _ = app.emit(RECIPES_CHANGED_EVENT, library_id);
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/// A photo as the recipe keeps it: at most 1024 px on its longest side,
/// as JPEG.
pub(crate) fn prepare_photo(bytes: &[u8]) -> RecipesResult<RecipePhoto> {
    let invalid = || RecipesError::new(RecipesErrorCode::Validation, "No se pudo leer la imagen: usá una foto JPG, PNG o WebP.");
    if bytes.is_empty() || bytes.len() > MAX_PHOTO_BYTES {
        return Err(RecipesError::new(RecipesErrorCode::Validation, "La foto tiene que pesar menos de 15 MB."));
    }
    let image = image::load_from_memory(bytes).map_err(|_| invalid())?;
    let image = if image.width().max(image.height()) > PHOTO_MAX_SIDE {
        image.resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, image::imageops::FilterType::Triangle)
    } else {
        image
    };
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut jpeg), PHOTO_QUALITY)
        .encode_image(&image.to_rgb8())
        .map_err(|_| invalid())?;
    Ok(RecipePhoto { media_type: "image/jpeg".into(), base64: base64::engine::general_purpose::STANDARD.encode(jpeg) })
}

/// A photo sent by the dashboard as a `data:` URI.
fn photo_from_data_uri(uri: &str) -> RecipesResult<RecipePhoto> {
    let raw = RecipePhoto::from_data_uri(uri).ok_or_else(|| RecipesError::new(RecipesErrorCode::Validation, "La foto no es una imagen válida."))?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.base64.as_bytes())
        .map_err(|_| RecipesError::new(RecipesErrorCode::Validation, "La foto no es una imagen válida."))?;
    prepare_photo(&bytes)
}

/// An image of the message the agent answers (Telegram or the app chat).
#[derive(Debug, Clone)]
pub(crate) struct MessageImage {
    pub(crate) base64: String,
}

pub(crate) fn photo_from_message(images: &[MessageImage], number: usize) -> RecipesResult<RecipePhoto> {
    let image = images.get(number.saturating_sub(1)).ok_or_else(|| {
        RecipesError::new(
            RecipesErrorCode::Validation,
            format!("El mensaje no tiene la imagen {number}: trae {} imagen(es).", images.len()),
        )
    })?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(image.base64.as_bytes())
        .map_err(|_| RecipesError::new(RecipesErrorCode::Validation, "La imagen del mensaje no se pudo leer."))?;
    prepare_photo(&bytes)
}

// ---------------------------------------------------------------------------
// New and changed recipes
// ---------------------------------------------------------------------------

/// Checks the recipe, refuses a repeated dish, has the AI review it and
/// returns it ready to write. Nothing is saved here.
/// `from_plate`: the recipe is rebuilt from a dish the person ate (see
/// `review_prompt`).
pub(crate) fn prepare_new(app: &AppHandle, library_id: &str, input: &RecipeInput, photo: Option<RecipePhoto>, recipes: &[Recipe], from_plate: bool) -> RecipesResult<Recipe> {
    let valid = validate_input(input).map_err(RecipesError::validation)?;
    if let Some(existing) = find_duplicate(&valid.name, recipes, None) {
        return Err(RecipesError::duplicate(existing));
    }
    let (system, user) = review_prompt(&valid, recipes, photo.is_some(), from_plate);
    let images = photo.iter().map(|photo| photo.base64.clone()).collect();
    let answer = crate::backend_runtime::complete_with_images(app, library_id, &system, &user, images, REVIEW_TIMEOUT).map_err(|error| {
        RecipesError::new(RecipesErrorCode::Ai, format!("No se pudo revisar la receta con IA ({}). No se guardó: probá de nuevo.", error.message))
    })?;
    let review = parse_review(&answer)
        .ok_or_else(|| RecipesError::new(RecipesErrorCode::Ai, "La IA no devolvió los datos de la receta. No se guardó: probá de nuevo."))?;
    if let Some(existing) = reviewed_duplicate(&review, recipes, None) {
        return Err(RecipesError::duplicate(existing));
    }
    let reviewed = validate_input(&apply_review(&valid, &review)).map_err(RecipesError::validation)?;
    let now = now_ms();
    let taken = recipes.iter().map(|recipe| recipe.path.clone()).collect::<Vec<_>>();
    Ok(Recipe {
        id: Uuid::new_v4().to_string(),
        path: available_path(&reviewed.name, &taken),
        name: reviewed.name,
        meal: reviewed.meal.unwrap_or(MealTime::Lunch),
        minutes: reviewed.minutes,
        servings: reviewed.servings,
        serving_grams: reviewed.serving_grams,
        description: reviewed.description,
        ingredients: reviewed.ingredients,
        steps: reviewed.steps,
        nutrition: reviewed.nutrition,
        photo,
        created_at_ms: now,
        updated_at_ms: now,
        ai_reviewed: true,
    })
}

/// Writes a prepared recipe, unless a repeated one was saved meanwhile.
pub(crate) fn save_new(app: &AppHandle, library_id: &str, recipe: &Recipe) -> RecipesResult<()> {
    let recipes = load_recipes(app, library_id)?;
    if let Some(existing) = find_duplicate(&recipe.name, &recipes, None) {
        return Err(RecipesError::duplicate(existing));
    }
    let mut recipe = recipe.clone();
    if recipes.iter().any(|other| other.path.eq_ignore_ascii_case(&recipe.path)) {
        recipe.path = available_path(&recipe.name, &recipes.iter().map(|other| other.path.clone()).collect::<Vec<_>>());
    }
    write_recipe(app, library_id, &recipe)?;
    changed(app, library_id);
    Ok(())
}

/// What an edit does with the photo.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind", content = "value")]
pub enum PhotoEdit {
    #[default]
    Keep,
    Remove,
    Replace(String),
}

enum PhotoChange {
    Keep,
    Remove,
    Replace(RecipePhoto),
}

/// The recipe after an edit, saved as it was typed. A new name moves the
/// file to a name that follows it.
fn edited(recipe: &Recipe, input: &RecipeInput, photo: PhotoChange, recipes: &[Recipe]) -> RecipesResult<Recipe> {
    let valid = validate_input(input).map_err(RecipesError::validation)?;
    if let Some(existing) = find_duplicate(&valid.name, recipes, Some(&recipe.id)) {
        return Err(RecipesError::duplicate(existing));
    }
    let mut next = recipe.clone();
    if valid.name != recipe.name {
        let taken = recipes.iter().filter(|other| other.id != recipe.id).map(|other| other.path.clone()).collect::<Vec<_>>();
        next.path = available_path(&valid.name, &taken);
    }
    next.name = valid.name;
    next.meal = valid.meal.unwrap_or(recipe.meal);
    next.minutes = valid.minutes;
    next.servings = valid.servings;
    // The dashboard form has no weight field: without one, the stored stays.
    next.serving_grams = valid.serving_grams.or(recipe.serving_grams);
    next.description = valid.description;
    next.ingredients = valid.ingredients;
    next.steps = valid.steps;
    next.nutrition = valid.nutrition;
    match photo {
        PhotoChange::Keep => {}
        PhotoChange::Remove => next.photo = None,
        PhotoChange::Replace(photo) => next.photo = Some(photo),
    }
    next.updated_at_ms = now_ms().max(recipe.updated_at_ms + 1);
    Ok(next)
}

fn save_edit(app: &AppHandle, library_id: &str, before: &Recipe, after: &Recipe) -> RecipesResult<()> {
    write_recipe(app, library_id, after)?;
    if !after.path.eq_ignore_ascii_case(&before.path) {
        delete_file(app, library_id, &before.path)?;
    }
    changed(app, library_id);
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> RecipesResult<T> + Send + 'static) -> RecipesResult<T> {
    crate::host::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| RecipesError::new(RecipesErrorCode::Storage, "No se pudo acceder a las recetas."))?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRecipe {
    pub id: String,
}

pub async fn recipes_grid(app: AppHandle, context: RecipesContext, query: Option<RecipeQuery>) -> RecipesResult<RecipeGrid> {
    blocking(move || Ok(build_grid(&load_recipes(&app, &context.library_id)?, &query.unwrap_or_default()))).await
}

pub async fn recipes_detail(app: AppHandle, context: RecipesContext, id: String) -> RecipesResult<RecipeDetail> {
    blocking(move || Ok(build_detail(&load_recipe(&load_recipes(&app, &context.library_id)?, &id)?))).await
}

/// The photo of a recipe as a `data:` URI, or none.
pub async fn recipes_photo(app: AppHandle, context: RecipesContext, id: String) -> RecipesResult<Option<String>> {
    blocking(move || Ok(load_recipe(&load_recipes(&app, &context.library_id)?, &id)?.photo.map(|photo| photo.data_uri()))).await
}

/// Saves a new recipe after the AI reviewed it; a repeated dish is refused.
pub async fn recipes_create(app: AppHandle, context: RecipesContext, input: RecipeInput, photo: Option<String>) -> RecipesResult<SavedRecipe> {
    blocking(move || {
        let photo = photo.as_deref().filter(|uri| !uri.trim().is_empty()).map(photo_from_data_uri).transpose()?;
        let recipes = load_recipes(&app, &context.library_id)?;
        let recipe = prepare_new(&app, &context.library_id, &input, photo, &recipes, false)?;
        save_new(&app, &context.library_id, &recipe)?;
        Ok(SavedRecipe { id: recipe.id })
    })
    .await
}

/// Saves an edit as typed.
pub async fn recipes_update(app: AppHandle, context: RecipesContext, id: String, input: RecipeInput, photo: Option<PhotoEdit>) -> RecipesResult<SavedRecipe> {
    blocking(move || {
        let photo = match photo.unwrap_or_default() {
            PhotoEdit::Keep => PhotoChange::Keep,
            PhotoEdit::Remove => PhotoChange::Remove,
            PhotoEdit::Replace(uri) => PhotoChange::Replace(photo_from_data_uri(&uri)?),
        };
        let recipes = load_recipes(&app, &context.library_id)?;
        let before = load_recipe(&recipes, &id)?;
        let after = edited(&before, &input, photo, &recipes)?;
        save_edit(&app, &context.library_id, &before, &after)?;
        Ok(SavedRecipe { id })
    })
    .await
}

pub async fn recipes_delete(app: AppHandle, context: RecipesContext, id: String) -> RecipesResult<()> {
    blocking(move || {
        let recipe = load_recipe(&load_recipes(&app, &context.library_id)?, &id)?;
        delete_file(&app, &context.library_id, &recipe.path)?;
        changed(&app, &context.library_id);
        Ok(())
    })
    .await
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

/// Recipes reviewed for a confirmation, by tool call, so the confirmed
/// execution saves exactly what the Owner saw.
fn pending() -> &'static Mutex<HashMap<String, (Instant, Recipe)>> {
    static PENDING: OnceLock<Mutex<HashMap<String, (Instant, Recipe)>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

fn keep_pending(call_id: &str, recipe: &Recipe) {
    if let Ok(mut pending) = pending().lock() {
        pending.retain(|_, (at, _)| at.elapsed() < PENDING_TTL);
        pending.insert(call_id.to_string(), (Instant::now(), recipe.clone()));
    }
}

fn take_pending(call_id: &str) -> Option<Recipe> {
    pending().lock().ok()?.remove(call_id).filter(|(at, _)| at.elapsed() < PENDING_TTL).map(|(_, recipe)| recipe)
}

fn tool_photo(arguments: &Value, images: &[MessageImage]) -> RecipesResult<Option<RecipePhoto>> {
    recipe_tools::photo_argument(arguments)?.map(|number| photo_from_message(images, number)).transpose()
}

/// A new recipe from a tool call, reviewed by the AI.
fn tool_new_recipe(app: &AppHandle, library_id: &str, arguments: &Value, images: &[MessageImage], recipes: &[Recipe]) -> RecipesResult<Recipe> {
    let input = recipe_tools::input_from_arguments(arguments, RecipeInput::default())?;
    let photo = tool_photo(arguments, images)?;
    prepare_new(app, library_id, &input, photo, recipes, false)
}

fn tool_edit(arguments: &Value, images: &[MessageImage], recipes: &[Recipe]) -> RecipesResult<(Recipe, Recipe, Option<&'static str>)> {
    let recipe = recipe_tools::resolve_recipe(recipes, arguments)?.clone();
    let input = recipe_tools::input_from_arguments(arguments, build_detail(&recipe).form)?;
    let (photo, note) = if recipe_tools::remove_photo_argument(arguments) {
        (PhotoChange::Remove, Some("sin foto"))
    } else {
        match tool_photo(arguments, images)? {
            Some(photo) => (PhotoChange::Replace(photo), Some("foto nueva")),
            None => (PhotoChange::Keep, None),
        }
    };
    let after = edited(&recipe, &input, photo, recipes)?;
    Ok((recipe, after, note))
}

/// The confirmation of a write tool. A new recipe is reviewed by the AI
/// here, and the confirmation shows what it completed.
pub(crate) fn preview_tool(app: &AppHandle, library_id: &str, call_id: &str, name: &str, arguments: &Value, images: &[MessageImage]) -> RecipesResult<String> {
    let recipes = load_recipes(app, library_id)?;
    match name {
        "create_recipe" => {
            let recipe = tool_new_recipe(app, library_id, arguments, images, &recipes)?;
            keep_pending(call_id, &recipe);
            Ok(recipe_tools::create_summary(&build_detail(&recipe).form, recipe.photo.is_some()))
        }
        "update_recipe" => {
            let (before, after, note) = tool_edit(arguments, images, &recipes)?;
            Ok(recipe_tools::update_summary(&before, &build_detail(&after).form, note))
        }
        "delete_recipe" => Ok(recipe_tools::delete_summary(recipe_tools::resolve_recipe(&recipes, arguments)?)),
        _ => Err(RecipesError::new(RecipesErrorCode::Validation, "La herramienta no es de Recetas.")),
    }
}

/// Runs a recipe tool: a read, or a write the person confirmed.
pub(crate) fn execute_tool(app: &AppHandle, library_id: &str, call_id: &str, name: &str, arguments: &Value, images: &[MessageImage]) -> RecipesResult<Value> {
    let recipes = load_recipes(app, library_id)?;
    match name {
        "list_recipes" => Ok(recipe_tools::list_view(&recipes, arguments)),
        "get_recipe" => Ok(recipe_tools::detail_view(recipe_tools::resolve_recipe(&recipes, arguments)?)),
        "create_recipe" => {
            let recipe = match take_pending(call_id) {
                Some(recipe) => recipe,
                None => tool_new_recipe(app, library_id, arguments, images, &recipes)?,
            };
            save_new(app, library_id, &recipe)?;
            Ok(json!({ "created": true, "id": recipe.id, "name": recipe.name, "path": recipe.path, "kcal": recipe.kcal(), "hasPhoto": recipe.photo.is_some() }))
        }
        "update_recipe" => {
            let (before, after, _) = tool_edit(arguments, images, &recipes)?;
            save_edit(app, library_id, &before, &after)?;
            Ok(json!({ "updated": true, "id": after.id, "name": after.name, "path": after.path }))
        }
        "delete_recipe" => {
            let recipe = recipe_tools::resolve_recipe(&recipes, arguments)?.clone();
            delete_file(app, library_id, &recipe.path)?;
            changed(app, library_id);
            Ok(json!({ "deleted": true, "id": recipe.id, "name": recipe.name }))
        }
        _ => Err(RecipesError::new(RecipesErrorCode::Validation, "La herramienta no es de Recetas.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(id: &str, name: &str) -> Recipe {
        Recipe {
            id: id.into(),
            name: name.into(),
            meal: MealTime::Lunch,
            minutes: Some(20),
            servings: Some(2),
            serving_grams: None,
            description: String::new(),
            ingredients: vec!["1 papa".into()],
            steps: vec![],
            nutrition: Default::default(),
            photo: Some(RecipePhoto { media_type: "image/jpeg".into(), base64: "QUJD".into() }),
            created_at_ms: 1,
            updated_at_ms: 1,
            ai_reviewed: true,
            path: format!("recipes/{name}.md"),
        }
    }

    #[test]
    fn recipe_paths_are_the_files_of_the_folder() {
        assert!(is_recipe_path("recipes/Guiso.md"));
        assert!(is_recipe_path("Recipes/Guiso.MD"));
        assert!(!is_recipe_path("recipes.md") && !is_recipe_path("notas/recipes/x.md") && !is_recipe_path("recipes/foto.jpg"));
        assert!(visible_recipe_file("Guiso.md") && !visible_recipe_file(".oculto.md") && !visible_recipe_file("_borrador.md"));
    }

    #[test]
    fn a_photo_is_scaled_down_and_kept_as_jpeg() {
        let mut png = Vec::new();
        image::DynamicImage::new_rgb8(2_000, 1_000).write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).expect("png");
        let photo = prepare_photo(&png).expect("photo");
        assert_eq!(photo.media_type, "image/jpeg");
        let bytes = base64::engine::general_purpose::STANDARD.decode(photo.base64).expect("base64");
        let scaled = image::load_from_memory(&bytes).expect("jpeg");
        assert_eq!((scaled.width(), scaled.height()), (1_024, 512));
        assert!(prepare_photo(b"no es una imagen").is_err());
        let uri = format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png));
        assert!(photo_from_data_uri(&uri).is_ok());
        assert!(photo_from_message(&[], 1).is_err());
    }

    #[test]
    fn an_edit_keeps_the_rest_and_a_new_name_moves_the_file() {
        let recipes = [stored("a", "Guiso"), stored("b", "Tarta de zapallitos")];
        let form = build_detail(&recipes[0]).form;
        let renamed = edited(&recipes[0], &RecipeInput { name: "Guiso de lentejas".into(), ..form.clone() }, PhotoChange::Keep, &recipes).expect("rename");
        assert_eq!((renamed.path.as_str(), renamed.photo.is_some(), renamed.created_at_ms), ("recipes/Guiso de lentejas.md", true, 1));
        assert!(renamed.updated_at_ms > 1);
        let without_photo = edited(&recipes[0], &form, PhotoChange::Remove, &recipes).expect("photo");
        assert_eq!((without_photo.path.as_str(), without_photo.photo.is_none()), ("recipes/Guiso.md", true));
        let duplicate = edited(&recipes[0], &RecipeInput { name: "Tartas de zapallitos".into(), ..form }, PhotoChange::Keep, &recipes).expect_err("duplicate");
        assert_eq!((duplicate.code, duplicate.duplicate_id.as_deref()), (RecipesErrorCode::Duplicate, Some("b")));
    }
}
