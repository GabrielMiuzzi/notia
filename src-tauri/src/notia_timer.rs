use std::time::Instant;

/// RAII timer that logs the duration of a scope when dropped.
///
/// Usage:
/// ```rust
/// let _timer = NotiaTimer::new("read_android_library_tree");
/// // ... do work ...
/// // drop(_timer) logs: [notia:perf] read_android_library_tree duration_ms=42
/// ```
pub(crate) struct NotiaTimer {
    name: &'static str,
    start: Instant,
    extra_meta: Option<String>,
    finished: bool,
}

impl NotiaTimer {
    pub(crate) fn new(name: &'static str) -> Self {
        Self {
            name,
            start: Instant::now(),
            extra_meta: None,
            finished: false,
        }
    }

    /// Attach extra metadata that will be included in the log line.
    pub(crate) fn with_meta(mut self, meta: impl Into<String>) -> Self {
        self.extra_meta = Some(meta.into());
        self
    }

    /// Manually finish the timer early and log the result.
    /// Returns the elapsed duration in milliseconds.
    pub(crate) fn finish_with_meta(&mut self, meta: &str) -> u128 {
        if self.finished {
            return 0;
        }
        self.finished = true;
        let elapsed_ms = self.start.elapsed().as_millis();
        let meta_suffix = match (&self.extra_meta, meta.is_empty()) {
            (Some(existing), false) => format!(" {} {}", existing, meta),
            (Some(existing), true) => format!(" {}", existing),
            (None, false) => format!(" {}", meta),
            (None, true) => String::new(),
        };
        log::info!(
            "[notia:perf] {} duration_ms={}{}",
            self.name,
            elapsed_ms,
            meta_suffix
        );
        elapsed_ms
    }
}

impl Drop for NotiaTimer {
    fn drop(&mut self) {
        if !self.finished {
            self.finish_with_meta("");
        }
    }
}
