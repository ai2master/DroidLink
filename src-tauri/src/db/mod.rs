use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use parking_lot::Mutex;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

pub type DbResult<T> = std::result::Result<T, DbError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRecord {
    pub id: i64,
    pub device_serial: String,
    pub contact_id: String,
    pub display_name: String,
    pub phone_numbers: String,
    pub emails: String,
    pub organization: String,
    pub photo_uri: String,
    pub raw_data: String,
    pub hash: String,
    pub last_synced: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: i64,
    pub device_serial: String,
    pub message_id: String,
    pub thread_id: String,
    pub address: String,
    pub contact_name: String,
    pub body: String,
    pub date: String,
    pub date_sent: String,
    pub msg_type: i32,
    pub read: i32,
    pub hash: String,
    pub last_synced: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallLogRecord {
    pub id: i64,
    pub device_serial: String,
    pub call_id: String,
    pub number: String,
    pub contact_name: String,
    pub call_type: i32,
    pub date: String,
    pub duration: i64,
    pub hash: String,
    pub last_synced: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRecord {
    pub id: String,
    pub device_serial: String,
    pub data_type: String,
    pub item_id: Option<String>,
    pub action: String,
    pub snapshot_path: Option<String>,
    pub data_before: Option<String>,
    pub data_after: Option<String>,
    pub source: String,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSyncPair {
    pub id: String,
    pub device_serial: String,
    pub local_path: String,
    pub remote_path: String,
    pub direction: String,
    pub enabled: bool,
    pub last_synced: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSyncEntry {
    pub pair_id: String,
    pub relative_path: String,
    pub local_hash: Option<String>,
    pub remote_hash: Option<String>,
    pub local_modified: Option<String>,
    pub remote_modified: Option<String>,
    pub local_size: Option<i64>,
    pub remote_size: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub device_serial: String,
    pub data_type: String,
    pub last_sync_time: Option<String>,
    pub last_sync_hash: Option<String>,
    pub items_synced: i64,
    pub status: String,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub thread_id: String,
    pub address: String,
    pub contact_name: String,
    pub last_date: String,
    pub message_count: i64,
    pub last_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferJournalEntry {
    pub id: String,
    pub pair_id: String,
    pub device_serial: String,
    pub file_path: String,
    pub direction: String,
    pub status: String,
    pub temp_path: Option<String>,
    pub final_path: String,
    pub file_size: i64,
    pub hash_expected: Option<String>,
    pub hash_actual: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub error_message: Option<String>,
    pub retry_count: i32,
}

pub struct Database {
    conn: Arc<Mutex<Connection>>,
    data_path: PathBuf,
}

impl Database {
    pub fn new(data_path: &Path) -> DbResult<Self> {
        std::fs::create_dir_all(data_path)?;
        let db_path = data_path.join("droidlink.db");
        let conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            data_path: data_path.to_path_buf(),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn data_path(&self) -> &Path {
        &self.data_path
    }

    fn init_schema(&self) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS devices (
                serial TEXT PRIMARY KEY,
                model TEXT,
                manufacturer TEXT,
                android_version TEXT,
                display_name TEXT,
                last_connected TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_serial TEXT NOT NULL,
                contact_id TEXT NOT NULL,
                display_name TEXT DEFAULT '',
                phone_numbers TEXT DEFAULT '[]',
                emails TEXT DEFAULT '[]',
                organization TEXT DEFAULT '',
                photo_uri TEXT DEFAULT '',
                raw_data TEXT DEFAULT '{}',
                hash TEXT DEFAULT '',
                last_synced TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                UNIQUE(device_serial, contact_id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_serial TEXT NOT NULL,
                message_id TEXT NOT NULL,
                thread_id TEXT DEFAULT '',
                address TEXT DEFAULT '',
                contact_name TEXT DEFAULT '',
                body TEXT DEFAULT '',
                date TEXT DEFAULT '',
                date_sent TEXT DEFAULT '',
                msg_type INTEGER DEFAULT 0,
                read INTEGER DEFAULT 0,
                hash TEXT DEFAULT '',
                last_synced TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(device_serial, message_id)
            );

            CREATE TABLE IF NOT EXISTS call_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_serial TEXT NOT NULL,
                call_id TEXT NOT NULL,
                number TEXT DEFAULT '',
                contact_name TEXT DEFAULT '',
                call_type INTEGER DEFAULT 0,
                date TEXT DEFAULT '',
                duration INTEGER DEFAULT 0,
                hash TEXT DEFAULT '',
                last_synced TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(device_serial, call_id)
            );

            CREATE TABLE IF NOT EXISTS versions (
                id TEXT PRIMARY KEY,
                device_serial TEXT NOT NULL,
                data_type TEXT NOT NULL,
                item_id TEXT,
                action TEXT NOT NULL,
                snapshot_path TEXT,
                data_before TEXT,
                data_after TEXT,
                source TEXT NOT NULL,
                description TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_versions_type ON versions(data_type, created_at);
            CREATE INDEX IF NOT EXISTS idx_versions_item ON versions(data_type, item_id, created_at);

            CREATE TABLE IF NOT EXISTS folder_sync_pairs (
                id TEXT PRIMARY KEY,
                device_serial TEXT NOT NULL,
                local_path TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                direction TEXT NOT NULL DEFAULT 'bidirectional',
                enabled INTEGER DEFAULT 1,
                last_synced TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS folder_sync_index (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pair_id TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                local_hash TEXT,
                remote_hash TEXT,
                local_modified TEXT,
                remote_modified TEXT,
                local_size INTEGER,
                remote_size INTEGER,
                status TEXT DEFAULT 'synced',
                last_checked TEXT,
                FOREIGN KEY (pair_id) REFERENCES folder_sync_pairs(id) ON DELETE CASCADE,
                UNIQUE(pair_id, relative_path)
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                device_serial TEXT NOT NULL,
                data_type TEXT NOT NULL,
                last_sync_time TEXT,
                last_sync_hash TEXT,
                items_synced INTEGER DEFAULT 0,
                status TEXT DEFAULT 'idle',
                error_message TEXT,
                PRIMARY KEY (device_serial, data_type)
            );

            CREATE TABLE IF NOT EXISTS transfer_journal (
                id TEXT PRIMARY KEY,
                pair_id TEXT NOT NULL,
                device_serial TEXT NOT NULL,
                file_path TEXT NOT NULL,
                direction TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                temp_path TEXT,
                final_path TEXT NOT NULL,
                file_size INTEGER NOT NULL DEFAULT 0,
                hash_expected TEXT,
                hash_actual TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                error_message TEXT,
                retry_count INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_transfer_journal_pair ON transfer_journal(pair_id, status);
            CREATE INDEX IF NOT EXISTS idx_transfer_journal_serial ON transfer_journal(device_serial, status);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            INSERT OR IGNORE INTO settings (key, value) VALUES
                ('sync_contacts', 'true'),
                ('sync_messages', 'true'),
                ('sync_call_logs', 'true'),
                ('auto_sync', 'false'),
                ('version_history_days', '90'),
                ('clipboard_sync', 'true'),
                ('scrcpy_max_size', '1920'),
                ('scrcpy_bit_rate', '8000000'),
                ('language', 'zh-CN'),
                ('adb_source', 'bundled'),
                ('adb_custom_path', ''),
                ('scrcpy_source', 'system'),
                ('scrcpy_custom_path', '');
            ",
        )?;
        Ok(())
    }

    // === Device methods ===

    pub fn upsert_device(&self, serial: &str, model: &str, manufacturer: &str, android_version: &str, display_name: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO devices (serial, model, manufacturer, android_version, display_name, last_connected)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
             ON CONFLICT(serial) DO UPDATE SET
               model = excluded.model, manufacturer = excluded.manufacturer,
               android_version = excluded.android_version, display_name = excluded.display_name,
               last_connected = datetime('now')",
            params![serial, model, manufacturer, android_version, display_name],
        )?;
        Ok(())
    }

    pub fn get_all_devices(&self) -> DbResult<Vec<serde_json::Value>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT serial, model, manufacturer, android_version, display_name, last_connected FROM devices ORDER BY last_connected DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(serde_json::json!({
                "serial": row.get::<_, String>(0)?,
                "model": row.get::<_, String>(1).unwrap_or_default(),
                "manufacturer": row.get::<_, String>(2).unwrap_or_default(),
                "androidVersion": row.get::<_, String>(3).unwrap_or_default(),
                "displayName": row.get::<_, String>(4).unwrap_or_default(),
                "lastConnected": row.get::<_, String>(5).unwrap_or_default(),
            }))
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    // === Contact methods ===

    pub fn upsert_contact(&self, serial: &str, contact_id: &str, display_name: &str, phone_numbers: &str,
                          emails: &str, organization: &str, raw_data: &str, hash: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO contacts (device_serial, contact_id, display_name, phone_numbers, emails, organization, raw_data, hash, last_synced, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'), datetime('now'))
             ON CONFLICT(device_serial, contact_id) DO UPDATE SET
               display_name=excluded.display_name, phone_numbers=excluded.phone_numbers,
               emails=excluded.emails, organization=excluded.organization,
               raw_data=excluded.raw_data, hash=excluded.hash,
               last_synced=datetime('now'), updated_at=datetime('now')",
            params![serial, contact_id, display_name, phone_numbers, emails, organization, raw_data, hash],
        )?;
        Ok(())
    }

    pub fn get_contacts(&self, serial: &str) -> DbResult<Vec<ContactRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, device_serial, contact_id, display_name, phone_numbers, emails, organization, photo_uri, raw_data, hash, last_synced, created_at, updated_at
             FROM contacts WHERE device_serial = ?1 ORDER BY display_name"
        )?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok(ContactRecord {
                id: row.get(0)?, device_serial: row.get(1)?, contact_id: row.get(2)?,
                display_name: row.get(3)?, phone_numbers: row.get(4)?, emails: row.get(5)?,
                organization: row.get(6)?, photo_uri: row.get(7)?, raw_data: row.get(8)?,
                hash: row.get(9)?, last_synced: row.get::<_, String>(10).unwrap_or_default(),
                created_at: row.get(11)?, updated_at: row.get(12)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_contact_hashes(&self, serial: &str) -> DbResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT contact_id, hash FROM contacts WHERE device_serial = ?1")?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_contact(&self, serial: &str, contact_id: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM contacts WHERE device_serial = ?1 AND contact_id = ?2", params![serial, contact_id])?;
        Ok(())
    }

    // === Message methods ===

    pub fn upsert_message(&self, serial: &str, message_id: &str, thread_id: &str, address: &str,
                          contact_name: &str, body: &str, date: &str, date_sent: &str,
                          msg_type: i32, read: i32, hash: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO messages (device_serial, message_id, thread_id, address, contact_name, body, date, date_sent, msg_type, read, hash, last_synced)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11, datetime('now'))
             ON CONFLICT(device_serial, message_id) DO UPDATE SET
               contact_name=excluded.contact_name, read=excluded.read, hash=excluded.hash, last_synced=datetime('now')",
            params![serial, message_id, thread_id, address, contact_name, body, date, date_sent, msg_type, read, hash],
        )?;
        Ok(())
    }

    pub fn get_messages(&self, serial: &str, thread_id: Option<&str>) -> DbResult<Vec<MessageRecord>> {
        let conn = self.conn.lock();
        let (sql, p): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(tid) = thread_id {
            ("SELECT id, device_serial, message_id, thread_id, address, contact_name, body, date, date_sent, msg_type, read, hash, last_synced, created_at FROM messages WHERE device_serial = ?1 AND thread_id = ?2 ORDER BY date DESC",
             vec![Box::new(serial.to_string()), Box::new(tid.to_string())])
        } else {
            ("SELECT id, device_serial, message_id, thread_id, address, contact_name, body, date, date_sent, msg_type, read, hash, last_synced, created_at FROM messages WHERE device_serial = ?1 ORDER BY date DESC",
             vec![Box::new(serial.to_string())])
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(p.iter()), |row| {
            Ok(MessageRecord {
                id: row.get(0)?, device_serial: row.get(1)?, message_id: row.get(2)?,
                thread_id: row.get(3)?, address: row.get(4)?, contact_name: row.get(5)?,
                body: row.get(6)?, date: row.get(7)?, date_sent: row.get(8)?,
                msg_type: row.get(9)?, read: row.get(10)?, hash: row.get(11)?,
                last_synced: row.get::<_, String>(12).unwrap_or_default(), created_at: row.get(13)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_conversations(&self, serial: &str) -> DbResult<Vec<Conversation>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT thread_id, address, contact_name, MAX(date) as last_date, COUNT(*) as cnt,
                    (SELECT body FROM messages m2 WHERE m2.thread_id = m.thread_id AND m2.device_serial = m.device_serial ORDER BY date DESC LIMIT 1) as last_msg
             FROM messages m WHERE device_serial = ?1 GROUP BY thread_id ORDER BY last_date DESC"
        )?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok(Conversation {
                thread_id: row.get(0)?, address: row.get(1)?, contact_name: row.get(2)?,
                last_date: row.get(3)?, message_count: row.get(4)?, last_message: row.get(5)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_message(&self, serial: &str, message_id: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM messages WHERE device_serial = ?1 AND message_id = ?2", params![serial, message_id])?;
        Ok(())
    }

    pub fn get_message_hashes(&self, serial: &str) -> DbResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT message_id, hash FROM messages WHERE device_serial = ?1")?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    // === Call Log methods ===

    pub fn upsert_call_log(&self, serial: &str, call_id: &str, number: &str, contact_name: &str,
                           call_type: i32, date: &str, duration: i64, hash: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO call_logs (device_serial, call_id, number, contact_name, call_type, date, duration, hash, last_synced)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8, datetime('now'))
             ON CONFLICT(device_serial, call_id) DO UPDATE SET
               contact_name=excluded.contact_name, hash=excluded.hash, last_synced=datetime('now')",
            params![serial, call_id, number, contact_name, call_type, date, duration, hash],
        )?;
        Ok(())
    }

    pub fn get_call_logs(&self, serial: &str) -> DbResult<Vec<CallLogRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, device_serial, call_id, number, contact_name, call_type, date, duration, hash, last_synced, created_at
             FROM call_logs WHERE device_serial = ?1 ORDER BY date DESC"
        )?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok(CallLogRecord {
                id: row.get(0)?, device_serial: row.get(1)?, call_id: row.get(2)?,
                number: row.get(3)?, contact_name: row.get(4)?, call_type: row.get(5)?,
                date: row.get(6)?, duration: row.get(7)?, hash: row.get(8)?,
                last_synced: row.get::<_, String>(9).unwrap_or_default(), created_at: row.get(10)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_call_log(&self, serial: &str, call_id: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM call_logs WHERE device_serial = ?1 AND call_id = ?2", params![serial, call_id])?;
        Ok(())
    }

    pub fn get_call_log_hashes(&self, serial: &str) -> DbResult<Vec<(String, String)>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT call_id, hash FROM call_logs WHERE device_serial = ?1")?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    // === Version methods ===

    pub fn insert_version(&self, v: &VersionRecord) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO versions (id, device_serial, data_type, item_id, action, snapshot_path, data_before, data_after, source, description)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![v.id, v.device_serial, v.data_type, v.item_id, v.action, v.snapshot_path, v.data_before, v.data_after, v.source, v.description],
        )?;
        Ok(())
    }

    pub fn get_version_history(&self, data_type: &str, item_id: Option<&str>, limit: i64) -> DbResult<Vec<VersionRecord>> {
        let conn = self.conn.lock();
        let (sql, p): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(iid) = item_id {
            ("SELECT id, device_serial, data_type, item_id, action, snapshot_path, data_before, data_after, source, description, created_at FROM versions WHERE data_type = ?1 AND item_id = ?2 ORDER BY created_at DESC LIMIT ?3",
             vec![Box::new(data_type.to_string()), Box::new(iid.to_string()), Box::new(limit)])
        } else {
            ("SELECT id, device_serial, data_type, item_id, action, snapshot_path, data_before, data_after, source, description, created_at FROM versions WHERE data_type = ?1 ORDER BY created_at DESC LIMIT ?2",
             vec![Box::new(data_type.to_string()), Box::new(limit)])
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(p.iter()), |row| {
            Ok(VersionRecord {
                id: row.get(0)?, device_serial: row.get(1)?, data_type: row.get(2)?,
                item_id: row.get(3)?, action: row.get(4)?, snapshot_path: row.get(5)?,
                data_before: row.get(6)?, data_after: row.get(7)?, source: row.get(8)?,
                description: row.get(9)?, created_at: row.get(10)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_version(&self, version_id: &str) -> DbResult<Option<VersionRecord>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, device_serial, data_type, item_id, action, snapshot_path, data_before, data_after, source, description, created_at FROM versions WHERE id = ?1"
        )?;
        let mut rows = stmt.query_map(params![version_id], |row| {
            Ok(VersionRecord {
                id: row.get(0)?, device_serial: row.get(1)?, data_type: row.get(2)?,
                item_id: row.get(3)?, action: row.get(4)?, snapshot_path: row.get(5)?,
                data_before: row.get(6)?, data_after: row.get(7)?, source: row.get(8)?,
                description: row.get(9)?, created_at: row.get(10)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn delete_versions_before(&self, date: &str) -> DbResult<usize> {
        let conn = self.conn.lock();
        let count = conn.execute("DELETE FROM versions WHERE created_at < ?1", params![date])?;
        Ok(count)
    }

    // === Sync State methods ===

    pub fn get_sync_state(&self, serial: &str, data_type: &str) -> DbResult<Option<SyncState>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT device_serial, data_type, last_sync_time, last_sync_hash, items_synced, status, error_message FROM sync_state WHERE device_serial = ?1 AND data_type = ?2"
        )?;
        let mut rows = stmt.query_map(params![serial, data_type], |row| {
            Ok(SyncState {
                device_serial: row.get(0)?, data_type: row.get(1)?,
                last_sync_time: row.get(2)?, last_sync_hash: row.get(3)?,
                items_synced: row.get(4)?, status: row.get(5)?, error_message: row.get(6)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn update_sync_state(&self, serial: &str, data_type: &str, status: &str, items: i64, error: Option<&str>) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sync_state (device_serial, data_type, last_sync_time, items_synced, status, error_message)
             VALUES (?1, ?2, datetime('now'), ?3, ?4, ?5)
             ON CONFLICT(device_serial, data_type) DO UPDATE SET
               last_sync_time=datetime('now'), items_synced=excluded.items_synced,
               status=excluded.status, error_message=excluded.error_message",
            params![serial, data_type, items, status, error],
        )?;
        Ok(())
    }

    // === Folder Sync methods ===

    pub fn get_folder_sync_pairs(&self, serial: Option<&str>) -> DbResult<Vec<FolderSyncPair>> {
        let conn = self.conn.lock();
        let (sql, p): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(s) = serial {
            ("SELECT id, device_serial, local_path, remote_path, direction, enabled, last_synced, created_at FROM folder_sync_pairs WHERE device_serial = ?1",
             vec![Box::new(s.to_string())])
        } else {
            ("SELECT id, device_serial, local_path, remote_path, direction, enabled, last_synced, created_at FROM folder_sync_pairs", vec![])
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(p.iter()), |row| {
            Ok(FolderSyncPair {
                id: row.get(0)?, device_serial: row.get(1)?, local_path: row.get(2)?,
                remote_path: row.get(3)?, direction: row.get(4)?,
                enabled: row.get::<_, i32>(5)? != 0, last_synced: row.get(6)?, created_at: row.get(7)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn add_folder_sync_pair(&self, pair: &FolderSyncPair) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO folder_sync_pairs (id, device_serial, local_path, remote_path, direction) VALUES (?1,?2,?3,?4,?5)",
            params![pair.id, pair.device_serial, pair.local_path, pair.remote_path, pair.direction],
        )?;
        Ok(())
    }

    pub fn remove_folder_sync_pair(&self, pair_id: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM folder_sync_pairs WHERE id = ?1", params![pair_id])?;
        Ok(())
    }

    pub fn get_folder_sync_index(&self, pair_id: &str) -> DbResult<Vec<FolderSyncEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT pair_id, relative_path, local_hash, remote_hash, local_modified, remote_modified, local_size, remote_size, status FROM folder_sync_index WHERE pair_id = ?1"
        )?;
        let rows = stmt.query_map(params![pair_id], |row| {
            Ok(FolderSyncEntry {
                pair_id: row.get(0)?, relative_path: row.get(1)?,
                local_hash: row.get(2)?, remote_hash: row.get(3)?,
                local_modified: row.get(4)?, remote_modified: row.get(5)?,
                local_size: row.get(6)?, remote_size: row.get(7)?, status: row.get(8)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn upsert_folder_sync_entry(&self, e: &FolderSyncEntry) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO folder_sync_index (pair_id, relative_path, local_hash, remote_hash, local_modified, remote_modified, local_size, remote_size, status, last_checked)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9, datetime('now'))
             ON CONFLICT(pair_id, relative_path) DO UPDATE SET
               local_hash=excluded.local_hash, remote_hash=excluded.remote_hash,
               local_modified=excluded.local_modified, remote_modified=excluded.remote_modified,
               local_size=excluded.local_size, remote_size=excluded.remote_size,
               status=excluded.status, last_checked=datetime('now')",
            params![e.pair_id, e.relative_path, e.local_hash, e.remote_hash, e.local_modified, e.remote_modified, e.local_size, e.remote_size, e.status],
        )?;
        Ok(())
    }

    // === Settings methods ===

    pub fn get_setting(&self, key: &str) -> DbResult<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> DbResult<std::collections::HashMap<String, String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows.into_iter().collect())
    }

    // === Transfer Journal methods ===

    pub fn create_transfer_entry(&self, entry: &TransferJournalEntry) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO transfer_journal (id, pair_id, device_serial, file_path, direction, status, temp_path, final_path, file_size, hash_expected, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,datetime('now'),datetime('now'))",
            params![entry.id, entry.pair_id, entry.device_serial, entry.file_path, entry.direction, entry.status, entry.temp_path, entry.final_path, entry.file_size, entry.hash_expected],
        )?;
        Ok(())
    }

    pub fn update_transfer_status(&self, id: &str, status: &str, error: Option<&str>) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE transfer_journal SET status=?2, error_message=?3, updated_at=datetime('now') WHERE id=?1",
            params![id, status, error],
        )?;
        Ok(())
    }

    pub fn update_transfer_hash(&self, id: &str, hash_actual: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE transfer_journal SET hash_actual=?2, updated_at=datetime('now') WHERE id=?1",
            params![id, hash_actual],
        )?;
        Ok(())
    }

    pub fn increment_transfer_retry(&self, id: &str) -> DbResult<()> {
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE transfer_journal SET retry_count=retry_count+1, updated_at=datetime('now') WHERE id=?1",
            params![id],
        )?;
        Ok(())
    }

    pub fn get_pending_transfers(&self, pair_id: &str) -> DbResult<Vec<TransferJournalEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, pair_id, device_serial, file_path, direction, status, temp_path, final_path, file_size, hash_expected, hash_actual, created_at, updated_at, error_message, retry_count
             FROM transfer_journal WHERE pair_id=?1 AND status IN ('pending','in_progress','failed') AND retry_count < 3
             ORDER BY created_at"
        )?;
        let rows = stmt.query_map(params![pair_id], |row| {
            Ok(TransferJournalEntry {
                id: row.get(0)?, pair_id: row.get(1)?, device_serial: row.get(2)?,
                file_path: row.get(3)?, direction: row.get(4)?, status: row.get(5)?,
                temp_path: row.get(6)?, final_path: row.get(7)?, file_size: row.get(8)?,
                hash_expected: row.get(9)?, hash_actual: row.get(10)?, created_at: row.get(11)?,
                updated_at: row.get(12)?, error_message: row.get(13)?, retry_count: row.get(14)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn get_failed_transfers_for_device(&self, serial: &str) -> DbResult<Vec<TransferJournalEntry>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, pair_id, device_serial, file_path, direction, status, temp_path, final_path, file_size, hash_expected, hash_actual, created_at, updated_at, error_message, retry_count
             FROM transfer_journal WHERE device_serial=?1 AND status IN ('pending','in_progress','failed') AND retry_count < 3
             ORDER BY created_at"
        )?;
        let rows = stmt.query_map(params![serial], |row| {
            Ok(TransferJournalEntry {
                id: row.get(0)?, pair_id: row.get(1)?, device_serial: row.get(2)?,
                file_path: row.get(3)?, direction: row.get(4)?, status: row.get(5)?,
                temp_path: row.get(6)?, final_path: row.get(7)?, file_size: row.get(8)?,
                hash_expected: row.get(9)?, hash_actual: row.get(10)?, created_at: row.get(11)?,
                updated_at: row.get(12)?, error_message: row.get(13)?, retry_count: row.get(14)?,
            })
        })?.collect::<SqlResult<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn delete_completed_transfers(&self, days: u32) -> DbResult<usize> {
        let conn = self.conn.lock();
        let count = conn.execute(
            "DELETE FROM transfer_journal WHERE status='completed' AND updated_at < datetime('now', ?1)",
            params![format!("-{} days", days)],
        )?;
        Ok(count)
    }
}
