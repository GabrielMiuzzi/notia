//! Routes of the NotIA Chrome extension (`chrome-ext/notia`), only in Host
//! mode: during a Microsoft Teams call it reports who is speaking, and
//! Meeting keeps it with the recording in progress (`meeting::add_call_speech`)
//! to name the live lines and, at the end, the speakers. Same origin and
//! token rules as the other extensions (`extension`).
//!
//! - `POST /api/meeting-call/login` `{ username, password }` (the library's
//!   Owner) → `{ token, library }`.
//! - `POST /api/meeting-call/logout`.
//! - `POST /api/meeting-call/status` → `{ recording, meetingId?, title? }`.
//! - `POST /api/meeting-call/speech` `{ meetingId, speech: [{ name, startedAt,
//!   endedAt }] }` (Unix ms of this computer) → `{ recording }`; ignored when
//!   that meeting is no longer being recorded.

use serde::Deserialize;
use serde_json::Value;

use super::super::http::{http_body, json_response};
use super::extension::{bearer, origin_is_extension};
use super::{error_body, too_many_attempts, ApiServer, ServerKind};
use crate::meeting::CallSpeechInput;

/// A batch every second or so; enough for long pauses of the network.
const REQUESTS_PER_MINUTE: usize = 600;
const LOGINS_PER_MINUTE: usize = 10;
/// Intervals one request may carry.
const MAX_SPEECH_PER_REQUEST: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeechItem {
    name: String,
    started_at: u64,
    ended_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpeechPayload {
    meeting_id: String,
    speech: Vec<SpeechItem>,
}

fn session_ended() -> Vec<u8> {
    error_body("401 Unauthorized", "La sesión de NotIA terminó. Conectala de nuevo.")
}

fn not_recording() -> Value {
    serde_json::json!({ "recording": false })
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
    let body = http_body(request);
    if path == "/api/meeting-call/login" {
        if !server.allow(format!("meeting-call-login:{peer}"), LOGINS_PER_MINUTE) {
            return too_many_attempts();
        }
        let input = serde_json::from_slice::<Value>(body).unwrap_or(Value::Null);
        let text = |key: &str| input.get(key).and_then(Value::as_str).unwrap_or_default().to_string();
        return login(server, &text("username"), &text("password"));
    }
    let Some(token) = bearer(request) else {
        return session_ended();
    };
    if !server.allow(format!("meeting-call:{token}"), REQUESTS_PER_MINUTE) {
        return too_many_attempts();
    }
    if path == "/api/meeting-call/logout" {
        server.call_sessions.close(&token);
        return json_response("200 OK", serde_json::json!({ "ok": true }));
    }
    if !server.call_sessions.touch(&token) {
        return session_ended();
    }
    match path {
        "/api/meeting-call/status" => json_response(
            "200 OK",
            match crate::meeting::live_meeting(&server.app) {
                Some((id, title)) => serde_json::json!({ "recording": true, "meetingId": id, "title": title }),
                None => not_recording(),
            },
        ),
        "/api/meeting-call/speech" => speech(server, body),
        _ => error_body("404 Not Found", "No existe."),
    }
}

fn login(server: &ApiServer, username: &str, password: &str) -> Vec<u8> {
    if password.is_empty() {
        return error_body("400 Bad Request", "Falta la contraseña.");
    }
    if let Err(error) = crate::app_auth::host_sign_in(&server.app, username, password) {
        return error_body("401 Unauthorized", &error.message);
    }
    let library = crate::library_catalog::selected_library(&server.app).map(|library| library.name);
    match server.call_sessions.open() {
        Some(token) => json_response("200 OK", serde_json::json!({ "token": token, "library": library })),
        None => error_body("500 Internal Server Error", "No se pudo abrir la sesión."),
    }
}

fn speech(server: &ApiServer, body: &[u8]) -> Vec<u8> {
    let Ok(payload) = serde_json::from_slice::<SpeechPayload>(body) else {
        return error_body("400 Bad Request", "Solicitud inválida.");
    };
    if payload.speech.len() > MAX_SPEECH_PER_REQUEST {
        return error_body("413 Payload Too Large", "Demasiados turnos en un solo envío.");
    }
    let recording = crate::meeting::live_meeting(&server.app).is_some_and(|(id, _)| id == payload.meeting_id);
    if !recording {
        return json_response("200 OK", not_recording());
    }
    let speech: Vec<CallSpeechInput> = payload
        .speech
        .into_iter()
        .map(|item| CallSpeechInput { name: item.name, start_unix_ms: item.started_at, end_unix_ms: item.ended_at })
        .collect();
    match crate::meeting::add_call_speech(&server.app, &payload.meeting_id, &speech) {
        Ok(()) => json_response("200 OK", serde_json::json!({ "recording": true })),
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

    fn call(server: &ApiServer, path: &str, origin: &str, token: Option<&str>, body: Value) -> (String, Value) {
        let body = body.to_string();
        let authorization = token.map(|token| format!("Authorization: Bearer {token}\r\n")).unwrap_or_default();
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:52480\r\nOrigin: {origin}\r\n{authorization}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let text = String::from_utf8_lossy(&route(request.as_bytes(), "POST", path, server, "127.0.0.1")).into_owned();
        let status = text.lines().next().unwrap_or_default().to_string();
        let json = text.split_once("\r\n\r\n").and_then(|(_, body)| serde_json::from_str(body).ok()).unwrap_or(Value::Null);
        (status, json)
    }

    #[test]
    fn the_call_extension_signs_in_and_learns_whether_a_recording_runs() {
        let (app, _, root) = app_with_owner("contraseña-del-owner");
        let server = ApiServer::new(app, Arc::new(EventHub::default()), None, ServerKind::Host, None, None);
        let login = serde_json::json!({ "username": "owner", "password": "contraseña-del-owner" });

        let (status, _) = call(&server, "/api/meeting-call/login", "https://teams.microsoft.com", None, login.clone());
        assert!(status.contains("403"), "a web page cannot call it: {status}");
        let (status, _) = call(&server, "/api/meeting-call/status", EXTENSION, None, Value::Null);
        assert!(status.contains("401"), "{status}");
        let (status, body) = call(&server, "/api/meeting-call/login", EXTENSION, None, login);
        assert!(status.contains("200"), "{status} {body}");
        let token = body["token"].as_str().expect("token").to_string();

        let (_, body) = call(&server, "/api/meeting-call/status", EXTENSION, Some(&token), Value::Null);
        assert_eq!(body, serde_json::json!({ "recording": false }));
        let speech = serde_json::json!({ "meetingId": "m1", "speech": [{ "name": "Ana", "startedAt": 1, "endedAt": 2 }] });
        let (status, body) = call(&server, "/api/meeting-call/speech", EXTENSION, Some(&token), speech);
        assert!(status.contains("200") && body["recording"] == false, "nothing to mark without a recording: {body}");
        let (status, _) = call(&server, "/api/meeting-call/speech", EXTENSION, Some(&token), serde_json::json!({ "speech": 3 }));
        assert!(status.contains("400"), "{status}");

        call(&server, "/api/meeting-call/logout", EXTENSION, Some(&token), Value::Null);
        let (status, _) = call(&server, "/api/meeting-call/status", EXTENSION, Some(&token), Value::Null);
        assert!(status.contains("401"), "{status}");
        let _ = std::fs::remove_dir_all(root);
    }

    /// Serves a Host on https://127.0.0.1:52499 (Owner «owner» /
    /// «contraseña-del-owner») recording a meeting without audio, for driving
    /// the real NotIA extension in Chrome; prints what the call reported when
    /// the file named by `NOTIA_BROWSER_PROBE_STOP` appears (or after ten
    /// minutes).
    #[test]
    #[ignore]
    fn serves_a_recording_host_for_the_call_probe() {
        let (app, _, root) = app_with_owner("contraseña-del-owner");
        let meeting_id = crate::meeting::probe::begin(&app);
        let tls = crate::server::tls::server_config(&root.join("tls")).expect("certificate");
        let listener = std::net::TcpListener::bind("127.0.0.1:52499").expect("port 52499");
        let server = Arc::new(ApiServer::new(app.clone(), Arc::new(EventHub::default()), None, ServerKind::Host, None, None));
        let stop = Arc::clone(&server.stop);
        let serving = std::thread::spawn(move || super::super::run(listener, server, tls));
        println!("probe host recording {meeting_id} on https://127.0.0.1:52499");
        let flag = std::env::var("NOTIA_BROWSER_PROBE_STOP").map(std::path::PathBuf::from).ok();
        let started = std::time::Instant::now();
        while started.elapsed() < std::time::Duration::from_secs(600) && !flag.as_ref().is_some_and(|flag| flag.exists()) {
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        println!("CALL_SPEECH {}", serde_json::to_string(&crate::meeting::probe::call_speech(&app)).expect("json"));
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = serving.join();
        let _ = std::fs::remove_dir_all(root);
    }
}
