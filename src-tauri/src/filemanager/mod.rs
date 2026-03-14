use super::adb::{self, FileEntry};
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FileManagerError {
    #[error("ADB error: {0}")]
    AdbError(String),
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Operation failed: {0}")]
    OperationFailed(String),
}

pub type Result<T> = std::result::Result<T, FileManagerError>;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub entry: FileEntry,
    pub mime_type: String,
    pub md5: String,
}

pub struct FileManager;

impl FileManager {
    /// List files in a directory with sorting (directories first, then alphabetically)
    pub fn list_directory(serial: &str, path: &str) -> Result<Vec<FileEntry>> {
        let mut entries = adb::list_files(serial, path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        // Sort: directories first, then by name
        entries.sort_by(|a, b| {
            match (&a.file_type[..], &b.file_type[..]) {
                ("directory", "directory") => a.name.cmp(&b.name),
                ("directory", _) => std::cmp::Ordering::Less,
                (_, "directory") => std::cmp::Ordering::Greater,
                _ => a.name.cmp(&b.name),
            }
        });

        Ok(entries)
    }

    /// Pull a file from the Android device to local system
    pub fn pull_file(serial: &str, remote_path: &str, local_path: &str) -> Result<()> {
        // Verify remote file exists
        let exists = adb::file_exists(serial, remote_path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        if !exists {
            return Err(FileManagerError::FileNotFound(remote_path.to_string()));
        }

        // Ensure local directory exists
        if let Some(parent) = Path::new(local_path).parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| FileManagerError::OperationFailed(format!("Failed to create local directory: {}", e)))?;
            }
        }

        adb::pull(serial, remote_path, local_path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Push a file from local system to Android device
    pub fn push_file(serial: &str, local_path: &str, remote_path: &str) -> Result<()> {
        // Verify local file exists
        if !Path::new(local_path).exists() {
            return Err(FileManagerError::FileNotFound(local_path.to_string()));
        }

        // Ensure remote directory exists
        if let Some(parent) = Path::new(remote_path).parent() {
            let parent_str = parent.to_str()
                .ok_or_else(|| FileManagerError::InvalidPath("Invalid UTF-8 in path".to_string()))?;

            let exists = adb::file_exists(serial, parent_str)
                .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

            if !exists {
                adb::create_dir(serial, parent_str)
                    .map_err(|e| FileManagerError::AdbError(e.to_string()))?;
            }
        }

        adb::push(serial, local_path, remote_path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Delete a file or directory on the Android device
    pub fn delete(serial: &str, path: &str) -> Result<()> {
        let exists = adb::file_exists(serial, path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        if !exists {
            return Err(FileManagerError::FileNotFound(path.to_string()));
        }

        adb::delete_path(serial, path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Create a directory on the Android device
    pub fn create_directory(serial: &str, path: &str) -> Result<()> {
        adb::create_dir(serial, path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Rename/move a file or directory on the Android device
    pub fn rename(serial: &str, old_path: &str, new_path: &str) -> Result<()> {
        let exists = adb::file_exists(serial, old_path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        if !exists {
            return Err(FileManagerError::FileNotFound(old_path.to_string()));
        }

        // Ensure destination directory exists
        if let Some(parent) = Path::new(new_path).parent() {
            let parent_str = parent.to_str()
                .ok_or_else(|| FileManagerError::InvalidPath("Invalid UTF-8 in path".to_string()))?;

            let parent_exists = adb::file_exists(serial, parent_str)
                .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

            if !parent_exists {
                adb::create_dir(serial, parent_str)
                    .map_err(|e| FileManagerError::AdbError(e.to_string()))?;
            }
        }

        // Use 'mv' command via shell (path sanitized)
        let safe_old = adb::sanitize_device_path(old_path)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;
        let safe_new = adb::sanitize_device_path(new_path)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;
        let command = format!("mv '{}' '{}'", safe_old, safe_new);
        adb::shell(serial, &command)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Copy a file or directory on the Android device
    pub fn copy(serial: &str, src: &str, dst: &str) -> Result<()> {
        let exists = adb::file_exists(serial, src)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        if !exists {
            return Err(FileManagerError::FileNotFound(src.to_string()));
        }

        // Ensure destination directory exists
        if let Some(parent) = Path::new(dst).parent() {
            let parent_str = parent.to_str()
                .ok_or_else(|| FileManagerError::InvalidPath("Invalid UTF-8 in path".to_string()))?;

            let parent_exists = adb::file_exists(serial, parent_str)
                .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

            if !parent_exists {
                adb::create_dir(serial, parent_str)
                    .map_err(|e| FileManagerError::AdbError(e.to_string()))?;
            }
        }

        // Use 'cp -r' command via shell (path sanitized, supports both files and directories)
        let safe_src = adb::sanitize_device_path(src)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;
        let safe_dst = adb::sanitize_device_path(dst)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;
        let command = format!("cp -r '{}' '{}'", safe_src, safe_dst);
        adb::shell(serial, &command)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        Ok(())
    }

    /// Get detailed information about a file including MIME type and MD5 hash
    pub fn get_file_info(serial: &str, path: &str) -> Result<FileInfo> {
        // First, get basic file entry
        let parent_path = Path::new(path).parent()
            .and_then(|p| p.to_str())
            .unwrap_or("/");

        let file_name = Path::new(path).file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| FileManagerError::InvalidPath("Invalid file name".to_string()))?;

        let entries = adb::list_files(serial, parent_path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        let entry = entries.into_iter()
            .find(|e| e.name == file_name)
            .ok_or_else(|| FileManagerError::FileNotFound(path.to_string()))?;

        // Sanitize path for shell commands
        let safe_path = adb::sanitize_device_path(path)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;

        // Get MIME type (only for files)
        let mime_type = if entry.file_type == "file" {
            let mime_cmd = format!("file -b --mime-type '{}'", safe_path);
            adb::shell(serial, &mime_cmd)
                .unwrap_or_else(|_| "application/octet-stream".to_string())
                .trim()
                .to_string()
        } else {
            "inode/directory".to_string()
        };

        // Get MD5 hash (only for files)
        let md5 = if entry.file_type == "file" {
            let md5_cmd = format!("md5sum '{}' | cut -d' ' -f1", safe_path);
            adb::shell(serial, &md5_cmd)
                .unwrap_or_else(|_| String::new())
                .trim()
                .to_string()
        } else {
            String::new()
        };

        Ok(FileInfo {
            entry,
            mime_type,
            md5,
        })
    }

    /// Search for files matching a pattern in a directory tree (paths sanitized)
    pub fn search_files(serial: &str, base_path: &str, pattern: &str) -> Result<Vec<FileEntry>> {
        // 安全：验证路径和搜索模式 / Security: validate path and search pattern
        let escaped_base = adb::sanitize_device_path(base_path)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;

        // 搜索模式只允许字母数字、点、横线、下划线、空格和 Unicode
        // Search pattern: only allow alphanumeric, dots, dashes, underscores, spaces, Unicode
        for ch in pattern.chars() {
            match ch {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' | ' ' => {}
                c if c as u32 > 127 => {} // 允许 CJK / Allow CJK
                other => {
                    return Err(FileManagerError::InvalidPath(
                        format!("Search pattern contains forbidden character: {:?}", other)
                    ));
                }
            }
        }
        let escaped_pattern = pattern.replace('\'', "'\\''");

        let find_cmd = format!(
            "find '{}' -name '*{}*' -printf '%p\\t%s\\t%TY-%Tm-%Td %TH:%TM:%TS\\t%M\\t%y\\n' 2>/dev/null",
            escaped_base, escaped_pattern
        );

        let output = adb::shell(serial, &find_cmd)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        let mut results = Vec::new();

        for line in output.lines() {
            if line.trim().is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 5 {
                let path = parts[0];
                let size = parts[1].parse::<u64>().unwrap_or(0);
                let modified = parts[2].to_string();
                let permissions = parts[3].to_string();
                let file_type_char = parts[4];

                let file_type = match file_type_char {
                    "d" => "directory",
                    "l" => "link",
                    _ => "file",
                }.to_string();

                let name = Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                results.push(FileEntry {
                    name,
                    path: path.to_string(),
                    file_type,
                    size,
                    modified,
                    permissions,
                });
            }
        }

        // Sort results: directories first, then alphabetically
        results.sort_by(|a, b| {
            match (&a.file_type[..], &b.file_type[..]) {
                ("directory", "directory") => a.path.cmp(&b.path),
                ("directory", _) => std::cmp::Ordering::Less,
                (_, "directory") => std::cmp::Ordering::Greater,
                _ => a.path.cmp(&b.path),
            }
        });

        Ok(results)
    }

    /// Get disk usage for a path in bytes
    pub fn get_disk_usage(serial: &str, path: &str) -> Result<u64> {
        let exists = adb::file_exists(serial, path)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        if !exists {
            return Err(FileManagerError::FileNotFound(path.to_string()));
        }

        // Use 'du -sb' for size in bytes (path sanitized)
        let safe_path = adb::sanitize_device_path(path)
            .map_err(|e| FileManagerError::InvalidPath(e.to_string()))?;
        let du_cmd = format!("du -sb '{}' | cut -f1", safe_path);

        let output = adb::shell(serial, &du_cmd)
            .map_err(|e| FileManagerError::AdbError(e.to_string()))?;

        let size = output.trim()
            .parse::<u64>()
            .map_err(|e| FileManagerError::OperationFailed(format!("Failed to parse disk usage: {}", e)))?;

        Ok(size)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_manager_creation() {
        // Basic compile-time test
        let _ = FileManager;
    }
}
