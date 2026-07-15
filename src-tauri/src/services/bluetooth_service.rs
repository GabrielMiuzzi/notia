#[cfg(not(any(target_os = "android", target_os = "ios")))]
use btleplug::api::{
    Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, ValueNotification,
    WriteType,
};
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use btleplug::platform::{Adapter, Manager, Peripheral};
#[cfg(target_os = "linux")]
use futures::StreamExt;

use crate::dto::bluetooth::ColdPassBluetoothStatusDto;

#[cfg(target_os = "linux")]
use std::io::{Read, Write};
#[cfg(target_os = "linux")]
use std::process::{Child, ChildStdin, Command, Stdio};
#[cfg(target_os = "linux")]
use std::sync::{Arc, Mutex};
#[cfg(target_os = "linux")]
use std::thread;

pub const COLDPASS_BLUETOOTH_SERVICE_UUID: &str = "8f95d4ef-6b74-4b7a-84b1-75a0ad8e4b61";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub const COLDPASS_BLUETOOTH_DEVICE_NAME: &str = "ColdPass";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub const COLDPASS_BLUETOOTH_RX_CHARACTERISTIC_UUID: &str = "4834f924-b2a8-4d65-b0f0-8e6c12fd72be";
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub const COLDPASS_BLUETOOTH_TX_CHARACTERISTIC_UUID: &str = "06342a5f-8f7b-44b8-9c6c-bf7feab42054";

#[cfg(target_os = "linux")]
#[derive(Clone)]
pub struct LinuxColdPassGattConnection {
    pub peripheral: Peripheral,
    pub device_id: String,
    pub device_name: String,
    pub rx_characteristic: Characteristic,
    pub tx_characteristic: Characteristic,
    pub application_authenticated: bool,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Default)]
struct LinuxBluetoothCtlSharedStatus {
    phase: String,
    connected: bool,
    device_id: Option<String>,
    device_name: Option<String>,
    prompt_message: Option<String>,
    error_message: Option<String>,
    retried_after_existing_bond: bool,
    pin_submitted: bool,
}

#[cfg(target_os = "linux")]
pub struct LinuxBluetoothCtlSession {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    shared: Arc<Mutex<LinuxBluetoothCtlSharedStatus>>,
}

#[cfg(target_os = "linux")]
impl LinuxBluetoothCtlSession {
    pub fn status(&self) -> Result<ColdPassBluetoothStatusDto, String> {
        let shared = self
            .shared
            .lock()
            .map_err(|_| "No se pudo leer el estado del pairing Bluetooth.".to_string())?
            .clone();
        Ok(build_status_from_linux_shared(shared))
    }

    pub fn send_pin(&mut self, pin: &str) -> Result<ColdPassBluetoothStatusDto, String> {
        if pin.trim().is_empty() {
            return Err("El PIN no puede estar vacio.".to_string());
        }

        write_linux_command(&self.stdin, &format!("{}\n", pin.trim()))
            .map_err(|error| format!("No se pudo enviar el PIN a bluetoothctl: {error}"))?;

        if let Ok(mut shared) = self.shared.lock() {
            shared.phase = "pairing".to_string();
            shared.prompt_message =
                Some("PIN enviado. Esperando validacion del enlace seguro...".to_string());
            shared.error_message = None;
            shared.pin_submitted = true;
        }

        self.status()
    }

    pub fn disconnect(&mut self) -> Result<(), String> {
        let device_id = self
            .shared
            .lock()
            .ok()
            .and_then(|shared| shared.device_id.clone());

        if let Some(device_id) = device_id {
            let _ = write_linux_command(&self.stdin, &format!("disconnect {}\n", device_id));
        }
        let _ = write_linux_command(&self.stdin, "scan off\nquit\n");
        let _ = self.child.kill();
        let _ = self.child.wait();
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn write_linux_command(stdin: &Arc<Mutex<ChildStdin>>, command: &str) -> Result<(), String> {
    let mut stdin_handle = stdin
        .lock()
        .map_err(|_| "No se pudo bloquear la entrada de bluetoothctl.".to_string())?;
    stdin_handle
        .write_all(command.as_bytes())
        .map_err(|error| format!("No se pudo escribir en bluetoothctl: {error}"))?;
    stdin_handle
        .flush()
        .map_err(|error| format!("No se pudo confirmar el comando Bluetooth: {error}"))?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn strip_ansi_sequences(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                let _ = chars.next();
                while let Some(next) = chars.next() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }

        if character == '\u{8}' {
            continue;
        }

        result.push(character);
    }

    result.replace('\r', "").trim().to_string()
}

#[cfg(target_os = "linux")]
fn build_status_from_linux_shared(
    shared: LinuxBluetoothCtlSharedStatus,
) -> ColdPassBluetoothStatusDto {
    ColdPassBluetoothStatusDto {
        supported: true,
        connected: shared.connected,
        phase: shared.phase,
        application_authenticated: false,
        device_id: shared.device_id,
        device_name: shared.device_name,
        service_uuid: Some(COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
        prompt_message: shared.prompt_message,
        error_message: shared.error_message,
    }
}

#[cfg(target_os = "linux")]
fn update_linux_status_from_output(
    shared: &Arc<Mutex<LinuxBluetoothCtlSharedStatus>>,
    output: &str,
    stdin: &Arc<Mutex<ChildStdin>>,
) {
    let normalized_output = strip_ansi_sequences(output);
    if normalized_output.is_empty() {
        return;
    }

    let mut maybe_pair_command: Option<String> = None;
    let lower_output = normalized_output.to_ascii_lowercase();

    if let Ok(mut state) = shared.lock() {
        for normalized_line in normalized_output.lines() {
            if normalized_line.contains("Device ")
                && normalized_line.contains(COLDPASS_BLUETOOTH_DEVICE_NAME)
            {
                let parts: Vec<&str> = normalized_line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let maybe_mac = parts[1];
                    if maybe_mac.matches(':').count() == 5 {
                        state.device_id = Some(maybe_mac.to_string());
                        state.device_name = Some(COLDPASS_BLUETOOTH_DEVICE_NAME.to_string());
                        if state.phase == "searching" {
                            state.phase = "pairing".to_string();
                            state.prompt_message = Some(
                                "Dispositivo encontrado. Iniciando pairing seguro...".to_string(),
                            );
                            state.error_message = None;
                            maybe_pair_command = Some(format!("scan off\npair {}\n", maybe_mac));
                        }
                    }
                }
            }
        }

        let is_pin_prompt = lower_output.contains("enter pin code")
            || lower_output.contains("enter passkey")
            || lower_output.contains("request passkey")
            || lower_output.contains("request pin code")
            || lower_output.contains("requestpasskey")
            || lower_output.contains("requestpincode");

        if is_pin_prompt {
            if !state.pin_submitted {
                state.phase = "awaiting-pin".to_string();
                state.prompt_message = Some(
                    "Ingresá el PIN que aparece en la pantalla de la placa ColdPass.".to_string(),
                );
                state.error_message = None;
            }
        } else if lower_output.contains("pairing successful") {
            state.phase = "pairing".to_string();
            state.prompt_message = Some("Pairing exitoso. Finalizando conexion...".to_string());
            state.error_message = None;
            state.pin_submitted = true;
            if let Some(device_id) = state.device_id.clone() {
                maybe_pair_command = Some(format!("trust {0}\nconnect {0}\n", device_id));
            }
        } else if lower_output.contains("connection successful")
            || lower_output.contains("servicesresolved: yes")
        {
            state.phase = "connected".to_string();
            state.connected = true;
            state.prompt_message = Some("ColdPass conectado correctamente.".to_string());
            state.error_message = None;
            state.pin_submitted = true;
        } else if lower_output.contains("alreadyexists") {
            if let Some(device_id) = state.device_id.clone() {
                if !state.retried_after_existing_bond {
                    state.retried_after_existing_bond = true;
                    state.phase = "pairing".to_string();
                    state.connected = false;
                    state.error_message = None;
                    state.pin_submitted = false;
                    state.prompt_message = Some(
                        "Habia un vinculo Bluetooth previo. Rehaciendo el enlace para volver a pedir el PIN..."
                            .to_string(),
                    );
                    maybe_pair_command = Some(format!("remove {0}\npair {0}\n", device_id));
                } else {
                    state.phase = "error".to_string();
                    state.connected = false;
                    state.error_message = Some(normalized_output.clone());
                    state.prompt_message = Some(
                        "BlueZ mantiene un vinculo previo con ColdPass. Eliminá el dispositivo del sistema y reintentá."
                            .to_string(),
                    );
                }
            }
        } else if lower_output.contains("failed to pair")
            || lower_output.contains("authenticationfailed")
            || lower_output.contains("authentication failed")
            || lower_output.contains("org.bluez.error")
            || lower_output.contains("not available")
        {
            state.phase = "error".to_string();
            state.connected = false;
            state.error_message = Some(normalized_output.clone());
            state.prompt_message =
                Some("Fallo el pairing Bluetooth. Revisá el PIN y volvé a intentar.".to_string());
            state.pin_submitted = false;
        }
    }

    if let Some(command) = maybe_pair_command {
        let _ = write_linux_command(stdin, &command);
    }
}

#[cfg(target_os = "linux")]
fn spawn_linux_bluetoothctl_reader<R: Read + Send + 'static>(
    mut reader: R,
    shared: Arc<Mutex<LinuxBluetoothCtlSharedStatus>>,
    stdin: Arc<Mutex<ChildStdin>>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 1024];
        let mut pending = String::new();

        loop {
            let read_size = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read_size) => read_size,
                Err(_) => break,
            };

            pending.push_str(&String::from_utf8_lossy(&buffer[..read_size]));
            update_linux_status_from_output(&shared, &pending, &stdin);

            if let Some(last_newline) = pending.rfind('\n') {
                pending = pending[last_newline + 1..].to_string();
            } else if pending.len() > 256 {
                pending = pending[pending.len().saturating_sub(256)..].to_string();
            }
        }
    });
}

#[cfg(target_os = "linux")]
fn normalize_linux_device_id(raw_device_id: &str) -> String {
    let trimmed = raw_device_id.trim();
    if trimmed.matches(':').count() == 5 {
        return trimmed.to_string();
    }

    if let Some(device_marker_index) = trimmed.find("dev_") {
        let candidate = trimmed[device_marker_index + 4..].replace('_', ":");
        if candidate.matches(':').count() == 5 {
            return candidate;
        }
    }

    let candidate = trimmed.replace('_', ":");
    if candidate.matches(':').count() == 5 {
        return candidate;
    }

    trimmed.to_string()
}

#[cfg(target_os = "linux")]
fn create_linux_bluetoothctl_session(device_id: &str) -> Result<LinuxBluetoothCtlSession, String> {
    let mut child = Command::new("bluetoothctl")
        .arg("--agent")
        .arg("KeyboardOnly")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("No se pudo iniciar bluetoothctl: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "No se pudo capturar la salida de bluetoothctl.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "No se pudo capturar los errores de bluetoothctl.".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "No se pudo abrir la entrada de bluetoothctl.".to_string())?;
    let stdin = Arc::new(Mutex::new(stdin));

    let normalized_device_id = normalize_linux_device_id(device_id);

    let shared = Arc::new(Mutex::new(LinuxBluetoothCtlSharedStatus {
        phase: "searching".to_string(),
        connected: false,
        device_id: Some(normalized_device_id.clone()),
        device_name: Some(COLDPASS_BLUETOOTH_DEVICE_NAME.to_string()),
        prompt_message: Some("Buscando el dispositivo ColdPass e iniciando pairing...".to_string()),
        error_message: None,
        retried_after_existing_bond: false,
        pin_submitted: false,
    }));

    spawn_linux_bluetoothctl_reader(stdout, Arc::clone(&shared), Arc::clone(&stdin));
    spawn_linux_bluetoothctl_reader(stderr, Arc::clone(&shared), Arc::clone(&stdin));

    let session = LinuxBluetoothCtlSession {
        child,
        stdin,
        shared,
    };
    write_linux_command(
        &session.stdin,
        &format!(
            "agent KeyboardOnly\ndefault-agent\npower on\npairable on\nscan le\npair {}\n",
            normalized_device_id
        ),
    )
    .map_err(|error| format!("No se pudo inicializar bluetoothctl: {error}"))?;

    Ok(session)
}

#[cfg(target_os = "linux")]
pub fn linux_bluetooth_status(
    session: &LinuxBluetoothCtlSession,
) -> Result<ColdPassBluetoothStatusDto, String> {
    session.status()
}

#[cfg(target_os = "linux")]
pub fn linux_bluetooth_start_pairing(device_id: &str) -> Result<LinuxBluetoothCtlSession, String> {
    create_linux_bluetoothctl_session(device_id)
}

#[cfg(target_os = "linux")]
pub fn linux_bluetooth_submit_pin(
    session: &mut LinuxBluetoothCtlSession,
    pin: &str,
) -> Result<ColdPassBluetoothStatusDto, String> {
    session.send_pin(pin)
}

#[cfg(target_os = "linux")]
pub fn linux_bluetooth_disconnect(session: &mut LinuxBluetoothCtlSession) -> Result<(), String> {
    session.disconnect()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(target_os = "linux"))]
#[derive(Clone)]
pub struct DesktopColdPassBluetoothConnection {
    pub peripheral: Peripheral,
    pub device_id: String,
    pub device_name: String,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(target_os = "linux"))]
impl DesktopColdPassBluetoothConnection {
    pub async fn to_status(&self) -> Result<ColdPassBluetoothStatusDto, String> {
        let connected = self
            .peripheral
            .is_connected()
            .await
            .map_err(|error| format!("No se pudo leer el estado Bluetooth: {error}"))?;

        Ok(ColdPassBluetoothStatusDto {
            supported: true,
            connected,
            phase: if connected { "connected" } else { "idle" }.to_string(),
            application_authenticated: false,
            device_id: Some(self.device_id.clone()),
            device_name: Some(self.device_name.clone()),
            service_uuid: Some(COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
            prompt_message: None,
            error_message: None,
        })
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn get_adapter() -> Result<Adapter, String> {
    let manager = Manager::new()
        .await
        .map_err(|error| format!("No se pudo inicializar el manager Bluetooth: {error}"))?;
    let adapters = manager
        .adapters()
        .await
        .map_err(|error| format!("No se pudieron leer los adaptadores Bluetooth: {error}"))?;

    adapters
        .into_iter()
        .next()
        .ok_or_else(|| "No hay adaptadores Bluetooth disponibles.".to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn find_coldpass_peripheral(adapter: &Adapter) -> Result<Peripheral, String> {
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|error| format!("No se pudo iniciar el escaneo Bluetooth: {error}"))?;
    std::thread::sleep(std::time::Duration::from_secs(2));

    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|error| format!("No se pudieron listar los dispositivos Bluetooth: {error}"))?;

    for peripheral in peripherals {
        let Some(properties) = peripheral.properties().await.map_err(|error| {
            format!("No se pudieron leer las propiedades del dispositivo: {error}")
        })?
        else {
            continue;
        };

        let matches_name = properties
            .local_name
            .as_deref()
            .map(|name| name == COLDPASS_BLUETOOTH_DEVICE_NAME)
            .unwrap_or(false);
        let matches_service = properties.services.iter().any(|uuid| {
            uuid.to_string()
                .eq_ignore_ascii_case(COLDPASS_BLUETOOTH_SERVICE_UUID)
        });

        if matches_name || matches_service {
            return Ok(peripheral);
        }
    }

    Err(format!(
        "No se encontro el dispositivo Bluetooth \"{COLDPASS_BLUETOOTH_DEVICE_NAME}\"."
    ))
}

#[cfg(target_os = "linux")]
pub async fn linux_discover_coldpass_device_id() -> Result<String, String> {
    let adapter = get_adapter().await?;
    let peripheral = find_coldpass_peripheral(&adapter).await?;
    Ok(normalize_linux_device_id(&peripheral.id().to_string()))
}

#[cfg(target_os = "linux")]
async fn find_linux_peripheral_by_device_id(
    adapter: &Adapter,
    device_id: &str,
) -> Result<Peripheral, String> {
    adapter
        .start_scan(ScanFilter::default())
        .await
        .map_err(|error| format!("No se pudo iniciar el escaneo Bluetooth: {error}"))?;
    std::thread::sleep(std::time::Duration::from_secs(2));

    let normalized_device_id = normalize_linux_device_id(device_id);
    let peripherals = adapter
        .peripherals()
        .await
        .map_err(|error| format!("No se pudieron listar los dispositivos Bluetooth: {error}"))?;

    for peripheral in peripherals {
        if normalize_linux_device_id(&peripheral.id().to_string()) == normalized_device_id {
            return Ok(peripheral);
        }
    }

    Err(
        "No se pudo encontrar el dispositivo ColdPass ya vinculado para abrir el canal GATT."
            .to_string(),
    )
}

#[cfg(target_os = "linux")]
fn find_characteristic<'a, I>(characteristics: I, uuid: &str) -> Result<Characteristic, String>
where
    I: IntoIterator<Item = &'a Characteristic>,
{
    characteristics
        .into_iter()
        .find(|characteristic| characteristic.uuid.to_string().eq_ignore_ascii_case(uuid))
        .cloned()
        .ok_or_else(|| format!("No se encontro la characteristic Bluetooth {uuid}."))
}

#[cfg(target_os = "linux")]
pub async fn linux_connect_gatt(device_id: &str) -> Result<LinuxColdPassGattConnection, String> {
    let adapter = get_adapter().await?;
    let peripheral = find_linux_peripheral_by_device_id(&adapter, device_id).await?;

    if !peripheral
        .is_connected()
        .await
        .map_err(|error| format!("No se pudo leer la conexion GATT de ColdPass: {error}"))?
    {
        peripheral
            .connect()
            .await
            .map_err(|error| format!("No se pudo abrir el canal GATT de ColdPass: {error}"))?;
    }

    peripheral
        .discover_services()
        .await
        .map_err(|error| format!("No se pudieron descubrir los servicios de ColdPass: {error}"))?;

    let properties = peripheral.properties().await.map_err(|error| {
        format!("No se pudieron leer las propiedades GATT de ColdPass: {error}")
    })?;
    let device_name = properties
        .and_then(|current| current.local_name)
        .unwrap_or_else(|| COLDPASS_BLUETOOTH_DEVICE_NAME.to_string());
    let characteristics = peripheral.characteristics();
    let rx_characteristic = find_characteristic(
        characteristics.iter(),
        COLDPASS_BLUETOOTH_RX_CHARACTERISTIC_UUID,
    )?;
    let tx_characteristic = find_characteristic(
        characteristics.iter(),
        COLDPASS_BLUETOOTH_TX_CHARACTERISTIC_UUID,
    )?;

    Ok(LinuxColdPassGattConnection {
        peripheral,
        device_id: normalize_linux_device_id(device_id),
        device_name,
        rx_characteristic,
        tx_characteristic,
        application_authenticated: false,
    })
}

#[cfg(target_os = "linux")]
pub async fn linux_write_gatt_payload(
    connection: &LinuxColdPassGattConnection,
    payload: &str,
) -> Result<(), String> {
    connection
        .peripheral
        .write(
            &connection.rx_characteristic,
            payload.as_bytes(),
            WriteType::WithResponse,
        )
        .await
        .map_err(|error| format!("No se pudo escribir el payload cifrado a ColdPass: {error}"))
}

#[cfg(target_os = "linux")]
pub async fn linux_read_gatt_value(
    connection: &LinuxColdPassGattConnection,
) -> Result<String, String> {
    let value = connection
        .peripheral
        .read(&connection.tx_characteristic)
        .await
        .map_err(|error| format!("No se pudo leer la respuesta de ColdPass: {error}"))?;

    Ok(String::from_utf8_lossy(&value).trim().to_string())
}

#[cfg(target_os = "linux")]
fn is_terminal_coldpass_callback(value: &str) -> bool {
    matches!(
        value,
        "app_auth_ok"
            | "app_auth_failed"
            | "msg_ok"
            | "packet_invalid"
            | "kdf_invalid"
            | "kdf_failed"
            | "decrypt_failed"
            | "app_auth_required"
    )
}

#[cfg(target_os = "linux")]
async fn linux_wait_for_gatt_terminal_value_by_read(
    connection: &LinuxColdPassGattConnection,
    baseline_value: &str,
    expected_value: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    let started_at = std::time::Instant::now();
    let mut last_terminal_value = String::new();

    while started_at.elapsed() < std::time::Duration::from_millis(timeout_ms) {
        let value = linux_read_gatt_value(connection).await?;
        if value.is_empty() || value == baseline_value {
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            continue;
        }

        if value == expected_value {
            return Ok(value);
        }

        if is_terminal_coldpass_callback(&value) {
            last_terminal_value = value;
            break;
        }

        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    }

    Ok(last_terminal_value)
}

#[cfg(target_os = "linux")]
pub async fn linux_subscribe_gatt_notifications(
    connection: &LinuxColdPassGattConnection,
) -> Result<impl futures::Stream<Item = ValueNotification> + Unpin, String> {
    connection
        .peripheral
        .subscribe(&connection.tx_characteristic)
        .await
        .map_err(|error| format!("No se pudo suscribir a los callbacks de ColdPass: {error}"))?;

    connection
        .peripheral
        .notifications()
        .await
        .map_err(|error| format!("No se pudo abrir el stream de callbacks de ColdPass: {error}"))
}

#[cfg(target_os = "linux")]
pub async fn linux_wait_for_gatt_notification<S>(
    notifications: &mut S,
    connection: &LinuxColdPassGattConnection,
    baseline_value: &str,
    expected_value: &str,
    timeout_ms: u64,
) -> Result<String, String>
where
    S: futures::Stream<Item = ValueNotification> + Unpin,
{
    let started_at = std::time::Instant::now();
    let mut last_terminal_value = String::new();

    while started_at.elapsed() < std::time::Duration::from_millis(timeout_ms) {
        let remaining =
            std::time::Duration::from_millis(timeout_ms).saturating_sub(started_at.elapsed());
        let next_notification = tokio::time::timeout(remaining, notifications.next()).await;
        let Ok(Some(notification)) = next_notification else {
            break;
        };

        if notification.uuid != connection.tx_characteristic.uuid {
            continue;
        }

        let value = String::from_utf8_lossy(&notification.value)
            .trim()
            .to_string();
        if value.is_empty() || value == baseline_value {
            continue;
        }

        if value == expected_value {
            return Ok(value);
        }

        if is_terminal_coldpass_callback(&value) {
            last_terminal_value = value;
            break;
        }
    }

    if !last_terminal_value.is_empty() {
        return Ok(last_terminal_value);
    }

    let remaining_timeout_ms = timeout_ms.saturating_sub(started_at.elapsed().as_millis() as u64);
    if remaining_timeout_ms == 0 {
        return Ok(String::new());
    }

    linux_wait_for_gatt_terminal_value_by_read(
        connection,
        baseline_value,
        expected_value,
        remaining_timeout_ms,
    )
    .await
}

#[cfg(target_os = "linux")]
pub async fn linux_disconnect_gatt(connection: &LinuxColdPassGattConnection) -> Result<(), String> {
    if connection
        .peripheral
        .is_connected()
        .await
        .map_err(|error| format!("No se pudo validar la desconexion GATT: {error}"))?
    {
        connection
            .peripheral
            .disconnect()
            .await
            .map_err(|error| format!("No se pudo cerrar el canal GATT de ColdPass: {error}"))?;
    }

    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(target_os = "linux"))]
pub async fn connect_to_coldpass() -> Result<DesktopColdPassBluetoothConnection, String> {
    let adapter = get_adapter().await?;
    let peripheral = find_coldpass_peripheral(&adapter).await?;

    peripheral
        .connect()
        .await
        .map_err(|error| format!("No se pudo conectar con ColdPass: {error}"))?;

    let properties = peripheral
        .properties()
        .await
        .map_err(|error| format!("No se pudieron leer las propiedades de ColdPass: {error}"))?;

    let device_name = properties
        .and_then(|current| current.local_name)
        .unwrap_or_else(|| COLDPASS_BLUETOOTH_DEVICE_NAME.to_string());
    let device_id = peripheral.id().to_string();

    Ok(DesktopColdPassBluetoothConnection {
        peripheral,
        device_id,
        device_name,
    })
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(target_os = "linux"))]
pub async fn disconnect_coldpass(
    connection: &DesktopColdPassBluetoothConnection,
) -> Result<(), String> {
    if connection
        .peripheral
        .is_connected()
        .await
        .map_err(|error| format!("No se pudo validar la conexion Bluetooth: {error}"))?
    {
        connection
            .peripheral
            .disconnect()
            .await
            .map_err(|error| format!("No se pudo desconectar ColdPass: {error}"))?;
    }

    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn unsupported_bluetooth_status() -> ColdPassBluetoothStatusDto {
    ColdPassBluetoothStatusDto {
        supported: false,
        connected: false,
        phase: "unsupported".to_string(),
        application_authenticated: false,
        device_id: None,
        device_name: None,
        service_uuid: Some(COLDPASS_BLUETOOTH_SERVICE_UUID.to_string()),
        prompt_message: Some(
            "Este runtime no expone backend Bluetooth compatible para ColdPass.".to_string(),
        ),
        error_message: None,
    }
}
