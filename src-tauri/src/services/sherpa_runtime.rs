use crate::dto::speech::SherpaRuntimeStatusDto;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const EXPECTED_SHERPA_ONNX_VERSION: &str = "1.13.4";
const WINDOWS_RUNTIME_RELATIVE_PATH: &[&str] = &[
    "resources",
    "speech",
    "runtime",
    "windows-x86_64",
    "sherpa-onnx-c-api.dll",
];
const ANDROID_RUNTIME_LIBRARY_NAME: &str = "libsherpa-onnx-c-api.so";

pub fn probe(app: &AppHandle) -> SherpaRuntimeStatusDto {
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        return probe_platform(app);
    }

    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        let _ = app;
        SherpaRuntimeStatusDto {
            supported: false,
            installed: false,
            compatible: false,
            expected_version: EXPECTED_SHERPA_ONNX_VERSION.to_string(),
            runtime_version: None,
            onnx_runtime_version: None,
            error_message: Some(
                "El runtime sherpa-onnx todavia no esta integrado en esta plataforma.".to_string(),
            ),
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
fn probe_platform(app: &AppHandle) -> SherpaRuntimeStatusDto {
    let runtime_path = match resolve_platform_runtime_path(app) {
        Ok(path) => path,
        Err(message) => return unavailable(false, message),
    };
    if !cfg!(target_os = "android") && !runtime_path.is_file() {
        return unavailable(
            false,
            "El runtime sherpa-onnx no esta incluido en la instalacion.".to_string(),
        );
    }

    match unsafe { LoadedSherpaLibrary::load(&runtime_path) } {
        Ok(library) => match library.version_info() {
            Ok((runtime_version, onnx_runtime_version)) => {
                let compatible = runtime_version == EXPECTED_SHERPA_ONNX_VERSION;
                SherpaRuntimeStatusDto {
                    supported: true,
                    installed: true,
                    compatible,
                    expected_version: EXPECTED_SHERPA_ONNX_VERSION.to_string(),
                    runtime_version: Some(runtime_version.clone()),
                    onnx_runtime_version,
                    error_message: (!compatible).then(|| {
                        format!(
                            "Version sherpa-onnx incompatible: se esperaba {EXPECTED_SHERPA_ONNX_VERSION} y se encontro {runtime_version}."
                        )
                    }),
                }
            }
            Err(message) => unavailable(true, message),
        },
        Err(message) => unavailable(true, message),
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) fn resolve_platform_runtime_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(target_os = "android") {
        return Ok(PathBuf::from(ANDROID_RUNTIME_LIBRARY_NAME));
    }
    let mut path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("No se pudo resolver el directorio de recursos: {error}"))?;
    for component in WINDOWS_RUNTIME_RELATIVE_PATH {
        path.push(component);
    }
    Ok(path)
}

fn unavailable(installed: bool, message: String) -> SherpaRuntimeStatusDto {
    SherpaRuntimeStatusDto {
        supported: cfg!(any(target_os = "windows", target_os = "android")),
        installed,
        compatible: false,
        expected_version: EXPECTED_SHERPA_ONNX_VERSION.to_string(),
        runtime_version: None,
        onnx_runtime_version: None,
        error_message: Some(message),
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub(crate) struct LoadedSherpaLibrary {
    // Rust drops fields in declaration order: sherpa must unload before ORT.
    library: libloading::Library,
    #[cfg(target_os = "windows")]
    _onnx_runtime: libloading::Library,
}

#[cfg(any(target_os = "windows", target_os = "android"))]
impl LoadedSherpaLibrary {
    /// The library path is resolved exclusively from Tauri's packaged resource directory.
    /// Keeping `Library` alive guarantees that all resolved function pointers remain valid.
    pub(crate) unsafe fn load(path: &std::path::Path) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            use libloading::os::windows::{
                Library as WindowsLibrary, LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
                LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR,
            };
            let flags = LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
            let runtime_directory = path.parent().ok_or_else(|| {
                "La ruta del runtime sherpa-onnx no tiene directorio.".to_string()
            })?;
            let onnx_path = runtime_directory.join("onnxruntime.dll");
            if !onnx_path.is_file() {
                return Err("Falta onnxruntime.dll junto al runtime sherpa-onnx.".to_string());
            }
            // Load the packaged ORT by absolute path before sherpa. Otherwise the
            // normal Windows search order can select an incompatible DLL from PATH.
            let onnx_runtime: libloading::Library =
                unsafe { WindowsLibrary::load_with_flags(&onnx_path, flags) }
                    .map(Into::into)
                    .map_err(|error| {
                        format!("No se pudo cargar ONNX Runtime empaquetado: {error}")
                    })?;
            let library: libloading::Library =
                unsafe { WindowsLibrary::load_with_flags(path, flags) }
                    .map(Into::into)
                    .map_err(|error| format!("No se pudo cargar sherpa-onnx: {error}"))?;
            return Ok(Self {
                library,
                _onnx_runtime: onnx_runtime,
            });
        }
        #[cfg(not(target_os = "windows"))]
        {
            let library = unsafe { libloading::Library::new(path) }
                .map_err(|error| format!("No se pudo cargar sherpa-onnx: {error}"))?;
            Ok(Self { library })
        }
    }

    pub(crate) unsafe fn get<T>(
        &self,
        symbol: &[u8],
    ) -> Result<libloading::Symbol<'_, T>, libloading::Error> {
        unsafe { self.library.get(symbol) }
    }

    fn version_info(&self) -> Result<(String, Option<String>), String> {
        type GetStaticString = unsafe extern "C" fn() -> *const std::ffi::c_char;
        let sherpa_version = unsafe {
            let function: libloading::Symbol<'_, GetStaticString> = self
                .library
                .get(b"SherpaOnnxGetVersionStr\0")
                .map_err(|error| {
                    format!("El runtime no exporta SherpaOnnxGetVersionStr: {error}")
                })?;
            read_static_c_string(function(), "version de sherpa-onnx")?
        };
        // Some official Windows 1.13.4 archives predate this optional diagnostic
        // export. ASR compatibility is determined by the sherpa-onnx version; a
        // missing ONNX Runtime version must not disable an otherwise valid runtime.
        let onnx_version = unsafe {
            self.library
                .get::<GetStaticString>(b"SherpaOnnxGetOnnxruntimeVersionStr\0")
                .ok()
                .and_then(|function| {
                    read_static_c_string(function(), "version de ONNX Runtime").ok()
                })
        };
        Ok((sherpa_version, onnx_version))
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
unsafe fn read_static_c_string(
    value: *const std::ffi::c_char,
    label: &str,
) -> Result<String, String> {
    if value.is_null() {
        return Err(format!("El runtime devolvio una {label} nula."));
    }
    let value = unsafe { std::ffi::CStr::from_ptr(value) }
        .to_str()
        .map_err(|_| format!("El runtime devolvio una {label} que no es UTF-8."))?;
    if value.is_empty() || value.len() > 80 {
        return Err(format!("El runtime devolvio una {label} invalida."));
    }
    Ok(value.to_string())
}

#[cfg(test)]
mod tests {
    use super::{unavailable, EXPECTED_SHERPA_ONNX_VERSION};

    #[test]
    fn unavailable_runtime_never_claims_compatibility() {
        let status = unavailable(false, "missing".to_string());
        assert!(!status.installed);
        assert!(!status.compatible);
        assert_eq!(status.expected_version, EXPECTED_SHERPA_ONNX_VERSION);
    }
}
