use serde::{Deserialize, Serialize};
#[cfg(target_os = "android")]
use std::collections::HashMap;
#[cfg(target_os = "android")]
use std::sync::Mutex;
use tauri::{
    Manager,
    plugin::{Builder as PluginBuilder, TauriPlugin},
    State, Wry,
};
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

pub struct AndroidDirectoryPickerState {
    #[cfg(target_os = "android")]
    handle: Mutex<Option<PluginHandle<Wry>>>,
    #[cfg(target_os = "android")]
    roots: Mutex<HashMap<String, String>>,
}

#[cfg(target_os = "android")]
fn normalize_android_root_key(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

impl AndroidDirectoryPickerState {
    #[cfg(target_os = "android")]
    fn with_handle(handle: PluginHandle<Wry>) -> Self {
        Self {
            handle: Mutex::new(Some(handle)),
            roots: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(not(target_os = "android"))]
    fn empty() -> Self {
        Self {}
    }
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickDirectoryTreeResponse {
    path: Option<String>,
    uri: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickAndroidDirectoryTreeResult {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadTreeResponse {
    nodes: Vec<AndroidTreeNode>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadFileResponse {
    content: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteFileResponse {
    ok: bool,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateEntryResponse {
    path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AndroidTreeNode {
    id: String,
    name: String,
    path: Option<String>,
    #[serde(rename = "type")]
    node_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    expanded: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<AndroidTreeNode>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAndroidTreePayload {
    directory_path: String,
    #[serde(default)]
    directory_uri: Option<String>,
}

#[tauri::command]
pub fn pick_android_directory_tree(
    state: State<'_, AndroidDirectoryPickerState>,
) -> Result<PickAndroidDirectoryTreeResult, String> {
    #[cfg(target_os = "android")]
    {
        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El selector de carpetas no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<PickDirectoryTreeResponse>("pickDirectoryTree", ())
            .map_err(|error| format!("No se pudo abrir el selector de carpetas: {error}"))?;
        let Some(path) = response.path else {
            return Err("No se pudo resolver la carpeta seleccionada.".to_string());
        };
        if path.trim().is_empty() {
            return Err("No se pudo resolver la carpeta seleccionada.".to_string());
        }

        let selected_uri = response.uri.clone();
        if let Some(uri) = selected_uri.clone() {
            let mut roots = state
                .roots
                .lock()
                .map_err(|_| "No se pudo guardar la referencia de carpeta Android.".to_string())?;
            let normalized_key = normalize_android_root_key(&path);
            roots.insert(path.clone(), uri.clone());
            roots.insert(normalized_key, uri);
        }

        return Ok(PickAndroidDirectoryTreeResult {
            path,
            uri: selected_uri,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        Err("El selector de carpetas Android solo esta disponible en Android.".to_string())
    }
}

#[tauri::command]
pub fn read_android_library_tree(
    state: State<'_, AndroidDirectoryPickerState>,
    payload: ReadAndroidTreePayload,
) -> Result<Vec<AndroidTreeNode>, String> {
    #[cfg(target_os = "android")]
    {
        if payload.directory_path.trim().is_empty() {
            return Ok(Vec::new());
        }

        let uri = {
            let normalized_key = normalize_android_root_key(&payload.directory_path);
            if let Some(uri) = payload.directory_uri.clone().filter(|value| !value.trim().is_empty()) {
                let mut roots = state
                    .roots
                    .lock()
                    .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
                roots.insert(payload.directory_path.clone(), uri.clone());
                roots.insert(normalized_key, uri.clone());
                Some(uri)
            } else {
            let roots = state
                .roots
                .lock()
                .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
                roots
                    .get(&payload.directory_path)
                    .cloned()
                    .or_else(|| roots.get(&normalized_key).cloned())
                    .or_else(|| {
                        if roots.len() == 1 {
                            roots.values().next().cloned()
                        } else {
                            None
                        }
                    })
            }
        };

        let Some(uri) = uri else {
            return Err("No se encontro la referencia Android de la carpeta seleccionada.".to_string());
        };

        let guard = state
            .handle
            .lock()
            .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
        let Some(handle) = guard.as_ref() else {
            return Err("El selector de carpetas no esta disponible.".to_string());
        };

        let response = handle
            .run_mobile_plugin::<ReadTreeResponse>("readTree", serde_json::json!({ "uri": uri }))
            .map_err(|error| format!("No se pudo leer la carpeta Android: {error}"))?;

        return Ok(response.nodes);
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = state;
        let ReadAndroidTreePayload {
            directory_path,
            directory_uri,
        } = payload;
        let _ = (directory_path, directory_uri);
        Err("Solo disponible en Android.".to_string())
    }
}

#[cfg(target_os = "android")]
pub fn read_android_content_text(
    state: &AndroidDirectoryPickerState,
    content_uri: &str,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<ReadFileResponse>("readFile", serde_json::json!({ "uri": content_uri }))
        .map_err(|error| format!("No se pudo leer el archivo Android: {error}"))?;
    let Some(content) = response.content else {
        return Err("No se pudo leer el contenido del archivo Android.".to_string());
    };

    Ok(content)
}

#[cfg(target_os = "android")]
pub fn write_android_content_text(
    state: &AndroidDirectoryPickerState,
    content_uri: &str,
    content: &str,
) -> Result<(), String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<WriteFileResponse>(
            "writeFile",
            serde_json::json!({ "uri": content_uri, "content": content }),
        )
        .map_err(|error| format!("No se pudo escribir el archivo Android: {error}"))?;

    if !response.ok {
        return Err("No se pudo escribir el archivo Android.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "android")]
pub fn create_android_tree_entry(
    state: &AndroidDirectoryPickerState,
    parent_uri: &str,
    name: &str,
    entry_type: &str,
    content: Option<&str>,
) -> Result<String, String> {
    let guard = state
        .handle
        .lock()
        .map_err(|_| "No se pudo acceder al selector de carpetas.".to_string())?;
    let Some(handle) = guard.as_ref() else {
        return Err("El selector de carpetas no esta disponible.".to_string());
    };

    let response = handle
        .run_mobile_plugin::<CreateEntryResponse>(
            "createEntry",
            serde_json::json!({
                "parentUri": parent_uri,
                "name": name,
                "entryType": entry_type,
                "content": content,
            }),
        )
        .map_err(|error| format!("No se pudo crear la entrada Android: {error}"))?;

    let Some(path) = response.path else {
        return Err("No se pudo crear la entrada Android.".to_string());
    };
    if path.trim().is_empty() {
        return Err("No se pudo crear la entrada Android.".to_string());
    }

    Ok(path)
}

#[cfg(target_os = "android")]
pub fn resolve_android_tree_uri(
    state: &AndroidDirectoryPickerState,
    directory_path: &str,
    directory_uri: Option<&str>,
) -> Result<Option<String>, String> {
    let normalized_key = normalize_android_root_key(directory_path);
    if let Some(uri) = directory_uri
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
    {
        let mut roots = state
            .roots
            .lock()
            .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
        roots.insert(directory_path.to_string(), uri.clone());
        roots.insert(normalized_key, uri.clone());
        return Ok(Some(uri));
    }

    let roots = state
        .roots
        .lock()
        .map_err(|_| "No se pudo acceder a las carpetas Android seleccionadas.".to_string())?;
    let resolved = roots
        .get(directory_path)
        .cloned()
        .or_else(|| roots.get(&normalized_key).cloned())
        .or_else(|| {
            if roots.len() == 1 {
                roots.values().next().cloned()
            } else {
                None
            }
        });
    Ok(resolved)
}

pub fn init() -> TauriPlugin<Wry> {
    PluginBuilder::new("notia-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.gabriel.notia", "DirectoryPickerPlugin")?;
                app.manage(AndroidDirectoryPickerState::with_handle(handle));
            }

            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(AndroidDirectoryPickerState::empty());
            }

            Ok(())
        })
        .build()
}
