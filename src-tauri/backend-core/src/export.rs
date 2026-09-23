//! Bounded, renderer-independent document export contracts.

use serde::{Deserialize, Serialize};

use super::error::BackendError;
use super::library_tools::DocumentLocatorDto;

pub const MAX_EXPORT_INPUT_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_EXPORT_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Pdf,
    Docx,
    Binary,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundedExportRequest {
    pub operation_id: String,
    pub locator: DocumentLocatorDto,
    pub expected_revision: u64,
    pub format: ExportFormat,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreview {
    pub operation_id: String,
    pub locator: DocumentLocatorDto,
    pub expected_revision: u64,
    pub format: ExportFormat,
    pub byte_length: usize,
    pub content_fingerprint: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReceipt {
    pub operation_id: String,
    pub format: ExportFormat,
    pub byte_length: usize,
    pub recovered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExportRecoveryState {
    Applied,
    NotFound,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecovery {
    pub state: ExportRecoveryState,
    pub receipt: Option<ExportReceipt>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload", rename_all = "kebab-case")]
pub enum RecoverableExportResult {
    Applied(ExportReceipt),
    Recovered(ExportReceipt),
    NotFound,
}

/// An adapter owns rendering and destination I/O. The core only enforces
/// bounded bytes, format identity, and recoverable atomic-result semantics.
pub trait BoundedExportPort: Send + Sync {
    fn preview_export(&self, request: &BoundedExportRequest)
        -> Result<ExportPreview, BackendError>;
    fn write_export_atomic(
        &self,
        request: &BoundedExportRequest,
    ) -> Result<ExportReceipt, BackendError>;
    fn recover_export(&self, operation_id: &str) -> Result<ExportRecovery, BackendError>;
}

pub fn preview_export_with_port(
    port: &dyn BoundedExportPort,
    request: &BoundedExportRequest,
) -> Result<ExportPreview, BackendError> {
    validate_export_request(request)?;
    port.preview_export(request)
}

pub fn write_export_with_port(
    port: &dyn BoundedExportPort,
    request: &BoundedExportRequest,
) -> Result<ExportReceipt, BackendError> {
    validate_export_request(request)?;
    port.write_export_atomic(request)
}

pub fn preview_bounded_export(
    request: &BoundedExportRequest,
) -> Result<ExportPreview, BackendError> {
    validate_export_request(request)?;
    Ok(ExportPreview {
        operation_id: request.operation_id.clone(),
        locator: request.locator.clone(),
        expected_revision: request.expected_revision,
        format: request.format,
        byte_length: request.bytes.len(),
        content_fingerprint: fingerprint(&request.bytes),
    })
}

pub fn validate_export_request(request: &BoundedExportRequest) -> Result<(), BackendError> {
    if request.operation_id.trim().is_empty()
        || request.operation_id.chars().count() > 200
        || request.operation_id.chars().any(char::is_control)
    {
        return Err(BackendError::invalid_input("operationId no es válido."));
    }
    request.locator.validate()?;
    if request.bytes.is_empty() {
        return Err(BackendError::invalid_input(
            "La exportación no puede estar vacía.",
        ));
    }
    if request.bytes.len() > MAX_EXPORT_OUTPUT_BYTES {
        return Err(BackendError::invalid_input(
            "La salida de exportación supera el límite de tamaño.",
        ));
    }
    match request.format {
        ExportFormat::Pdf if !request.bytes.starts_with(b"%PDF-") => {
            return Err(BackendError::invalid_input(
                "La salida PDF no tiene formato válido.",
            ));
        }
        ExportFormat::Docx if !request.bytes.starts_with(b"PK") => {
            return Err(BackendError::invalid_input(
                "La salida DOCX no tiene formato válido.",
            ));
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_export_input_size(bytes: &[u8]) -> Result<(), BackendError> {
    if bytes.len() > MAX_EXPORT_INPUT_BYTES {
        return Err(BackendError::invalid_input(
            "La entrada de exportación supera el límite de tamaño.",
        ));
    }
    Ok(())
}

fn fingerprint(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// Safe, deterministic fingerprint used by transport adapters to verify that
/// the bytes accepted by the writer are the bytes persisted by the provider.
pub fn export_fingerprint(bytes: &[u8]) -> u64 {
    fingerprint(bytes)
}

/// Maximum numbered variants tried when an export destination exists.
pub const MAX_EXPORT_NAME_ATTEMPTS: u32 = 20;

/// Logical destination of an export next to its source document. Attempt 1
/// is `name.ext`; later attempts add ` (n)` so an existing export is never
/// overwritten.
pub fn export_destination_path(
    source_logical_path: &str,
    format: ExportFormat,
    attempt: u32,
) -> Result<String, BackendError> {
    let extension = match format {
        ExportFormat::Pdf => "pdf",
        ExportFormat::Docx => "docx",
        ExportFormat::Binary => {
            return Err(BackendError::invalid_input(
                "Binary no tiene un destino de exportación derivable.",
            ))
        }
    };
    if attempt == 0 || attempt > MAX_EXPORT_NAME_ATTEMPTS {
        return Err(BackendError::invalid_input(
            "No quedan nombres disponibles para la exportación.",
        ));
    }
    let (parent, file_name) = source_logical_path
        .rsplit_once('/')
        .unwrap_or(("", source_logical_path));
    let stem = file_name
        .strip_suffix(".md")
        .or_else(|| file_name.strip_suffix(".MD"))
        .unwrap_or(file_name);
    let name = if attempt == 1 {
        format!("{stem}.{extension}")
    } else {
        format!("{stem} ({attempt}).{extension}")
    };
    Ok(if parent.is_empty() {
        name
    } else {
        format!("{parent}/{name}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_destinations_never_reuse_an_existing_name() {
        assert_eq!(
            export_destination_path("notas/a.md", ExportFormat::Pdf, 1).expect("first"),
            "notas/a.pdf"
        );
        assert_eq!(
            export_destination_path("a.md", ExportFormat::Docx, 3).expect("third"),
            "a (3).docx"
        );
        assert!(export_destination_path("a.md", ExportFormat::Pdf, MAX_EXPORT_NAME_ATTEMPTS + 1).is_err());
        assert!(export_destination_path("a.md", ExportFormat::Binary, 1).is_err());
    }

    fn locator() -> DocumentLocatorDto {
        DocumentLocatorDto::new("library-a", "notes/a.md", None, None).expect("locator")
    }

    fn request(bytes: Vec<u8>, format: ExportFormat) -> BoundedExportRequest {
        BoundedExportRequest {
            operation_id: "export-1".into(),
            locator: locator(),
            expected_revision: 1,
            format,
            bytes,
        }
    }

    #[test]
    fn accepts_bounded_binary_and_rejects_oversized_output() {
        let preview = preview_bounded_export(&request(vec![1, 2, 3], ExportFormat::Binary))
            .expect("binary preview");
        assert_eq!(preview.byte_length, 3);
        let oversized = request(vec![0; MAX_EXPORT_OUTPUT_BYTES + 1], ExportFormat::Binary);
        assert!(validate_export_request(&oversized).is_err());
    }

    #[test]
    fn validates_pdf_and_docx_signatures_without_rendering_them() {
        assert!(preview_bounded_export(&request(b"%PDF-1.7".to_vec(), ExportFormat::Pdf)).is_ok());
        assert!(
            preview_bounded_export(&request(b"PK\x03\x04".to_vec(), ExportFormat::Docx)).is_ok()
        );
        assert!(preview_bounded_export(&request(b"plain".to_vec(), ExportFormat::Pdf)).is_err());
    }
}
