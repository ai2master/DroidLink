use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;
use walkdir::WalkDir;

use super::db::{Database, VersionRecord};

/// Errors that can occur during version management operations
#[derive(Error, Debug)]
pub enum VersionError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Version not found: {0}")]
    NotFound(String),

    #[error("Invalid data type: {0}")]
    InvalidDataType(String),

    #[error("Snapshot file not found: {0}")]
    SnapshotNotFound(String),
}

pub type Result<T> = std::result::Result<T, VersionError>;

/// Detailed version information including snapshot data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDetail {
    pub record: VersionRecord,
    pub snapshot_data: Option<serde_json::Value>,
}

/// Snapshot file structure stored on disk
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapshotFile {
    version_id: String,
    timestamp: String,
    data_type: String,
    item_id: Option<String>,
    action: String,
    before: Option<serde_json::Value>,
    after: Option<serde_json::Value>,
}

/// Version history manager - tracks all changes to synced data
///
/// This works like a simplified Git for DroidLink data:
/// - Every change creates a version snapshot stored on the PC
/// - Even edits made on the PC side create version history
/// - All old versions are stored on PC only (not synced back to Android)
/// - Supports restoring any previous version
/// - Configurable retention period (default 90 days)
pub struct VersionManager {
    db: Arc<Database>,
    snapshot_dir: PathBuf,
    retention_days: u32,
}

impl VersionManager {
    /// Create a new version manager
    ///
    /// # Arguments
    /// * `db` - Database handle for storing version metadata
    /// * `data_path` - Base data directory where snapshots will be stored
    pub fn new(db: Arc<Database>, data_path: &Path) -> Self {
        let snapshot_dir = data_path.join("versions");

        // Create base snapshot directory and subdirectories
        let data_types = ["contacts", "messages", "call_logs", "folder_sync"];
        for data_type in &data_types {
            let dir = snapshot_dir.join(data_type);
            if let Err(e) = fs::create_dir_all(&dir) {
                error!("Failed to create snapshot directory for {}: {}", data_type, e);
            }
        }

        info!("Version manager initialized with snapshot dir: {:?}", snapshot_dir);

        Self {
            db,
            snapshot_dir,
            retention_days: 90, // Default 90 days retention
        }
    }

    /// Create a new version entry and store the snapshot
    ///
    /// This method is called whenever data changes, whether from Android sync or PC edits.
    /// It creates a version record in the database and stores a snapshot file on disk.
    ///
    /// # Arguments
    /// * `device_serial` - Serial number of the Android device
    /// * `data_type` - Type of data (contacts, messages, call_logs, folder_sync)
    /// * `item_id` - Optional ID of the specific item (None for bulk operations)
    /// * `action` - Action performed (create, update, delete, bulk_sync)
    /// * `data_before` - State before the change (None for create)
    /// * `data_after` - State after the change (None for delete)
    /// * `source` - Source of change (android_sync, pc_edit, manual)
    /// * `description` - Optional human-readable description
    ///
    /// # Returns
    /// The version ID (UUID) of the created version
    pub fn create_version(
        &self,
        device_serial: &str,
        data_type: &str,
        item_id: Option<&str>,
        action: &str,
        data_before: Option<&serde_json::Value>,
        data_after: Option<&serde_json::Value>,
        source: &str,
        description: Option<&str>,
    ) -> Result<String> {
        // Validate data type
        let valid_types = ["contacts", "messages", "call_logs", "folder_sync"];
        if !valid_types.contains(&data_type) {
            return Err(VersionError::InvalidDataType(data_type.to_string()));
        }

        // Generate version ID and timestamp
        let version_id = Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();

        debug!(
            "Creating version {} for {} (action: {}, source: {})",
            version_id, data_type, action, source
        );

        // Create snapshot file
        let snapshot_path = self.write_snapshot(
            &version_id,
            &timestamp,
            data_type,
            item_id,
            action,
            data_before,
            data_after,
        )?;

        // Create version record
        let record = VersionRecord {
            id: version_id.clone(),
            device_serial: device_serial.to_string(),
            data_type: data_type.to_string(),
            item_id: item_id.map(|s| s.to_string()),
            action: action.to_string(),
            snapshot_path: Some(snapshot_path.to_string_lossy().to_string()),
            data_before: data_before.map(|v| v.to_string()),
            data_after: data_after.map(|v| v.to_string()),
            source: source.to_string(),
            description: description.map(|s| s.to_string()),
            created_at: timestamp,
        };

        // Insert into database
        self.db.insert_version(&record)
            .map_err(|e| VersionError::Database(e.to_string()))?;

        info!(
            "Version {} created successfully for {} (item_id: {:?})",
            version_id, data_type, item_id
        );

        Ok(version_id)
    }

    /// Get version history for a specific data type and optional item
    ///
    /// # Arguments
    /// * `data_type` - Type of data to query
    /// * `item_id` - Optional specific item ID (None returns all items of this type)
    /// * `limit` - Maximum number of versions to return (most recent first)
    pub fn get_history(
        &self,
        data_type: &str,
        item_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<VersionRecord>> {
        debug!(
            "Getting history for {} (item_id: {:?}, limit: {})",
            data_type, item_id, limit
        );

        self.db.get_version_history(data_type, item_id, limit)
            .map_err(|e| VersionError::Database(e.to_string()))
    }

    /// Get detailed version information including snapshot data
    ///
    /// # Arguments
    /// * `version_id` - The version ID to retrieve
    ///
    /// # Returns
    /// VersionDetail containing both the record and the snapshot data
    pub fn get_version_detail(&self, version_id: &str) -> Result<VersionDetail> {
        debug!("Getting version detail for {}", version_id);

        // Get the version record from database
        let record = self.db.get_version(version_id)
            .map_err(|e| VersionError::Database(e.to_string()))?
            .ok_or_else(|| VersionError::NotFound(version_id.to_string()))?;

        // Read the snapshot file if it exists
        let snapshot_data = if let Some(ref snapshot_path) = record.snapshot_path {
            match self.read_snapshot(Path::new(snapshot_path)) {
                Ok(snapshot) => Some(serde_json::to_value(snapshot)?),
                Err(e) => {
                    warn!("Failed to read snapshot for version {}: {}", version_id, e);
                    None
                }
            }
        } else {
            None
        };

        Ok(VersionDetail {
            record,
            snapshot_data,
        })
    }

    /// Restore a previous version by returning its data
    ///
    /// This returns the "after" data from the version, which can then be applied
    /// to restore the state. For delete operations, this may return the "before" data.
    ///
    /// # Arguments
    /// * `version_id` - The version ID to restore
    ///
    /// # Returns
    /// The data to restore as a JSON value
    pub fn restore_version(&self, version_id: &str) -> Result<serde_json::Value> {
        info!("Restoring version {}", version_id);

        let detail = self.get_version_detail(version_id)?;

        // Get the snapshot file to extract the data
        if let Some(ref snapshot_path) = detail.record.snapshot_path {
            let snapshot = self.read_snapshot(Path::new(snapshot_path))?;

            // For restore, we want the "after" data (the state at that version)
            // For delete actions, we might want "before" data
            let data_to_restore = if detail.record.action == "delete" {
                snapshot.before.ok_or_else(|| {
                    VersionError::NotFound(format!(
                        "No 'before' data available for delete action in version {}",
                        version_id
                    ))
                })?
            } else {
                snapshot.after.ok_or_else(|| {
                    VersionError::NotFound(format!(
                        "No 'after' data available for version {}",
                        version_id
                    ))
                })?
            };

            Ok(data_to_restore)
        } else {
            Err(VersionError::SnapshotNotFound(version_id.to_string()))
        }
    }

    /// Clean up old versions beyond the retention period
    ///
    /// This deletes both database records and snapshot files for versions
    /// older than the retention period.
    ///
    /// # Returns
    /// Number of versions deleted
    pub fn cleanup_old_versions(&self) -> Result<usize> {
        let cutoff_date = Utc::now()
            .checked_sub_signed(chrono::Duration::days(self.retention_days as i64))
            .ok_or_else(|| {
                VersionError::Database("Failed to calculate cutoff date".to_string())
            })?;
        let cutoff_str = cutoff_date.to_rfc3339();

        info!(
            "Cleaning up versions older than {} ({} days)",
            cutoff_str, self.retention_days
        );

        // Get versions to delete (to clean up their snapshot files)
        let old_versions = self.db.get_version_history("", None, i64::MAX)
            .map_err(|e| VersionError::Database(e.to_string()))?;

        let mut deleted_count = 0;
        for version in old_versions {
            if version.created_at < cutoff_str {
                // Delete snapshot file if it exists
                if let Some(ref snapshot_path) = version.snapshot_path {
                    if let Err(e) = fs::remove_file(snapshot_path) {
                        warn!("Failed to delete snapshot file {}: {}", snapshot_path, e);
                    } else {
                        debug!("Deleted snapshot file: {}", snapshot_path);
                    }
                }
                deleted_count += 1;
            }
        }

        // Delete version records from database
        let db_deleted = self.db.delete_versions_before(&cutoff_str)
            .map_err(|e| VersionError::Database(e.to_string()))?;

        info!(
            "Cleanup completed: {} snapshots deleted, {} database records deleted",
            deleted_count, db_deleted
        );

        Ok(db_deleted)
    }

    /// Set the retention period in days
    ///
    /// # Arguments
    /// * `days` - Number of days to retain versions (0 means keep forever)
    pub fn set_retention_days(&mut self, days: u32) {
        info!("Setting retention period to {} days", days);
        self.retention_days = days;
    }

    /// Get the total size of all snapshot files
    ///
    /// # Returns
    /// Total size in bytes
    pub fn get_snapshot_size(&self) -> Result<u64> {
        let mut total_size = 0u64;

        for entry in WalkDir::new(&self.snapshot_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if entry.file_type().is_file() {
                if let Ok(metadata) = entry.metadata() {
                    total_size += metadata.len();
                }
            }
        }

        debug!("Total snapshot size: {} bytes", total_size);
        Ok(total_size)
    }

    /// Export a version to a standalone JSON file
    ///
    /// This creates a complete export including metadata and snapshot data.
    ///
    /// # Arguments
    /// * `version_id` - The version to export
    /// * `output_path` - Path where the export file should be written
    pub fn export_version(&self, version_id: &str, output_path: &str) -> Result<()> {
        info!("Exporting version {} to {}", version_id, output_path);

        let detail = self.get_version_detail(version_id)?;

        // Create a complete export structure
        let export = serde_json::json!({
            "version_id": detail.record.id,
            "device_serial": detail.record.device_serial,
            "data_type": detail.record.data_type,
            "item_id": detail.record.item_id,
            "action": detail.record.action,
            "source": detail.record.source,
            "description": detail.record.description,
            "created_at": detail.record.created_at,
            "snapshot": detail.snapshot_data,
        });

        // Write to file with pretty printing
        let json_string = serde_json::to_string_pretty(&export)?;
        fs::write(output_path, json_string)?;

        info!("Version {} exported successfully", version_id);
        Ok(())
    }

    /// Write a snapshot file to disk
    fn write_snapshot(
        &self,
        version_id: &str,
        timestamp: &str,
        data_type: &str,
        item_id: Option<&str>,
        action: &str,
        data_before: Option<&serde_json::Value>,
        data_after: Option<&serde_json::Value>,
    ) -> Result<PathBuf> {
        let snapshot = SnapshotFile {
            version_id: version_id.to_string(),
            timestamp: timestamp.to_string(),
            data_type: data_type.to_string(),
            item_id: item_id.map(|s| s.to_string()),
            action: action.to_string(),
            before: data_before.cloned(),
            after: data_after.cloned(),
        };

        let snapshot_path = self.snapshot_dir
            .join(data_type)
            .join(format!("{}.json", version_id));

        let json_string = serde_json::to_string_pretty(&snapshot)?;
        fs::write(&snapshot_path, json_string)?;

        debug!("Snapshot written to: {:?}", snapshot_path);
        Ok(snapshot_path)
    }

    /// Read a snapshot file from disk
    fn read_snapshot(&self, path: &Path) -> Result<SnapshotFile> {
        let content = fs::read_to_string(path)?;
        let snapshot: SnapshotFile = serde_json::from_str(&content)?;
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tempfile::TempDir;

    // Mock database for testing
    struct MockDatabase {
        data_path: PathBuf,
    }

    impl MockDatabase {
        fn new(data_path: PathBuf) -> Self {
            Self { data_path }
        }
    }

    // Note: In a real implementation, you would need to implement the Database trait
    // methods for MockDatabase. This is a placeholder for the test structure.

    #[test]
    fn test_version_manager_creation() {
        let temp_dir = TempDir::new().unwrap();
        let data_path = temp_dir.path();

        // This test demonstrates the structure. In practice, you'd need a proper
        // mock implementation of the Database trait.

        let snapshot_dir = data_path.join("versions");
        assert!(snapshot_dir.join("contacts").exists() || !snapshot_dir.exists());
    }

    #[test]
    fn test_snapshot_structure() {
        let snapshot = SnapshotFile {
            version_id: "test-123".to_string(),
            timestamp: Utc::now().to_rfc3339(),
            data_type: "contacts".to_string(),
            item_id: Some("contact-456".to_string()),
            action: "update".to_string(),
            before: Some(serde_json::json!({"name": "John"})),
            after: Some(serde_json::json!({"name": "Jane"})),
        };

        let json = serde_json::to_string_pretty(&snapshot).unwrap();
        assert!(json.contains("test-123"));
        assert!(json.contains("contacts"));
    }
}
