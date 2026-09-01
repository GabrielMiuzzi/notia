use serde::Deserialize;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub library_path: String,
    pub backup_directory: String,
}

#[tauri::command]
pub async fn create_windows_library_backup(payload: BackupPayload) -> Result<BackupResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = payload;
        return Ok(BackupResult {
            ok: false,
            error: Some("Los backups solo están disponibles en Windows.".into()),
        });
    }
    #[cfg(target_os = "windows")]
    tokio::task::spawn_blocking(move || create_backup(payload))
        .await
        .map_err(|_| "No se pudo completar el backup.".to_string())?
}

#[cfg(target_os = "windows")]
fn create_backup(payload: BackupPayload) -> Result<BackupResult, String> {
    let library = fs::canonicalize(&payload.library_path)
        .map_err(|_| "La biblioteca no es accesible.".to_string())?;
    if !library.is_dir() {
        return Err("La biblioteca no es una carpeta.".into());
    }
    let requested_destination = PathBuf::from(&payload.backup_directory);
    let destination_for_check = if requested_destination.exists() {
        fs::canonicalize(&requested_destination)
            .map_err(|_| "La carpeta de backups no es accesible.".to_string())?
    } else {
        let parent = requested_destination
            .parent()
            .ok_or_else(|| "La carpeta de backups no es válida.".to_string())?;
        fs::canonicalize(parent)
            .map_err(|_| "La carpeta de backups no es accesible.".to_string())?
            .join(
                requested_destination
                    .file_name()
                    .ok_or_else(|| "La carpeta de backups no es válida.".to_string())?,
            )
    };
    if destination_for_check.starts_with(&library) {
        return Err("La carpeta de backups no puede estar dentro de la biblioteca.".into());
    }
    fs::create_dir_all(&requested_destination)
        .map_err(|_| "No se pudo crear la carpeta de backups.".to_string())?;
    let destination = fs::canonicalize(requested_destination)
        .map_err(|_| "La carpeta de backups no es accesible.".to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "Reloj del sistema inválido.")?
        .as_secs();
    let final_path = destination.join(format!("notia-backup-{timestamp}.zip"));
    let temp_path = destination.join(format!(".notia-backup-{timestamp}.tmp"));
    let result = (|| {
        let file = File::create(&temp_path).map_err(|_| "No se pudo crear el archivo temporal.")?;
        let mut zip = ZipWriter::new(file);
        add_directory(&mut zip, &library, &library)?;
        zip.finish()
            .map_err(|_| "No se pudo cerrar el archivo comprimido.")?;
        fs::rename(&temp_path, &final_path).map_err(|_| "No se pudo guardar el backup.")?;
        Ok::<(), String>(())
    })();
    let _ = fs::remove_file(&temp_path);
    result?;
    prune_backups(&destination, timestamp);
    Ok(BackupResult {
        ok: true,
        error: None,
    })
}

#[cfg(target_os = "windows")]
fn add_directory(zip: &mut ZipWriter<File>, root: &Path, current: &Path) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|_| "No se pudo leer la biblioteca.")? {
        let entry = entry.map_err(|_| "No se pudo leer la biblioteca.")?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "Ruta de biblioteca inválida.")?;
        let name = relative.to_string_lossy().replace('\\', "/");
        if entry
            .file_type()
            .map_err(|_| "No se pudo inspeccionar la biblioteca.")?
            .is_dir()
        {
            zip.add_directory(format!("{name}/"), SimpleFileOptions::default())
                .map_err(|_| "No se pudo comprimir la biblioteca.")?;
            add_directory(zip, root, &path)?;
        } else if entry
            .file_type()
            .map_err(|_| "No se pudo inspeccionar la biblioteca.")?
            .is_file()
        {
            let mut input =
                File::open(&path).map_err(|_| "No se pudo leer un archivo de la biblioteca.")?;
            zip.start_file(name, SimpleFileOptions::default())
                .map_err(|_| "No se pudo comprimir la biblioteca.")?;
            io::copy(&mut input, zip)
                .map_err(|_| "No se pudo comprimir un archivo de la biblioteca.")?;
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn prune_backups(destination: &Path, now: u64) {
    let max_age = Duration::from_secs(2 * 24 * 60 * 60).as_secs();
    let mut backups = Vec::new();
    if let Ok(entries) = fs::read_dir(destination) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) != Some("zip")
                || !path
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or_default()
                    .starts_with("notia-backup-")
            {
                continue;
            }
            if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                if let Ok(age) = modified.duration_since(UNIX_EPOCH) {
                    backups.push((age.as_secs(), path));
                }
            }
        }
    }
    backups.sort_by_key(|item| std::cmp::Reverse(item.0));
    let mut retained = 0usize;
    for (created, path) in backups {
        if now.saturating_sub(created) > max_age || retained >= 48 {
            let _ = fs::remove_file(path);
        } else {
            retained += 1;
        }
    }
}
