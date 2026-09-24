//! Channels a native plugin can push messages through (Android AI stream).
//! The host creates the real channel; the application only keeps its
//! serialized identity and the callback.

use std::any::Any;
use std::marker::PhantomData;
use std::sync::{Arc, OnceLock};

use serde::{Serialize, Serializer};
use serde_json::Value;

use super::Error;

/// Body of a message received through a channel.
pub enum InvokeResponseBody {
    Json(String),
    Raw(Vec<u8>),
}

pub type ChannelCallback = Box<dyn Fn(InvokeResponseBody) -> Result<(), Error> + Send + Sync>;

/// Creates a host channel for a callback: returns the value that identifies
/// it to the native side and a guard that keeps it alive.
pub type ChannelFactory = dyn Fn(ChannelCallback) -> (Value, Arc<dyn Any + Send + Sync>) + Send + Sync;

static FACTORY: OnceLock<Box<ChannelFactory>> = OnceLock::new();

/// Installs the channel factory of the host. Only the first call counts.
pub fn set_channel_factory(factory: Box<ChannelFactory>) {
    let _ = FACTORY.set(factory);
}

pub struct Channel<T = Value> {
    identity: Value,
    _guard: Option<Arc<dyn Any + Send + Sync>>,
    message: PhantomData<fn() -> T>,
}

impl<T> Channel<T> {
    /// Creates a channel; without a host factory it identifies as `null` and
    /// never receives messages.
    pub fn new<F>(callback: F) -> Self
    where
        F: Fn(InvokeResponseBody) -> Result<(), Error> + Send + Sync + 'static,
    {
        match FACTORY.get() {
            Some(factory) => {
                let (identity, guard) = factory(Box::new(callback));
                Self { identity, _guard: Some(guard), message: PhantomData }
            }
            None => Self { identity: Value::Null, _guard: None, message: PhantomData },
        }
    }
}

impl<T> Clone for Channel<T> {
    fn clone(&self) -> Self {
        Self {
            identity: self.identity.clone(),
            _guard: self._guard.clone(),
            message: PhantomData,
        }
    }
}

impl<T> Serialize for Channel<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.identity.serialize(serializer)
    }
}
