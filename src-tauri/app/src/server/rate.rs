//! Sliding-window rate limits keyed by client and route.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Most distinct keys tracked; new keys are refused beyond it so a flood of
/// addresses cannot grow memory without bound.
const MAX_RATE_LIMIT_BUCKETS: usize = 1024;

#[derive(Debug, Default)]
pub(crate) struct RateWindows {
    windows: HashMap<String, VecDeque<Instant>>,
}

impl RateWindows {
    /// Records a request under `key` when fewer than `limit` happened within
    /// `window`; returns whether it is allowed.
    pub(crate) fn allow(&mut self, key: String, limit: usize, window: Duration) -> bool {
        if !self.windows.contains_key(&key) && self.windows.len() >= MAX_RATE_LIMIT_BUCKETS {
            return false;
        }
        let now = Instant::now();
        let bucket = self.windows.entry(key).or_default();
        while bucket.front().is_some_and(|timestamp| now.duration_since(*timestamp) >= window) {
            bucket.pop_front();
        }
        if bucket.len() >= limit {
            return false;
        }
        bucket.push_back(now);
        true
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.windows.len()
    }

    pub(crate) fn clear(&mut self) {
        self.windows.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_requests_beyond_the_limit_of_each_key() {
        let mut windows = RateWindows::default();
        let minute = Duration::from_secs(60);
        assert!(windows.allow("a".into(), 2, minute));
        assert!(windows.allow("a".into(), 2, minute));
        assert!(!windows.allow("a".into(), 2, minute));
        assert!(windows.allow("b".into(), 2, minute));
        assert_eq!(windows.len(), 2);
    }
}
