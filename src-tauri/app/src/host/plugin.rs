//! Startup hooks of the services and native (Kotlin) plugin handles.
//!
//! A service declares a named startup hook with [`Builder`]; the host runs
//! the hooks in order once the application exists, and lends each one a
//! [`PluginApi`] to register its Android plugin under the same name.

use std::fmt;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use super::{AppHandle, Wry};

pub type SetupResult = Result<(), Box<dyn std::error::Error>>;
type SetupFn = dyn FnOnce(&AppHandle, PluginApi) -> SetupResult + Send;

/// Error of a native plugin call, formatted as the plugin reported it.
#[derive(Debug, Clone)]
pub struct PluginInvokeError(String);

impl PluginInvokeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl fmt::Display for PluginInvokeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for PluginInvokeError {}

pub type MobileFuture = Pin<Box<dyn Future<Output = Result<Value, String>> + Send>>;

/// A native plugin registered by the host.
pub trait MobilePlugin: Send + Sync {
    fn run(&self, command: &str, payload: Value) -> Result<Value, String>;
    fn run_async(&self, command: String, payload: Value) -> MobileFuture;
}

/// Registers a native plugin under the name of the running hook.
pub type AndroidPluginRegistrar = Box<dyn Fn(&str, &str) -> Result<PluginHandle<Wry>, String>>;

/// What a startup hook receives besides the application.
pub struct PluginApi {
    registrar: Option<AndroidPluginRegistrar>,
}

impl PluginApi {
    pub fn new(registrar: Option<AndroidPluginRegistrar>) -> Self {
        Self { registrar }
    }

    pub fn register_android_plugin(
        &self,
        package: &str,
        class: &str,
    ) -> Result<PluginHandle<Wry>, PluginInvokeError> {
        let registrar = self
            .registrar
            .as_ref()
            .ok_or_else(|| PluginInvokeError::new("native plugins are not available in this host"))?;
        registrar(package, class).map_err(PluginInvokeError)
    }
}

/// Handle to call a native plugin.
pub struct PluginHandle<R = Wry> {
    plugin: Arc<dyn MobilePlugin>,
    runtime: PhantomData<R>,
}

impl<R> Clone for PluginHandle<R> {
    fn clone(&self) -> Self {
        Self { plugin: Arc::clone(&self.plugin), runtime: PhantomData }
    }
}

impl<R> PluginHandle<R> {
    pub fn new(plugin: Arc<dyn MobilePlugin>) -> Self {
        Self { plugin, runtime: PhantomData }
    }

    pub fn run_mobile_plugin<T: DeserializeOwned>(
        &self,
        command: impl AsRef<str>,
        payload: impl Serialize,
    ) -> Result<T, PluginInvokeError> {
        let payload = to_payload(payload)?;
        let response = self.plugin.run(command.as_ref(), payload).map_err(PluginInvokeError)?;
        from_response(response)
    }

    pub async fn run_mobile_plugin_async<T: DeserializeOwned>(
        &self,
        command: impl AsRef<str>,
        payload: impl Serialize,
    ) -> Result<T, PluginInvokeError> {
        let payload = to_payload(payload)?;
        let response = self
            .plugin
            .run_async(command.as_ref().to_string(), payload)
            .await
            .map_err(PluginInvokeError)?;
        from_response(response)
    }
}

fn to_payload(payload: impl Serialize) -> Result<Value, PluginInvokeError> {
    serde_json::to_value(payload).map_err(|error| PluginInvokeError(error.to_string()))
}

fn from_response<T: DeserializeOwned>(response: Value) -> Result<T, PluginInvokeError> {
    serde_json::from_value(response).map_err(|error| PluginInvokeError(error.to_string()))
}

/// A named startup hook. Kept under Tauri's name so services read as before.
pub struct TauriPlugin<R = Wry> {
    name: &'static str,
    setup: Option<Box<SetupFn>>,
    runtime: PhantomData<R>,
}

impl<R> TauriPlugin<R> {
    pub fn name(&self) -> &'static str {
        self.name
    }

    /// Runs the hook; the host calls it once, in registration order.
    pub fn run_setup(self, app: &AppHandle, api: PluginApi) -> SetupResult {
        match self.setup {
            Some(setup) => setup(app, api),
            None => Ok(()),
        }
    }
}

pub struct Builder {
    name: &'static str,
    setup: Option<Box<SetupFn>>,
}

impl Builder {
    pub fn new(name: &'static str) -> Self {
        Self { name, setup: None }
    }

    pub fn setup<F>(mut self, setup: F) -> Self
    where
        F: FnOnce(&AppHandle, PluginApi) -> SetupResult + Send + 'static,
    {
        self.setup = Some(Box::new(setup));
        self
    }

    pub fn build(self) -> TauriPlugin<Wry> {
        TauriPlugin { name: self.name, setup: self.setup, runtime: PhantomData }
    }
}

/// State of an Android runtime permission, with Tauri's wire format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PermissionState {
    Granted,
    Denied,
    #[default]
    Prompt,
    PromptWithRationale,
}

impl PermissionState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Prompt => "prompt",
            Self::PromptWithRationale => "prompt-with-rationale",
        }
    }
}

impl Serialize for PermissionState {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for PermissionState {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        match value.to_ascii_lowercase().as_str() {
            "granted" => Ok(Self::Granted),
            "denied" => Ok(Self::Denied),
            "prompt" => Ok(Self::Prompt),
            "prompt-with-rationale" => Ok(Self::PromptWithRationale),
            _ => Err(serde::de::Error::custom(format!("unknown permission state {value}"))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_state_keeps_the_native_format() {
        let parsed: PermissionState = serde_json::from_str("\"prompt-with-rationale\"").unwrap();
        assert_eq!(parsed, PermissionState::PromptWithRationale);
        assert_eq!(serde_json::to_string(&PermissionState::Granted).unwrap(), "\"granted\"");
    }

    #[test]
    fn without_a_registrar_native_plugins_are_unavailable() {
        assert!(PluginApi::new(None).register_android_plugin("pkg", "Class").is_err());
    }
}
