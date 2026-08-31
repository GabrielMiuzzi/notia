use std::{path::Path, time::Duration};

use reqwest::multipart::{Form, Part};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    fn from_environment() -> Result<Self, String> {
        let api_key = std::env::var("LLAMA_CLOUD_API_KEY")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                "Configurá LLAMA_CLOUD_API_KEY en el entorno nativo para extraer documentos."
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

fn validated_document(
    payload: &ExtractFinanceDocumentPayload,
) -> Result<(String, String, Vec<u8>), String> {
    if !matches!(
        payload.document_type.as_str(),
        "ticket" | "salary" | "credit_card_statement"
    ) || payload.artifact_id.trim().is_empty()
    {
        return Err(
            "El documento requiere tipo ticket, salary o credit_card_statement e identificador."
                .into(),
        );
    }
    #[cfg(any(target_os = "android", target_os = "ios"))]
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

#[tauri::command]
pub async fn extract_finance_document(
    app: tauri::AppHandle,
    payload: ExtractFinanceDocumentPayload,
) -> FinanceCommandResult<FinanceExtractionResult> {
    let (name, mime, bytes) = validated_document(&payload)?;
    let content_hash = format!("{:x}", Sha256::digest(&bytes));
    let adapter = LlamaCloudAdapter::from_environment()?;
    let raw_result = adapter.extract(&name, &mime, bytes).await?;
    let raw_json = serde_json::to_string(&raw_result)
        .map_err(|_| "No se pudo serializar la extracción.".to_string())?;
    let mut connection = validate_context(&payload.context, &app)?;
    let timestamp = now();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO finance_source_artifacts(id,source_type,reference,content_hash,created_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,content_hash=excluded.content_hash",rusqlite::params![payload.artifact_id,payload.document_type,payload.file_path,content_hash,timestamp]).map_err(|error|error.to_string())?;
    transaction.execute("INSERT INTO finance_extraction_results(id,source_artifact_id,extractor,raw_result,status,created_at) VALUES(?1,?2,'llamacloud-v2',?3,'completed',?4)",rusqlite::params![uuid::Uuid::new_v4().to_string(),payload.artifact_id,raw_json,timestamp]).map_err(|error|error.to_string())?;
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
