//! Rules of the copy a «Con copia» client keeps of its host's library.
//!
//! Each file is compared three ways: as the host has it, as the copy has
//! it, and as both had it after the last sync (the base). What changed on
//! one side goes to the other; what changed on both keeps the last
//! modified, whatever device it came from (a tie keeps the host's). A
//! modification wins over a deletion, so no edit is lost.
//!
//! The copy's side keeps its own times in the base: some file systems
//! cannot take the host's modification time.

use serde::{Deserialize, Serialize};

/// Size and modification time (ms since the epoch) of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStamp {
    pub size: u64,
    pub modified_ms: i64,
}

/// How a file was on both sides after the last sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncBase {
    pub remote: FileStamp,
    pub local: FileStamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncAction {
    /// Nothing changed.
    Keep,
    /// The host's file replaces the copy's.
    Download,
    /// The copy's file replaces the host's.
    Upload,
    DeleteLocal,
    DeleteRemote,
    /// Both sides already agree: only the base is recorded.
    Adopt,
    /// Deleted on both sides: the base is dropped.
    Forget,
}

fn changed(base: Option<FileStamp>, now: Option<&FileStamp>) -> bool {
    match (base, now) {
        (Some(base), Some(now)) => base != *now,
        (None, None) => false,
        _ => true,
    }
}

/// What to do with one file.
pub fn plan(base: Option<&SyncBase>, local: Option<&FileStamp>, remote: Option<&FileStamp>) -> SyncAction {
    let local_changed = changed(base.map(|base| base.local), local);
    let remote_changed = changed(base.map(|base| base.remote), remote);
    match (local_changed, remote_changed) {
        (false, false) => SyncAction::Keep,
        (false, true) if remote.is_some() => SyncAction::Download,
        (false, true) => SyncAction::DeleteLocal,
        (true, false) if local.is_some() => SyncAction::Upload,
        (true, false) => SyncAction::DeleteRemote,
        (true, true) => match (local, remote) {
            (None, None) => SyncAction::Forget,
            (Some(_), None) => SyncAction::Upload,
            (None, Some(_)) => SyncAction::Download,
            (Some(local), Some(remote)) if local == remote => SyncAction::Adopt,
            (Some(local), Some(remote)) if local.modified_ms > remote.modified_ms => SyncAction::Upload,
            (Some(_), Some(_)) => SyncAction::Download,
        },
    }
}

/// Library files the copy keeps: the visible ones, the agent's folder and
/// the configuration of `.notia`. The database travels apart, as a
/// read-only snapshot.
pub fn is_synced_path(path: &str) -> bool {
    let mut segments = path.split('/');
    match segments.next() {
        Some(".notia") => matches!(path, ".notia/notiaConfig.json" | ".notia/linkCache.md"),
        Some(".agent") => path.split('/').skip(1).all(|segment| !segment.starts_with('.')),
        Some(first) => !first.starts_with('.') && path.split('/').all(|segment| !segment.starts_with('.')),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(size: u64, modified_ms: i64) -> FileStamp {
        FileStamp { size, modified_ms }
    }

    #[test]
    fn one_sided_changes_travel_to_the_other_side() {
        let base = SyncBase { remote: stamp(1, 100), local: stamp(1, 900) };
        assert_eq!(plan(Some(&base), Some(&stamp(1, 900)), Some(&stamp(1, 100))), SyncAction::Keep);
        assert_eq!(plan(Some(&base), Some(&stamp(1, 900)), Some(&stamp(2, 200))), SyncAction::Download);
        assert_eq!(plan(Some(&base), Some(&stamp(1, 900)), None), SyncAction::DeleteLocal);
        assert_eq!(plan(Some(&base), Some(&stamp(3, 950)), Some(&stamp(1, 100))), SyncAction::Upload);
        assert_eq!(plan(Some(&base), None, Some(&stamp(1, 100))), SyncAction::DeleteRemote);
        // New files.
        assert_eq!(plan(None, None, Some(&stamp(1, 100))), SyncAction::Download);
        assert_eq!(plan(None, Some(&stamp(1, 100)), None), SyncAction::Upload);
    }

    #[test]
    fn changes_on_both_sides_keep_the_last_modified() {
        let base = SyncBase { remote: stamp(1, 100), local: stamp(1, 100) };
        assert_eq!(plan(Some(&base), Some(&stamp(2, 300)), Some(&stamp(3, 200))), SyncAction::Upload);
        assert_eq!(plan(Some(&base), Some(&stamp(2, 200)), Some(&stamp(3, 300))), SyncAction::Download);
        // A tie keeps the host's.
        assert_eq!(plan(Some(&base), Some(&stamp(2, 300)), Some(&stamp(3, 300))), SyncAction::Download);
        // An edit beats a deletion.
        assert_eq!(plan(Some(&base), Some(&stamp(2, 300)), None), SyncAction::Upload);
        assert_eq!(plan(Some(&base), None, Some(&stamp(3, 300))), SyncAction::Download);
        assert_eq!(plan(Some(&base), None, None), SyncAction::Forget);
        // The same file on both sides only records the base.
        assert_eq!(plan(None, Some(&stamp(5, 500)), Some(&stamp(5, 500))), SyncAction::Adopt);
    }

    #[test]
    fn the_copy_keeps_visible_files_the_agent_and_the_configuration() {
        for kept in ["Notas/idea.md", "a.png", ".agent/memory/thoughts.md", ".notia/notiaConfig.json", ".notia/linkCache.md"] {
            assert!(is_synced_path(kept), "{kept}");
        }
        for skipped in [".notia/notia.db", ".notia/notia.db-wal", ".git/config", "Notas/.oculto.md", ".agent/.tmp", ".obsidian/app.json"] {
            assert!(!is_synced_path(skipped), "{skipped}");
        }
    }
}
