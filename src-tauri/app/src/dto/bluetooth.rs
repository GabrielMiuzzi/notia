use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColdPassBluetoothStatusDto {
    pub supported: bool,
    pub connected: bool,
    pub phase: String,
    pub application_authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_uuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}
