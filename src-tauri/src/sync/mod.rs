use crate::adb;
use crate::db::{Database, Contact, Message, CallLog};
use crossbeam_channel::Sender;
use log::{debug, error, info, warn};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use xxhash_rust::xxh3::xxh3_64;

const POLL_INTERVAL_SECS: u64 = 5;
const TEMP_DIR: &str = "/data/local/tmp";

#[derive(Error, Debug)]
pub enum SyncError {
    #[error("ADB error: {0}")]
    Adb(String),

    #[error("Database error: {0}")]
    Database(String),

    #[error("Parse error: {0}")]
    Parse(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Device not connected: {0}")]
    DeviceNotConnected(String),

    #[error("Sync already running for device: {0}")]
    SyncAlreadyRunning(String),
}

pub type Result<T> = std::result::Result<T, SyncError>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SyncEvent {
    Started {
        serial: String,
        data_type: String
    },
    Progress {
        serial: String,
        data_type: String,
        current: u64,
        total: u64
    },
    Completed {
        serial: String,
        data_type: String,
        items_synced: u64
    },
    Error {
        serial: String,
        data_type: String,
        message: String
    },
}

#[derive(Debug)]
struct SyncHandle {
    running: Arc<AtomicBool>,
}

pub struct SyncEngine {
    db: Arc<Database>,
    active_syncs: Arc<Mutex<HashMap<String, SyncHandle>>>,
    event_tx: Arc<Mutex<Option<Sender<SyncEvent>>>>,
}

#[derive(Debug, Clone, Deserialize)]
struct ContactWithHash {
    id: String,
    display_name: String,
    phone_numbers: Vec<String>,
    emails: Vec<String>,
    photo_uri: Option<String>,
    hash: String,
}

#[derive(Debug, Clone, Deserialize)]
struct MessageWithHash {
    id: String,
    thread_id: String,
    address: String,
    body: String,
    date: i64,
    date_sent: i64,
    type_: i32,
    read: bool,
    hash: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CallLogWithHash {
    id: String,
    number: String,
    cached_name: Option<String>,
    type_: i32,
    date: i64,
    duration: i64,
    hash: String,
}

impl SyncEngine {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            db,
            active_syncs: Arc::new(Mutex::new(HashMap::new())),
            event_tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_event_sender(&self, tx: Sender<SyncEvent>) {
        *self.event_tx.lock() = Some(tx);
    }

    fn send_event(&self, event: SyncEvent) {
        if let Some(tx) = self.event_tx.lock().as_ref() {
            let _ = tx.send(event);
        }
    }

    /// Check if companion app is installed (pure ADB, no TCP)
    fn check_companion(serial: &str) -> bool {
        match adb::shell(serial, "pm list packages com.droidlink.companion 2>/dev/null") {
            Ok(output) => output.contains("com.droidlink.companion"),
            Err(_) => false,
        }
    }

    pub fn start_sync(&self, serial: &str) {
        let mut active = self.active_syncs.lock();

        if active.contains_key(serial) {
            return;
        }

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();
        let serial = serial.to_string();
        let db = self.db.clone();
        let event_tx = self.event_tx.clone();

        std::thread::spawn(move || {
            info!("Starting auto-sync for device: {} (pure ADB)", serial);

            let has_companion = Self::check_companion(&serial);
            if has_companion {
                info!("Companion app detected for {}", serial);
            } else {
                info!("No companion app for {}, using content provider fallback", serial);
            }

            while running_clone.load(Ordering::Relaxed) {
                // Check if data has changed via companion broadcast + temp file
                let should_sync = if has_companion {
                    Self::check_changes_via_adb(&serial).unwrap_or(true)
                } else {
                    true // Always sync periodically without companion
                };

                if should_sync {
                    let engine = SyncEngine {
                        db: db.clone(),
                        active_syncs: Arc::new(Mutex::new(HashMap::new())),
                        event_tx: event_tx.clone(),
                    };

                    for data_type in &["contacts", "messages", "call_logs"] {
                        if !running_clone.load(Ordering::Relaxed) {
                            break;
                        }

                        let result = match *data_type {
                            "contacts" => engine.sync_contacts_blocking(&serial, has_companion),
                            "messages" => engine.sync_messages_blocking(&serial, has_companion),
                            "call_logs" => engine.sync_call_logs_blocking(&serial, has_companion),
                            _ => continue,
                        };

                        if let Err(e) = result {
                            error!("Sync error for {} on {}: {}", data_type, serial, e);
                        }
                    }
                }

                // Wait before next poll
                for _ in 0..(POLL_INTERVAL_SECS * 10) {
                    if !running_clone.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }

            info!("Stopped auto-sync for device: {}", serial);
        });

        active.insert(
            serial.to_string(),
            SyncHandle { running },
        );
    }

    pub fn stop_sync(&self, serial: &str) {
        let mut active = self.active_syncs.lock();
        if let Some(handle) = active.remove(serial) {
            handle.running.store(false, Ordering::Relaxed);
        }
    }

    pub fn stop_all(&self) {
        let serials: Vec<String> = self.active_syncs.lock().keys().cloned().collect();
        for serial in serials {
            self.stop_sync(&serial);
        }
    }

    pub fn trigger_sync(&self, serial: &str, data_type: Option<&str>) {
        let serial = serial.to_string();
        let db = self.db.clone();
        let event_tx = self.event_tx.clone();
        let data_type = data_type.map(|s| s.to_string());
        let has_companion = Self::check_companion(&serial);

        std::thread::spawn(move || {
            let engine = SyncEngine {
                db,
                active_syncs: Arc::new(Mutex::new(HashMap::new())),
                event_tx,
            };

            match data_type.as_deref() {
                Some("contacts") => { let _ = engine.sync_contacts_blocking(&serial, has_companion); }
                Some("messages") => { let _ = engine.sync_messages_blocking(&serial, has_companion); }
                Some("call_logs") => { let _ = engine.sync_call_logs_blocking(&serial, has_companion); }
                None => {
                    let _ = engine.sync_contacts_blocking(&serial, has_companion);
                    let _ = engine.sync_messages_blocking(&serial, has_companion);
                    let _ = engine.sync_call_logs_blocking(&serial, has_companion);
                }
                Some(unknown) => {
                    warn!("Unknown data type: {}", unknown);
                }
            }
        });
    }

    fn sync_contacts_blocking(&self, serial: &str, has_companion: bool) -> Result<u64> {
        self.send_event(SyncEvent::Started {
            serial: serial.to_string(),
            data_type: "contacts".to_string(),
        });

        let result = self.sync_contacts_impl(serial, has_companion);

        match result {
            Ok(count) => {
                self.send_event(SyncEvent::Completed {
                    serial: serial.to_string(),
                    data_type: "contacts".to_string(),
                    items_synced: count,
                });
                Ok(count)
            }
            Err(e) => {
                self.send_event(SyncEvent::Error {
                    serial: serial.to_string(),
                    data_type: "contacts".to_string(),
                    message: e.to_string(),
                });
                Err(e)
            }
        }
    }

    fn sync_contacts_impl(&self, serial: &str, has_companion: bool) -> Result<u64> {
        // Try companion dump (adb broadcast + adb pull), fall back to content provider
        let contacts = if has_companion {
            match Self::fetch_contacts_via_companion_adb(serial) {
                Ok(contacts) => contacts,
                Err(e) => {
                    debug!("Companion ADB dump failed ({}), falling back to content provider", e);
                    Self::fetch_contacts_via_content(serial)?
                }
            }
        } else {
            Self::fetch_contacts_via_content(serial)?
        };

        let total = contacts.len() as u64;
        let mut synced = 0u64;

        let existing_contacts = self.db.get_contacts(serial)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        let mut existing_map: HashMap<String, Contact> = existing_contacts
            .into_iter()
            .map(|c| (c.id.clone(), c))
            .collect();

        for (idx, contact_with_hash) in contacts.iter().enumerate() {
            let needs_update = if let Some(existing) = existing_map.get(&contact_with_hash.id) {
                let existing_hash = Self::compute_contact_hash(existing);
                existing_hash != contact_with_hash.hash
            } else {
                true
            };

            if needs_update {
                let contact = Contact {
                    id: contact_with_hash.id.clone(),
                    device_serial: serial.to_string(),
                    display_name: contact_with_hash.display_name.clone(),
                    phone_numbers: serde_json::to_string(&contact_with_hash.phone_numbers)
                        .unwrap_or_default(),
                    emails: serde_json::to_string(&contact_with_hash.emails)
                        .unwrap_or_default(),
                    photo_uri: contact_with_hash.photo_uri.clone(),
                    last_modified: chrono::Utc::now().timestamp(),
                };

                self.db.save_contact(&contact)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                synced += 1;
            }

            existing_map.remove(&contact_with_hash.id);

            if (idx + 1) % 10 == 0 || idx + 1 == contacts.len() {
                self.send_event(SyncEvent::Progress {
                    serial: serial.to_string(),
                    data_type: "contacts".to_string(),
                    current: (idx + 1) as u64,
                    total,
                });
            }
        }

        for (contact_id, _) in existing_map {
            self.db.delete_contact(&contact_id)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }

        info!("Synced {} contacts for device {}", synced, serial);
        Ok(synced)
    }

    fn sync_messages_blocking(&self, serial: &str, has_companion: bool) -> Result<u64> {
        self.send_event(SyncEvent::Started {
            serial: serial.to_string(),
            data_type: "messages".to_string(),
        });

        let result = self.sync_messages_impl(serial, has_companion);

        match result {
            Ok(count) => {
                self.send_event(SyncEvent::Completed {
                    serial: serial.to_string(),
                    data_type: "messages".to_string(),
                    items_synced: count,
                });
                Ok(count)
            }
            Err(e) => {
                self.send_event(SyncEvent::Error {
                    serial: serial.to_string(),
                    data_type: "messages".to_string(),
                    message: e.to_string(),
                });
                Err(e)
            }
        }
    }

    fn sync_messages_impl(&self, serial: &str, has_companion: bool) -> Result<u64> {
        let messages = if has_companion {
            match Self::fetch_messages_via_companion_adb(serial) {
                Ok(messages) => messages,
                Err(e) => {
                    debug!("Companion ADB dump failed ({}), falling back to content provider", e);
                    Self::fetch_messages_via_content(serial)?
                }
            }
        } else {
            Self::fetch_messages_via_content(serial)?
        };

        let total = messages.len() as u64;
        let mut synced = 0u64;

        let existing_messages = self.db.get_messages(serial)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        let mut existing_map: HashMap<String, Message> = existing_messages
            .into_iter()
            .map(|m| (m.id.clone(), m))
            .collect();

        for (idx, msg_with_hash) in messages.iter().enumerate() {
            let needs_update = if let Some(existing) = existing_map.get(&msg_with_hash.id) {
                let existing_hash = Self::compute_message_hash(existing);
                existing_hash != msg_with_hash.hash
            } else {
                true
            };

            if needs_update {
                let message = Message {
                    id: msg_with_hash.id.clone(),
                    device_serial: serial.to_string(),
                    thread_id: msg_with_hash.thread_id.clone(),
                    address: msg_with_hash.address.clone(),
                    body: msg_with_hash.body.clone(),
                    date: msg_with_hash.date,
                    date_sent: msg_with_hash.date_sent,
                    type_: msg_with_hash.type_,
                    read: msg_with_hash.read,
                    last_modified: chrono::Utc::now().timestamp(),
                };

                self.db.save_message(&message)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                synced += 1;
            }

            existing_map.remove(&msg_with_hash.id);

            if (idx + 1) % 50 == 0 || idx + 1 == messages.len() {
                self.send_event(SyncEvent::Progress {
                    serial: serial.to_string(),
                    data_type: "messages".to_string(),
                    current: (idx + 1) as u64,
                    total,
                });
            }
        }

        for (msg_id, _) in existing_map {
            self.db.delete_message(&msg_id)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }

        info!("Synced {} messages for device {}", synced, serial);
        Ok(synced)
    }

    fn sync_call_logs_blocking(&self, serial: &str, has_companion: bool) -> Result<u64> {
        self.send_event(SyncEvent::Started {
            serial: serial.to_string(),
            data_type: "call_logs".to_string(),
        });

        let result = self.sync_call_logs_impl(serial, has_companion);

        match result {
            Ok(count) => {
                self.send_event(SyncEvent::Completed {
                    serial: serial.to_string(),
                    data_type: "call_logs".to_string(),
                    items_synced: count,
                });
                Ok(count)
            }
            Err(e) => {
                self.send_event(SyncEvent::Error {
                    serial: serial.to_string(),
                    data_type: "call_logs".to_string(),
                    message: e.to_string(),
                });
                Err(e)
            }
        }
    }

    fn sync_call_logs_impl(&self, serial: &str, has_companion: bool) -> Result<u64> {
        let call_logs = if has_companion {
            match Self::fetch_call_logs_via_companion_adb(serial) {
                Ok(logs) => logs,
                Err(e) => {
                    debug!("Companion ADB dump failed ({}), falling back to content provider", e);
                    Self::fetch_call_logs_via_content(serial)?
                }
            }
        } else {
            Self::fetch_call_logs_via_content(serial)?
        };

        let total = call_logs.len() as u64;
        let mut synced = 0u64;

        let existing_logs = self.db.get_call_logs(serial)
            .map_err(|e| SyncError::Database(e.to_string()))?;

        let mut existing_map: HashMap<String, CallLog> = existing_logs
            .into_iter()
            .map(|c| (c.id.clone(), c))
            .collect();

        for (idx, log_with_hash) in call_logs.iter().enumerate() {
            let needs_update = if let Some(existing) = existing_map.get(&log_with_hash.id) {
                let existing_hash = Self::compute_call_log_hash(existing);
                existing_hash != log_with_hash.hash
            } else {
                true
            };

            if needs_update {
                let call_log = CallLog {
                    id: log_with_hash.id.clone(),
                    device_serial: serial.to_string(),
                    number: log_with_hash.number.clone(),
                    cached_name: log_with_hash.cached_name.clone(),
                    type_: log_with_hash.type_,
                    date: log_with_hash.date,
                    duration: log_with_hash.duration,
                    last_modified: chrono::Utc::now().timestamp(),
                };

                self.db.save_call_log(&call_log)
                    .map_err(|e| SyncError::Database(e.to_string()))?;
                synced += 1;
            }

            existing_map.remove(&log_with_hash.id);

            if (idx + 1) % 50 == 0 || idx + 1 == call_logs.len() {
                self.send_event(SyncEvent::Progress {
                    serial: serial.to_string(),
                    data_type: "call_logs".to_string(),
                    current: (idx + 1) as u64,
                    total,
                });
            }
        }

        for (log_id, _) in existing_map {
            self.db.delete_call_log(&log_id)
                .map_err(|e| SyncError::Database(e.to_string()))?;
        }

        info!("Synced {} call logs for device {}", synced, serial);
        Ok(synced)
    }

    // ========== Companion App via Pure ADB ==========
    // Pattern: adb broadcast -> companion writes JSON to temp file -> adb pull

    fn check_changes_via_adb(serial: &str) -> Result<bool> {
        let device_path = format!("{}/{}", TEMP_DIR, ".droidlink_changes.json");
        let cmd = format!(
            "am broadcast -a com.droidlink.EXPORT_CHANGES \
             --es output_path '{}' \
             -n com.droidlink.companion/.data.DataExportReceiver 2>/dev/null",
            device_path
        );
        let _ = adb::shell(serial, &cmd).map_err(|e| SyncError::Adb(e.to_string()))?;

        std::thread::sleep(Duration::from_millis(300));

        // Read result directly via adb shell cat
        let content = adb::shell(serial, &format!("cat '{}' 2>/dev/null", device_path))
            .map_err(|e| SyncError::Adb(e.to_string()))?;
        let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", device_path));

        if content.trim().is_empty() {
            return Ok(true); // Assume changes if empty
        }

        if let Ok(changes) = serde_json::from_str::<HashMap<String, u64>>(content.trim()) {
            let total_changes: u64 = changes.values().sum();
            Ok(total_changes > 0)
        } else {
            Ok(true)
        }
    }

    fn fetch_via_companion_adb(serial: &str, action: &str, data_type: &str) -> Result<String> {
        let device_path = format!("{}/{}", TEMP_DIR, format!(".droidlink_{}.json", data_type));
        let cmd = format!(
            "am broadcast -a {} \
             --es output_path '{}' \
             -n com.droidlink.companion/.data.DataExportReceiver 2>/dev/null",
            action, device_path
        );
        adb::shell(serial, &cmd).map_err(|e| SyncError::Adb(e.to_string()))?;

        // Wait for companion to write the file
        std::thread::sleep(Duration::from_millis(500));

        // Pull via adb (pure USB)
        let temp_dir = std::env::temp_dir();
        let local_path = temp_dir.join(format!(".droidlink_{}.json", data_type));
        adb::pull(serial, &device_path, &local_path.to_string_lossy())
            .map_err(|e| SyncError::Adb(e.to_string()))?;

        let content = std::fs::read_to_string(&local_path)?;

        // Clean up
        let _ = std::fs::remove_file(&local_path);
        let _ = adb::shell(serial, &format!("rm -f '{}' 2>/dev/null", device_path));

        Ok(content)
    }

    fn fetch_contacts_via_companion_adb(serial: &str) -> Result<Vec<ContactWithHash>> {
        let content = Self::fetch_via_companion_adb(serial, "com.droidlink.EXPORT_CONTACTS", "contacts")?;
        serde_json::from_str(&content).map_err(|e| SyncError::Parse(e.to_string()))
    }

    fn fetch_messages_via_companion_adb(serial: &str) -> Result<Vec<MessageWithHash>> {
        let content = Self::fetch_via_companion_adb(serial, "com.droidlink.EXPORT_MESSAGES", "messages")?;
        serde_json::from_str(&content).map_err(|e| SyncError::Parse(e.to_string()))
    }

    fn fetch_call_logs_via_companion_adb(serial: &str) -> Result<Vec<CallLogWithHash>> {
        let content = Self::fetch_via_companion_adb(serial, "com.droidlink.EXPORT_CALLLOGS", "calllogs")?;
        serde_json::from_str(&content).map_err(|e| SyncError::Parse(e.to_string()))
    }

    // ========== Content Provider Fallback (pure ADB) ==========

    fn fetch_contacts_via_content(serial: &str) -> Result<Vec<ContactWithHash>> {
        let output = adb::shell(
            serial,
            "content query --uri content://com.android.contacts/contacts --projection _id:display_name:has_phone_number"
        ).map_err(|e| SyncError::Adb(e.to_string()))?;

        let mut contacts = Vec::new();

        for line in output.lines() {
            if let Some(contact_data) = Self::parse_content_row(line) {
                if let (Some(id), Some(display_name)) = (
                    contact_data.get("_id"),
                    contact_data.get("display_name")
                ) {
                    let phone_numbers = Self::fetch_phone_numbers(serial, id)?;
                    let emails = Self::fetch_emails(serial, id)?;

                    let hash = Self::compute_contact_hash_raw(id, display_name, &phone_numbers, &emails);

                    contacts.push(ContactWithHash {
                        id: id.clone(),
                        display_name: display_name.clone(),
                        phone_numbers,
                        emails,
                        photo_uri: None,
                        hash,
                    });
                }
            }
        }

        Ok(contacts)
    }

    fn fetch_phone_numbers(serial: &str, contact_id: &str) -> Result<Vec<String>> {
        let output = adb::shell(
            serial,
            &format!(
                "content query --uri content://com.android.contacts/data --projection data1 --where \"contact_id={} AND mimetype='vnd.android.cursor.item/phone_v2'\"",
                contact_id
            )
        ).map_err(|e| SyncError::Adb(e.to_string()))?;

        let mut numbers = Vec::new();
        for line in output.lines() {
            if let Some(row) = Self::parse_content_row(line) {
                if let Some(number) = row.get("data1") {
                    numbers.push(number.clone());
                }
            }
        }

        Ok(numbers)
    }

    fn fetch_emails(serial: &str, contact_id: &str) -> Result<Vec<String>> {
        let output = adb::shell(
            serial,
            &format!(
                "content query --uri content://com.android.contacts/data --projection data1 --where \"contact_id={} AND mimetype='vnd.android.cursor.item/email_v2'\"",
                contact_id
            )
        ).map_err(|e| SyncError::Adb(e.to_string()))?;

        let mut emails = Vec::new();
        for line in output.lines() {
            if let Some(row) = Self::parse_content_row(line) {
                if let Some(email) = row.get("data1") {
                    emails.push(email.clone());
                }
            }
        }

        Ok(emails)
    }

    fn fetch_messages_via_content(serial: &str) -> Result<Vec<MessageWithHash>> {
        let output = adb::shell(
            serial,
            "content query --uri content://sms --projection _id:thread_id:address:body:date:date_sent:type:read --sort \"date DESC\" | head -1000"
        ).map_err(|e| SyncError::Adb(e.to_string()))?;

        let mut messages = Vec::new();

        for line in output.lines() {
            if let Some(row) = Self::parse_content_row(line) {
                if let (Some(id), Some(thread_id), Some(address), Some(body), Some(date)) = (
                    row.get("_id"),
                    row.get("thread_id"),
                    row.get("address"),
                    row.get("body"),
                    row.get("date"),
                ) {
                    let date_sent = row.get("date_sent").and_then(|s| s.parse().ok()).unwrap_or(0);
                    let type_ = row.get("type").and_then(|s| s.parse().ok()).unwrap_or(0);
                    let read = row.get("read").map(|s| s == "1").unwrap_or(false);

                    let hash = Self::compute_message_hash_raw(
                        id, address, body,
                        date.parse().unwrap_or(0), type_, read,
                    );

                    messages.push(MessageWithHash {
                        id: id.clone(),
                        thread_id: thread_id.clone(),
                        address: address.clone(),
                        body: body.clone(),
                        date: date.parse().unwrap_or(0),
                        date_sent,
                        type_,
                        read,
                        hash,
                    });
                }
            }
        }

        Ok(messages)
    }

    fn fetch_call_logs_via_content(serial: &str) -> Result<Vec<CallLogWithHash>> {
        let output = adb::shell(
            serial,
            "content query --uri content://call_log/calls --projection _id:number:cached_name:type:date:duration --sort \"date DESC\" | head -1000"
        ).map_err(|e| SyncError::Adb(e.to_string()))?;

        let mut call_logs = Vec::new();

        for line in output.lines() {
            if let Some(row) = Self::parse_content_row(line) {
                if let (Some(id), Some(number), Some(date)) = (
                    row.get("_id"),
                    row.get("number"),
                    row.get("date"),
                ) {
                    let cached_name = row.get("cached_name").cloned();
                    let type_ = row.get("type").and_then(|s| s.parse().ok()).unwrap_or(0);
                    let duration = row.get("duration").and_then(|s| s.parse().ok()).unwrap_or(0);

                    let hash = Self::compute_call_log_hash_raw(
                        id, number,
                        cached_name.as_deref(), type_,
                        date.parse().unwrap_or(0), duration,
                    );

                    call_logs.push(CallLogWithHash {
                        id: id.clone(),
                        number: number.clone(),
                        cached_name,
                        type_,
                        date: date.parse().unwrap_or(0),
                        duration,
                        hash,
                    });
                }
            }
        }

        Ok(call_logs)
    }

    fn parse_content_row(line: &str) -> Option<HashMap<String, String>> {
        // Parse format: "Row: 0 _id=1, display_name=张三, has_phone_number=1"
        if !line.starts_with("Row: ") {
            return None;
        }

        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() < 2 {
            return None;
        }

        let fields_str = parts[1].trim();
        let mut map = HashMap::new();

        for field in fields_str.split(", ") {
            if let Some((key, value)) = field.split_once('=') {
                if value != "NULL" {
                    map.insert(key.to_string(), value.to_string());
                }
            }
        }

        if map.is_empty() { None } else { Some(map) }
    }

    // ========== Hash Computation ==========

    fn compute_contact_hash(contact: &Contact) -> String {
        let phone_numbers: Vec<String> = serde_json::from_str(&contact.phone_numbers).unwrap_or_default();
        let emails: Vec<String> = serde_json::from_str(&contact.emails).unwrap_or_default();
        Self::compute_contact_hash_raw(&contact.id, &contact.display_name, &phone_numbers, &emails)
    }

    fn compute_contact_hash_raw(id: &str, display_name: &str, phone_numbers: &[String], emails: &[String]) -> String {
        let mut data = Vec::new();
        data.extend_from_slice(id.as_bytes());
        data.extend_from_slice(display_name.as_bytes());
        for number in phone_numbers { data.extend_from_slice(number.as_bytes()); }
        for email in emails { data.extend_from_slice(email.as_bytes()); }
        format!("{:x}", xxh3_64(&data))
    }

    fn compute_message_hash(message: &Message) -> String {
        Self::compute_message_hash_raw(&message.id, &message.address, &message.body, message.date, message.type_, message.read)
    }

    fn compute_message_hash_raw(id: &str, address: &str, body: &str, date: i64, type_: i32, read: bool) -> String {
        let mut data = Vec::new();
        data.extend_from_slice(id.as_bytes());
        data.extend_from_slice(address.as_bytes());
        data.extend_from_slice(body.as_bytes());
        data.extend_from_slice(&date.to_le_bytes());
        data.extend_from_slice(&type_.to_le_bytes());
        data.push(if read { 1 } else { 0 });
        format!("{:x}", xxh3_64(&data))
    }

    fn compute_call_log_hash(log: &CallLog) -> String {
        Self::compute_call_log_hash_raw(&log.id, &log.number, log.cached_name.as_deref(), log.type_, log.date, log.duration)
    }

    fn compute_call_log_hash_raw(id: &str, number: &str, cached_name: Option<&str>, type_: i32, date: i64, duration: i64) -> String {
        let mut data = Vec::new();
        data.extend_from_slice(id.as_bytes());
        data.extend_from_slice(number.as_bytes());
        if let Some(name) = cached_name { data.extend_from_slice(name.as_bytes()); }
        data.extend_from_slice(&type_.to_le_bytes());
        data.extend_from_slice(&date.to_le_bytes());
        data.extend_from_slice(&duration.to_le_bytes());
        format!("{:x}", xxh3_64(&data))
    }
}

impl Drop for SyncEngine {
    fn drop(&mut self) {
        let serials: Vec<String> = self.active_syncs.lock().keys().cloned().collect();
        for serial in serials {
            if let Some(handle) = self.active_syncs.lock().remove(&serial) {
                handle.running.store(false, Ordering::Relaxed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_content_row() {
        let line = "Row: 0 _id=1, display_name=张三, has_phone_number=1";
        let row = SyncEngine::parse_content_row(line).unwrap();
        assert_eq!(row.get("_id").unwrap(), "1");
        assert_eq!(row.get("display_name").unwrap(), "张三");
        assert_eq!(row.get("has_phone_number").unwrap(), "1");
    }

    #[test]
    fn test_parse_content_row_with_null() {
        let line = "Row: 0 _id=1, display_name=NULL, has_phone_number=1";
        let row = SyncEngine::parse_content_row(line).unwrap();
        assert_eq!(row.get("_id").unwrap(), "1");
        assert!(row.get("display_name").is_none());
    }

    #[test]
    fn test_compute_hash_deterministic() {
        let hash1 = SyncEngine::compute_contact_hash_raw("123", "张三", &["1234567890".to_string()], &["test@example.com".to_string()]);
        let hash2 = SyncEngine::compute_contact_hash_raw("123", "张三", &["1234567890".to_string()], &["test@example.com".to_string()]);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_compute_hash_different_data() {
        let hash1 = SyncEngine::compute_contact_hash_raw("123", "张三", &["1234567890".to_string()], &[]);
        let hash2 = SyncEngine::compute_contact_hash_raw("123", "李四", &["1234567890".to_string()], &[]);
        assert_ne!(hash1, hash2);
    }
}
