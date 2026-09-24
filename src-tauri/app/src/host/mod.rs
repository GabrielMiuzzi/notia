//! Host layer of the application.
//!
//! The use cases were written against the Tauri API; this module offers the
//! same shape (`AppHandle`, `State`, `Manager`, `Emitter`, plugins, runtime)
//! without depending on Tauri. Whoever hosts Notia — the Tauri window today,
//! the headless server later — builds an [`AppContext`] with its paths and
//! platform ports and keeps it for the whole process.

pub mod async_runtime;
pub mod dialog;
pub mod ipc;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod lock;
pub mod plugin;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub use lock::DataDirLock;

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::fmt;
use std::marker::PhantomData;
use std::ops::Deref;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use serde::Serialize;
use serde_json::Value;

/// Error of the host operations (paths, events, assets).
#[derive(Debug, Clone)]
pub enum Error {
    UnknownPath,
    Serialization(String),
    AssetNotFound(String),
    Unavailable(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownPath => formatter.write_str("unknown path"),
            Self::Serialization(error) => write!(formatter, "serialization failed: {error}"),
            Self::AssetNotFound(path) => write!(formatter, "asset not found: {path}"),
            Self::Unavailable(capability) => write!(formatter, "{capability} is not available in this host"),
        }
    }
}

impl std::error::Error for Error {}

/// Marker kept so signatures such as `PluginHandle<Wry>` read as before.
#[derive(Debug, Clone, Copy, Default)]
pub struct Wry;

/// Receives the events the application publishes for its clients.
pub trait EventSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value) -> Result<(), String>;
}

/// Static files of the interface, served by the publication server.
pub trait AssetSource: Send + Sync {
    fn get(&self, path: &str) -> Option<Asset>;
}

/// One asset of the interface bundle.
pub struct Asset {
    bytes: Vec<u8>,
    mime_type: String,
}

impl Asset {
    pub fn new(bytes: Vec<u8>, mime_type: String) -> Self {
        Self { bytes, mime_type }
    }

    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn mime_type(&self) -> &str {
        &self.mime_type
    }
}

/// Looks up assets through the host; empty when the host has no bundle.
pub struct AssetResolver<R = Wry> {
    source: Option<Arc<dyn AssetSource>>,
    runtime: PhantomData<R>,
}

impl<R> AssetResolver<R> {
    pub fn get(&self, path: String) -> Option<Asset> {
        let path = path.trim_start_matches('/');
        self.source.as_ref()?.get(path)
    }
}

/// Directories the host assigns to the application.
#[derive(Debug, Clone, Default)]
pub struct AppPaths {
    app_data: Option<PathBuf>,
    resources: Option<PathBuf>,
}

impl AppPaths {
    pub fn new(app_data: Option<PathBuf>, resources: Option<PathBuf>) -> Self {
        Self { app_data, resources }
    }

    pub fn app_data_dir(&self) -> Result<PathBuf, Error> {
        self.app_data.clone().ok_or(Error::UnknownPath)
    }

    pub fn resource_dir(&self) -> Result<PathBuf, Error> {
        self.resources.clone().ok_or(Error::UnknownPath)
    }
}

/// Platform services the host provides; every one is optional.
#[derive(Default)]
pub struct HostPorts {
    pub events: Option<Arc<dyn EventSink>>,
    pub assets: Option<Arc<dyn AssetSource>>,
    pub dialogs: Option<Arc<dyn dialog::DialogPort>>,
}

type StateEntry = &'static (dyn Any + Send + Sync);

struct ContextInner {
    paths: AppPaths,
    ports: HostPorts,
    states: RwLock<HashMap<TypeId, StateEntry>>,
}

/// The running application: its paths, its platform ports and the state of
/// every service. Cheap to clone; all clones share the same application.
#[derive(Clone)]
pub struct AppContext {
    inner: Arc<ContextInner>,
}

/// Name used by the use cases for the running application.
pub type AppHandle = AppContext;

impl AppContext {
    pub fn new(paths: AppPaths, ports: HostPorts) -> Self {
        Self {
            inner: Arc::new(ContextInner {
                paths,
                ports,
                states: RwLock::new(HashMap::new()),
            }),
        }
    }

    pub fn asset_resolver(&self) -> AssetResolver<Wry> {
        AssetResolver {
            source: self.inner.ports.assets.clone(),
            runtime: PhantomData,
        }
    }

    pub(crate) fn dialogs(&self) -> Option<Arc<dyn dialog::DialogPort>> {
        self.inner.ports.dialogs.clone()
    }

    fn publish(&self, event: &str, payload: Value) -> Result<(), Error> {
        match &self.inner.ports.events {
            Some(sink) => sink.emit(event, payload).map_err(Error::Serialization),
            None => Ok(()),
        }
    }
}

/// Access to the application state, as the use cases expect it.
pub trait Manager {
    fn app_handle(&self) -> &AppHandle;

    /// Registers a service state. Returns `false`, keeping the first one, when
    /// that type is already registered.
    fn manage<T: Send + Sync + 'static>(&self, state: T) -> bool {
        let context = self.app_handle();
        let mut states = context.inner.states.write().unwrap_or_else(|error| error.into_inner());
        if states.contains_key(&TypeId::of::<T>()) {
            return false;
        }
        // States live as long as the process: the application is built once
        // and every borrowed `State` stays valid across awaits.
        let entry: &'static T = Box::leak(Box::new(state));
        states.insert(TypeId::of::<T>(), entry);
        true
    }

    fn try_state<T: Send + Sync + 'static>(&self) -> Option<State<'static, T>> {
        let context = self.app_handle();
        let states = context.inner.states.read().unwrap_or_else(|error| error.into_inner());
        let entry: StateEntry = *states.get(&TypeId::of::<T>())?;
        entry.downcast_ref::<T>().map(State)
    }

    fn state<T: Send + Sync + 'static>(&self) -> State<'static, T> {
        self.try_state::<T>().unwrap_or_else(|| {
            panic!("state not managed for type {}", std::any::type_name::<T>())
        })
    }

    fn path(&self) -> &AppPaths {
        &self.app_handle().inner.paths
    }
}

impl Manager for AppContext {
    fn app_handle(&self) -> &AppHandle {
        self
    }
}

/// Publishes events to the clients of the application.
pub trait Emitter {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error>;
}

impl Emitter for AppContext {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error> {
        let payload = serde_json::to_value(payload).map_err(|error| Error::Serialization(error.to_string()))?;
        self.publish(event, payload)
    }
}

/// Borrowed service state.
pub struct State<'r, T: Send + Sync + 'static>(&'r T);

impl<'r, T: Send + Sync + 'static> State<'r, T> {
    pub fn inner(&self) -> &'r T {
        self.0
    }
}

impl<T: Send + Sync + 'static> Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
        self.0
    }
}

impl<T: Send + Sync + 'static> Clone for State<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: Send + Sync + 'static> Copy for State<'_, T> {}

/// The client window that sent a command. Events it emits reach every
/// client, as they did with Tauri.
#[derive(Clone)]
pub struct Window {
    app: AppContext,
    label: String,
}

impl Window {
    pub fn new(app: AppContext, label: impl Into<String>) -> Self {
        Self { app, label: label.into() }
    }

    pub fn label(&self) -> &str {
        &self.label
    }
}

impl Manager for Window {
    fn app_handle(&self) -> &AppHandle {
        &self.app
    }
}

impl Emitter for Window {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), Error> {
        self.app.emit(event, payload)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Counter(u32);

    #[test]
    fn keeps_the_first_managed_state() {
        let app = AppContext::new(AppPaths::default(), HostPorts::default());
        assert!(app.manage(Counter(1)));
        assert!(!app.manage(Counter(2)));
        assert_eq!(app.state::<Counter>().inner().0, 1);
        assert!(app.try_state::<String>().is_none());
    }

    #[test]
    fn a_window_reaches_the_application_state() {
        let app = AppContext::new(AppPaths::default(), HostPorts::default());
        app.manage(Counter(7));
        let window = Window::new(app, "main");
        assert_eq!(window.app_handle().state::<Counter>().inner().0, 7);
        assert_eq!(window.label(), "main");
    }

    #[test]
    fn missing_paths_are_errors() {
        let paths = AppPaths::new(Some(PathBuf::from("data")), None);
        assert_eq!(paths.app_data_dir().unwrap(), PathBuf::from("data"));
        assert!(paths.resource_dir().is_err());
    }
}
