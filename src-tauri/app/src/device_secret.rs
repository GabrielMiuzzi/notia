//! Secrets kept on this device for «Recordar sesión» and «Recordar datos».
//! On Windows they are sealed with the person's Windows account (DPAPI), so
//! another account or machine cannot read the file. On Android and Linux
//! they stay in the app's private data folder, which other apps cannot read.

use crate::backend::{BackendError, BackendErrorCode};

fn failed() -> BackendError {
    BackendError::new(BackendErrorCode::Storage, "No se pudo proteger el dato en este equipo.", true)
}

#[cfg(target_os = "windows")]
const ENTROPY: &[u8] = b"notia-app-auth-v1";

/// `secret` sealed for this device and account.
#[cfg(target_os = "windows")]
pub(crate) fn protect(secret: &[u8]) -> Result<Vec<u8>, BackendError> {
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: secret.len() as u32, pbData: secret.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: the blobs point to live buffers for the duration of the call;
    // the output buffer is copied and then released with `LocalFree`.
    unsafe {
        CryptProtectData(&input, windows::core::PCWSTR::null(), Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|_| failed())?;
        Ok(take_blob(output))
    }
}

/// The secret `protect` sealed, or `None` when it cannot be opened here.
#[cfg(target_os = "windows")]
pub(crate) fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: sealed.len() as u32, pbData: sealed.as_ptr() as *mut u8 };
    let entropy = CRYPT_INTEGER_BLOB { cbData: ENTROPY.len() as u32, pbData: ENTROPY.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: as in `protect`.
    unsafe {
        CryptUnprotectData(&input, None, Some(&entropy), None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output).ok()?;
        Some(take_blob(output))
    }
}

/// Copies a blob allocated by DPAPI and frees it.
#[cfg(target_os = "windows")]
unsafe fn take_blob(blob: windows::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    let bytes = if blob.pbData.is_null() {
        Vec::new()
    } else {
        // SAFETY: DPAPI returned `cbData` readable bytes at `pbData`.
        unsafe { std::slice::from_raw_parts(blob.pbData, blob.cbData as usize).to_vec() }
    };
    if !blob.pbData.is_null() {
        // SAFETY: the buffer was allocated by DPAPI with LocalAlloc.
        unsafe {
            let _ = windows::Win32::Foundation::LocalFree(Some(windows::Win32::Foundation::HLOCAL(blob.pbData as *mut core::ffi::c_void)));
        }
    }
    bytes
}

/// Outside Windows the secret stays in the app's private data folder.
#[cfg(not(target_os = "windows"))]
pub(crate) fn protect(secret: &[u8]) -> Result<Vec<u8>, BackendError> {
    let _ = failed;
    Ok(secret.to_vec())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn unprotect(sealed: &[u8]) -> Option<Vec<u8>> {
    Some(sealed.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_protected_secret_opens_on_this_device() {
        let sealed = protect(b"clave de datos").expect("protected");
        assert_eq!(unprotect(&sealed).as_deref(), Some(&b"clave de datos"[..]));
        #[cfg(target_os = "windows")]
        {
            assert_ne!(sealed, b"clave de datos".to_vec());
            assert!(unprotect(b"no sellado").is_none());
        }
    }
}
