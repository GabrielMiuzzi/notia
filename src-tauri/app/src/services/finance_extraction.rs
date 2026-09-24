use std::{path::Path, time::Duration};

use reqwest::multipart::{Form, Part};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(target_os = "android")]
use crate::host::Manager;

use crate::finance::{now, sync_context, validate_context, FinanceCommandResult, FinanceContext};

const MAX_DOCUMENT_BYTES: u64 = 15 * 1024 * 1024;
const LLAMA_CLOUD_BASE_URL: &str = "https://api.cloud.llamaindex.ai";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractFinanceDocumentPayload {
    pub context: FinanceContext,
    pub artifact_id: String,
    pub file_path: String,
    pub document_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceExtractionResult {
    pub artifact_id: String,
    pub extractor: String,
    pub status: String,
    pub raw_result: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceArtifactStatus {
    pub artifact_id: String,
    pub source_type: String,
    pub reference: Option<String>,
    pub content_hash: Option<String>,
    pub created_at: String,
    pub extraction: Option<FinanceExtractionResult>,
}

trait FinanceExtractionAdapter {
    async fn extract(
        &self,
        name: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<serde_json::Value, String>;
}

struct LlamaCloudAdapter {
    client: reqwest::Client,
    api_key: String,
}
impl LlamaCloudAdapter {
    /// Resolves the credential from the library config first and falls back to
    /// the Windows-only environment variable. The key never reaches logs,
    /// prompts or persistence other than notiaConfig.json.
    fn from_credential_or_environment(api_key_from_config: Option<&str>) -> Result<Self, String> {
        let api_key = api_key_from_config
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| std::env::var("LLAMA_CLOUD_API_KEY").ok())
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "Configurá la clave de LlamaCloud en la configuración de la biblioteca para extraer documentos."
                    .to_string()
            })?;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(45))
            .build()
            .map_err(|_| "No se pudo iniciar el cliente de extracción.".to_string())?;
        Ok(Self { client, api_key })
    }
}
impl FinanceExtractionAdapter for LlamaCloudAdapter {
    async fn extract(
        &self,
        name: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> Result<serde_json::Value, String> {
        let file = Part::bytes(bytes)
            .file_name(name.to_string())
            .mime_str(mime_type)
            .map_err(|_| "El tipo del archivo no es válido.".to_string())?;
        let response = self
            .client
            .post(format!("{LLAMA_CLOUD_BASE_URL}/api/v2/parse/upload"))
            .bearer_auth(&self.api_key)
            .multipart(
                Form::new()
                    .part("file", file)
                    .text("tier", "agentic")
                    .text("version", "latest"),
            )
            .send()
            .await
            .map_err(|_| "LlamaCloud no respondió a la carga del documento.".to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "LlamaCloud rechazó el documento (HTTP {}).",
                response.status().as_u16()
            ));
        }
        let created: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "LlamaCloud devolvió una respuesta inválida.".to_string())?;
        let job_id = created
            .get("id")
            .or_else(|| created.get("job_id"))
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "LlamaCloud no devolvió el identificador del trabajo.".to_string())?;
        for _ in 0..30 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let poll = self
                .client
                .get(format!(
                    "{LLAMA_CLOUD_BASE_URL}/api/v2/parse/{job_id}?expand=markdown&expand=text"
                ))
                .bearer_auth(&self.api_key)
                .send()
                .await
                .map_err(|_| "Se interrumpió la consulta de extracción.".to_string())?;
            if !poll.status().is_success() {
                return Err(format!(
                    "No se pudo consultar la extracción (HTTP {}).",
                    poll.status().as_u16()
                ));
            }
            let result: serde_json::Value = poll
                .json()
                .await
                .map_err(|_| "LlamaCloud devolvió un resultado inválido.".to_string())?;
            let status = result
                .get("status")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if matches!(status, "completed" | "success" | "done") {
                return Ok(result);
            }
            if matches!(status, "failed" | "error" | "cancelled") {
                return Err("LlamaCloud no pudo extraer el documento.".to_string());
            }
        }
        Err("La extracción sigue en proceso; intentá nuevamente en unos segundos.".to_string())
    }
}

fn parse_library_credential(config: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(config).ok()?;
    value
        .get("llamacloud")?
        .get("apiKey")?
        .as_str()
        .map(str::trim)
        .filter(|key| !key.is_empty() && key.len() <= 256)
        .map(str::to_string)
}

fn read_library_llamacloud_credential(
    app: &crate::host::AppHandle,
    context: &FinanceContext,
) -> Result<Option<String>, String> {
    #[cfg(target_os = "android")]
    {
        let directory_uri = context
            .android_directory_uri
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "La biblioteca Android no tiene un permiso SAF válido.".to_string())?;
        let config_path = format!(
            "{}/.notia/notiaConfig.json",
            context.library_path.trim_end_matches(['/', '\\'])
        );
        let picker_state =
            app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>();
        let result = crate::filesystem::android_saf::read_library_file(
            picker_state.inner(),
            &config_path,
            Some(directory_uri),
        )
        .ok_or_else(|| "No se pudo leer la configuración de la biblioteca Android.".to_string())?;
        return if result.ok {
            Ok(parse_library_credential(&result.content))
        } else {
            Err("No se pudo leer la configuración de la biblioteca Android.".to_string())
        };
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let config_path = Path::new(context.library_path.trim())
            .join(".notia")
            .join("notiaConfig.json");
        match std::fs::read_to_string(config_path) {
            Ok(config) => Ok(parse_library_credential(&config)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("No se pudo leer la configuración de la biblioteca.".to_string()),
        }
    }
}

/// Android-only SAF reader for finance extraction. The logical path is
/// resolved with the same directory picker state used by the rest of the
/// library boundary, so documents are validated and read without a local
/// filesystem path.
#[cfg(target_os = "android")]
fn read_saf_document(
    app: &crate::host::AppHandle,
    payload: &ExtractFinanceDocumentPayload,
) -> Result<(String, String, Vec<u8>), String> {
    if payload.file_path.trim().is_empty() {
        return Err("El documento no existe.".into());
    }
    let extension = Path::new(payload.file_path.trim())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => return Err("Solo se admiten PDF, PNG, JPG y WEBP.".into()),
    };
    let picker_state = app.state::<crate::mobile_directory_picker::AndroidDirectoryPickerState>();
    let content_uri = {
        let root_tree_uri = payload.context.android_directory_uri.as_deref();
        match crate::filesystem::android_saf::read_library_file_bytes(
            picker_state.inner(),
            payload.file_path.trim(),
            root_tree_uri,
        ) {
            Some(result) => result,
            None => return Err("El documento no existe.".into()),
        }
    };
    let (name, bytes) = match content_uri {
        Ok(result) => result,
        Err(error) => return Err(error),
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("El documento debe pesar entre 1 byte y 15 MB.".into());
    }
    Ok((name, mime.to_string(), bytes))
}

/// Resolves the document bytes for extraction: SAF in Android, canonicalized
/// local path on desktop. Authorization must already be validated.
#[allow(unused_variables)]
fn resolve_extraction_document(
    app: &crate::host::AppHandle,
    payload: &ExtractFinanceDocumentPayload,
) -> Result<(String, String, Vec<u8>), String> {
    validate_document_identity(payload)?;
    #[cfg(target_os = "android")]
    {
        read_saf_document(app, payload)
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        validated_document(payload)
    }
}

fn validate_document_identity(payload: &ExtractFinanceDocumentPayload) -> Result<(), String> {
    if !matches!(
        payload.document_type.as_str(),
        "ticket" | "salary" | "credit_card_statement" | "service_invoice"
    ) || payload.artifact_id.trim().is_empty()
    {
        return Err(
            "El documento requiere tipo ticket, salary, credit_card_statement o service_invoice e identificador."
                .into(),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn validated_document(
    payload: &ExtractFinanceDocumentPayload,
) -> Result<(String, String, Vec<u8>), String> {
    validate_document_identity(payload)?;
    #[cfg(target_os = "ios")]
    {
        let _ = payload;
        return Err("En mobile seleccioná el documento mediante el flujo SAF de archivos.".into());
    }
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let root = Path::new(&payload.context.library_path)
            .canonicalize()
            .map_err(|_| "La biblioteca no está disponible.".to_string())?;
        let path = Path::new(&payload.file_path)
            .canonicalize()
            .map_err(|_| "El documento no existe.".to_string())?;
        if !path.starts_with(&root) {
            return Err("El documento debe estar dentro de la biblioteca activa.".into());
        }
        let metadata =
            std::fs::metadata(&path).map_err(|_| "No se pudo leer el documento.".to_string())?;
        if metadata.len() == 0 || metadata.len() > MAX_DOCUMENT_BYTES {
            return Err("El documento debe pesar entre 1 byte y 15 MB.".into());
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match extension.as_str() {
            "pdf" => "application/pdf",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            _ => return Err("Solo se admiten PDF, PNG, JPG y WEBP.".into()),
        };
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "El nombre del documento no es válido.".to_string())?
            .to_string();
        let bytes = std::fs::read(path).map_err(|_| "No se pudo leer el documento.".to_string())?;
        Ok((name, mime.to_string(), bytes))
    }
}

pub async fn extract_finance_document(
    app: crate::host::AppHandle,
    payload: ExtractFinanceDocumentPayload,
) -> FinanceCommandResult<FinanceExtractionResult> {
    // Authorization is deliberately the first operation. Path canonicalization,
    // file reads and the external adapter must never run for an unauthorized
    // actor or an invalid source.
    let connection = validate_context(&payload.context, &app)?;
    let (name, mime, bytes) = resolve_extraction_document(&app, &payload)?;
    let content_hash = format!("{:x}", Sha256::digest(&bytes));
    if let Some((stored_hash, stored_type, stored_reference)) = connection
        .query_row(
            "SELECT content_hash,source_type,reference FROM finance_source_artifacts WHERE id=?1",
            [&payload.artifact_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
    {
        if stored_hash.as_deref() != Some(content_hash.as_str())
            || stored_type != payload.document_type
            || stored_reference.as_deref() != Some(payload.file_path.as_str())
        {
            return Err("El artefacto ya existe con otro documento o tipo.".into());
        }
        if let Some(raw_result) = connection
            .query_row(
                "SELECT raw_result FROM finance_extraction_results WHERE source_artifact_id=?1 AND extractor='llamacloud-v2' AND status='completed' ORDER BY created_at DESC LIMIT 1",
                [&payload.artifact_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
        {
            let raw_result = serde_json::from_str(&raw_result).map_err(|_| "La extracción guardada no es válida.".to_string())?;
            drop(connection);
            return Ok(FinanceExtractionResult { artifact_id: payload.artifact_id, extractor: "llamacloud-v2".into(), status: "completed".into(), raw_result });
        }
    }
    drop(connection);
    let library_credential = read_library_llamacloud_credential(&app, &payload.context)?;
    let adapter = LlamaCloudAdapter::from_credential_or_environment(library_credential.as_deref())?;
    let raw_result = adapter.extract(&name, &mime, bytes).await?;
    let raw_json = serde_json::to_string(&raw_result)
        .map_err(|_| "No se pudo serializar la extracción.".to_string())?;
    let mut connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_source_artifacts(id,source_type,reference,content_hash,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET source_type=excluded.source_type,reference=excluded.reference,content_hash=excluded.content_hash",rusqlite::params![payload.artifact_id,payload.document_type,payload.file_path,content_hash,timestamp]).map_err(|error| if error.to_string().contains("UNIQUE") { "El documento ya fue extraído con otro identificador.".to_string() } else { error.to_string() })?;
    transaction.execute("INSERT INTO finance_extraction_results(id,source_artifact_id,extractor,raw_result,status,created_at) VALUES(?1,?2,'llamacloud-v2',?3,'completed',?4) ON CONFLICT(source_artifact_id) DO UPDATE SET extractor=excluded.extractor,raw_result=excluded.raw_result,status=excluded.status,created_at=excluded.created_at",rusqlite::params![uuid::Uuid::new_v4().to_string(),payload.artifact_id,raw_json,timestamp]).map_err(|error|error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    drop(connection);
    sync_context(&payload.context, &app)?;
    Ok(FinanceExtractionResult {
        artifact_id: payload.artifact_id,
        extractor: "llamacloud-v2".into(),
        status: "completed".into(),
        raw_result,
    })
}

pub fn list_finance_artifacts(
    app: crate::host::AppHandle,
    context: FinanceContext,
) -> FinanceCommandResult<Vec<FinanceArtifactStatus>> {
    let connection = validate_context(&context, &app)?;
    let mut statement = connection
        .prepare(
            "SELECT a.id,a.source_type,a.reference,a.content_hash,a.created_at,
                    e.extractor,e.status,e.raw_result
             FROM finance_source_artifacts a
             LEFT JOIN finance_extraction_results e ON e.id=(
                 SELECT e2.id FROM finance_extraction_results e2
                 WHERE e2.source_artifact_id=a.id
                 ORDER BY e2.created_at DESC LIMIT 1
             )
             WHERE a.deleted_at IS NULL
             ORDER BY a.created_at DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let raw_result = row
                .get::<_, Option<String>>(7)?
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(FinanceArtifactStatus {
                artifact_id: row.get(0)?,
                source_type: row.get(1)?,
                reference: row.get(2)?,
                content_hash: row.get(3)?,
                created_at: row.get(4)?,
                extraction: row
                    .get::<_, Option<String>>(5)?
                    .zip(row.get::<_, Option<String>>(6)?)
                    .map(|(extractor, status)| FinanceExtractionResult {
                        artifact_id: row.get(0).unwrap_or_default(),
                        extractor,
                        status,
                        raw_result: raw_result.clone().unwrap_or(serde_json::Value::Null),
                    }),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(rows)
}
