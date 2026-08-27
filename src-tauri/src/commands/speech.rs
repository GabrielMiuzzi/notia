use crate::dto::speech::{
    SherpaRuntimeStatusDto, SpeechAudioInputStatusDto, SpeechCapabilitiesDto, SpeechModelStatusDto,
    SpeechSessionPayload, StartSpeechSessionPayload, StartSpeechSessionResultDto,
};
use crate::mobile_speech_permission::AndroidSpeechPermissionState;
use crate::services::sherpa_runtime;
use crate::services::speech_audio;
use crate::services::speech_model_repository;
use crate::services::speech_service;
use crate::services::speech_service::{SpeechPhase, SpeechRuntimeState};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn get_speech_capabilities(
    app: AppHandle,
    permission_state: State<'_, AndroidSpeechPermissionState>,
) -> Result<SpeechCapabilitiesDto, String> {
    // La comprobación de capacidades es informativa y no debe quedar inutilizable
    // por un directorio de modelos ausente (por ejemplo, en el primer arranque).
    // La resolución estricta se hace al iniciar la sesión y allí se devuelve el
    // error accionable de modelo faltante/inválido.
    let model_status =
        speech_model_repository::inspect_installed_models(&app).unwrap_or_else(|_| {
            SpeechModelStatusDto {
                schema_version: 1,
                profiles: Vec::new(),
            }
        });
    let runtime = sherpa_runtime::probe(&app);
    let permission = microphone_permission(&permission_state);
    let audio_available = if permission == "granted" {
        speech_audio::probe_audio_input().available
    } else {
        cfg!(target_os = "android")
    };
    Ok(speech_service::current_capabilities(
        &model_status,
        runtime.compatible,
        audio_available,
        &permission,
    ))
}

#[tauri::command]
pub fn get_speech_model_status(app: AppHandle) -> Result<SpeechModelStatusDto, String> {
    speech_model_repository::inspect_installed_models(&app)
}

#[tauri::command]
pub fn probe_speech_audio_input(
    permission_state: State<'_, AndroidSpeechPermissionState>,
) -> SpeechAudioInputStatusDto {
    let permission = microphone_permission(&permission_state);
    if cfg!(target_os = "android") && permission != "granted" {
        return SpeechAudioInputStatusDto {
            supported: true,
            available: true,
            device_label: None,
            sample_rate: None,
            channels: None,
            error_message: None,
        };
    }
    speech_audio::probe_audio_input()
}

#[tauri::command]
pub fn probe_sherpa_runtime(app: AppHandle) -> SherpaRuntimeStatusDto {
    sherpa_runtime::probe(&app)
}

#[tauri::command]
pub async fn start_speech_session(
    payload: StartSpeechSessionPayload,
    app: AppHandle,
    state: State<'_, SpeechRuntimeState>,
    permission_state: State<'_, AndroidSpeechPermissionState>,
) -> Result<StartSpeechSessionResultDto, String> {
    speech_service::validate_start_input(&payload.language, payload.max_duration_seconds)?;
    if !matches!(payload.model.as_str(), "0.6b" | "1.7b") {
        return Err("El modelo Qwen3-ASR seleccionado no es válido.".to_string());
    }
    if !matches!(payload.device.as_str(), "cpu" | "gpu") {
        return Err("El dispositivo Qwen3-ASR seleccionado no es válido.".to_string());
    }
    let _diarization_enabled = payload.diarization_enabled;
    let phase = *state
        .phase
        .lock()
        .map_err(|_| "No se pudo bloquear el estado de la sesion de voz.".to_string())?;
    if phase.is_active() || !phase.can_transition_to(SpeechPhase::Preparing) {
        return Err("Ya existe una sesion de voz activa.".to_string());
    }
    if !speech_service::runtime_integrated() {
        return Err(speech_service::not_integrated_error());
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    {
        #[cfg(target_os = "android")]
        crate::mobile_speech_permission::ensure_microphone_permission(&permission_state)?;
        #[cfg(not(target_os = "android"))]
        let _ = permission_state;
        let session_id = uuid::Uuid::new_v4().to_string();
        {
            let mut phase = state
                .phase
                .lock()
                .map_err(|_| "No se pudo bloquear el estado de voz.".to_string())?;
            *phase = SpeechPhase::Preparing;
        }
        speech_service::emit_session_state(
            &app,
            &session_id,
            crate::dto::speech::SpeechSessionStateDto::Preparing { progress: None },
        );
        let model_size = payload.model;
        let language = payload.language;
        let device = payload.device;
        let diarization_enabled = payload.diarization_enabled;
        let capture_system_audio = payload.capture_system_audio;
        let worker_app = app.clone();
        let worker_session_id = session_id.clone();
        let result = match tauri::async_runtime::spawn_blocking(move || {
            let model = speech_model_repository::resolve_qwen3_asr_model(
                &worker_app,
                &model_size,
                &language,
                &device,
            )?;
            let diarization_model = diarization_enabled
                .then(|| speech_model_repository::resolve_diarization_model(&worker_app, &language))
                .transpose()?;
            let worker_state = worker_app.state::<SpeechRuntimeState>();
            speech_service::start_platform_session(
                &worker_app,
                &worker_state,
                worker_session_id,
                model,
                diarization_model,
                capture_system_audio,
            )
        })
        .await
        {
            Ok(result) => result,
            Err(error) => {
                if let Ok(mut phase) = state.phase.lock() {
                    *phase = SpeechPhase::Idle;
                }
                return Err(format!(
                    "El worker de inicio de voz finalizo inesperadamente: {error}"
                ));
            }
        };
        if let Err(error) = result {
            if let Ok(mut phase) = state.phase.lock() {
                *phase = SpeechPhase::Idle;
            }
            return Err(error);
        }
        Ok(StartSpeechSessionResultDto { session_id })
    }
    #[cfg(not(any(target_os = "windows", target_os = "android")))]
    {
        let _ = (app, state);
        Err(speech_service::not_integrated_error())
    }
}

fn microphone_permission(_state: &AndroidSpeechPermissionState) -> String {
    #[cfg(target_os = "android")]
    {
        return match crate::mobile_speech_permission::check_microphone_permission(_state) {
            Ok(tauri::plugin::PermissionState::Granted) => "granted",
            Ok(tauri::plugin::PermissionState::Denied) => "denied",
            Ok(tauri::plugin::PermissionState::Prompt)
            | Ok(tauri::plugin::PermissionState::PromptWithRationale) => "prompt",
            Err(_) => "unavailable",
        }
        .to_string();
    }
    #[cfg(not(target_os = "android"))]
    {
        "granted".to_string()
    }
}

fn validate_session_command(payload: &SpeechSessionPayload) -> Result<(), String> {
    if payload.session_id.trim().is_empty() || payload.session_id.len() > 128 {
        return Err("El identificador de la sesion de voz no es valido.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn pause_speech_session(
    payload: SpeechSessionPayload,
    app: AppHandle,
    state: State<'_, SpeechRuntimeState>,
) -> Result<(), String> {
    validate_session_command(&payload)?;
    if !speech_service::runtime_integrated() {
        return Err(speech_service::not_integrated_error());
    }
    let elapsed_ms = speech_service::validate_active_session(&state, &payload.session_id)?;
    {
        let mut phase = state
            .phase
            .lock()
            .map_err(|_| "No se pudo bloquear el estado de voz.".to_string())?;
        if !phase.can_transition_to(SpeechPhase::Paused) {
            return Err("La sesion no puede pausarse en su estado actual.".to_string());
        }
        *phase = SpeechPhase::Paused;
    }
    if let Err(error) = speech_service::pause_platform_audio(&state) {
        if let Ok(mut phase) = state.phase.lock() {
            *phase = SpeechPhase::Recording;
        }
        return Err(error);
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    speech_service::emit_session_state(
        &app,
        &payload.session_id,
        crate::dto::speech::SpeechSessionStateDto::Paused { elapsed_ms },
    );
    Ok(())
}

#[tauri::command]
pub fn resume_speech_session(
    payload: SpeechSessionPayload,
    app: AppHandle,
    state: State<'_, SpeechRuntimeState>,
) -> Result<(), String> {
    validate_session_command(&payload)?;
    if !speech_service::runtime_integrated() {
        return Err(speech_service::not_integrated_error());
    }
    let elapsed_ms = speech_service::validate_active_session(&state, &payload.session_id)?;
    {
        let mut phase = state
            .phase
            .lock()
            .map_err(|_| "No se pudo bloquear el estado de voz.".to_string())?;
        if !phase.can_transition_to(SpeechPhase::Recording) {
            return Err("La sesion no puede reanudarse en su estado actual.".to_string());
        }
        *phase = SpeechPhase::Recording;
    }
    if let Err(error) = speech_service::resume_platform_audio(&state) {
        if let Ok(mut phase) = state.phase.lock() {
            *phase = SpeechPhase::Paused;
        }
        return Err(error);
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    speech_service::emit_session_state(
        &app,
        &payload.session_id,
        crate::dto::speech::SpeechSessionStateDto::Recording {
            elapsed_ms,
            has_speech: true,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn stop_speech_session(
    payload: SpeechSessionPayload,
    app: AppHandle,
    state: State<'_, SpeechRuntimeState>,
) -> Result<(), String> {
    validate_session_command(&payload)?;
    speech_service::validate_active_session(&state, &payload.session_id)?;
    {
        let mut phase = state
            .phase
            .lock()
            .map_err(|_| "No se pudo bloquear el estado de voz.".to_string())?;
        if !phase.can_transition_to(SpeechPhase::Finalizing) {
            return Err("La sesion no puede finalizarse en su estado actual.".to_string());
        }
        *phase = SpeechPhase::Finalizing;
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    speech_service::emit_session_state(
        &app,
        &payload.session_id,
        crate::dto::speech::SpeechSessionStateDto::Finalizing { progress: None },
    );
    let worker_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let worker_state = worker_app.state::<SpeechRuntimeState>();
        speech_service::stop_platform_session(&worker_state)
    })
    .await
    .map_err(|error| {
        format!("El worker de finalizacion de voz finalizo inesperadamente: {error}")
    })?
}

#[tauri::command]
pub fn consume_speech_turn(
    payload: SpeechSessionPayload,
    app: AppHandle,
    state: State<'_, SpeechRuntimeState>,
) -> Result<String, String> {
    validate_session_command(&payload)?;
    let elapsed_ms = speech_service::validate_active_session(&state, &payload.session_id)?;
    let text = speech_service::consume_platform_turn(&state, &payload.session_id)?;
    if text.is_empty() {
        return Err("No se detecto voz en este turno.".to_string());
    }
    if let Ok(mut phase) = state.phase.lock() {
        *phase = SpeechPhase::Paused;
    }
    #[cfg(any(target_os = "windows", target_os = "android"))]
    speech_service::emit_session_state(
        &app,
        &payload.session_id,
        crate::dto::speech::SpeechSessionStateDto::Paused { elapsed_ms },
    );
    Ok(text)
}

#[tauri::command]
pub fn cancel_speech_session(
    payload: SpeechSessionPayload,
    state: State<'_, SpeechRuntimeState>,
) -> Result<(), String> {
    validate_session_command(&payload)?;
    speech_service::validate_active_session(&state, &payload.session_id)?;
    speech_service::cancel_platform_audio(&state)
}
