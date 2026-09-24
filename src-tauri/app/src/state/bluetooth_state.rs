#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
#[cfg(not(target_os = "linux"))]
use crate::services::bluetooth_service::DesktopColdPassBluetoothConnection;
#[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
use std::sync::Mutex;

#[derive(Default)]
pub struct ColdPassBluetoothState {
    #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
    #[cfg(not(target_os = "linux"))]
    pub connection: Mutex<Option<DesktopColdPassBluetoothConnection>>,
    #[cfg(all(feature = "bluetooth", target_os = "linux"))]
    pub pairing_session:
        Mutex<Option<crate::services::bluetooth_service::LinuxBluetoothCtlSession>>,
    #[cfg(all(feature = "bluetooth", target_os = "linux"))]
    pub gatt_connection:
        Mutex<Option<crate::services::bluetooth_service::LinuxColdPassGattConnection>>,
    /// Passkey of the authenticated application channel; it encrypts the
    /// following messages and never reaches the interface.
    #[cfg(all(feature = "bluetooth", not(any(target_os = "android", target_os = "ios"))))]
    pub session_passkey: Mutex<Option<String>>,
}
