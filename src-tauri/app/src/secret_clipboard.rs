//! Copies a secret to the clipboard of this device and clears it after
//! [`CLEAR_AFTER`], unless something else was copied meanwhile. Windows keeps
//! it out of the clipboard history and the cloud clipboard and checks the
//! clipboard sequence number, so it never reads what is copied. Android
//! marks it sensitive and clears it from the Kotlin plugin. Elsewhere the
//! copy is not supported and the interface copies by itself.

use std::time::Duration;

use crate::backend::{BackendError, BackendErrorCode};
use crate::host::AppHandle;

pub(crate) const CLEAR_AFTER: Duration = Duration::from_secs(30);
const MAX_SECRET_CHARS: usize = 10_000;

/// Copies `text` and schedules its clearing.
pub(crate) fn copy_secret(app: &AppHandle, text: &str) -> Result<(), BackendError> {
    if text.is_empty() || text.chars().count() > MAX_SECRET_CHARS {
        return Err(BackendError::invalid_input("No hay nada válido para copiar."));
    }
    platform::copy_secret(app, text)
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW,
        SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    use super::{BackendError, BackendErrorCode, CLEAR_AFTER};
    use crate::host::AppHandle;

    const CF_UNICODETEXT: u32 = 13;
    /// Another program may hold the clipboard for a moment.
    const OPEN_ATTEMPTS: u32 = 10;

    /// The clipboard, open until dropped.
    struct OpenedClipboard;

    impl OpenedClipboard {
        fn open() -> Option<Self> {
            for _ in 0..OPEN_ATTEMPTS {
                // SAFETY: no window owns the clipboard; it is closed on drop.
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Some(Self);
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            None
        }
    }

    impl Drop for OpenedClipboard {
        fn drop(&mut self) {
            // SAFETY: this value opened the clipboard.
            let _ = unsafe { CloseClipboard() };
        }
    }

    /// Places `bytes` in `format`; the clipboard owns the memory afterwards.
    fn set_data(format: u32, bytes: &[u8]) -> Option<()> {
        // SAFETY: the block is `bytes.len()` long, locked while it is written
        // and freed here only when the clipboard did not take it.
        unsafe {
            let memory: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).ok()?;
            let target = GlobalLock(memory);
            if target.is_null() {
                let _ = GlobalFree(Some(memory));
                return None;
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast::<u8>(), bytes.len());
            // Unlocking the last lock reports an error with no error code.
            let _ = GlobalUnlock(memory);
            if SetClipboardData(format, Some(HANDLE(memory.0))).is_err() {
                let _ = GlobalFree(Some(memory));
                return None;
            }
        }
        Some(())
    }

    /// Copies `text` and returns the clipboard sequence number it left,
    /// read once the clipboard is closed: closing it counts as a change.
    fn write(text: &str) -> Option<u32> {
        fill(text)?;
        // SAFETY: plain query.
        Some(unsafe { GetClipboardSequenceNumber() })
    }

    fn fill(text: &str) -> Option<()> {
        let _clipboard = OpenedClipboard::open()?;
        // SAFETY: the clipboard is open.
        unsafe { EmptyClipboard() }.ok()?;
        let wide = text.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect::<Vec<_>>();
        set_data(CF_UNICODETEXT, &wide)?;
        // Keep the secret out of the clipboard history (Win + V), the cloud
        // clipboard and clipboard monitors. Best effort: older Windows
        // versions ignore these formats.
        let no = 0u32.to_le_bytes();
        for format in [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("CanIncludeInClipboardHistory"),
            w!("CanUploadToCloudClipboard"),
        ] {
            // SAFETY: the name is a static wide string.
            let id = unsafe { RegisterClipboardFormatW(format) };
            if id != 0 {
                let _ = set_data(id, &no);
            }
        }
        Some(())
    }

    fn clear_if_unchanged(sequence: u32) {
        // SAFETY: plain query.
        if unsafe { GetClipboardSequenceNumber() } != sequence {
            return;
        }
        if let Some(_clipboard) = OpenedClipboard::open() {
            // SAFETY: the clipboard is open.
            let _ = unsafe { EmptyClipboard() };
        }
    }

    fn copy_failed() -> BackendError {
        BackendError::new(BackendErrorCode::Internal, "No se pudo copiar al portapapeles.", true)
    }

    pub(super) fn copy_secret(_app: &AppHandle, text: &str) -> Result<(), BackendError> {
        let sequence = write(text).ok_or_else(copy_failed)?;
        std::thread::spawn(move || {
            std::thread::sleep(CLEAR_AFTER);
            clear_if_unchanged(sequence);
        });
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows::Win32::System::DataExchange::{GetClipboardData, IsClipboardFormatAvailable};

        fn clipboard_text() -> Option<String> {
            let _clipboard = OpenedClipboard::open()?;
            // SAFETY: the clipboard is open and the block stays locked while read.
            unsafe {
                if IsClipboardFormatAvailable(CF_UNICODETEXT).is_err() {
                    return None;
                }
                let handle = GetClipboardData(CF_UNICODETEXT).ok()?;
                let memory = HGLOBAL(handle.0);
                let pointer = GlobalLock(memory).cast::<u16>();
                if pointer.is_null() {
                    return None;
                }
                let length = (0..).take_while(|&index| *pointer.add(index) != 0).count();
                let text = String::from_utf16_lossy(std::slice::from_raw_parts(pointer, length));
                let _ = GlobalUnlock(memory);
                Some(text)
            }
        }

        /// Uses the real clipboard of this computer, so it only runs on
        /// demand: `cargo test -p notia-app secret_clipboard -- --ignored`.
        #[test]
        #[ignore]
        fn probe_copies_and_clears_only_its_own_secret() {
            let sequence = write("clave-de-prueba-ñ").expect("copy");
            assert_eq!(clipboard_text().as_deref(), Some("clave-de-prueba-ñ"));
            clear_if_unchanged(sequence);
            assert_eq!(clipboard_text(), None, "cleared when nothing else was copied");
            let stale = write("primera").expect("copy");
            write("segunda").expect("copy");
            clear_if_unchanged(stale);
            assert_eq!(clipboard_text().as_deref(), Some("segunda"), "a later copy is kept");
            let last = write("otra").expect("copy");
            clear_if_unchanged(last);
        }
    }
}

#[cfg(target_os = "android")]
mod platform {
    use super::{BackendError, BackendErrorCode, CLEAR_AFTER};
    use crate::host::{AppHandle, Manager};

    pub(super) fn copy_secret(app: &AppHandle, text: &str) -> Result<(), BackendError> {
        let state = app.state::<crate::mobile_continuity::ContinuityState>();
        crate::mobile_continuity::copy_android_secret(state.inner(), text, CLEAR_AFTER.as_millis() as u64)
            .map_err(|message| BackendError::new(BackendErrorCode::Internal, message, true))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "android")))]
mod platform {
    use super::{BackendError, BackendErrorCode};
    use crate::host::AppHandle;

    pub(super) fn copy_secret(_app: &AppHandle, _text: &str) -> Result<(), BackendError> {
        Err(BackendError::new(
            BackendErrorCode::Unsupported,
            "Este dispositivo no copia con borrado automático.",
            false,
        ))
    }
}
