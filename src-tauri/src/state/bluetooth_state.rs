#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[cfg(not(target_os = "linux"))]
use crate::services::bluetooth_service::DesktopColdPassBluetoothConnection;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use std::sync::Mutex;

#[derive(Default)]
pub struct ColdPassBluetoothState {
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    #[cfg(not(target_os = "linux"))]
    pub connection: Mutex<Option<DesktopColdPassBluetoothConnection>>,
    #[cfg(target_os = "linux")]
    pub pairing_session:
        Mutex<Option<crate::services::bluetooth_service::LinuxBluetoothCtlSession>>,
    #[cfg(target_os = "linux")]
    pub gatt_connection:
        Mutex<Option<crate::services::bluetooth_service::LinuxColdPassGattConnection>>,
}
