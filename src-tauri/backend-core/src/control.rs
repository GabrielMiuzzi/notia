use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

use super::context::BackendRequestContext;
use super::error::{BackendError, BackendErrorCode};

#[derive(Clone, Debug)]
pub struct RequestControl {
    cancelled: Arc<AtomicBool>,
    deadline: Option<Instant>,
}

impl RequestControl {
    pub fn new(timeout: Option<Duration>) -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            deadline: timeout.map(|value| Instant::now() + value),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub fn check(&self) -> Result<(), BackendError> {
        if self.is_cancelled() {
            return Err(BackendError::cancelled());
        }
        if self
            .deadline
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            return Err(BackendError::timeout());
        }
        Ok(())
    }

    pub fn remaining(&self) -> Option<Duration> {
        self.deadline
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
    }
}

/// Maximum number of simultaneously running requests whose cancellation
/// handles are retained by one backend host.
pub const MAX_ACTIVE_REQUEST_CONTROLS: usize = 256;

/// Host-owned registry of cancellation handles for running requests.
///
/// The key is always tenant-scoped (library, user, request) so a cancel from
/// one library or user can never reach a request owned by another. The
/// registry outlives individual transport calls, which lets a cancel arrive
/// through a different call than the one executing the agent.
#[derive(Debug, Default)]
pub struct RequestControlRegistry {
    controls: Mutex<HashMap<RequestControlKey, RequestControl>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RequestControlKey {
    library_id: String,
    library_user_id: String,
    request_id: String,
}

impl RequestControlKey {
    fn new(context: &BackendRequestContext) -> Self {
        Self {
            library_id: context.library_id.clone(),
            library_user_id: context.actor.library_user_id.clone(),
            request_id: context.request_id.clone(),
        }
    }
}

impl RequestControlRegistry {
    /// Registers the handle of a running request. A second registration for
    /// the same scoped request is rejected so a duplicate transport call can
    /// not steal or orphan the handle of the active run.
    pub fn register(
        &self,
        context: &BackendRequestContext,
        control: RequestControl,
    ) -> Result<(), BackendError> {
        let mut controls = self.lock()?;
        let key = RequestControlKey::new(context);
        if controls.contains_key(&key) {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "La solicitud ya se está ejecutando.",
                true,
            ));
        }
        if controls.len() >= MAX_ACTIVE_REQUEST_CONTROLS {
            return Err(BackendError::new(
                BackendErrorCode::Conflict,
                "Hay demasiadas solicitudes backend activas.",
                true,
            ));
        }
        controls.insert(key, control);
        Ok(())
    }

    pub fn unregister(&self, context: &BackendRequestContext) -> Result<(), BackendError> {
        self.lock()?.remove(&RequestControlKey::new(context));
        Ok(())
    }

    /// Cancels the running request. Returns `false` when no run is active for
    /// this scoped request.
    pub fn cancel(&self, context: &BackendRequestContext) -> Result<bool, BackendError> {
        let control = self.lock()?.remove(&RequestControlKey::new(context));
        Ok(control.map(|control| control.cancel()).is_some())
    }

    pub fn is_running(&self, context: &BackendRequestContext) -> Result<bool, BackendError> {
        Ok(self.lock()?.contains_key(&RequestControlKey::new(context)))
    }

    /// Cancels every run of one library, e.g. after its grant was revoked or
    /// the host switched libraries. Returns the number of cancelled runs.
    pub fn cancel_library(&self, library_id: &str) -> Result<usize, BackendError> {
        let mut controls = self.lock()?;
        let before = controls.len();
        controls.retain(|key, control| {
            let keep = key.library_id != library_id;
            if !keep {
                control.cancel();
            }
            keep
        });
        Ok(before - controls.len())
    }

    fn lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<RequestControlKey, RequestControl>>, BackendError>
    {
        self.controls.lock().map_err(|_| {
            BackendError::new(
                BackendErrorCode::Internal,
                "No se pudo proteger el control de la operación.",
                true,
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{RequestControl, RequestControlRegistry};
    use crate::{BackendActor, BackendChannel, BackendRequestContext, BackendScope, PersistencePolicy};

    fn context(library_id: &str, user: &str) -> BackendRequestContext {
        BackendRequestContext {
            request_id: "request-1".into(),
            library_id: library_id.into(),
            actor: BackendActor {
                library_user_id: user.into(),
                external_identity: None,
            },
            channel: BackendChannel::App,
            scope: BackendScope::Library,
            persistence_policy: PersistencePolicy::Persistent,
        }
    }

    #[test]
    fn registry_cancels_only_the_scoped_request() {
        let registry = RequestControlRegistry::default();
        let owned = RequestControl::new(None);
        let other = RequestControl::new(None);
        registry.register(&context("library-a", "user-1"), owned.clone()).expect("register");
        registry.register(&context("library-b", "user-1"), other.clone()).expect("register");
        assert!(!registry.cancel(&context("library-a", "user-2")).expect("cancel"));
        assert!(registry.cancel(&context("library-a", "user-1")).expect("cancel"));
        assert!(owned.is_cancelled());
        assert!(!other.is_cancelled());
    }

    #[test]
    fn registry_rejects_a_duplicate_active_run() {
        let registry = RequestControlRegistry::default();
        let scoped = context("library-a", "user-1");
        registry.register(&scoped, RequestControl::new(None)).expect("register");
        assert!(registry.register(&scoped, RequestControl::new(None)).is_err());
        registry.unregister(&scoped).expect("unregister");
        assert!(registry.register(&scoped, RequestControl::new(None)).is_ok());
    }

    #[test]
    fn registry_cancels_every_run_of_a_library() {
        let registry = RequestControlRegistry::default();
        let control = RequestControl::new(None);
        registry.register(&context("library-a", "user-1"), control.clone()).expect("register");
        registry.register(&context("library-b", "user-1"), RequestControl::new(None)).expect("register");
        assert_eq!(registry.cancel_library("library-a").expect("cancel"), 1);
        assert!(control.is_cancelled());
        assert!(registry.is_running(&context("library-b", "user-1")).expect("state"));
    }

    #[test]
    fn cancellation_is_shared_between_clones() {
        let control = RequestControl::new(None);
        let clone = control.clone();
        clone.cancel();
        assert!(control.check().is_err());
    }

    #[test]
    fn an_expired_deadline_is_reported_as_timeout() {
        let control = RequestControl::new(Some(Duration::from_millis(0)));
        assert_eq!(
            control.check().expect_err("deadline must expire").code,
            super::super::error::BackendErrorCode::Timeout
        );
    }
}
