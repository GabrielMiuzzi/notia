//! Exclusive use of the data folder. The window and the headless server
//! share SQLite databases, caches and settings there; only one process may
//! run over the same folder at a time.

use std::fs::{File, OpenOptions};
use std::path::Path;

const LOCK_FILE: &str = "notia.lock";

/// Held while the process runs; the operating system releases the lock when
/// the process ends, even if it crashes.
#[derive(Debug)]
pub struct DataDirLock {
    _file: File,
}

impl DataDirLock {
    pub fn acquire(data_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|_| "No se pudo preparar la carpeta de datos de Notia.".to_string())?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(data_dir.join(LOCK_FILE))
            .map_err(|_| "No se pudo abrir el bloqueo de la carpeta de datos de Notia.".to_string())?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(std::fs::TryLockError::WouldBlock) => Err(
                "Otra instancia de Notia (la aplicación o el servidor headless) ya está usando esta carpeta de datos."
                    .to_string(),
            ),
            Err(std::fs::TryLockError::Error(_)) => {
                Err("No se pudo bloquear la carpeta de datos de Notia.".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_holder_is_refused_until_the_first_releases() {
        let directory = std::env::temp_dir().join(format!("notia-lock-test-{}", uuid::Uuid::new_v4()));
        let first = DataDirLock::acquire(&directory).expect("first lock");
        assert!(DataDirLock::acquire(&directory).is_err());
        drop(first);
        assert!(DataDirLock::acquire(&directory).is_ok());
        let _ = std::fs::remove_dir_all(&directory);
    }
}
