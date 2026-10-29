//! Images of the agent on this device: the Qwen-Image 2.1 Turbo files in
//! `app_data/image-models/`, downloaded and verified from Configuración →
//! Imágenes; `sd-cli` (`resources/stable-diffusion/runtime`) run as a
//! separate process, one image at a time; and the images each request made,
//! kept in memory until the chat or Telegram takes them with the reply. The
//! rules (files, arguments, size, command) live in
//! `backend_core::image_generation`. Only Windows generates images: an
//! Android client asks its host, whose chat turns run there.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use serde::Serialize;
use sha2::Digest as _;

use crate::backend::image_generation::{self as images, ImageJob, ModelFile, ModelPaths, ModelRole, MODEL_FILES, MODEL_PROFILE};
use crate::backend::{BackendError, BackendErrorCode, RequestControl};
use crate::host::{AppHandle, Manager};

#[cfg(target_os = "windows")]
const RUNTIME_RELATIVE_PATH: &str = "resources/stable-diffusion/runtime/windows-x86_64/sd-cli.exe";
/// A 1024 × 1024 image takes about a minute on a 12 GB card; a larger
/// one, or a card that falls back to the CPU, takes longer.
const RUN_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// Requests whose images are kept until their reply takes them.
const MAX_KEPT_REQUESTS: usize = 32;
/// Last bytes of the output of `sd-cli` read to explain a failure.
const MAX_OUTPUT_TAIL: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(200);

fn internal(message: &str) -> BackendError {
    BackendError::new(BackendErrorCode::Internal, message, true)
}

// ---------------------------------------------------------------------------
// Images of each request
// ---------------------------------------------------------------------------

/// An image a request made (PNG) or another tool kept for the person (a
/// browser screenshot, JPEG), in Base64, named by its reference.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GeneratedImage {
    pub name: String,
    pub base64: String,
    pub media_type: &'static str,
}

fn generated() -> &'static Mutex<VecDeque<(String, Vec<GeneratedImage>)>> {
    static GENERATED: OnceLock<Mutex<VecDeque<(String, Vec<GeneratedImage>)>>> = OnceLock::new();
    GENERATED.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn keep_generated(request_id: &str, image: GeneratedImage) {
    let Ok(mut kept) = generated().lock() else { return };
    match kept.iter_mut().find(|(id, _)| id == request_id) {
        Some((_, list)) => list.push(image),
        None => kept.push_back((request_id.to_string(), vec![image])),
    }
    while kept.len() > MAX_KEPT_REQUESTS {
        kept.pop_front();
    }
}

/// Keeps an image another tool made for the person, to go with the
/// generated ones: before the agent's next question on Telegram, or with
/// its reply. Returns its name.
pub(crate) fn keep_for_reply(request_id: &str, stem: &str, extension: &str, media_type: &'static str, base64: String) -> String {
    let name = format!("{stem}-{}.{extension}", generated_count(request_id) + 1);
    keep_generated(request_id, GeneratedImage { name: name.clone(), base64, media_type });
    name
}

/// The images `request_id` made, in order, removed from memory: the reply
/// that carries them takes them once.
pub(crate) fn take_generated(request_id: &str) -> Vec<GeneratedImage> {
    let Ok(mut kept) = generated().lock() else { return Vec::new() };
    match kept.iter().position(|(id, _)| id == request_id) {
        Some(index) => kept.remove(index).map(|(_, list)| list).unwrap_or_default(),
        None => Vec::new(),
    }
}

/// An image `request_id` already made, by its reference: an edit in the
/// same turn starts from it.
fn generated_in(request_id: &str, name: &str) -> Option<String> {
    let kept = generated().lock().ok()?;
    kept.iter()
        .find(|(id, _)| id == request_id)
        .and_then(|(_, list)| list.iter().find(|image| image.name == name))
        .map(|image| image.base64.clone())
}

fn generated_count(request_id: &str) -> usize {
    generated().lock().ok().and_then(|kept| kept.iter().find(|(id, _)| id == request_id).map(|(_, list)| list.len())).unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Model files and runtime
// ---------------------------------------------------------------------------

fn models_dir(app: &AppHandle) -> Result<PathBuf, BackendError> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("image-models").join(MODEL_PROFILE))
        .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudo resolver la carpeta de los modelos de imágenes.", true))
}

/// `sd-cli`, from the packaged resources (the source tree in development).
#[cfg(target_os = "windows")]
fn runtime_path(app: &AppHandle) -> Result<PathBuf, BackendError> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        Ok(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/..")).join(RUNTIME_RELATIVE_PATH))
    }
    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resource_dir()
            .map(|directory| directory.join(RUNTIME_RELATIVE_PATH))
            .map_err(|_| internal("No se pudo resolver el directorio de recursos."))
    }
}

#[cfg(not(target_os = "windows"))]
fn runtime_path(_app: &AppHandle) -> Result<PathBuf, BackendError> {
    Err(unsupported())
}

fn unsupported() -> BackendError {
    BackendError::new(
        BackendErrorCode::Unsupported,
        "Las imágenes se generan en la PC con Windows; desde el celular, conectate a ella como cliente.",
        false,
    )
}

fn file_ready(directory: &Path, file: &ModelFile) -> bool {
    std::fs::metadata(directory.join(file.name)).is_ok_and(|metadata| metadata.len() == file.size)
}

fn runtime_ready(app: &AppHandle) -> bool {
    runtime_path(app).is_ok_and(|path| path.is_file())
}

fn models_ready(app: &AppHandle) -> bool {
    models_dir(app).is_ok_and(|directory| MODEL_FILES.iter().all(|file| file_ready(&directory, file)))
}

/// Whether this device can generate images now: Windows, with `sd-cli`
/// and every model file. The image tools are offered only then.
pub(crate) fn is_available(app: &AppHandle) -> bool {
    cfg!(target_os = "windows") && runtime_ready(app) && models_ready(app)
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Download {
    running: bool,
    cancel: Arc<AtomicBool>,
    /// Bytes of the files already verified plus the one downloading.
    downloaded: u64,
    error: Option<String>,
}

fn download() -> &'static Mutex<Download> {
    static DOWNLOAD: OnceLock<Mutex<Download>> = OnceLock::new();
    DOWNLOAD.get_or_init(|| Mutex::new(Download::default()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageModelsStatus {
    /// This device generates images (Windows).
    supported: bool,
    /// `sd-cli` is in the resources.
    runtime_ready: bool,
    /// Every model file is downloaded and complete.
    installed: bool,
    total_bytes: u64,
    downloaded_bytes: u64,
    downloading: bool,
    error: Option<String>,
}

fn ready_bytes(directory: &Path) -> u64 {
    MODEL_FILES.iter().filter(|file| file_ready(directory, file)).map(|file| file.size).sum()
}

fn status(app: &AppHandle) -> ImageModelsStatus {
    let directory = models_dir(app).ok();
    let ready = directory.as_deref().map(ready_bytes).unwrap_or(0);
    let (downloading, downloaded, error) = download()
        .lock()
        .map(|state| (state.running, state.downloaded, state.error.clone()))
        .unwrap_or((false, 0, None));
    ImageModelsStatus {
        supported: cfg!(target_os = "windows"),
        runtime_ready: runtime_ready(app),
        installed: models_ready(app),
        total_bytes: images::total_model_bytes(),
        downloaded_bytes: if downloading { downloaded.max(ready) } else { ready },
        downloading,
        error,
    }
}

fn set_progress(downloaded: u64) {
    if let Ok(mut state) = download().lock() {
        state.downloaded = downloaded;
    }
}

/// SHA-256 of a file read in blocks.
fn file_sha256(path: &Path) -> std::io::Result<sha2::Sha256> {
    let mut hasher = sha2::Sha256::new();
    let mut file = std::fs::File::open(path)?;
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(hasher);
        }
        hasher.update(&buffer[..read]);
    }
}

/// Downloads `file` into `directory`, resuming a `.part` left by a
/// cancelled or failed download, and keeps it only when its size and
/// SHA-256 match. `before` is the bytes of the files already verified, for
/// the progress.
async fn download_file(directory: &Path, file: &ModelFile, before: u64, cancel: &AtomicBool) -> Result<(), String> {
    let target = directory.join(file.name);
    let part = directory.join(format!("{}.part", file.name));
    let mut offset = std::fs::metadata(&part).map(|metadata| metadata.len()).unwrap_or(0);
    if offset > file.size {
        let _ = std::fs::remove_file(&part);
        offset = 0;
    }
    let mut hasher = if offset > 0 { file_sha256(&part).map_err(|_| "No se pudo leer la descarga parcial.".to_string())? } else { sha2::Sha256::new() };
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(120))
        .build()
        .map_err(|_| "No se pudo preparar la descarga.".to_string())?;
    let mut request = client.get(file.url);
    if offset > 0 && offset < file.size {
        request = request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
    }
    let mut response = request.send().await.map_err(|_| "No se pudo conectar con Hugging Face.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("Hugging Face respondió {} al descargar {}.", response.status().as_u16(), file.name));
    }
    // The server ignored the range: the file starts over.
    if offset > 0 && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        offset = 0;
        hasher = sha2::Sha256::new();
    }
    let mut output = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(&part)
        .map_err(|_| "No se pudo escribir el modelo en el disco.".to_string())?;
    let mut written = offset;
    let mut last_report = Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|_| format!("Se cortó la descarga de {}; volvé a intentar y sigue desde donde quedó.", file.name))? {
        if cancel.load(Ordering::SeqCst) {
            return Err("Descarga cancelada.".to_string());
        }
        output.write_all(&chunk).map_err(|_| "No se pudo escribir el modelo en el disco (¿falta espacio?).".to_string())?;
        hasher.update(&chunk);
        written += chunk.len() as u64;
        if written > file.size {
            break;
        }
        if last_report.elapsed() >= Duration::from_millis(500) {
            set_progress(before + written);
            last_report = Instant::now();
        }
    }
    output.flush().map_err(|_| "No se pudo escribir el modelo en el disco.".to_string())?;
    drop(output);
    let digest = format!("{:x}", hasher.finalize());
    if written != file.size || digest != file.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(format!("{} llegó dañado (no coincide su verificación); se descartó. Volvé a intentar.", file.name));
    }
    std::fs::rename(&part, &target).map_err(|_| "No se pudo guardar el modelo descargado.".to_string())?;
    set_progress(before + file.size);
    Ok(())
}

fn run_download(app: AppHandle, cancel: Arc<AtomicBool>) {
    let result = (|| -> Result<(), String> {
        let directory = models_dir(&app).map_err(|error| error.message)?;
        std::fs::create_dir_all(&directory).map_err(|_| "No se pudo crear la carpeta de los modelos.".to_string())?;
        for file in MODEL_FILES.iter() {
            if file_ready(&directory, file) {
                continue;
            }
            let before = ready_bytes(&directory);
            crate::host::async_runtime::block_on(download_file(&directory, file, before, &cancel))?;
        }
        Ok(())
    })();
    if let Ok(mut state) = download().lock() {
        state.running = false;
        state.error = result.err().filter(|message| message != "Descarga cancelada.");
        if let Some(message) = &state.error {
            log::error!("[notia:images] la descarga de los modelos falló: {message}");
        }
    }
}

/// Starts downloading the missing model files in the background (about
/// 11.3 GB in all), unless a download already runs.
pub(crate) fn start_download(app: &AppHandle) -> Result<ImageModelsStatus, BackendError> {
    if !cfg!(target_os = "windows") {
        return Err(unsupported());
    }
    {
        let mut state = download().lock().map_err(|_| internal("No se pudo iniciar la descarga."))?;
        if !state.running {
            state.running = true;
            state.error = None;
            state.cancel = Arc::new(AtomicBool::new(false));
            state.downloaded = models_dir(app).map(|directory| ready_bytes(&directory)).unwrap_or(0);
            let (app, cancel) = (app.clone(), Arc::clone(&state.cancel));
            std::thread::spawn(move || run_download(app, cancel));
        }
    }
    Ok(status(app))
}

pub(crate) fn cancel_download(app: &AppHandle) -> ImageModelsStatus {
    if let Ok(state) = download().lock() {
        state.cancel.store(true, Ordering::SeqCst);
    }
    status(app)
}

/// Removes the model files (and any partial download) from this device.
pub(crate) fn delete_models(app: &AppHandle) -> Result<ImageModelsStatus, BackendError> {
    if download().lock().map(|state| state.running).unwrap_or(false) {
        return Err(BackendError::invalid_input("Cancelá la descarga antes de borrar los modelos."));
    }
    let directory = models_dir(app)?;
    if directory.exists() {
        std::fs::remove_dir_all(&directory)
            .map_err(|_| BackendError::new(BackendErrorCode::Storage, "No se pudieron borrar los modelos de imágenes.", true))?;
    }
    Ok(status(app))
}

pub(crate) fn backend_image_models_status(app: AppHandle) -> Result<ImageModelsStatus, BackendError> {
    Ok(status(&app))
}

pub(crate) fn backend_download_image_models(app: AppHandle) -> Result<ImageModelsStatus, BackendError> {
    start_download(&app)
}

pub(crate) fn backend_cancel_image_models_download(app: AppHandle) -> Result<ImageModelsStatus, BackendError> {
    Ok(cancel_download(&app))
}

pub(crate) fn backend_delete_image_models(app: AppHandle) -> Result<ImageModelsStatus, BackendError> {
    delete_models(&app)
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/// Asks the Ollama at `url` (on this computer) to unload the models it
/// keeps on the GPU, so the image model has the card; Ollama loads the chat
/// model again for the next reply. Best effort: an Ollama that does not
/// answer leaves the image to the memory it finds.
pub(crate) fn release_ollama_gpu(url: &str) {
    let url = url.trim_end_matches('/').to_string();
    let released = crate::host::async_runtime::block_on(async move {
        let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).build().ok()?;
        let loaded = client.get(format!("{url}/api/ps")).send().await.ok()?.json::<serde_json::Value>().await.ok()?;
        let mut released = 0;
        for model in loaded.get("models")?.as_array()? {
            let on_gpu = model.get("size_vram").and_then(serde_json::Value::as_u64).unwrap_or(0) > 0;
            let Some(name) = model.get("name").and_then(serde_json::Value::as_str).filter(|_| on_gpu) else { continue };
            let body = serde_json::json!({ "model": name, "keep_alive": 0 });
            if client.post(format!("{url}/api/generate")).json(&body).send().await.is_ok() {
                released += 1;
            }
        }
        Some(released)
    });
    if let Some(count) = released.filter(|count| *count > 0) {
        log::info!("[notia:images] Ollama liberó {count} modelo(s) de la GPU para la imagen");
    }
}

/// One image at a time: two would not fit the GPU together.
fn running() -> &'static Mutex<()> {
    static RUNNING: Mutex<()> = Mutex::new(());
    &RUNNING
}

/// The model paths on this device.
fn model_paths(directory: &Path) -> ModelPaths {
    let path = |role| directory.join(images::model_file(role).name).to_string_lossy().into_owned();
    ModelPaths {
        diffusion: path(ModelRole::Diffusion),
        text_encoder: path(ModelRole::TextEncoder),
        vision: path(ModelRole::Vision),
        vae: path(ModelRole::Vae),
    }
}

/// The image an edit starts from, as PNG, and its size. Accepts the
/// formats the chat and Telegram attach (JPEG, PNG, WebP).
fn reference_png(base64: &str) -> Result<(Vec<u8>, (u32, u32)), BackendError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64.trim())
        .map_err(|_| BackendError::invalid_input("La imagen a editar no se pudo leer."))?;
    let image = image::load_from_memory(&bytes).map_err(|_| BackendError::invalid_input("La imagen a editar no es una imagen válida."))?;
    let size = (image.width(), image.height());
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|_| BackendError::invalid_input("La imagen a editar no se pudo preparar."))?;
    Ok((png, size))
}

/// Reads a pipe of `sd-cli` keeping its last `MAX_OUTPUT_TAIL` bytes.
fn read_tail(mut pipe: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut tail = Vec::new();
        let mut buffer = [0u8; 8192];
        while let Ok(read) = pipe.read(&mut buffer) {
            if read == 0 {
                break;
            }
            tail.extend_from_slice(&buffer[..read]);
            if tail.len() > MAX_OUTPUT_TAIL {
                tail.drain(..tail.len() - MAX_OUTPUT_TAIL);
            }
        }
        tail
    })
}

/// Waits for the turn of this image, while the request is not cancelled.
fn wait_turn<'a>(control: &RequestControl) -> Result<std::sync::MutexGuard<'a, ()>, BackendError> {
    loop {
        match running().try_lock() {
            Ok(guard) => return Ok(guard),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => return Ok(poisoned.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => {}
        }
        if control.is_cancelled() {
            return Err(BackendError::new(BackendErrorCode::Cancelled, "Se canceló la imagen.", false));
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Runs `sd-cli` for `job` in `work` and returns the PNG it drew.
fn run_sd_cli(app: &AppHandle, control: &RequestControl, job: &ImageJob, size: (u32, u32), reference: Option<&[u8]>, work: &Path) -> Result<Vec<u8>, BackendError> {
    let runtime = runtime_path(app)?;
    let directory = models_dir(app)?;
    let reference_path = match reference {
        Some(png) => {
            let path = work.join("referencia.png");
            std::fs::write(&path, png).map_err(|_| internal("No se pudo preparar la imagen a editar."))?;
            Some(path.to_string_lossy().into_owned())
        }
        None => None,
    };
    let output = work.join("imagen.png");
    let arguments = images::sd_cli_arguments(job, size, &model_paths(&directory), reference_path.as_deref(), &output.to_string_lossy());
    let mut command = std::process::Command::new(&runtime);
    command
        .args(&arguments)
        .current_dir(work)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt as _;
        // No console window over the app.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| internal("No se pudo iniciar el generador de imágenes."))?;
    let stdout = child.stdout.take().map(read_tail);
    let stderr = child.stderr.take().map(read_tail);
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| internal("Se perdió el generador de imágenes."))? {
            break status;
        }
        if control.is_cancelled() || started.elapsed() > RUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if control.is_cancelled() {
                BackendError::new(BackendErrorCode::Cancelled, "Se canceló la imagen.", false)
            } else {
                BackendError::new(BackendErrorCode::Timeout, "La imagen tardó demasiado y se cortó.", true)
            });
        }
        std::thread::sleep(POLL_INTERVAL);
    };
    let mut printed = stdout.and_then(|handle| handle.join().ok()).unwrap_or_default();
    printed.extend(stderr.and_then(|handle| handle.join().ok()).unwrap_or_default());
    match std::fs::read(&output) {
        Ok(png) if status.success() && !png.is_empty() => Ok(png),
        _ => {
            // The output may repeat the prompt: only the exit code is logged.
            log::error!("[notia:images] sd-cli terminó sin imagen (código {:?})", status.code());
            Err(images::run_error(&String::from_utf8_lossy(&printed)))
        }
    }
}

/// Generates the image of `job` (an edit starts from `reference`, an
/// image in Base64) and keeps it for the reply of `request_id`. Returns
/// what the model reads.
pub(crate) fn generate(
    app: &AppHandle,
    control: &RequestControl,
    request_id: &str,
    mut job: ImageJob,
    reference: Option<String>,
) -> Result<serde_json::Value, BackendError> {
    if !cfg!(target_os = "windows") {
        return Err(unsupported());
    }
    if !is_available(app) {
        return Err(BackendError::new(
            BackendErrorCode::Unsupported,
            "Faltan los modelos de imágenes en esta PC: descargalos en Configuración → Imágenes.",
            false,
        ));
    }
    let reference = reference.map(|base64| reference_png(&base64)).transpose()?;
    let size = job.size.or(reference.as_ref().map(|(_, (width, height))| images::fit_size(*width, *height))).unwrap_or((1024, 1024));
    job.size = Some(size);
    let _turn = wait_turn(control)?;
    let work = models_dir(app)?.with_file_name("runs").join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&work).map_err(|_| internal("No se pudo preparar la carpeta de trabajo de la imagen."))?;
    let png = run_sd_cli(app, control, &job, size, reference.as_ref().map(|(png, _)| png.as_slice()), &work);
    let _ = std::fs::remove_dir_all(&work);
    let png = png?;
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H-%M-%S").to_string();
    let name = images::image_file_name(&stamp, generated_count(request_id) + 1);
    keep_generated(request_id, GeneratedImage { name: name.clone(), base64: base64::engine::general_purpose::STANDARD.encode(&png), media_type: "image/png" });
    Ok(images::tool_result(&name, size, job.seed, job.reference.as_deref()))
}

/// A seed that changes on every image.
pub(crate) fn random_seed() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| (elapsed.as_nanos() % i64::MAX as u128) as i64)
        .unwrap_or_default()
}

/// Runs a `/image` command of `request_id`: the person's text goes to the
/// model as written, without the chat model in between. With `reference`
/// (an attached image: its name and Base64) it edits it; otherwise it
/// draws a new image. The image stays for the reply (`take_generated`);
/// returns the text that goes with it.
pub(crate) fn run_command(
    app: &AppHandle,
    library_id: &str,
    control: &RequestControl,
    request_id: &str,
    command: &images::ImageCommand,
    reference: Option<(String, String)>,
) -> Result<String, BackendError> {
    let arguments = images::command_arguments(command, reference.as_ref().map(|(name, _)| name.as_str()));
    let job = match reference {
        Some(_) => images::edit_job(&arguments, random_seed())?,
        None => images::generate_job(&arguments, random_seed())?,
    };
    if let Some(url) = crate::backend_runtime::local_ollama_url(app, library_id) {
        release_ollama_gpu(&url);
    }
    let result = generate(app, control, request_id, job, reference.map(|(_, base64)| base64))?;
    Ok(images::command_reply(&result))
}

/// Cancels `control` once `cancelled` says so, until `done`: the chat and
/// Telegram stop a `/image` the way they stop any request.
pub(crate) fn cancel_when(control: &RequestControl, done: Arc<AtomicBool>, cancelled: impl Fn() -> bool + Send + 'static) {
    let control = control.clone();
    std::thread::spawn(move || {
        while !done.load(Ordering::SeqCst) {
            if cancelled() {
                control.cancel();
                return;
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    });
}

/// The image an edit names: one of the conversation (`conversation`, by
/// reference) or one this request already made.
pub(crate) fn find_reference(request_id: &str, name: &str, conversation: &[(String, String)]) -> Option<String> {
    conversation
        .iter()
        .rev()
        .find(|(reference, _)| reference == name)
        .map(|(_, base64)| base64.clone())
        .or_else(|| generated_in(request_id, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_keeps_its_images_until_its_reply_takes_them() {
        let image = |name: &str| GeneratedImage { name: name.into(), base64: format!("b64-{name}"), media_type: "image/png" };
        keep_generated("req-images-1", image("a.png"));
        keep_generated("req-images-1", image("b.png"));
        assert_eq!(generated_count("req-images-1"), 2);
        assert_eq!(find_reference("req-images-1", "b.png", &[]).as_deref(), Some("b64-b.png"));
        assert_eq!(
            find_reference("req-images-1", "b.png", &[("b.png".into(), "del-chat".into())]).as_deref(),
            Some("del-chat"),
            "the conversation's image wins"
        );
        assert_eq!(take_generated("req-images-1").iter().map(|image| image.name.as_str()).collect::<Vec<_>>(), vec!["a.png", "b.png"]);
        assert!(take_generated("req-images-1").is_empty());
        for index in 0..MAX_KEPT_REQUESTS + 3 {
            keep_generated(&format!("req-images-cap-{index}"), image("x.png"));
        }
        assert!(take_generated("req-images-cap-0").is_empty(), "the oldest requests are dropped");
    }

    #[test]
    fn references_become_png_with_their_size() {
        let mut jpeg = Vec::new();
        image::RgbImage::new(40, 30).write_to(&mut std::io::Cursor::new(&mut jpeg), image::ImageFormat::Jpeg).expect("jpeg");
        let (png, size) = reference_png(&base64::engine::general_purpose::STANDARD.encode(&jpeg)).expect("png");
        assert_eq!(size, (40, 30));
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(reference_png("no es base64!").is_err());
        assert!(reference_png(&base64::engine::general_purpose::STANDARD.encode(b"texto")).is_err());
    }

    /// The real model on this PC: `NOTIA_IMAGE_PROBE_DATA` is the app data
    /// folder that holds `image-models/` (for example
    /// `%APPDATA%\com.gabriel.notia`). Generates a small image, edits it by
    /// its reference and cancels a third one midway.
    #[cfg(target_os = "windows")]
    #[test]
    #[ignore]
    fn generates_edits_and_cancels_with_the_real_model() {
        use crate::host::{AppPaths, HostPorts};
        let Some(data) = std::env::var_os("NOTIA_IMAGE_PROBE_DATA") else { return };
        let app = crate::create_app(AppPaths::new(Some(PathBuf::from(data)), None), HostPorts::default());
        app.manage(crate::mobile_directory_picker::AndroidDirectoryPickerState::empty());
        assert!(is_available(&app), "faltan sd-cli o los modelos");
        let control = RequestControl::new(None);
        let job = images::generate_job(&serde_json::json!({ "prompt": "una taza de café sobre una mesa de madera", "width": 512, "height": 512, "seed": 3 }), 1).expect("job");
        let started = Instant::now();
        let result = generate(&app, &control, "probe-request", job, None).expect("generate");
        eprintln!("generar 512x512: {:?}", started.elapsed());
        let name = result["image"].as_str().expect("name").to_string();
        assert_eq!((result["width"].as_u64(), result["height"].as_u64()), (Some(512), Some(512)));

        let job = images::edit_job(&serde_json::json!({ "image": name, "instruction": "poné la taza sobre una mesa de mármol blanco" }), 1).expect("edit");
        let reference = find_reference("probe-request", &name, &[]).expect("reference");
        let started = Instant::now();
        let edited = generate(&app, &control, "probe-request", job, Some(reference)).expect("edit");
        eprintln!("editar 512x512: {:?}", started.elapsed());
        assert_eq!((edited["width"].as_u64(), edited["editedFrom"].as_str()), (Some(512), Some(name.as_str())));
        let images = take_generated("probe-request");
        assert_eq!(images.len(), 2);
        for image in &images {
            let png = base64::engine::general_purpose::STANDARD.decode(&image.base64).expect("base64");
            assert_eq!(image::load_from_memory(&png).expect("png").width(), 512);
        }

        // `/image` of the chat and Telegram: the text goes as written.
        let command = images::parse_image_command("/image 9:16 una manzana roja sobre fondo blanco").expect("command").expect("valid");
        let started = Instant::now();
        let reply = run_command(&app, "sin-biblioteca", &control, "probe-command", &command, None).expect("command");
        eprintln!("/image 9:16: {:?}", started.elapsed());
        assert_eq!(reply.split(" (semilla").next(), Some("Listo: imagen de 768 × 1344"));
        assert_eq!(take_generated("probe-command").len(), 1);

        let cancelled = RequestControl::new(None);
        let stopper = cancelled.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            stopper.cancel();
        });
        let job = images::generate_job(&serde_json::json!({ "prompt": "un bosque" }), 1).expect("job");
        let started = Instant::now();
        let error = generate(&app, &cancelled, "probe-cancel", job, None).expect_err("cancelled");
        assert_eq!(error.code, BackendErrorCode::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(15), "the run stops soon after the cancel");
        assert!(take_generated("probe-cancel").is_empty());
    }

    #[test]
    fn a_command_is_cancelled_like_any_request() {
        let control = RequestControl::new(None);
        let flag = Arc::new(AtomicBool::new(false));
        let asked = Arc::clone(&flag);
        cancel_when(&control, Arc::new(AtomicBool::new(false)), move || asked.load(Ordering::SeqCst));
        std::thread::sleep(POLL_INTERVAL * 2);
        assert!(!control.is_cancelled());
        flag.store(true, Ordering::SeqCst);
        std::thread::sleep(POLL_INTERVAL * 3);
        assert!(control.is_cancelled());

        let finished = RequestControl::new(None);
        let done = Arc::new(AtomicBool::new(true));
        cancel_when(&finished, done, || true);
        std::thread::sleep(POLL_INTERVAL * 2);
        assert!(!finished.is_cancelled(), "a finished command is not cancelled afterwards");
    }

    #[test]
    fn a_partial_file_is_hashed_from_the_disk() {
        let path = std::env::temp_dir().join(format!("notia-image-hash-{}", std::process::id()));
        std::fs::write(&path, b"abc").expect("file");
        let digest = format!("{:x}", file_sha256(&path).expect("hash").finalize());
        assert_eq!(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&path);
    }
}
