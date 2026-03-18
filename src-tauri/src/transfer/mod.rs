use crate::adb;
use crate::db::{Database, FolderSyncEntry, FolderSyncPair, TransferJournalEntry};
use crossbeam_channel::{Sender, Receiver, unbounded};
use log::{info, warn};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use thiserror::Error;
use uuid::Uuid;
use walkdir::WalkDir;
use xxhash_rust::xxh3::xxh3_64;

/// ADB file transfer limits (researched):
///
/// | Factor              | Limit                  | Notes                                    |
/// |---------------------|------------------------|------------------------------------------|
/// | adb push/pull       | No hard limit          | Can transfer GB-sized files               |
/// | USB 2.0 speed       | ~20-40 MB/s            | Most phones                               |
/// | USB 3.0 speed       | ~200-500 MB/s          | Modern flagships                          |
/// | Android ext4        | Up to 16 TB per file   | Internal storage                          |
/// | FAT32 (SD card)     | 4 GB per file           | External SD limitation                    |
/// | ADB buffer          | Chunked automatically  | ADB protocol handles chunking             |
/// | Timeout             | None for data transfer | ADB keeps connection alive during I/O     |
///
/// Strategies to maximize transfer capability:
/// 1. No artificial size limits in code - let adb push/pull handle any size
/// 2. Report progress via file size tracking during transfer
/// 3. For FAT32 SD cards, warn user about 4GB limit
/// 4. Chunked transfer not needed - ADB handles this internally

const IGNORE_FILE_NAME: &str = ".droidlinkignore";
const VERSIONS_DIR: &str = ".droidlink_versions";

#[derive(Debug, Error)]
pub enum FolderSyncError {
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("ADB error: {0}")]
    AdbError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Sync pair not found: {0}")]
    PairNotFound(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Watch error: {0}")]
    WatchError(String),
    #[error("UTF-8 error: {0}")]
    Utf8Error(#[from] std::string::FromUtf8Error),
    #[error("Integrity check failed: expected {expected}, got {actual}")]
    IntegrityError { expected: String, actual: String },
    #[error("Transfer interrupted: {0}")]
    TransferInterrupted(String),
}

pub type Result<T> = std::result::Result<T, FolderSyncError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub pushed: u64,
    pub pulled: u64,
    pub deleted_local: u64,
    pub deleted_remote: u64,
    pub conflicts: u64,
    pub skipped: u64,
    pub errors: Vec<String>,
    pub bytes_pushed: u64,
    pub bytes_pulled: u64,
    pub duration_ms: u64,
    pub speed_mbps: f64,
}

impl Default for SyncResult {
    fn default() -> Self {
        Self {
            pushed: 0, pulled: 0, deleted_local: 0, deleted_remote: 0,
            conflicts: 0, skipped: 0, errors: Vec::new(),
            bytes_pushed: 0, bytes_pulled: 0, duration_ms: 0, speed_mbps: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FolderSyncEvent {
    Started { pair_id: String },
    Progress {
        pair_id: String, current: u64, total: u64,
        file: String, action: String, bytes: u64,
    },
    Completed { pair_id: String, result: SyncResult },
    Error { pair_id: String, message: String },
    FileChanged { pair_id: String, path: String },
}

/// Conflict resolution policy (configurable per sync pair, like Syncthing)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConflictPolicy {
    KeepBoth,
    LocalWins,
    RemoteWins,
    NewestWins,
}

impl Default for ConflictPolicy {
    fn default() -> Self { ConflictPolicy::KeepBoth }
}

impl ConflictPolicy {
    pub fn from_str(s: &str) -> Self {
        match s {
            "local_wins" => Self::LocalWins,
            "remote_wins" => Self::RemoteWins,
            "newest_wins" => Self::NewestWins,
            _ => Self::KeepBoth,
        }
    }
    pub fn to_str(&self) -> &str {
        match self {
            Self::KeepBoth => "keep_both",
            Self::LocalWins => "local_wins",
            Self::RemoteWins => "remote_wins",
            Self::NewestWins => "newest_wins",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChangeItem {
    pub relative_path: String,
    pub action: ChangeAction,
    pub local_path: Option<PathBuf>,
    pub remote_path: Option<String>,
    pub local_size: u64,
    pub remote_size: u64,
    pub local_modified: u64,
    pub remote_modified: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ChangeAction {
    PushNew,
    PushModified,
    PullNew,
    PullModified,
    DeleteLocal,
    DeleteRemote,
    Conflict,
}

// ========== Ignore Patterns (.droidlinkignore, like Syncthing's .stignore) ==========

struct IgnorePatterns {
    patterns: Vec<IgnoreRule>,
}

#[derive(Debug)]
struct IgnoreRule {
    pattern: String,
    negate: bool,
}

impl IgnorePatterns {
    fn new() -> Self { Self { patterns: Vec::new() } }

    fn load_from_file(path: &Path) -> Self {
        let mut p = Self::new();
        // Always ignore internal dirs
        p.add(VERSIONS_DIR, false);
        p.add(IGNORE_FILE_NAME, false);
        p.add(".DS_Store", false);
        p.add("Thumbs.db", false);
        p.add("desktop.ini", false);
        p.add(".Trash-*", false);

        let ignore_file = path.join(IGNORE_FILE_NAME);
        if let Ok(content) = std::fs::read_to_string(&ignore_file) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') { continue; }
                if let Some(stripped) = line.strip_prefix('!') {
                    p.add(stripped, true);
                } else {
                    p.add(line, false);
                }
            }
        }
        p
    }

    fn add(&mut self, pattern: &str, negate: bool) {
        self.patterns.push(IgnoreRule { pattern: pattern.to_string(), negate });
    }

    fn is_ignored(&self, path: &str) -> bool {
        let mut ignored = false;
        for rule in &self.patterns {
            if self.matches(path, &rule.pattern) {
                ignored = !rule.negate;
            }
        }
        ignored
    }

    fn matches(&self, path: &str, pattern: &str) -> bool {
        let fname = path.rsplit('/').next().unwrap_or(path);
        if pattern.contains('*') {
            self.glob_match(path, pattern) || self.glob_match(fname, pattern)
        } else if pattern.ends_with('/') {
            let dir = pattern.trim_end_matches('/');
            path.starts_with(dir) || path.contains(&format!("/{}/", dir)) || fname == dir
        } else {
            path == pattern || fname == pattern || path.starts_with(&format!("{}/", pattern))
        }
    }

    fn glob_match(&self, text: &str, pattern: &str) -> bool {
        let parts: Vec<&str> = pattern.split('*').collect();
        if parts.len() == 1 { return text == pattern; }
        let mut pos = 0;
        for (i, part) in parts.iter().enumerate() {
            if part.is_empty() { continue; }
            if let Some(found) = text[pos..].find(part) {
                if i == 0 && found != 0 { return false; }
                pos += found + part.len();
            } else {
                return false;
            }
        }
        parts.last().map_or(true, |last| last.is_empty() || pos == text.len())
    }
}

// ========== File Info ==========

#[derive(Debug)]
struct LocalFileInfo {
    path: PathBuf,
    size: u64,
    modified: u64,
    hash: Option<String>,
}

#[derive(Debug)]
struct RemoteFileInfo {
    path: String,
    size: u64,
    modified: u64,
}

// ========== Transfer Info ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInfo {
    pub usb_speed: String,
    pub estimated_speed: String,
    pub max_file_size: String,
    pub filesystem: String,
    pub has_fat32_limit: bool,
}

// ========== Watch Handle ==========

struct WatchHandle {
    _watcher: RecommendedWatcher,
    stop_tx: Sender<()>,
}

// ========== Auto Sync Handle ==========

struct AutoSyncHandle {
    running: Arc<std::sync::atomic::AtomicBool>,
}

const FOLDER_SYNC_POLL_INTERVAL_SECS: u64 = 5;
const MARKER_DIR: &str = "/data/local/tmp";
const MARKER_PREFIX: &str = ".droidlink_fsmarker";

// ========== Recovery Result ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryResult {
    pub recovered: u64,
    pub failed: u64,
    pub errors: Vec<String>,
}

// ========== FolderSync ==========

pub struct FolderSync {
    db: Arc<Database>,
    active_watches: Arc<Mutex<HashMap<String, WatchHandle>>>,
    active_auto_syncs: Arc<Mutex<HashMap<String, AutoSyncHandle>>>,
    event_tx: Option<Sender<FolderSyncEvent>>,
}

impl FolderSync {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            active_watches: Arc::new(Mutex::new(HashMap::new())),
            active_auto_syncs: Arc::new(Mutex::new(HashMap::new())),
            event_tx: None,
        }
    }

    pub fn set_event_sender(&mut self, tx: Sender<FolderSyncEvent>) {
        self.event_tx = Some(tx);
    }

    fn emit_event(&self, event: FolderSyncEvent) {
        if let Some(tx) = &self.event_tx { let _ = tx.send(event); }
    }

    fn hash_local_file(path: &Path) -> Result<String> {
        let data = std::fs::read(path)?;
        Ok(format!("{:016x}", xxh3_64(&data)))
    }

    /// Calculate MD5 hash of a local file (for integrity verification against device md5sum)
    fn md5_local_file(path: &Path) -> Result<String> {
        use std::io::{BufReader, Read};
        let file = std::fs::File::open(path)?;
        let mut reader = BufReader::new(file);
        let mut context = md5::Context::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = reader.read(&mut buffer)?;
            if n == 0 { break; }
            context.consume(&buffer[..n]);
        }
        Ok(format!("{:x}", context.compute()))
    }

    /// Verified push: push file to temp path on device, verify MD5, then atomic rename.
    /// Returns Ok(()) on success, records result in transfer journal.
    fn verified_push(
        &self, serial: &str, local_path: &str, remote_path: &str,
        pair_id: &str, relative_path: &str, file_size: u64,
    ) -> Result<()> {
        let journal_id = Uuid::new_v4().to_string();
        let temp_remote = format!("{}.droidlink_temp", remote_path);

        // Calculate local MD5
        let local_md5 = Self::md5_local_file(Path::new(local_path))
            .map_err(|e| FolderSyncError::IoError(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;

        // Create journal entry
        let _ = self.db.create_transfer_entry(&TransferJournalEntry {
            id: journal_id.clone(),
            pair_id: pair_id.to_string(),
            device_serial: serial.to_string(),
            file_path: relative_path.to_string(),
            direction: "push".to_string(),
            status: "in_progress".to_string(),
            temp_path: Some(temp_remote.clone()),
            final_path: remote_path.to_string(),
            file_size: file_size as i64,
            hash_expected: Some(local_md5.clone()),
            hash_actual: None,
            created_at: String::new(),
            updated_at: String::new(),
            error_message: None,
            retry_count: 0,
        });

        // Push to temp path
        match adb::push(serial, local_path, &temp_remote) {
            Ok(_) => {}
            Err(e) => {
                let msg = format!("Push to temp failed: {}", e);
                let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                let _ = self.db.increment_transfer_retry(&journal_id);
                // Clean up temp file
                let _ = adb::delete_path(serial, &temp_remote);
                return Err(FolderSyncError::AdbError(msg));
            }
        }

        // Verify remote MD5
        match adb::get_file_hash(serial, &temp_remote) {
            Ok(remote_md5) => {
                let _ = self.db.update_transfer_hash(&journal_id, &remote_md5);
                if remote_md5 != local_md5 {
                    let msg = format!("Integrity mismatch: expected {}, got {}", local_md5, remote_md5);
                    let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                    let _ = self.db.increment_transfer_retry(&journal_id);
                    let _ = adb::delete_path(serial, &temp_remote);
                    return Err(FolderSyncError::IntegrityError {
                        expected: local_md5, actual: remote_md5,
                    });
                }
            }
            Err(e) => {
                // md5sum not available or file gone — fallback: skip integrity check, just rename
                warn!("MD5 verification unavailable for {}: {}, proceeding without integrity check", temp_remote, e);
            }
        }

        // Atomic rename: temp -> final
        let safe_temp = adb::sanitize_device_path(&temp_remote)
            .map_err(|e| FolderSyncError::InvalidPath(e.to_string()))?;
        let safe_final = adb::sanitize_device_path(remote_path)
            .map_err(|e| FolderSyncError::InvalidPath(e.to_string()))?;
        let mv_cmd = format!("mv '{}' '{}'", safe_temp, safe_final);
        match adb::shell(serial, &mv_cmd) {
            Ok(_) => {
                let _ = self.db.update_transfer_status(&journal_id, "completed", None);
                Ok(())
            }
            Err(e) => {
                let msg = format!("Atomic rename failed: {}", e);
                let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                let _ = self.db.increment_transfer_retry(&journal_id);
                Err(FolderSyncError::AdbError(msg))
            }
        }
    }

    /// Verified pull: get remote MD5, pull to local temp, verify local MD5, atomic rename.
    fn verified_pull(
        &self, serial: &str, remote_path: &str, local_path: &str,
        pair_id: &str, relative_path: &str, file_size: u64,
    ) -> Result<()> {
        let journal_id = Uuid::new_v4().to_string();
        let temp_local = format!("{}.droidlink_temp", local_path);

        // Get remote MD5 (may fail if md5sum not available on device)
        let remote_md5 = adb::get_file_hash(serial, remote_path).ok();

        // Create journal entry
        let _ = self.db.create_transfer_entry(&TransferJournalEntry {
            id: journal_id.clone(),
            pair_id: pair_id.to_string(),
            device_serial: serial.to_string(),
            file_path: relative_path.to_string(),
            direction: "pull".to_string(),
            status: "in_progress".to_string(),
            temp_path: Some(temp_local.clone()),
            final_path: local_path.to_string(),
            file_size: file_size as i64,
            hash_expected: remote_md5.clone(),
            hash_actual: None,
            created_at: String::new(),
            updated_at: String::new(),
            error_message: None,
            retry_count: 0,
        });

        // Pull to temp path
        match adb::pull(serial, remote_path, &temp_local) {
            Ok(_) => {}
            Err(e) => {
                let msg = format!("Pull to temp failed: {}", e);
                let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                let _ = self.db.increment_transfer_retry(&journal_id);
                let _ = std::fs::remove_file(&temp_local);
                return Err(FolderSyncError::AdbError(msg));
            }
        }

        // Verify local MD5 if we have remote reference hash
        if let Some(ref expected_md5) = remote_md5 {
            match Self::md5_local_file(Path::new(&temp_local)) {
                Ok(local_md5) => {
                    let _ = self.db.update_transfer_hash(&journal_id, &local_md5);
                    if &local_md5 != expected_md5 {
                        let msg = format!("Integrity mismatch: expected {}, got {}", expected_md5, local_md5);
                        let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                        let _ = self.db.increment_transfer_retry(&journal_id);
                        let _ = std::fs::remove_file(&temp_local);
                        return Err(FolderSyncError::IntegrityError {
                            expected: expected_md5.clone(), actual: local_md5,
                        });
                    }
                }
                Err(e) => {
                    warn!("Local MD5 calculation failed for {}: {}", temp_local, e);
                }
            }
        }

        // Atomic rename: temp -> final
        match std::fs::rename(&temp_local, local_path) {
            Ok(_) => {
                let _ = self.db.update_transfer_status(&journal_id, "completed", None);
                Ok(())
            }
            Err(e) => {
                let msg = format!("Local rename failed: {}", e);
                let _ = self.db.update_transfer_status(&journal_id, "failed", Some(&msg));
                let _ = self.db.increment_transfer_retry(&journal_id);
                let _ = std::fs::remove_file(&temp_local);
                Err(FolderSyncError::IoError(e))
            }
        }
    }

    /// Recover pending/failed transfers for a device (called on reconnect)
    pub fn recover_transfers(&self, serial: &str) -> Result<RecoveryResult> {
        let entries = self.db.get_failed_transfers_for_device(serial)
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;

        if entries.is_empty() {
            return Ok(RecoveryResult { recovered: 0, failed: 0, errors: Vec::new() });
        }

        info!("Recovering {} interrupted transfers for device {}", entries.len(), serial);
        let mut result = RecoveryResult { recovered: 0, failed: 0, errors: Vec::new() };

        for entry in &entries {
            // Clean up any leftover temp files first
            if let Some(ref temp) = entry.temp_path {
                if entry.direction == "push" {
                    let _ = adb::delete_path(serial, temp);
                } else {
                    let _ = std::fs::remove_file(temp);
                }
            }

            // Mark entry as pending for retry on next sync.
            // We cannot fully re-derive local/remote paths here without the sync pair context,
            // but the next sync_pair() call will detect these files as out-of-sync and re-transfer
            // them using verified_push/verified_pull with fresh journal entries.
            let _ = self.db.update_transfer_status(&entry.id, "failed", Some("Marked for retry by recovery"));
            let retry_result: std::result::Result<(), FolderSyncError> =
                Err(FolderSyncError::TransferInterrupted("Will retry on next sync".to_string()));

            match retry_result {
                Ok(_) => result.recovered += 1,
                Err(e) => {
                    result.failed += 1;
                    result.errors.push(format!("{}: {}", entry.file_path, e));
                }
            }
        }

        // Clean up old completed entries (older than 7 days)
        let _ = self.db.delete_completed_transfers(7);

        info!("Recovery done: {} recovered, {} failed", result.recovered, result.failed);
        Ok(result)
    }

    fn scan_local_directory(local_path: &Path, ignore: &IgnorePatterns) -> Result<HashMap<String, LocalFileInfo>> {
        let mut files = HashMap::new();
        for entry in WalkDir::new(local_path).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() { continue; }
            let full_path = entry.path();
            let relative_path = full_path
                .strip_prefix(local_path)
                .map_err(|_| FolderSyncError::InvalidPath("relative path".to_string()))?
                .to_str()
                .ok_or_else(|| FolderSyncError::InvalidPath("non-UTF8 path".to_string()))?
                .replace('\\', "/");

            if ignore.is_ignored(&relative_path) { continue; }

            if let Ok(metadata) = entry.metadata() {
                let modified = metadata.modified().ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs()).unwrap_or(0);
                let hash = Self::hash_local_file(full_path).ok();
                files.insert(relative_path, LocalFileInfo {
                    path: full_path.to_path_buf(), size: metadata.len(), modified, hash,
                });
            }
        }
        Ok(files)
    }

    fn scan_remote_directory(serial: &str, remote_path: &str, ignore: &IgnorePatterns) -> Result<HashMap<String, RemoteFileInfo>> {
        let mut files = HashMap::new();
        let safe_path = adb::sanitize_device_path(remote_path)
            .map_err(|e| FolderSyncError::InvalidPath(e.to_string()))?;
        let cmd = format!("find '{}' -type f -printf '%p\\t%s\\t%T@\\n' 2>/dev/null", safe_path);
        let output = adb::shell(serial, &cmd).map_err(|e| FolderSyncError::AdbError(e.to_string()))?;

        let base = if remote_path.ends_with('/') { remote_path.to_string() } else { format!("{}/", remote_path) };

        for line in output.lines() {
            if line.trim().is_empty() { continue; }
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 { continue; }

            let full = parts[0];
            let size = parts[1].parse::<u64>().unwrap_or(0);
            let modified = parts[2].parse::<f64>().unwrap_or(0.0) as u64;

            let relative = if full.starts_with(&base) {
                full[base.len()..].to_string()
            } else if full.starts_with(remote_path) {
                full[remote_path.len()..].trim_start_matches('/').to_string()
            } else { continue; };

            if relative.is_empty() || ignore.is_ignored(&relative) { continue; }

            files.insert(relative, RemoteFileInfo { path: full.to_string(), size, modified });
        }
        Ok(files)
    }

    /// Version a local file before overwriting/deleting (Syncthing-like file versioning)
    fn version_local_file(local_path: &Path, pair_root: &Path) -> Result<()> {
        if !local_path.exists() { return Ok(()); }

        let version_dir = pair_root.join(VERSIONS_DIR);
        std::fs::create_dir_all(&version_dir)?;

        let relative = local_path.strip_prefix(pair_root)
            .map_err(|_| FolderSyncError::InvalidPath("version relative path".to_string()))?;

        let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let stem = relative.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = relative.extension().and_then(|s| s.to_str());
        let ext_suffix = ext.map(|e| format!(".{}", e)).unwrap_or_default();
        let version_name = format!("{}~{}{}", stem, ts, ext_suffix);

        let sub = if let Some(p) = relative.parent() { version_dir.join(p) } else { version_dir };
        std::fs::create_dir_all(&sub)?;
        std::fs::copy(local_path, sub.join(version_name))?;
        Ok(())
    }

    /// Clean old versioned files beyond retention days
    pub fn clean_old_versions(local_root: &Path, retention_days: u32) -> Result<u64> {
        let dir = local_root.join(VERSIONS_DIR);
        if !dir.exists() { return Ok(0); }
        let cutoff = SystemTime::now() - Duration::from_secs(retention_days as u64 * 86400);
        let mut cleaned = 0u64;
        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                if let Ok(m) = entry.metadata() {
                    if let Ok(mod_time) = m.modified() {
                        if mod_time < cutoff {
                            if std::fs::remove_file(entry.path()).is_ok() { cleaned += 1; }
                        }
                    }
                }
            }
        }
        info!("Cleaned {} old version files from {}", cleaned, dir.display());
        Ok(cleaned)
    }

    fn detect_changes(
        local_files: &HashMap<String, LocalFileInfo>,
        remote_files: &HashMap<String, RemoteFileInfo>,
        index: &HashMap<String, FolderSyncEntry>,
        direction: &str, remote_path: &str, local_path: &Path,
    ) -> Vec<ChangeItem> {
        let mut changes = Vec::new();

        for (rel, local_info) in local_files {
            let remote = remote_files.get(rel);
            let idx = index.get(rel);
            let full_remote = format!("{}/{}", remote_path.trim_end_matches('/'), rel);

            match (remote, idx) {
                (None, None) => {
                    if direction == "bidirectional" || direction == "push" {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::PushNew,
                            local_path: Some(local_info.path.clone()), remote_path: Some(full_remote),
                            local_size: local_info.size, remote_size: 0,
                            local_modified: local_info.modified, remote_modified: 0,
                        });
                    }
                }
                (Some(r), None) => {
                    changes.push(ChangeItem {
                        relative_path: rel.clone(), action: ChangeAction::Conflict,
                        local_path: Some(local_info.path.clone()), remote_path: Some(r.path.clone()),
                        local_size: local_info.size, remote_size: r.size,
                        local_modified: local_info.modified, remote_modified: r.modified,
                    });
                }
                (None, Some(_)) => {
                    if direction == "bidirectional" || direction == "pull" {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::DeleteLocal,
                            local_path: Some(local_info.path.clone()), remote_path: None,
                            local_size: local_info.size, remote_size: 0,
                            local_modified: local_info.modified, remote_modified: 0,
                        });
                    }
                }
                (Some(r), Some(entry)) => {
                    let local_hash = local_info.hash.as_deref();
                    let stored_hash = entry.local_hash.as_deref();
                    let local_changed = local_hash != stored_hash;
                    let stored_mod = entry.remote_modified.as_ref()
                        .and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    let remote_changed = r.modified != stored_mod
                        || r.size != entry.remote_size.unwrap_or(0) as u64;

                    if local_changed && remote_changed {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::Conflict,
                            local_path: Some(local_info.path.clone()), remote_path: Some(r.path.clone()),
                            local_size: local_info.size, remote_size: r.size,
                            local_modified: local_info.modified, remote_modified: r.modified,
                        });
                    } else if local_changed && (direction == "bidirectional" || direction == "push") {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::PushModified,
                            local_path: Some(local_info.path.clone()), remote_path: Some(r.path.clone()),
                            local_size: local_info.size, remote_size: r.size,
                            local_modified: local_info.modified, remote_modified: r.modified,
                        });
                    } else if remote_changed && (direction == "bidirectional" || direction == "pull") {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::PullModified,
                            local_path: Some(local_info.path.clone()), remote_path: Some(r.path.clone()),
                            local_size: local_info.size, remote_size: r.size,
                            local_modified: local_info.modified, remote_modified: r.modified,
                        });
                    }
                }
            }
        }

        for (rel, r) in remote_files {
            if local_files.contains_key(rel) { continue; }
            match index.get(rel) {
                None => {
                    if direction == "bidirectional" || direction == "pull" {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::PullNew,
                            local_path: Some(local_path.join(rel)), remote_path: Some(r.path.clone()),
                            local_size: 0, remote_size: r.size,
                            local_modified: 0, remote_modified: r.modified,
                        });
                    }
                }
                Some(_) => {
                    if direction == "bidirectional" || direction == "push" {
                        changes.push(ChangeItem {
                            relative_path: rel.clone(), action: ChangeAction::DeleteRemote,
                            local_path: None, remote_path: Some(r.path.clone()),
                            local_size: 0, remote_size: r.size,
                            local_modified: 0, remote_modified: r.modified,
                        });
                    }
                }
            }
        }

        changes
    }

    fn resolve_conflict(serial: &str, change: &ChangeItem, policy: &ConflictPolicy, local_root: &Path) -> Result<Option<ChangeAction>> {
        match policy {
            ConflictPolicy::KeepBoth => {
                if let (Some(local), Some(remote)) = (&change.local_path, &change.remote_path) {
                    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
                    let conflict_path = PathBuf::from(format!("{}.sync-conflict-{}", local.display(), ts));
                    if let Some(p) = conflict_path.parent() { let _ = std::fs::create_dir_all(p); }
                    let _ = adb::pull(serial, remote, conflict_path.to_str().unwrap_or(""));
                }
                Ok(Some(ChangeAction::PushModified))
            }
            ConflictPolicy::LocalWins => Ok(Some(ChangeAction::PushModified)),
            ConflictPolicy::RemoteWins => {
                if let Some(local) = &change.local_path { let _ = Self::version_local_file(local, local_root); }
                Ok(Some(ChangeAction::PullModified))
            }
            ConflictPolicy::NewestWins => {
                if change.local_modified >= change.remote_modified {
                    Ok(Some(ChangeAction::PushModified))
                } else {
                    if let Some(local) = &change.local_path { let _ = Self::version_local_file(local, local_root); }
                    Ok(Some(ChangeAction::PullModified))
                }
            }
        }
    }

    /// Perform full synchronization of a folder pair
    pub fn sync_pair(&self, serial: &str, pair_id: &str) -> Result<SyncResult> {
        let start = Instant::now();
        info!("Starting folder sync for pair: {}", pair_id);
        self.emit_event(FolderSyncEvent::Started { pair_id: pair_id.to_string() });

        let pairs = self.db.get_folder_sync_pairs(Some(serial))
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        let pair = pairs.iter().find(|p| p.id == pair_id)
            .ok_or_else(|| FolderSyncError::PairNotFound(pair_id.to_string()))?.clone();

        if !pair.enabled {
            return Err(FolderSyncError::PairNotFound(format!("disabled: {}", pair_id)));
        }

        let local_path = Path::new(&pair.local_path);
        let remote_path = &pair.remote_path;

        std::fs::create_dir_all(local_path)?;
        let _ = adb::create_dir(serial, remote_path);

        let ignore = IgnorePatterns::load_from_file(local_path);
        let local_files = Self::scan_local_directory(local_path, &ignore)?;
        let remote_files = Self::scan_remote_directory(serial, remote_path, &ignore)?;

        let index_entries = self.db.get_folder_sync_index(pair_id)
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        let index: HashMap<String, FolderSyncEntry> = index_entries.into_iter()
            .filter(|e| e.status != "deleted")
            .map(|e| (e.relative_path.clone(), e)).collect();

        let changes = Self::detect_changes(&local_files, &remote_files, &index, &pair.direction, remote_path, local_path);
        let total = changes.len() as u64;
        let mut result = SyncResult::default();
        let mut current = 0u64;

        let conflict_str = self.db.get_setting("conflict_policy").unwrap_or(None).unwrap_or_else(|| "keep_both".to_string());
        let conflict_policy = ConflictPolicy::from_str(&conflict_str);

        // 安全控制：检查是否禁止推送到设备
        // Safety control: check if push to device is blocked
        let block_push = self.db.get_setting("block_push_to_device")
            .unwrap_or(None)
            .map(|v| v == "true")
            .unwrap_or(false);

        for change in changes {
            current += 1;
            self.emit_event(FolderSyncEvent::Progress {
                pair_id: pair_id.to_string(), current, total,
                file: change.relative_path.clone(), action: format!("{:?}", change.action),
                bytes: change.local_size.max(change.remote_size),
            });

            match change.action {
                ChangeAction::PushNew | ChangeAction::PushModified => {
                    if block_push {
                        result.errors.push(format!("Blocked: {} (push to device disabled)", change.relative_path));
                        continue;
                    }
                    if let (Some(local), Some(remote)) = (&change.local_path, &change.remote_path) {
                        if let Some(p) = PathBuf::from(remote).parent() {
                            let _ = adb::create_dir(serial, p.to_str().unwrap_or(""));
                        }
                        match self.verified_push(serial, local.to_str().unwrap_or(""), remote, pair_id, &change.relative_path, change.local_size) {
                            Ok(_) => {
                                result.pushed += 1;
                                result.bytes_pushed += change.local_size;
                                self.update_index_entry(&pair, &change.relative_path, local, Some(remote), serial)?;
                            }
                            Err(e) => result.errors.push(format!("Push: {} - {}", change.relative_path, e)),
                        }
                    }
                }
                ChangeAction::PullNew | ChangeAction::PullModified => {
                    if let (Some(local), Some(remote)) = (&change.local_path, &change.remote_path) {
                        if change.action == ChangeAction::PullModified && local.exists() {
                            let _ = Self::version_local_file(local, local_path);
                        }
                        if let Some(p) = local.parent() { let _ = std::fs::create_dir_all(p); }
                        match self.verified_pull(serial, remote, local.to_str().unwrap_or(""), pair_id, &change.relative_path, change.remote_size) {
                            Ok(_) => {
                                result.pulled += 1;
                                result.bytes_pulled += change.remote_size;
                                self.update_index_entry(&pair, &change.relative_path, local, Some(remote), serial)?;
                            }
                            Err(e) => result.errors.push(format!("Pull: {} - {}", change.relative_path, e)),
                        }
                    }
                }
                ChangeAction::DeleteLocal => {
                    if let Some(local) = &change.local_path {
                        let _ = Self::version_local_file(local, local_path);
                        match std::fs::remove_file(local) {
                            Ok(_) => { result.deleted_local += 1; self.remove_index_entry(pair_id, &change.relative_path)?; }
                            Err(e) => result.errors.push(format!("DelLocal: {} - {}", change.relative_path, e)),
                        }
                    }
                }
                ChangeAction::DeleteRemote => {
                    if let Some(remote) = &change.remote_path {
                        match adb::delete_path(serial, remote) {
                            Ok(_) => { result.deleted_remote += 1; self.remove_index_entry(pair_id, &change.relative_path)?; }
                            Err(e) => result.errors.push(format!("DelRemote: {} - {}", change.relative_path, e)),
                        }
                    }
                }
                ChangeAction::Conflict => {
                    result.conflicts += 1;
                    match Self::resolve_conflict(serial, &change, &conflict_policy, local_path)? {
                        Some(ChangeAction::PushModified) => {
                            if let (Some(local), Some(remote)) = (&change.local_path, &change.remote_path) {
                                if let Some(p) = PathBuf::from(remote).parent() {
                                    let _ = adb::create_dir(serial, p.to_str().unwrap_or(""));
                                }
                                match self.verified_push(serial, local.to_str().unwrap_or(""), remote, pair_id, &change.relative_path, change.local_size) {
                                    Ok(_) => { result.pushed += 1; result.bytes_pushed += change.local_size;
                                        self.update_index_entry(&pair, &change.relative_path, local, Some(remote), serial)?; }
                                    Err(e) => result.errors.push(format!("ConflictPush: {} - {}", change.relative_path, e)),
                                }
                            }
                        }
                        Some(ChangeAction::PullModified) => {
                            if let (Some(local), Some(remote)) = (&change.local_path, &change.remote_path) {
                                if let Some(p) = local.parent() { let _ = std::fs::create_dir_all(p); }
                                match self.verified_pull(serial, remote, local.to_str().unwrap_or(""), pair_id, &change.relative_path, change.remote_size) {
                                    Ok(_) => { result.pulled += 1; result.bytes_pulled += change.remote_size;
                                        self.update_index_entry(&pair, &change.relative_path, local, Some(remote), serial)?; }
                                    Err(e) => result.errors.push(format!("ConflictPull: {} - {}", change.relative_path, e)),
                                }
                            }
                        }
                        _ => result.errors.push(format!("Unresolved: {}", change.relative_path)),
                    }
                }
            }
        }

        let elapsed = start.elapsed();
        result.duration_ms = elapsed.as_millis() as u64;
        let total_bytes = result.bytes_pushed + result.bytes_pulled;
        result.speed_mbps = if elapsed.as_secs_f64() > 0.0 {
            (total_bytes as f64 / 1_048_576.0) / elapsed.as_secs_f64()
        } else { 0.0 };

        info!("Sync done [{}]: push={}, pull={}, conflicts={}, speed={:.1}MB/s, {}ms",
            pair_id, result.pushed, result.pulled, result.conflicts, result.speed_mbps, result.duration_ms);

        self.emit_event(FolderSyncEvent::Completed { pair_id: pair_id.to_string(), result: result.clone() });
        Ok(result)
    }

    /// 仅对比两端差异，不执行实际同步
    /// Compare only: detect changes without syncing
    pub fn compare_only(&self, pair_id: &str) -> Result<Value> {
        let pairs = self.db.get_folder_sync_pairs(None)
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        let pair = pairs.iter().find(|p| p.id == pair_id)
            .ok_or_else(|| FolderSyncError::PairNotFound(pair_id.to_string()))?.clone();

        let local_path = Path::new(&pair.local_path);
        let remote_path = &pair.remote_path;
        let serial = &pair.device_serial;

        if !local_path.exists() {
            return Err(FolderSyncError::InvalidPath(format!("Local path not found: {}", pair.local_path)));
        }

        let ignore = IgnorePatterns::load_from_file(local_path);
        let local_files = Self::scan_local_directory(local_path, &ignore)?;
        let remote_files = Self::scan_remote_directory(serial, remote_path, &ignore)?;

        let index_entries = self.db.get_folder_sync_index(pair_id)
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        let index: HashMap<String, FolderSyncEntry> = index_entries.into_iter()
            .filter(|e| e.status != "deleted")
            .map(|e| (e.relative_path.clone(), e)).collect();

        let changes = Self::detect_changes(&local_files, &remote_files, &index, &pair.direction, remote_path, local_path);

        let summary = serde_json::json!({
            "pairId": pair_id,
            "localPath": pair.local_path,
            "remotePath": remote_path,
            "localFileCount": local_files.len(),
            "remoteFileCount": remote_files.len(),
            "changes": changes.iter().map(|c| serde_json::json!({
                "path": c.relative_path,
                "action": format!("{:?}", c.action),
                "localSize": c.local_size,
                "remoteSize": c.remote_size,
            })).collect::<Vec<_>>(),
            "totalChanges": changes.len(),
            "pushCount": changes.iter().filter(|c| matches!(c.action, ChangeAction::PushNew | ChangeAction::PushModified)).count(),
            "pullCount": changes.iter().filter(|c| matches!(c.action, ChangeAction::PullNew | ChangeAction::PullModified)).count(),
            "deleteCount": changes.iter().filter(|c| matches!(c.action, ChangeAction::DeleteLocal | ChangeAction::DeleteRemote)).count(),
            "conflictCount": changes.iter().filter(|c| matches!(c.action, ChangeAction::Conflict)).count(),
        });

        Ok(summary)
    }

    fn update_index_entry(&self, pair: &FolderSyncPair, rel: &str, local: &Path, remote: Option<&str>, serial: &str) -> Result<()> {
        let local_hash = Self::hash_local_file(local).ok();
        let meta = std::fs::metadata(local).ok();
        let local_size = meta.as_ref().map(|m| m.len() as i64);
        let local_modified = meta.and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs().to_string());

        let (remote_hash, remote_size, remote_modified) = if let Some(rp) = remote {
            let safe_rp = adb::sanitize_device_path(rp)
                .map_err(|e| FolderSyncError::InvalidPath(e.to_string()))?;
            let cmd = format!("stat -c '%s %Y' '{}' 2>/dev/null", safe_rp);
            if let Ok(output) = adb::shell(serial, &cmd) {
                let parts: Vec<&str> = output.trim().split(' ').collect();
                (local_hash.clone(), parts.first().and_then(|s| s.parse().ok()), parts.get(1).map(|s| s.to_string()))
            } else { (None, None, None) }
        } else { (None, None, None) };

        self.db.upsert_folder_sync_entry(&FolderSyncEntry {
            pair_id: pair.id.clone(), relative_path: rel.to_string(),
            local_hash, remote_hash, local_modified, remote_modified,
            local_size, remote_size, status: "synced".to_string(),
        }).map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    /// Touch a marker file on Android after successful sync.
    /// Used by auto-sync to quickly detect remote changes via `find -newer`.
    fn touch_remote_marker(serial: &str, pair_id: &str) {
        let marker = format!("{}/{}_{}", MARKER_DIR, MARKER_PREFIX, pair_id);
        let _ = adb::shell(serial, &format!("mkdir -p '{}' && touch '{}'", MARKER_DIR, marker));
    }

    /// Quick check: has anything changed on Android since last sync?
    /// Uses `find -newer <marker>` — single lightweight ADB command.
    /// Returns true if changes detected or marker doesn't exist (first run).
    fn has_remote_changes(serial: &str, pair_id: &str, remote_path: &str) -> bool {
        let marker = format!("{}/{}_{}", MARKER_DIR, MARKER_PREFIX, pair_id);
        // Check if marker exists first
        let marker_exists = adb::shell(serial, &format!("test -f '{}' && echo y", marker))
            .map(|o| o.trim() == "y")
            .unwrap_or(false);
        if !marker_exists {
            return true; // First run, always sync
        }
        // Quick check: any files newer than marker?
        let safe_path = match adb::sanitize_device_path(remote_path) {
            Ok(p) => p,
            Err(_) => return true,
        };
        let cmd = format!(
            "find '{}' -newer '{}' -type f 2>/dev/null | head -1",
            safe_path, marker
        );
        match adb::shell(serial, &cmd) {
            Ok(output) => !output.trim().is_empty(),
            Err(_) => true, // On error, assume changes
        }
    }

    /// Start auto-sync polling for all enabled folder sync pairs of a device.
    /// Uses lightweight change detection:
    /// - PC side: `notify` watcher (inotify/FSEvents) sets dirty flag per pair
    /// - Android side: `find -newer <marker>` quick check (1 ADB command)
    /// Only does full scan + sync when changes are detected.
    pub fn start_auto_sync(&self, serial: &str) {
        use std::sync::atomic::{AtomicBool, Ordering};

        let mut active = self.active_auto_syncs.lock();
        if active.contains_key(serial) {
            info!("Folder auto-sync already running for device: {}", serial);
            return;
        }

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let serial_owned = serial.to_string();
        let serial_for_insert = serial_owned.clone();
        let db = self.db.clone();
        let event_tx = self.event_tx.clone();

        std::thread::spawn(move || {
            info!("Starting folder auto-sync for device: {}", serial_owned);

            // Per-pair state: dirty flag (set by PC-side notify watcher) + watcher handle
            let local_dirty: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>> =
                Arc::new(Mutex::new(HashMap::new()));
            let mut watchers: HashMap<String, RecommendedWatcher> = HashMap::new();

            while running_clone.load(Ordering::Relaxed) {
                // Get all enabled pairs for this device
                let pairs = match db.get_folder_sync_pairs(Some(&serial_owned)) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!("Failed to load folder sync pairs: {}", e);
                        for _ in 0..(FOLDER_SYNC_POLL_INTERVAL_SECS * 10) {
                            if !running_clone.load(Ordering::Relaxed) { return; }
                            std::thread::sleep(Duration::from_millis(100));
                        }
                        continue;
                    }
                };

                // Remove watchers for pairs that no longer exist or are disabled
                let active_pair_ids: std::collections::HashSet<String> = pairs.iter()
                    .filter(|p| p.enabled)
                    .map(|p| p.id.clone())
                    .collect();
                watchers.retain(|id, _| active_pair_ids.contains(id));
                local_dirty.lock().retain(|id, _| active_pair_ids.contains(id));

                for pair in pairs.iter().filter(|p| p.enabled) {
                    if !running_clone.load(Ordering::Relaxed) { break; }

                    let local_path = PathBuf::from(&pair.local_path);
                    if !local_path.exists() { continue; }

                    // Set up PC-side notify watcher if not already watching this pair
                    let dirty_flag = {
                        let mut dirty_map = local_dirty.lock();
                        dirty_map.entry(pair.id.clone())
                            .or_insert_with(|| Arc::new(AtomicBool::new(true))) // dirty on first run
                            .clone()
                    };

                    if !watchers.contains_key(&pair.id) {
                        let flag_for_watcher = dirty_flag.clone();
                        let watch_path = local_path.clone();
                        match RecommendedWatcher::new(
                            move |res: notify::Result<Event>| {
                                if let Ok(e) = res {
                                    // Only mark dirty for actual file changes
                                    if e.paths.iter().any(|p| p.is_file()) {
                                        flag_for_watcher.store(true, Ordering::Relaxed);
                                    }
                                }
                            },
                            Config::default(),
                        ) {
                            Ok(mut w) => {
                                if w.watch(&watch_path, RecursiveMode::Recursive).is_ok() {
                                    info!("Folder auto-sync: watching local path for pair {}", pair.id);
                                    watchers.insert(pair.id.clone(), w);
                                }
                            }
                            Err(e) => {
                                warn!("Failed to start watcher for pair {}: {}", pair.id, e);
                            }
                        }
                    }

                    // === Lightweight change detection ===
                    let pc_dirty = dirty_flag.load(Ordering::Relaxed);
                    let android_dirty = FolderSync::has_remote_changes(
                        &serial_owned, &pair.id, &pair.remote_path,
                    );

                    if !pc_dirty && !android_dirty {
                        continue; // Nothing changed, skip this pair
                    }

                    info!(
                        "Folder auto-sync: changes detected for pair {} (pc={}, android={}), syncing...",
                        pair.id, pc_dirty, android_dirty
                    );

                    // Full sync
                    let fs = FolderSync {
                        db: db.clone(),
                        active_watches: Arc::new(Mutex::new(HashMap::new())),
                        active_auto_syncs: Arc::new(Mutex::new(HashMap::new())),
                        event_tx: event_tx.clone(),
                    };
                    match fs.sync_pair(&serial_owned, &pair.id) {
                        Ok(result) => {
                            info!(
                                "Folder auto-sync completed for pair {}: pushed={}, pulled={}, deleted={}",
                                pair.id, result.pushed, result.pulled,
                                result.deleted_local + result.deleted_remote
                            );
                            // Reset dirty flag and touch Android marker
                            dirty_flag.store(false, Ordering::Relaxed);
                            FolderSync::touch_remote_marker(&serial_owned, &pair.id);
                        }
                        Err(e) => {
                            warn!("Folder auto-sync failed for pair {}: {}", pair.id, e);
                            if let Some(tx) = &event_tx {
                                let _ = tx.send(FolderSyncEvent::Error {
                                    pair_id: pair.id.clone(),
                                    message: e.to_string(),
                                });
                            }
                        }
                    }
                }

                // Wait before next poll
                for _ in 0..(FOLDER_SYNC_POLL_INTERVAL_SECS * 10) {
                    if !running_clone.load(Ordering::Relaxed) { break; }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }

            // Cleanup: drop watchers
            drop(watchers);
            info!("Stopped folder auto-sync for device: {}", serial_owned);
        });

        active.insert(serial_for_insert, AutoSyncHandle { running });
    }

    pub fn stop_auto_sync(&self, serial: &str) {
        let mut active = self.active_auto_syncs.lock();
        if let Some(handle) = active.remove(serial) {
            handle.running.store(false, std::sync::atomic::Ordering::Relaxed);
            info!("Stopping folder auto-sync for device: {}", serial);
        }
    }

    pub fn stop_all_auto_syncs(&self) {
        let mut active = self.active_auto_syncs.lock();
        for (serial, handle) in active.drain() {
            handle.running.store(false, std::sync::atomic::Ordering::Relaxed);
            info!("Stopping folder auto-sync for device: {}", serial);
        }
    }

    fn remove_index_entry(&self, pair_id: &str, rel: &str) -> Result<()> {
        self.db.upsert_folder_sync_entry(&FolderSyncEntry {
            pair_id: pair_id.to_string(), relative_path: rel.to_string(),
            local_hash: None, remote_hash: None, local_modified: None, remote_modified: None,
            local_size: None, remote_size: None, status: "deleted".to_string(),
        }).map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        Ok(())
    }

    pub fn start_watching(&self, serial: &str, pair_id: &str) -> Result<()> {
        let pairs = self.db.get_folder_sync_pairs(Some(serial))
            .map_err(|e| FolderSyncError::DatabaseError(e.to_string()))?;
        let pair = pairs.iter().find(|p| p.id == pair_id)
            .ok_or_else(|| FolderSyncError::PairNotFound(pair_id.to_string()))?.clone();
        if !pair.enabled { return Err(FolderSyncError::PairNotFound(format!("disabled: {}", pair_id))); }

        let local_path = PathBuf::from(&pair.local_path);
        if !local_path.exists() { return Err(FolderSyncError::InvalidPath(pair.local_path)); }

        let (stop_tx, stop_rx): (Sender<()>, Receiver<()>) = unbounded();
        let (event_tx, event_rx) = unbounded();
        let event_sender = self.event_tx.clone();
        let pair_id_clone = pair_id.to_string();

        let mut watcher = RecommendedWatcher::new(
            move |res: notify::Result<Event>| { if let Ok(e) = res { let _ = event_tx.send(e); } },
            Config::default(),
        ).map_err(|e| FolderSyncError::WatchError(e.to_string()))?;

        watcher.watch(&local_path, RecursiveMode::Recursive)
            .map_err(|e| FolderSyncError::WatchError(e.to_string()))?;

        std::thread::spawn(move || {
            let ignore = IgnorePatterns::load_from_file(&local_path);
            loop {
                crossbeam_channel::select! {
                    recv(stop_rx) -> _ => break,
                    recv(event_rx) -> event => {
                        if let Ok(event) = event {
                            for path in event.paths {
                                if path.is_file() {
                                    let rel = path.strip_prefix(&local_path)
                                        .map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
                                    if !rel.is_empty() && !ignore.is_ignored(&rel) {
                                        if let Some(tx) = &event_sender {
                                            let _ = tx.send(FolderSyncEvent::FileChanged {
                                                pair_id: pair_id_clone.clone(), path: rel,
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        self.active_watches.lock().insert(pair_id.to_string(), WatchHandle { _watcher: watcher, stop_tx });
        info!("Started watching pair: {}", pair_id);
        Ok(())
    }

    pub fn stop_watching(&self, pair_id: &str) {
        if let Some(h) = self.active_watches.lock().remove(pair_id) { let _ = h.stop_tx.send(()); }
    }

    pub fn stop_all_watching(&self) {
        for (_, h) in self.active_watches.lock().drain() { let _ = h.stop_tx.send(()); }
    }

    /// Get USB transfer speed and filesystem info for a device
    pub fn get_transfer_info(serial: &str) -> Result<TransferInfo> {
        let usb = adb::shell(serial, "cat /sys/class/android_usb/android0/speed 2>/dev/null || echo unknown")
            .map_err(|e| FolderSyncError::AdbError(e.to_string()))?;
        let mount = adb::shell(serial, "mount | grep -E '/sdcard|/storage/emulated' | head -1")
            .map_err(|e| FolderSyncError::AdbError(e.to_string()))?;

        let is_fat32 = mount.to_lowercase().contains("vfat") || mount.to_lowercase().contains("fat32");
        let usb_speed = usb.trim().to_string();
        let est = match usb_speed.as_str() {
            "480" => "USB 2.0 (~30 MB/s)", "5000" => "USB 3.0 (~300 MB/s)",
            "10000" => "USB 3.1 (~500 MB/s)", _ => "未知",
        };

        Ok(TransferInfo {
            usb_speed, estimated_speed: est.to_string(),
            max_file_size: if is_fat32 { "4 GB (FAT32)" } else { "无限制 (ext4)" }.to_string(),
            filesystem: if is_fat32 { "FAT32" } else { "ext4" }.to_string(),
            has_fat32_limit: is_fat32,
        })
    }
}

impl Drop for FolderSync {
    fn drop(&mut self) {
        self.stop_all_watching();
        self.stop_all_auto_syncs();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ignore_patterns() {
        let mut p = IgnorePatterns::new();
        p.add("*.tmp", false);
        p.add(".DS_Store", false);
        p.add("node_modules", false);
        assert!(p.is_ignored("test.tmp"));
        assert!(p.is_ignored(".DS_Store"));
        assert!(p.is_ignored("node_modules/package.json"));
        assert!(!p.is_ignored("test.txt"));
    }

    #[test]
    fn test_ignore_negate() {
        let mut p = IgnorePatterns::new();
        p.add("*.log", false);
        p.add("important.log", true);
        assert!(p.is_ignored("debug.log"));
        assert!(!p.is_ignored("important.log"));
    }

    #[test]
    fn test_conflict_policy() {
        assert_eq!(ConflictPolicy::from_str("local_wins"), ConflictPolicy::LocalWins);
        assert_eq!(ConflictPolicy::from_str("newest_wins"), ConflictPolicy::NewestWins);
        assert_eq!(ConflictPolicy::from_str("unknown"), ConflictPolicy::KeepBoth);
    }

    #[test]
    fn test_sync_result_default() {
        let r = SyncResult::default();
        assert_eq!(r.pushed, 0);
        assert_eq!(r.bytes_pushed, 0);
        assert_eq!(r.speed_mbps, 0.0);
    }
}
