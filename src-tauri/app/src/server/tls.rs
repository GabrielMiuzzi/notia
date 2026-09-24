//! Self-signed HTTPS certificate of a Notia server, kept in its data folder
//! and regenerated when the format version changes.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use rcgen::{CertificateParams, KeyPair};
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;

const CERTIFICATE_VERSION: &str = "2";

/// TLS configuration with the certificate stored in `directory`, creating it
/// when missing or outdated.
pub(crate) fn server_config(directory: &Path) -> Result<Arc<ServerConfig>, String> {
    fs::create_dir_all(directory).map_err(|_| "No se pudo preparar el directorio del certificado HTTPS.")?;
    let certificate_path = directory.join("certificate.der");
    let private_key_path = directory.join("private-key.der");
    let version_path = directory.join("version");
    let (certificate, private_key) = match (
        fs::read(&certificate_path),
        fs::read(&private_key_path),
        fs::read_to_string(&version_path),
    ) {
        (Ok(certificate), Ok(private_key), Ok(version)) if version.trim() == CERTIFICATE_VERSION => {
            (certificate, private_key)
        }
        _ => create_certificate(&certificate_path, &private_key_path, &version_path)?,
    };

    ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(certificate)],
            PrivateKeyDer::Pkcs8(private_key.into()),
        )
        .map(Arc::new)
        .map_err(|_| "No se pudo cargar el certificado HTTPS.".to_string())
}

fn create_certificate(
    certificate_path: &Path,
    private_key_path: &Path,
    version_path: &Path,
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let key_pair = KeyPair::generate().map_err(|_| "No se pudo crear la clave privada HTTPS.")?;
    let certificate = CertificateParams::new(subject_names())
        .map_err(|_| "No se pudo preparar el certificado HTTPS.")?
        .self_signed(&key_pair)
        .map_err(|_| "No se pudo crear el certificado HTTPS.")?;
    let certificate_der = certificate.der().to_vec();
    let private_key_der = key_pair.serialize_der();
    fs::write(certificate_path, &certificate_der).map_err(|_| "No se pudo guardar el certificado HTTPS.")?;
    fs::write(private_key_path, &private_key_der).map_err(|_| "No se pudo guardar la clave HTTPS.")?;
    fs::write(version_path, CERTIFICATE_VERSION)
        .map_err(|_| "No se pudo guardar la versión del certificado HTTPS.")?;
    Ok((certificate_der, private_key_der))
}

fn subject_names() -> Vec<String> {
    let mut names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    names.extend(super::network::local_ipv4_addresses().iter().map(ToString::to_string));
    names.sort_unstable();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_certificate_accepted_by_rustls_and_reuses_it() {
        let directory = std::env::temp_dir().join(format!("notia-server-tls-test-{}", uuid::Uuid::new_v4()));
        assert!(server_config(&directory).is_ok());
        let certificate = fs::read(directory.join("certificate.der")).expect("certificate");
        assert_eq!(fs::read_to_string(directory.join("version")).expect("version").trim(), CERTIFICATE_VERSION);
        assert!(server_config(&directory).is_ok());
        assert_eq!(fs::read(directory.join("certificate.der")).expect("certificate"), certificate);
        fs::remove_dir_all(&directory).expect("remove certificate test directory");
    }
}
