use serde::Deserialize;
use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[cfg(target_os = "windows")]
const BACKUP_FILE_PREFIX: &str = "notia-backup-";
#[cfg(target_os = "windows")]
const TEMP_FILE_PREFIX: &str = ".notia-backup-";
#[cfg(target_os = "windows")]
const MAX_BACKUP_AGE_SECS: u64 = 2 * 24 * 60 * 60;
#[cfg(target_os = "windows")]
const STALE_TEMP_MAX_AGE_SECS: u64 = 24 * 60 * 60;
#[cfg(target_os = "windows")]
const MAX_BACKUP_COUNT: usize = 48;

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
    prune_backups(&destination, timestamp);
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
    prune_backups(&destination, timestamp);
    result?;
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
    let mut backups = Vec::new();
    if let Ok(entries) = fs::read_dir(destination) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            if is_backup_temp(file_name) {
                let modified_timestamp = entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .ok()
                    .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                    .map(|age| age.as_secs());
                if is_stale_backup_temp(modified_timestamp, now) {
                    let _ = fs::remove_file(path);
                }
                continue;
            }
            if path.extension().and_then(|v| v.to_str()) != Some("zip")
                || !file_name.starts_with(BACKUP_FILE_PREFIX)
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
        if now.saturating_sub(created) > MAX_BACKUP_AGE_SECS || retained >= MAX_BACKUP_COUNT {
            let _ = fs::remove_file(path);
        } else {
            retained += 1;
        }
    }
}

#[cfg(target_os = "windows")]
fn is_backup_temp(file_name: &str) -> bool {
    file_name.starts_with(TEMP_FILE_PREFIX) && file_name.ends_with(".tmp")
}

#[cfg(target_os = "windows")]
fn is_stale_backup_temp(modified_timestamp: Option<u64>, now: u64) -> bool {
    modified_timestamp
        .map(|modified| now.saturating_sub(modified) > STALE_TEMP_MAX_AGE_SECS)
        .unwrap_or(false)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{
        is_backup_temp, is_stale_backup_temp, MAX_BACKUP_AGE_SECS, STALE_TEMP_MAX_AGE_SECS,
    };

    #[test]
    fn recognizes_only_notia_backup_temporary_files() {
        assert!(is_backup_temp(".notia-backup-123.tmp"));
        assert!(!is_backup_temp("notia-backup-123.zip"));
        assert!(!is_backup_temp(".other-backup-123.tmp"));
    }

    #[test]
    fn temporary_files_expire_before_regular_backups() {
        assert!(STALE_TEMP_MAX_AGE_SECS < MAX_BACKUP_AGE_SECS);
        assert!(is_stale_backup_temp(Some(0), STALE_TEMP_MAX_AGE_SECS + 1));
        assert!(!is_stale_backup_temp(Some(1), STALE_TEMP_MAX_AGE_SECS + 1));
        assert!(!is_stale_backup_temp(None, STALE_TEMP_MAX_AGE_SECS + 1));
    }
}
