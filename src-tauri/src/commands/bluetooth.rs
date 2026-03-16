#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::State;

use crate::dto::bluetooth::ColdPassBluetoothStatusDto;
use crate::services::bluetooth_service;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use crate::state::bluetooth_state::ColdPassBluetoothState;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassBluetoothPinPayload {
    pub pin: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassBluetoothEncryptedPayload {
    pub packet: String,
}

#[cfg(target_os = "linux")]
async fn ensure_linux_gatt_connection(
    state: &State<'_, ColdPassBluetoothState>,
    device_id: &str,
) -> Result<crate::services::bluetooth_service::LinuxColdPassGattConnection, String> {
    let existing_connection = {
        state
            .gatt_connection
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?
            .clone()
    };

    if let Some(connection) = existing_connection {
        if connection.device_id == device_id {
            return Ok(connection);
        }
    }

    let connection = bluetooth_service::linux_connect_gatt(device_id).await?;
    let mut state_lock = state
        .gatt_connection
        .lock()
        .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?;
    *state_lock = Some(connection.clone());
    Ok(connection)
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_status(
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        let application_authenticated = state
            .gatt_connection
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?
            .as_ref()
            .map(|connection| connection.application_authenticated)
            .unwrap_or(false);
        let status = {
            let session_lock = state
                .pairing_session
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;
            if let Some(session) = session_lock.as_ref() {
                Some(bluetooth_service::linux_bluetooth_status(session)?)
            } else {
                None
            }
        };

        return Ok(status
            .map(|mut current_status| {
                current_status.application_authenticated = application_authenticated;
                current_status
            })
            .unwrap_or(ColdPassBluetoothStatusDto {
            supported: true,
            connected: false,
            phase: "idle".to_string(),
            application_authenticated,
            device_id: None,
            device_name: None,
            service_uuid: Some(bluetooth_service::COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
            prompt_message: Some("Buscá el dispositivo ColdPass para iniciar el pairing seguro.".to_string()),
            error_message: None,
        }));
    }

    #[cfg(not(target_os = "linux"))]
    {
        let existing_connection = {
            state
                .connection
                .lock()
                .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?
                .clone()
        };

        if let Some(connection) = existing_connection {
            let status = connection.to_status().await?;
            if status.connected {
                return Ok(status);
            }

            let mut state_lock = state
                .connection
                .lock()
                .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?;
            *state_lock = None;
        }

        return Ok(ColdPassBluetoothStatusDto {
            supported: true,
            connected: false,
            phase: "idle".to_string(),
            application_authenticated: false,
            device_id: None,
            device_name: None,
            service_uuid: Some(bluetooth_service::COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
            prompt_message: Some("Buscá el dispositivo ColdPass para iniciar el pairing seguro.".to_string()),
            error_message: None,
        });
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_status() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_connect(
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        {
            let mut session_lock = state
                .pairing_session
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;

            if let Some(session) = session_lock.as_mut() {
                let status = bluetooth_service::linux_bluetooth_status(session)?;
                if status.connected || status.phase == "searching" || status.phase == "awaiting-pin" || status.phase == "pairing" {
                    return Ok(status);
                }

                bluetooth_service::linux_bluetooth_disconnect(session)?;
                *session_lock = None;
            }
        }

        let device_id = bluetooth_service::linux_discover_coldpass_device_id().await?;
        let session = bluetooth_service::linux_bluetooth_start_pairing(&device_id)?;
        let status = bluetooth_service::linux_bluetooth_status(&session)?;
        let mut session_lock = state
            .pairing_session
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;
        *session_lock = Some(session);
        let mut gatt_lock = state
            .gatt_connection
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?;
        *gatt_lock = None;
        return Ok(status);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let existing_connection = {
            state
                .connection
                .lock()
                .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?
                .clone()
        };

        if let Some(connection) = existing_connection {
            let status = connection.to_status().await?;
            if status.connected {
                return Ok(status);
            }
        }

        let connection = bluetooth_service::connect_to_coldpass().await?;
        let status = connection.to_status().await?;

        let mut state_lock = state
            .connection
            .lock()
            .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?;
        *state_lock = Some(connection);

        return Ok(status);
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_connect() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_submit_pin(
    payload: ColdPassBluetoothPinPayload,
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        let existing_gatt_connection = {
            state
                .gatt_connection
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?
                .clone()
        };
        if let Some(connection) = existing_gatt_connection {
            bluetooth_service::linux_disconnect_gatt(&connection).await?;
        }
        let mut gatt_lock = state
            .gatt_connection
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?;
        *gatt_lock = None;

        let mut session_lock = state
            .pairing_session
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;
        let session = session_lock
            .as_mut()
            .ok_or_else(|| "No hay una sesion de pairing Bluetooth activa.".to_string())?;
        return bluetooth_service::linux_bluetooth_submit_pin(session, &payload.pin);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = payload;
        let _ = state;
        Err("El envio manual de PIN solo esta soportado en Linux por ahora.".to_string())
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_submit_pin() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_disconnect(
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        let mut session_lock = state
            .pairing_session
            .lock()
            .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;
        if let Some(session) = session_lock.as_mut() {
            bluetooth_service::linux_bluetooth_disconnect(session)?;
        }
        *session_lock = None;

        return Ok(ColdPassBluetoothStatusDto {
            supported: true,
            connected: false,
            phase: "idle".to_string(),
            application_authenticated: false,
            device_id: None,
            device_name: None,
            service_uuid: Some(bluetooth_service::COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
            prompt_message: Some("La conexion Bluetooth fue cerrada.".to_string()),
            error_message: None,
        });
    }

    #[cfg(not(target_os = "linux"))]
    {
        let existing_connection = {
            state
                .connection
                .lock()
                .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?
                .clone()
        };

        if let Some(connection) = existing_connection {
            bluetooth_service::disconnect_coldpass(&connection).await?;
        }

        let mut state_lock = state
            .connection
            .lock()
            .map_err(|_| "No se pudo bloquear el estado Bluetooth.".to_string())?;
        *state_lock = None;

        return Ok(ColdPassBluetoothStatusDto {
            supported: true,
            connected: false,
            phase: "idle".to_string(),
            application_authenticated: false,
            device_id: None,
            device_name: None,
            service_uuid: Some(bluetooth_service::COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
            prompt_message: Some("La conexion Bluetooth fue cerrada.".to_string()),
            error_message: None,
        });
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_disconnect() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_authenticate(
    payload: ColdPassBluetoothEncryptedPayload,
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        let device_id = {
            let session_lock = state
                .pairing_session
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion Bluetooth.".to_string())?;
            let session = session_lock
                .as_ref()
                .ok_or_else(|| "No hay una sesion Bluetooth activa con ColdPass.".to_string())?;
            let status = bluetooth_service::linux_bluetooth_status(session)?;
            if !status.connected {
                return Err("ColdPass todavia no termino de conectarse por Bluetooth.".to_string());
            }
            status
                .device_id
                .ok_or_else(|| "No se pudo resolver el identificador BLE de ColdPass.".to_string())?
        };

        let connection = ensure_linux_gatt_connection(&state, &device_id).await?;
        let baseline_response = bluetooth_service::linux_read_gatt_value(&connection).await?;
        let mut notifications = bluetooth_service::linux_subscribe_gatt_notifications(&connection).await?;
        bluetooth_service::linux_write_gatt_payload(&connection, &payload.packet).await?;
        let response = bluetooth_service::linux_wait_for_gatt_notification(
            &mut notifications,
            &connection,
            &baseline_response,
            "app_auth_ok",
            4_000,
        )
        .await?;

        if response != "app_auth_ok" {
            return Err(if response.is_empty() {
                "ColdPass no confirmo la autenticacion del challenge.".to_string()
            } else {
                format!("ColdPass rechazo la autenticacion: {response}")
            });
        }

        {
            let mut state_lock = state
                .gatt_connection
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?;
            if let Some(existing_connection) = state_lock.as_mut() {
                existing_connection.application_authenticated = true;
            }
        }

        let mut status = coldpass_bluetooth_status(state).await?;
        status.application_authenticated = true;
        status.prompt_message = Some("Canal seguro de aplicacion autenticado.".to_string());
        return Ok(status);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = payload;
        let _ = state;
        Err("La autenticacion de aplicacion sobre ColdPass solo esta soportada en Linux por ahora.".to_string())
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_authenticate() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}

#[tauri::command]
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub async fn coldpass_bluetooth_send_message(
    payload: ColdPassBluetoothEncryptedPayload,
    state: State<'_, ColdPassBluetoothState>,
) -> Result<ColdPassBluetoothStatusDto, String> {
    #[cfg(target_os = "linux")]
    {
        let existing_connection = {
            state
                .gatt_connection
                .lock()
                .map_err(|_| "No se pudo bloquear la sesion GATT de ColdPass.".to_string())?
                .clone()
        };

        let connection = existing_connection
            .ok_or_else(|| "No hay una sesion GATT autenticada con ColdPass.".to_string())?;

        if !connection.application_authenticated {
            return Err("ColdPass todavia no completo la autenticacion de aplicacion.".to_string());
        }

        let baseline_response = bluetooth_service::linux_read_gatt_value(&connection).await?;
        let mut notifications = bluetooth_service::linux_subscribe_gatt_notifications(&connection).await?;
        bluetooth_service::linux_write_gatt_payload(&connection, &payload.packet).await?;
        let response = bluetooth_service::linux_wait_for_gatt_notification(
            &mut notifications,
            &connection,
            &baseline_response,
            "msg_ok",
            4_000,
        )
        .await?;
        if response != "msg_ok" {
            return Err(if response.is_empty() {
                "ColdPass no confirmo la recepcion del mensaje cifrado.".to_string()
            } else {
                format!("ColdPass rechazo el mensaje cifrado: {response}")
            });
        }

        let mut status = coldpass_bluetooth_status(state).await?;
        status.prompt_message = Some("Mensaje cifrado enviado y confirmado por ColdPass.".to_string());
        return Ok(status);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = payload;
        let _ = state;
        Err("El envio cifrado de mensajes a ColdPass solo esta soportado en Linux por ahora.".to_string())
    }
}

#[tauri::command]
#[cfg(any(target_os = "android", target_os = "ios"))]
pub async fn coldpass_bluetooth_send_message() -> Result<ColdPassBluetoothStatusDto, String> {
    Ok(bluetooth_service::unsupported_bluetooth_status())
}
