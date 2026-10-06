//! Routes of the ColdPass Chrome extension (`chrome-ext/coldpass`), only in
//! Host mode, with the origin and token rules of `extension`.
//!
//! - `POST /api/browser/login` `{ username, password }`: the library's
//!   Owner opens the vault for the extension → `{ token, library }`.
//! - `POST /api/browser/logout`, `POST /api/browser/status` → `{ ok }`.
//! - `POST /api/browser/credentials` `{ pageUrl }` → `{ credentials }`.
//! - `POST /api/browser/offer` `{ pageUrl, username, password }` →
//!   `{ offer }`: whether to ask the person to save that sign-in.
//! - `POST /api/browser/save` `{ pageUrl, username, password }` → `{ ok }`.
//! - `POST /api/browser/generate` → `{ password }`.
//!
//! `pageUrl` is the address Chrome reports for the frame the extension is
//! in, and Rust decides which credentials belong there.

use serde_json::Value;

use super::super::http::{http_body, json_response};
use super::extension::{bearer, origin_is_extension};
use super::{error_body, too_many_attempts, ApiServer, ServerKind};

/// Fills, offers and generations a session may ask per minute.
const REQUESTS_PER_MINUTE: usize = 600;
const LOGINS_PER_MINUTE: usize = 10;

fn session_ended() -> Vec<u8> {
    error_body("401 Unauthorized", "La sesión de ColdPass en el navegador terminó. Desbloqueala de nuevo.")
}

pub(super) fn route(request: &[u8], method: &str, path: &str, server: &ApiServer, peer: &str) -> Vec<u8> {
    if server.kind != ServerKind::Host {
        return error_body("404 Not Found", "No existe.");
    }
    if method != "POST" {
        return error_body("405 Method Not Allowed", "Método no permitido.");
    }
    if !origin_is_extension(request) {
        return error_body("403 Forbidden", "Origen no autorizado.");
    }
    let input = serde_json::from_slice::<Value>(http_body(request)).unwrap_or(Value::Null);
    let text = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
    if path == "/api/browser/login" {
        if !server.allow(format!("browser-login:{peer}"), LOGINS_PER_MINUTE) {
            return too_many_attempts();
        }
        return login(server, &text("username"), &text("password"));
    }
    let Some(token) = bearer(request) else {
        return session_ended();
    };
    if !server.allow(format!("browser:{token}"), REQUESTS_PER_MINUTE) {
        return too_many_attempts();
    }
    let app = &server.app;
    let vaults = &server.browser;
    let result = match path {
        "/api/browser/logout" => {
            vaults.close(&token);
            Ok(Some(serde_json::json!({ "ok": true })))
        }
        "/api/browser/status" => Ok(vaults.library_of(&token).map(|_| serde_json::json!({ "ok": true }))),
        "/api/browser/credentials" => vaults
            .credentials(app, &token, &text("pageUrl"))
            .map(|found| found.map(|credentials| serde_json::json!({ "credentials": credentials }))),
        "/api/browser/offer" => vaults
            .offers_saving(app, &token, &text("pageUrl"), &text("username"), &text("password"))
            .map(|offer| offer.map(|offer| serde_json::json!({ "offer": offer }))),
        "/api/browser/save" => vaults
            .save(app, &token, &text("pageUrl"), &text("username"), &text("password"))
            .map(|saved| saved.map(|()| serde_json::json!({ "ok": true }))),
        "/api/browser/generate" => vaults
            .generate(&token)
            .map(|password| password.map(|password| serde_json::json!({ "password": password }))),
        _ => return error_body("404 Not Found", "No existe."),
    };
    match result {
        Ok(Some(value)) => json_response("200 OK", value),
        Ok(None) => session_ended(),
        Err(error) => error_body("400 Bad Request", &error.message),
    }
}

/// The library's Owner signs in as in the app and opens the vault of the
/// library this host serves.
fn login(server: &ApiServer, username: &str, password: &str) -> Vec<u8> {
    if password.is_empty() {
        return error_body("400 Bad Request", "Falta la contraseña.");
    }
    if let Err(error) = crate::app_auth::host_sign_in(&server.app, username, password) {
        return error_body("401 Unauthorized", &error.message);
    }
    let Some(library) = crate::library_catalog::selected_library(&server.app) else {
        return error_body("400 Bad Request", "El host no tiene una biblioteca abierta.");
    };
    match server.browser.open(&server.app, &library.id, password) {
        Ok(token) => json_response("200 OK", serde_json::json!({ "token": token, "library": library.name })),
        Err(error) => error_body("400 Bad Request", &error.message),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::coldpass::test_support::app_with_owner;
    use crate::server::events::EventHub;

    const EXTENSION: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";

    fn post(path: &str, origin: &str, token: Option<&str>, body: &Value) -> Vec<u8> {
        let body = body.to_string();
        let authorization = token.map(|token| format!("Authorization: Bearer {token}\r\n")).unwrap_or_default();
        format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:52480\r\nOrigin: {origin}\r\n{authorization}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    /// The status line, the body and whether the answer set a cookie.
    fn call(server: &ApiServer, path: &str, origin: &str, token: Option<&str>, body: Value) -> (String, Value, bool) {
        let raw = route(&post(path, origin, token, &body), "POST", path, server, "127.0.0.1");
        let text = String::from_utf8_lossy(&raw).into_owned();
        let status = text.lines().next().unwrap_or_default().to_string();
        let json = text
            .split_once("\r\n\r\n")
            .and_then(|(_, body)| serde_json::from_str(body).ok())
            .unwrap_or(Value::Null);
        (status, json, text.contains("Set-Cookie"))
    }

    #[test]
    fn the_extension_signs_in_fills_offers_saves_and_generates() {
        let (app, _, root) = app_with_owner("contraseña-del-owner");
        let server = ApiServer::new(app, Arc::new(EventHub::default()), None, ServerKind::Host, None, None);
        let login = serde_json::json!({ "username": "owner", "password": "contraseña-del-owner" });

        let (status, _, _) = call(&server, "/api/browser/login", "https://evil.example", None, login.clone());
        assert!(status.contains("403"), "a web page cannot call it: {status}");
        let wrong = serde_json::json!({ "username": "owner", "password": "mala" });
        let (status, _, _) = call(&server, "/api/browser/login", EXTENSION, None, wrong);
        assert!(status.contains("401"), "{status}");
        let (status, body, cookie) = call(&server, "/api/browser/login", EXTENSION, None, login);
        assert!(status.contains("200") && !cookie, "{status} {body}");
        let token = body["token"].as_str().expect("token").to_string();

        let page = serde_json::json!({ "pageUrl": "https://accounts.ejemplo.com/login", "username": "ana", "password": "secreta" });
        let (_, body, _) = call(&server, "/api/browser/credentials", EXTENSION, Some(&token), page.clone());
        assert_eq!(body["credentials"], serde_json::json!([]));
        let (_, body, _) = call(&server, "/api/browser/offer", EXTENSION, Some(&token), page.clone());
        assert_eq!(body["offer"], true);
        let (status, _, _) = call(&server, "/api/browser/save", EXTENSION, Some(&token), page.clone());
        assert!(status.contains("200"), "{status}");
        let (_, body, _) = call(&server, "/api/browser/credentials", EXTENSION, Some(&token), page.clone());
        let first = &body["credentials"][0];
        assert_eq!((first["username"].as_str(), first["password"].as_str()), (Some("ana"), Some("secreta")));
        let (_, body, _) = call(&server, "/api/browser/offer", EXTENSION, Some(&token), page.clone());
        assert_eq!(body["offer"], false);
        let (_, body, _) = call(&server, "/api/browser/generate", EXTENSION, Some(&token), Value::Null);
        assert_eq!(body["password"].as_str().map(|password| password.chars().count()), Some(20));

        let (status, _, _) = call(&server, "/api/browser/credentials", EXTENSION, Some("otro-token"), page.clone());
        assert!(status.contains("401"), "{status}");
        call(&server, "/api/browser/logout", EXTENSION, Some(&token), Value::Null);
        let (status, _, _) = call(&server, "/api/browser/credentials", EXTENSION, Some(&token), page);
        assert!(status.contains("401"), "{status}");
        let _ = std::fs::remove_dir_all(root);
    }

    /// Serves a Host on https://127.0.0.1:52499 (Owner «owner» /
    /// «contraseña-del-owner», one credential «ana» for http://localhost)
    /// for driving the real extension in Chrome; stops when the file named
    /// by `NOTIA_BROWSER_PROBE_STOP` appears or after ten minutes.
    #[test]
    #[ignore]
    fn serves_a_host_for_the_extension_probe() {
        let (app, library_id, root) = app_with_owner("contraseña-del-owner");
        let seed = crate::coldpass::BrowserVaults::default();
        let token = seed.open(&app, &library_id, "contraseña-del-owner").expect("seed session");
        seed.save(&app, &token, "http://localhost:8765/login.html", "ana", "secreta-1").expect("seed").expect("session");
        let tls = crate::server::tls::server_config(&root.join("tls")).expect("certificate");
        let listener = std::net::TcpListener::bind("127.0.0.1:52499").expect("port 52499");
        let server = Arc::new(ApiServer::new(app, Arc::new(EventHub::default()), None, ServerKind::Host, None, None));
        let stop = Arc::clone(&server.stop);
        let serving = std::thread::spawn(move || super::super::run(listener, server, tls));
        println!("probe host ready on https://127.0.0.1:52499");
        let flag = std::env::var("NOTIA_BROWSER_PROBE_STOP").map(std::path::PathBuf::from).ok();
        let started = std::time::Instant::now();
        while started.elapsed() < std::time::Duration::from_secs(600) && !flag.as_ref().is_some_and(|flag| flag.exists()) {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = serving.join();
        let _ = std::fs::remove_dir_all(root);
    }
}
