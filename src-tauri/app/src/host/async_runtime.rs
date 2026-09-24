//! Process-wide async runtime. The Tauri host hands this same runtime to
//! Tauri, so commands and background work share one pool of threads.

use std::future::Future;
use std::sync::OnceLock;

use tokio::runtime::{Handle, Runtime};
pub use tokio::task::JoinHandle;

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("notia-async")
            .build()
            .expect("failed to start the Notia async runtime")
    })
}

/// Handle of the shared runtime, for hosts that also run async work.
pub fn handle() -> Handle {
    runtime().handle().clone()
}

pub fn spawn<F>(future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    runtime().spawn(future)
}

pub fn spawn_blocking<F, T>(task: F) -> JoinHandle<T>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    runtime().spawn_blocking(task)
}

/// Runs a future to completion on the current thread. Must not be called
/// from inside an async task.
pub fn block_on<F: Future>(future: F) -> F::Output {
    runtime().block_on(future)
}
