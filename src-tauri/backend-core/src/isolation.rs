use std::collections::HashMap;
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use super::context::BackendRequestContext;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ScopedKey {
    pub library_id: String,
    pub library_user_id: String,
}

impl ScopedKey {
    pub fn from_context(context: &BackendRequestContext) -> Self {
        Self {
            library_id: context.library_id.clone(),
            library_user_id: context.actor.library_user_id.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub struct TenantStateRegistry<T> {
    values: RwLock<HashMap<ScopedKey, T>>,
}

#[derive(Debug)]
struct CacheEntry<T> {
    generation: u64,
    inserted_at: Instant,
    value: T,
}

/// Caché acotada para resultados derivados de una biblioteca/request.
///
/// La clave y la generación son responsabilidad del adaptador que conoce el
/// contrato de la operación. Una generación distinta nunca reutiliza el
/// resultado anterior y una mutación puede invalidar una clave exacta sin
/// descartar entradas hermanas.
#[derive(Debug)]
pub struct GenerationCache<T> {
    entries: Mutex<HashMap<String, CacheEntry<T>>>,
    capacity: usize,
    ttl: Duration,
}

impl<T: Clone> GenerationCache<T> {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            capacity: capacity.max(1),
            ttl,
        }
    }

    pub fn insert(&self, key: impl Into<String>, generation: u64, value: T) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        let now = Instant::now();
        entries.retain(|_, entry| now.duration_since(entry.inserted_at) <= self.ttl);
        let key = key.into();
        if entries
            .get(&key)
            .is_some_and(|entry| entry.generation > generation)
        {
            return;
        }
        entries.insert(
            key,
            CacheEntry {
                generation,
                inserted_at: now,
                value,
            },
        );
        while entries.len() > self.capacity {
            let oldest_key = entries
                .iter()
                .min_by_key(|(_, entry)| entry.inserted_at)
                .map(|(key, _)| key.clone());
            if let Some(key) = oldest_key {
                entries.remove(&key);
            } else {
                break;
            }
        }
    }

    pub fn get(&self, key: &str, generation: u64) -> Option<T> {
        let Ok(mut entries) = self.entries.lock() else {
            return None;
        };
        let now = Instant::now();
        entries.retain(|_, entry| now.duration_since(entry.inserted_at) <= self.ttl);
        let entry = entries.get(key)?;
        (entry.generation == generation).then(|| entry.value.clone())
    }

    pub fn invalidate(&self, key: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(key);
        }
    }

    pub fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }
}

#[derive(Debug, Default)]
pub struct InFlightRegistry {
    entries: Mutex<HashMap<String, u64>>,
}

impl InFlightRegistry {
    /// Devuelve `true` solo al primer consumidor de una clave/generación.
    /// Los demás consumidores deben esperar o reutilizar el resultado del
    /// adaptador que inició la operación.
    pub fn begin(&self, key: impl Into<String>, generation: u64) -> bool {
        let Ok(mut entries) = self.entries.lock() else {
            return false;
        };
        let key = key.into();
        match entries.get(&key).copied() {
            None => {
                entries.insert(key, generation);
                true
            }
            Some(current) if generation > current => {
                entries.insert(key, generation);
                true
            }
            Some(_) => false,
        }
    }

    pub fn is_active(&self, key: &str, generation: u64) -> bool {
        self.entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(key).copied())
            .is_some_and(|value| value == generation)
    }

    pub fn current_generation(&self, key: &str) -> Option<u64> {
        self.entries
            .lock()
            .ok()
            .and_then(|entries| entries.get(key).copied())
    }

    pub fn finish(&self, key: &str, generation: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            if entries.get(key).copied() == Some(generation) {
                entries.remove(key);
            }
        }
    }
}

impl<T: Clone> TenantStateRegistry<T> {
    pub fn get(&self, key: &ScopedKey) -> Option<T> {
        self.values.read().ok()?.get(key).cloned()
    }
}

impl<T> TenantStateRegistry<T> {
    pub fn insert(&self, key: ScopedKey, value: T) -> Option<T> {
        self.values.write().ok()?.insert(key, value)
    }

    pub fn remove(&self, key: &ScopedKey) -> Option<T> {
        self.values.write().ok()?.remove(key)
    }

    pub fn len(&self) -> usize {
        self.values.read().map(|values| values.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{GenerationCache, InFlightRegistry, ScopedKey, TenantStateRegistry};

    #[test]
    fn keeps_two_library_users_isolated() {
        let registry = TenantStateRegistry::default();
        let first = ScopedKey {
            library_id: "library-a".to_string(),
            library_user_id: "user-1".to_string(),
        };
        let second = ScopedKey {
            library_id: "library-b".to_string(),
            library_user_id: "user-1".to_string(),
        };
        registry.insert(first.clone(), "first".to_string());
        registry.insert(second.clone(), "second".to_string());
        assert_eq!(registry.get(&first).as_deref(), Some("first"));
        assert_eq!(registry.get(&second).as_deref(), Some("second"));
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn rejects_stale_generations_and_invalidates_selectively() {
        let cache = GenerationCache::new(4, Duration::from_secs(60));
        cache.insert("library-a:file-a", 1, "old".to_string());
        cache.insert("library-a:file-b", 1, "sibling".to_string());
        assert_eq!(cache.get("library-a:file-a", 2), None);
        assert_eq!(cache.get("library-a:file-a", 1).as_deref(), Some("old"));
        cache.invalidate("library-a:file-a");
        assert_eq!(cache.get("library-a:file-a", 1), None);
        assert_eq!(cache.get("library-a:file-b", 1).as_deref(), Some("sibling"));
    }

    #[test]
    fn enforces_a_capacity() {
        let cache = GenerationCache::new(1, Duration::from_secs(60));
        cache.insert("first", 1, 1);
        cache.insert("second", 1, 2);
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.get("first", 1), None);
        assert_eq!(cache.get("second", 1), Some(2));
    }

    #[test]
    fn deduplicates_the_same_in_flight_generation() {
        let registry = InFlightRegistry::default();
        assert!(registry.begin("library-a:file-a", 4));
        assert!(!registry.begin("library-a:file-a", 4));
        assert!(registry.is_active("library-a:file-a", 4));
        registry.finish("library-a:file-a", 4);
        assert!(!registry.is_active("library-a:file-a", 4));
    }

    #[test]
    fn newer_in_flight_generations_replace_older_ones() {
        let registry = InFlightRegistry::default();
        assert!(registry.begin("operation", 1));
        assert!(registry.begin("operation", 2));
        assert!(!registry.is_active("operation", 1));
        assert!(registry.is_active("operation", 2));
        registry.finish("operation", 1);
        assert!(registry.is_active("operation", 2));
    }

    #[test]
    fn older_cache_results_cannot_overwrite_newer_results() {
        let cache = GenerationCache::new(2, Duration::from_secs(60));
        cache.insert("operation", 2, "new".to_string());
        cache.insert("operation", 1, "old".to_string());
        assert_eq!(cache.get("operation", 2).as_deref(), Some("new"));
        assert_eq!(cache.get("operation", 1), None);
    }
}
