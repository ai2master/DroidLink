use serde_json::Value;
use tauri::{State, Manager};

use crate::app_state::AppState;
use crate::adb;

// ========== Device Commands ==========

#[tauri::command]
pub async fn get_devices(_state: State<'_, AppState>) -> Result<Value, String> {
    let devices = adb::get_devices().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&devices).unwrap())
}

#[tauri::command]
pub async fn get_device_info(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let info = adb::get_device_info(&serial).map_err(|e| e.to_string())?;
    state.db.upsert_device(&serial, &info.model, &info.manufacturer, &info.android_version, &info.display_name).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&info).unwrap())
}

#[tauri::command]
pub async fn check_adb() -> Result<bool, String> {
    adb::check_adb().map_err(|e| e.to_string())
}

// ========== Contact Commands ==========

#[tauri::command]
pub async fn get_contacts(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let contacts = state.db.get_contacts(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&contacts).unwrap())
}

#[tauri::command]
pub async fn get_contact_history(_serial: String, contact_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let history = state.db.get_version_history("contacts", Some(&contact_id), 50).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&history).unwrap())
}

#[tauri::command]
pub async fn delete_contact(serial: String, contact_id: String, state: State<'_, AppState>) -> Result<(), String> {
    // Get current data for version history
    let contacts = state.db.get_contacts(&serial).map_err(|e| e.to_string())?;
    let current = contacts.iter().find(|c| c.contact_id == contact_id);
    if let Some(c) = current {
        let before = serde_json::to_value(c).unwrap();
        state.version_manager.create_version(&serial, "contacts", Some(&contact_id), "delete", Some(&before), None, "desktop", Some("Contact deleted from desktop")).map_err(|e| e.to_string())?;
    }
    // 安全：验证 contact_id 只包含数字 / Security: validate contact_id is numeric only
    if !contact_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid contact ID: must be numeric".to_string());
    }
    // Delete from device
    let cmd = format!("content delete --uri content://com.android.contacts/contacts/{}", contact_id);
    let _ = adb::shell(&serial, &cmd);
    // Delete from local db
    state.db.delete_contact(&serial, &contact_id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_contacts(serial: String, format: String, output_path: String, state: State<'_, AppState>) -> Result<String, String> {
    let contacts = state.db.get_contacts(&serial).map_err(|e| e.to_string())?;
    match format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&contacts).unwrap();
            std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
        }
        "csv" => {
            let mut csv = String::from("Name,Phone,Email,Organization\n");
            for c in &contacts {
                let phones: Vec<String> = serde_json::from_str(&c.phone_numbers).unwrap_or_default();
                let emails: Vec<String> = serde_json::from_str(&c.emails).unwrap_or_default();
                csv.push_str(&format!("\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    c.display_name,
                    phones.join("; "),
                    emails.join("; "),
                    c.organization,
                ));
            }
            std::fs::write(&output_path, csv).map_err(|e| e.to_string())?;
        }
        "vcf" => {
            let mut vcf = String::new();
            for c in &contacts {
                let phones: Vec<String> = serde_json::from_str(&c.phone_numbers).unwrap_or_default();
                let emails: Vec<String> = serde_json::from_str(&c.emails).unwrap_or_default();
                vcf.push_str("BEGIN:VCARD\nVERSION:3.0\n");
                vcf.push_str(&format!("FN:{}\n", c.display_name));
                for p in &phones {
                    vcf.push_str(&format!("TEL:{}\n", p));
                }
                for e in &emails {
                    vcf.push_str(&format!("EMAIL:{}\n", e));
                }
                if !c.organization.is_empty() {
                    vcf.push_str(&format!("ORG:{}\n", c.organization));
                }
                vcf.push_str("END:VCARD\n");
            }
            std::fs::write(&output_path, vcf).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported format: {}", format)),
    }
    Ok(output_path)
}

// ========== Message Commands ==========

#[tauri::command]
pub async fn get_messages(serial: String, thread_id: Option<String>, state: State<'_, AppState>) -> Result<Value, String> {
    let messages = state.db.get_messages(&serial, thread_id.as_deref()).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&messages).unwrap())
}

#[tauri::command]
pub async fn get_conversations(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let conversations = state.db.get_conversations(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&conversations).unwrap())
}

#[tauri::command]
pub async fn export_messages(serial: String, format: String, output_path: String, state: State<'_, AppState>) -> Result<String, String> {
    let messages = state.db.get_messages(&serial, None).map_err(|e| e.to_string())?;
    match format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&messages).unwrap();
            std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
        }
        "csv" => {
            let mut csv = String::from("Date,Address,Contact,Type,Body\n");
            for m in &messages {
                let type_str = match m.msg_type { 1 => "Received", 2 => "Sent", _ => "Other" };
                csv.push_str(&format!("\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
                    m.date, m.address, m.contact_name, type_str,
                    m.body.replace('"', "\"\""),
                ));
            }
            std::fs::write(&output_path, csv).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported format: {}", format)),
    }
    Ok(output_path)
}

// ========== Call Log Commands ==========

#[tauri::command]
pub async fn get_call_logs(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let logs = state.db.get_call_logs(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&logs).unwrap())
}

#[tauri::command]
pub async fn export_call_logs(serial: String, format: String, output_path: String, state: State<'_, AppState>) -> Result<String, String> {
    let logs = state.db.get_call_logs(&serial).map_err(|e| e.to_string())?;
    match format.as_str() {
        "json" => {
            let json = serde_json::to_string_pretty(&logs).unwrap();
            std::fs::write(&output_path, json).map_err(|e| e.to_string())?;
        }
        "csv" => {
            let mut csv = String::from("Date,Number,Contact,Type,Duration\n");
            for l in &logs {
                let type_str = match l.call_type { 1 => "Incoming", 2 => "Outgoing", 3 => "Missed", _ => "Other" };
                csv.push_str(&format!("\"{}\",\"{}\",\"{}\",\"{}\",{}\n",
                    l.date, l.number, l.contact_name, type_str, l.duration,
                ));
            }
            std::fs::write(&output_path, csv).map_err(|e| e.to_string())?;
        }
        _ => return Err(format!("Unsupported format: {}", format)),
    }
    Ok(output_path)
}

// ========== Sync Commands ==========

#[tauri::command]
pub async fn trigger_sync(serial: String, data_type: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    state.sync_engine.trigger_sync(&serial, data_type.as_deref());
    Ok(())
}

#[tauri::command]
pub async fn start_auto_sync(serial: String, state: State<'_, AppState>) -> Result<(), String> {
    state.sync_engine.start_sync(&serial);
    Ok(())
}

#[tauri::command]
pub async fn get_sync_status(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let mut statuses = serde_json::Map::new();
    for dtype in &["contacts", "messages", "call_logs"] {
        if let Ok(Some(s)) = state.db.get_sync_state(&serial, dtype) {
            statuses.insert(dtype.to_string(), serde_json::to_value(s).unwrap());
        }
    }
    Ok(Value::Object(statuses))
}

#[tauri::command]
pub async fn get_sync_config(state: State<'_, AppState>) -> Result<Value, String> {
    let settings = state.db.get_all_settings().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(settings).unwrap())
}

#[tauri::command]
pub async fn set_sync_config(config: Value, state: State<'_, AppState>) -> Result<(), String> {
    if let Value::Object(map) = config {
        for (key, value) in map {
            let val_str = match value {
                Value::String(s) => s,
                other => other.to_string(),
            };
            state.db.set_setting(&key, &val_str).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ========== Version History Commands ==========

#[tauri::command]
pub async fn get_version_history(data_type: String, item_id: Option<String>, state: State<'_, AppState>) -> Result<Value, String> {
    let history = state.version_manager.get_history(&data_type, item_id.as_deref(), 100).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&history).unwrap())
}

#[tauri::command]
pub async fn get_version_detail(version_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let detail = state.version_manager.get_version_detail(&version_id).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&detail).unwrap())
}

/// 恢复版本：创建新版本记录（不删除旧版本），并将数据写回数据库
/// Restore version: creates a NEW version record (old versions are never deleted),
/// and applies the restored data back to the database
#[tauri::command]
pub async fn restore_version(version_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    // 1. Get the version detail to restore
    let detail = state.version_manager.get_version_detail(&version_id).map_err(|e| e.to_string())?;
    let record = &detail.record;
    let data_type = &record.data_type;
    let device_serial = &record.device_serial;

    // 2. Determine data to restore (before for deletes, after for others)
    let restore_data = state.version_manager.restore_version(&version_id).map_err(|e| e.to_string())?;

    // 3. Get current state as data_before for the new version record
    let current_state: Option<Value> = match data_type.as_str() {
        "contacts" => {
            if let Some(ref item_id) = record.item_id {
                let contacts = state.db.get_contacts(device_serial).map_err(|e| e.to_string())?;
                contacts.iter().find(|c| c.contact_id == *item_id)
                    .map(|c| serde_json::to_value(c).unwrap())
            } else { None }
        }
        "messages" => {
            if let Some(ref item_id) = record.item_id {
                let msgs = state.db.get_messages(device_serial, None).map_err(|e| e.to_string())?;
                msgs.iter().find(|m| m.message_id == *item_id)
                    .map(|m| serde_json::to_value(m).unwrap())
            } else { None }
        }
        "call_logs" => {
            if let Some(ref item_id) = record.item_id {
                let logs = state.db.get_call_logs(device_serial).map_err(|e| e.to_string())?;
                logs.iter().find(|l| l.call_id == *item_id)
                    .map(|l| serde_json::to_value(l).unwrap())
            } else { None }
        }
        _ => None,
    };

    // 4. Apply restored data back to database
    match data_type.as_str() {
        "contacts" => {
            let display_name = restore_data["display_name"].as_str().unwrap_or("");
            let phone_numbers = restore_data["phone_numbers"].as_str().unwrap_or("[]");
            let emails = restore_data["emails"].as_str().unwrap_or("[]");
            let organization = restore_data["organization"].as_str().unwrap_or("");
            let raw_data = restore_data["raw_data"].as_str().unwrap_or("{}");
            let hash = restore_data["hash"].as_str().unwrap_or("");
            let contact_id = record.item_id.as_deref().unwrap_or("");
            state.db.upsert_contact(device_serial, contact_id, display_name, phone_numbers, emails, organization, raw_data, hash)
                .map_err(|e| e.to_string())?;
        }
        "messages" => {
            let message_id = record.item_id.as_deref().unwrap_or("");
            let thread_id = restore_data["thread_id"].as_str().unwrap_or("");
            let address = restore_data["address"].as_str().unwrap_or("");
            let contact_name = restore_data["contact_name"].as_str().unwrap_or("");
            let body = restore_data["body"].as_str().unwrap_or("");
            let date = restore_data["date"].as_str().unwrap_or("");
            let date_sent = restore_data["date_sent"].as_str().unwrap_or("");
            let msg_type = restore_data["msg_type"].as_i64().unwrap_or(0) as i32;
            let read = restore_data["read"].as_i64().unwrap_or(0) as i32;
            let hash = restore_data["hash"].as_str().unwrap_or("");
            state.db.upsert_message(device_serial, message_id, thread_id, address, contact_name, body, date, date_sent, msg_type, read, hash)
                .map_err(|e| e.to_string())?;
        }
        "call_logs" => {
            let call_id = record.item_id.as_deref().unwrap_or("");
            let number = restore_data["number"].as_str().unwrap_or("");
            let contact_name = restore_data["contact_name"].as_str().unwrap_or("");
            let call_type = restore_data["call_type"].as_i64().unwrap_or(0) as i32;
            let date = restore_data["date"].as_str().unwrap_or("");
            let duration = restore_data["duration"].as_i64().unwrap_or(0);
            let hash = restore_data["hash"].as_str().unwrap_or("");
            state.db.upsert_call_log(device_serial, call_id, number, contact_name, call_type, date, duration, hash)
                .map_err(|e| e.to_string())?;
        }
        _ => {}
    }

    // 5. Create a NEW version entry for the restore action (immutable history)
    let description = format!("Restored from version {}", &version_id[..8.min(version_id.len())]);
    state.version_manager.create_version(
        device_serial,
        data_type,
        record.item_id.as_deref(),
        "restore",
        current_state.as_ref(),
        Some(&restore_data),
        "desktop",
        Some(&description),
    ).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({ "success": true, "description": description }))
}

/// 对比两个版本的数据
/// Compare two versions and return their data for diff rendering
#[tauri::command]
pub async fn compare_versions(version_id_a: String, version_id_b: String, state: State<'_, AppState>) -> Result<Value, String> {
    let detail_a = state.version_manager.get_version_detail(&version_id_a).map_err(|e| e.to_string())?;
    let detail_b = state.version_manager.get_version_detail(&version_id_b).map_err(|e| e.to_string())?;

    // Get the effective data for each version (after for most actions, before for deletes)
    let data_a = if detail_a.record.action == "delete" {
        detail_a.record.data_before.as_deref().map(|s| serde_json::from_str(s).unwrap_or(Value::Null))
    } else {
        detail_a.record.data_after.as_deref().map(|s| serde_json::from_str(s).unwrap_or(Value::Null))
    };

    let data_b = if detail_b.record.action == "delete" {
        detail_b.record.data_before.as_deref().map(|s| serde_json::from_str(s).unwrap_or(Value::Null))
    } else {
        detail_b.record.data_after.as_deref().map(|s| serde_json::from_str(s).unwrap_or(Value::Null))
    };

    Ok(serde_json::json!({
        "versionA": {
            "id": detail_a.record.id,
            "timestamp": detail_a.record.created_at,
            "action": detail_a.record.action,
            "description": detail_a.record.description,
            "dataType": detail_a.record.data_type,
            "data": data_a,
        },
        "versionB": {
            "id": detail_b.record.id,
            "timestamp": detail_b.record.created_at,
            "action": detail_b.record.action,
            "description": detail_b.record.description,
            "dataType": detail_b.record.data_type,
            "data": data_b,
        }
    }))
}

#[tauri::command]
pub async fn delete_old_versions(before_date: String, state: State<'_, AppState>) -> Result<usize, String> {
    state.db.delete_versions_before(&before_date).map_err(|e| e.to_string())
}

// ========== File Manager Commands ==========

#[tauri::command]
pub async fn list_files(serial: String, remote_path: String) -> Result<Value, String> {
    let files = adb::list_files(&serial, &remote_path).map_err(|e| e.to_string())?;
    // Sort: directories first, then by name
    let mut sorted = files;
    sorted.sort_by(|a, b| {
        let a_is_dir = a.file_type == "directory";
        let b_is_dir = b.file_type == "directory";
        b_is_dir.cmp(&a_is_dir).then(a.name.cmp(&b.name))
    });
    Ok(serde_json::to_value(&sorted).unwrap())
}

#[tauri::command]
pub async fn pull_file(serial: String, remote_path: String, local_path: String) -> Result<(), String> {
    adb::pull(&serial, &remote_path, &local_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pull_directory(serial: String, remote_path: String, local_path: String) -> Result<(), String> {
    adb::pull_directory(&serial, &remote_path, &local_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn push_file(serial: String, local_path: String, remote_path: String) -> Result<(), String> {
    adb::push(&serial, &local_path, &remote_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_file(serial: String, remote_path: String) -> Result<(), String> {
    adb::delete_path(&serial, &remote_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_folder(serial: String, remote_path: String) -> Result<(), String> {
    adb::create_dir(&serial, &remote_path).map_err(|e| e.to_string())
}

// ========== File Manager Extended Commands ==========

#[tauri::command]
pub async fn rename_file(serial: String, old_path: String, new_path: String) -> Result<(), String> {
    crate::filemanager::FileManager::rename(&serial, &old_path, &new_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_file(serial: String, src_path: String, dst_path: String) -> Result<(), String> {
    crate::filemanager::FileManager::copy(&serial, &src_path, &dst_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn move_file(serial: String, old_path: String, new_path: String) -> Result<(), String> {
    crate::filemanager::FileManager::rename(&serial, &old_path, &new_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_info(serial: String, path: String) -> Result<Value, String> {
    let info = crate::filemanager::FileManager::get_file_info(&serial, &path)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&info).unwrap())
}

#[tauri::command]
pub async fn search_files(serial: String, base_path: String, pattern: String) -> Result<Value, String> {
    let results = crate::filemanager::FileManager::search_files(&serial, &base_path, &pattern)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&results).unwrap())
}

#[tauri::command]
pub async fn batch_delete_files(serial: String, paths: Vec<String>) -> Result<Value, String> {
    let mut succeeded = 0u32;
    let mut failed = Vec::new();
    for path in &paths {
        match adb::delete_path(&serial, path) {
            Ok(_) => succeeded += 1,
            Err(e) => failed.push(serde_json::json!({ "path": path, "error": e.to_string() })),
        }
    }
    Ok(serde_json::json!({ "succeeded": succeeded, "failed": failed }))
}

#[tauri::command]
pub async fn batch_copy_files(serial: String, files: Vec<String>, destination: String) -> Result<Value, String> {
    let mut succeeded = 0u32;
    let mut failed = Vec::new();
    for src in &files {
        let file_name = std::path::Path::new(src)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let dst = format!("{}/{}", destination.trim_end_matches('/'), file_name);
        match crate::filemanager::FileManager::copy(&serial, src, &dst) {
            Ok(_) => succeeded += 1,
            Err(e) => failed.push(serde_json::json!({ "path": src, "error": e.to_string() })),
        }
    }
    Ok(serde_json::json!({ "succeeded": succeeded, "failed": failed }))
}

#[tauri::command]
pub async fn batch_move_files(serial: String, files: Vec<String>, destination: String) -> Result<Value, String> {
    let mut succeeded = 0u32;
    let mut failed = Vec::new();
    for src in &files {
        let file_name = std::path::Path::new(src)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let dst = format!("{}/{}", destination.trim_end_matches('/'), file_name);
        match crate::filemanager::FileManager::rename(&serial, src, &dst) {
            Ok(_) => succeeded += 1,
            Err(e) => failed.push(serde_json::json!({ "path": src, "error": e.to_string() })),
        }
    }
    Ok(serde_json::json!({ "succeeded": succeeded, "failed": failed }))
}

// ========== Folder Sync Commands ==========

#[tauri::command]
pub async fn get_folder_sync_pairs(state: State<'_, AppState>) -> Result<Value, String> {
    let pairs = state.db.get_folder_sync_pairs(None).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&pairs).unwrap())
}

#[tauri::command]
pub async fn add_folder_sync_pair(pair: Value, state: State<'_, AppState>) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let sync_pair = crate::db::FolderSyncPair {
        id: id.clone(),
        device_serial: pair["deviceSerial"].as_str().unwrap_or("").to_string(),
        local_path: pair["localPath"].as_str().unwrap_or("").to_string(),
        remote_path: pair["remotePath"].as_str().unwrap_or("").to_string(),
        direction: pair["direction"].as_str().unwrap_or("bidirectional").to_string(),
        enabled: true,
        last_synced: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    state.db.add_folder_sync_pair(&sync_pair).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn remove_folder_sync_pair(pair_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.db.remove_folder_sync_pair(&pair_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn trigger_folder_sync(pair_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    // Get the pair info
    let pairs = state.db.get_folder_sync_pairs(None).map_err(|e| e.to_string())?;
    let pair = pairs.iter().find(|p| p.id == pair_id).ok_or("Sync pair not found")?;
    let result = state.folder_sync.sync_pair(&pair.device_serial, &pair_id).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&result).unwrap())
}

#[tauri::command]
pub async fn get_transfer_info(serial: String) -> Result<Value, String> {
    let info = crate::transfer::FolderSync::get_transfer_info(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&info).unwrap())
}

#[tauri::command]
pub async fn clean_folder_versions(local_path: String, retention_days: u32) -> Result<u64, String> {
    let path = std::path::Path::new(&local_path);
    crate::transfer::FolderSync::clean_old_versions(path, retention_days).map_err(|e| e.to_string())
}

// ========== Clipboard Commands ==========

#[tauri::command]
pub async fn get_clipboard_content(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    // Manual: get clipboard from device
    let (text, method) = state.clipboard_bridge.get_from_device(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "text": text,
        "method": method,
        "length": text.chars().count(),
        "byteSize": text.len(),
    }))
}

#[tauri::command]
pub async fn send_clipboard_to_device(serial: String, content: String, state: State<'_, AppState>) -> Result<Value, String> {
    // Manual: send clipboard to device
    let method = state.clipboard_bridge.send_to_device(&serial, &content).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "method": method,
        "length": content.chars().count(),
        "byteSize": content.len(),
    }))
}

#[tauri::command]
pub async fn get_clipboard_info(serial: String, state: State<'_, AppState>) -> Result<Value, String> {
    let info = state.clipboard_bridge.get_info(&serial);
    Ok(serde_json::to_value(&info).unwrap())
}

// ========== File Transfer Commands ==========

#[tauri::command]
pub async fn send_file_to_device(serial: String, local_path: String, remote_path: String) -> Result<(), String> {
    adb::push(&serial, &local_path, &remote_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn receive_file_from_device(serial: String, remote_path: String, local_path: String) -> Result<(), String> {
    adb::pull(&serial, &remote_path, &local_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_folder_to_device(serial: String, local_path: String, remote_path: String) -> Result<(), String> {
    adb::push_folder(&serial, &local_path, &remote_path).map_err(|e| e.to_string())
}

// ========== scrcpy Commands ==========

#[tauri::command]
pub async fn start_scrcpy(serial: String, options: Option<Value>, state: State<'_, AppState>) -> Result<(), String> {
    let opts = options.and_then(|v| serde_json::from_value(v).ok());
    state.scrcpy_manager.start(&serial, opts).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_scrcpy(serial: String, state: State<'_, AppState>) -> Result<(), String> {
    state.scrcpy_manager.stop(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn is_scrcpy_running(serial: String, state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.scrcpy_manager.is_running(&serial))
}

#[tauri::command]
pub async fn check_scrcpy() -> Result<String, String> {
    crate::scrcpy::ScrcpyManager::check_available().map_err(|e| e.to_string())
}

// ========== DroidLink IME 命令 (中日韩文本输入) ==========
// ========== DroidLink IME Commands (CJK text input) ==========

#[tauri::command]
pub async fn send_text_to_device(serial: String, text: String) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::send_text_input(&serial, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_key_to_device(serial: String, key_code: i32) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::send_key_input(&serial, key_code).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_backspace_to_device(serial: String, count: Option<i32>) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::send_backspace(&serial, count.unwrap_or(1)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn send_enter_to_device(serial: String) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::send_enter(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn setup_droidlink_ime(serial: String) -> Result<String, String> {
    crate::scrcpy::ScrcpyManager::setup_ime(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_default_ime(serial: String) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::restore_ime(&serial).map_err(|e| e.to_string())
}

// ========== 键盘直通命令 (使用手机自带输入法) ==========
// ========== Keyboard passthrough commands (uses phone's native IME) ==========

#[tauri::command]
pub async fn passthrough_keyevent(serial: String, key_code: i32) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::passthrough_keyevent(&serial, key_code).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn passthrough_text(serial: String, text: String) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::passthrough_text(&serial, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_device_imes(serial: String) -> Result<Value, String> {
    let imes = crate::scrcpy::ScrcpyManager::list_device_imes(&serial).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&imes).unwrap())
}

#[tauri::command]
pub async fn get_current_ime(serial: String) -> Result<String, String> {
    crate::scrcpy::ScrcpyManager::get_current_ime(&serial).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn switch_ime(serial: String, ime_id: String) -> Result<(), String> {
    crate::scrcpy::ScrcpyManager::switch_ime(&serial, &ime_id).map_err(|e| e.to_string())
}

// ========== ADB 信息命令 ==========
// ========== ADB info commands ==========

#[tauri::command]
pub async fn get_adb_info() -> Result<Value, String> {
    let info = crate::adb::get_adb_path_info();
    Ok(serde_json::to_value(&info).unwrap())
}

// ========== 设置命令 ==========
// ========== Settings Commands ==========

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Value, String> {
    let settings = state.db.get_all_settings().map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(settings).unwrap())
}

#[tauri::command]
pub async fn set_settings(settings: Value, state: State<'_, AppState>) -> Result<(), String> {
    if let Value::Object(map) = settings {
        for (key, value) in map {
            let val_str = match value {
                Value::String(s) => s,
                other => other.to_string(),
            };
            state.db.set_setting(&key, &val_str).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_data_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.db.data_path().to_string_lossy().to_string())
}

/// 在系统文件管理器中打开路径 (安全验证)
/// Open path in system file explorer (with security validation)
#[tauri::command]
pub async fn open_in_explorer(path: String) -> Result<(), String> {
    // 安全：验证路径存在且是目录，防止打开恶意路径
    // Security: validate path exists and is a directory
    let path_obj = std::path::Path::new(&path);
    if !path_obj.exists() {
        return Err("Path does not exist".to_string());
    }
    // 规范化路径防止路径穿越 / Canonicalize to prevent traversal
    let canonical = path_obj.canonicalize().map_err(|e| format!("Invalid path: {}", e))?;
    let canonical_str = canonical.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("explorer").arg(&canonical_str).spawn(); }
    #[cfg(target_os = "macos")]
    { let _ = std::process::Command::new("open").arg(&canonical_str).spawn(); }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&canonical_str).spawn(); }
    Ok(())
}

// ========== Companion App 命令 ==========
// ========== Companion App Commands ==========

const COMPANION_PACKAGE: &str = "com.droidlink.companion";

/// 检查手机上是否已安装 DroidLink Companion，返回安装状态和版本
/// Check if DroidLink Companion is installed on the device, return status and version
#[tauri::command]
pub async fn check_companion_app(serial: String) -> Result<Value, String> {
    // Check if package is installed
    let output = adb::shell(&serial, &format!("pm list packages {}", COMPANION_PACKAGE))
        .map_err(|e| e.to_string())?;
    let installed = output.contains(COMPANION_PACKAGE);

    if !installed {
        return Ok(serde_json::json!({
            "installed": false,
            "deviceVersion": null,
            "needsUpdate": false,
        }));
    }

    // Get installed version
    let version_output = adb::shell(&serial,
        &format!("dumpsys package {} | grep versionName", COMPANION_PACKAGE))
        .unwrap_or_default();
    let device_version = version_output
        .lines()
        .find(|l| l.contains("versionName"))
        .and_then(|l| l.split('=').last())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();

    // Read bundled version from resources
    let bundled_version = get_bundled_companion_version();

    let needs_update = !device_version.is_empty()
        && !bundled_version.is_empty()
        && device_version != bundled_version;

    Ok(serde_json::json!({
        "installed": true,
        "deviceVersion": device_version,
        "bundledVersion": bundled_version,
        "needsUpdate": needs_update,
    }))
}

/// 通过 ADB 安装 companion APK 到手机（用户已同意后调用）
/// Install companion APK to device via ADB (called after user consent)
#[tauri::command]
pub async fn install_companion_app(serial: String, app_handle: tauri::AppHandle) -> Result<Value, String> {
    // Resolve APK path from bundled resources
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let apk_path = resource_dir.join("resources").join("companion").join("DroidLinkCompanion.apk");

    if !apk_path.exists() {
        return Err("Companion APK not found in application resources. Please rebuild the application with the Android companion APK.".to_string());
    }

    // Check APK is not empty placeholder
    let metadata = std::fs::metadata(&apk_path).map_err(|e| e.to_string())?;
    if metadata.len() < 1024 {
        return Err("Companion APK is a placeholder. Build the Android project first: cd android && ./gradlew assembleRelease".to_string());
    }

    let apk_path_str = apk_path.to_string_lossy().to_string();

    // Install using adb install -r (replace existing)
    let output = std::process::Command::new(adb::get_adb_path())
        .args(["-s", &serial, "install", "-r", &apk_path_str])
        .output()
        .map_err(|e| format!("Failed to execute adb install: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if stdout.contains("Success") {
        log::info!("Companion app installed successfully on {}", serial);
        Ok(serde_json::json!({
            "success": true,
            "message": "Companion app installed successfully",
        }))
    } else {
        let err_msg = if stderr.contains("INSTALL_FAILED_USER_RESTRICTED") {
            "Installation blocked by device. Please enable 'Install via USB' in Developer Options."
        } else if stderr.contains("INSTALL_FAILED_VERIFICATION_FAILURE") {
            "Installation verification failed. Please disable 'Verify apps over USB' in Developer Options."
        } else {
            &format!("Installation failed: {} {}", stdout.trim(), stderr.trim())
        };
        log::error!("Companion app install failed on {}: {}", serial, err_msg);
        Err(err_msg.to_string())
    }
}

/// 获取内置 companion APK 的版本号
/// Get the bundled companion APK version
fn get_bundled_companion_version() -> String {
    let paths = [
        "resources/companion/version.txt",
        "../resources/companion/version.txt",
    ];
    for path in &paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            return content.trim().to_string();
        }
    }
    String::new()
}

// ========== 工具路径命令 ==========
// ========== Tool Path Commands ==========

/// 获取可用的工具来源列表
/// Get available tool sources (which ADB/scrcpy sources are usable)
#[tauri::command]
pub async fn get_tool_sources(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;

    let adb_sources = crate::adb::get_available_sources(&resource_dir);

    // scrcpy: 始终包含内置选项（CI 构建会打包 scrcpy，运行时缺失则自动回退到系统 PATH）
    // scrcpy: always include bundled option (CI build bundles scrcpy, runtime falls back to system PATH if missing)
    let mut scrcpy_sources = vec!["bundled".to_string()];
    if which::which(if cfg!(target_os = "windows") { "scrcpy.exe" } else { "scrcpy" }).is_ok() {
        scrcpy_sources.push("system".to_string());
    }
    scrcpy_sources.push("custom".to_string());

    Ok(serde_json::json!({
        "adb": adb_sources,
        "scrcpy": scrcpy_sources,
    }))
}

/// 更新工具路径设置并重新初始化
/// Update tool path settings and reinitialize
#[tauri::command]
pub async fn update_tool_paths(
    adb_source: String,
    adb_custom_path: Option<String>,
    scrcpy_source: String,
    scrcpy_custom_path: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<Value, String> {
    // 保存设置到数据库 / Save settings to database
    state.db.set_setting("adb_source", &adb_source).map_err(|e| e.to_string())?;
    state.db.set_setting("adb_custom_path", adb_custom_path.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;
    state.db.set_setting("scrcpy_source", &scrcpy_source).map_err(|e| e.to_string())?;
    state.db.set_setting("scrcpy_custom_path", scrcpy_custom_path.as_deref().unwrap_or("")).map_err(|e| e.to_string())?;

    // 重新初始化 ADB / Reinitialize ADB
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let adb_result = crate::adb::init_adb(
        &resource_dir,
        &adb_source,
        adb_custom_path.as_deref().unwrap_or(""),
    );

    // 更新 scrcpy 设置 / Update scrcpy settings
    crate::scrcpy::set_scrcpy_source(&scrcpy_source);
    if let Some(ref path) = scrcpy_custom_path {
        if !path.is_empty() {
            crate::scrcpy::set_scrcpy_custom_path(path);
        }
    }

    match adb_result {
        Ok(info) => Ok(serde_json::json!({
            "success": true,
            "adb": serde_json::to_value(&info).unwrap(),
        })),
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "error": e.to_string(),
        })),
    }
}

/// 验证工具路径是否有效
/// Validate a tool path before saving
#[tauri::command]
pub async fn validate_tool_path(tool: String, path: String) -> Result<bool, String> {
    match tool.as_str() {
        "adb" => Ok(crate::adb::validate_adb_path(&path)),
        "scrcpy" => Ok(crate::scrcpy::validate_scrcpy_path(&path)),
        _ => Err(format!("Unknown tool: {}", tool)),
    }
}

// ========== 文件读写命令 ==========
// ========== File I/O Commands ==========

/// 读取本地文本文件
/// Read a local text file
#[tauri::command]
pub async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// 写入本地文本文件
/// Write a local text file
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write {}: {}", path, e))
}
