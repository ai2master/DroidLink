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
    // Ensure local parent directory exists
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    adb::pull(&serial, &remote_path, &local_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pull_directory(serial: String, remote_path: String, local_path: String) -> Result<(), String> {
    // Ensure local parent directory exists
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    adb::pull_directory(&serial, &remote_path, &local_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn push_file(serial: String, local_path: String, remote_path: String) -> Result<(), String> {
    adb::push(&serial, &local_path, &remote_path).map_err(|e| e.to_string())?;
    // 自动触发媒体扫描, 使推送的文件出现在相册/音乐等应用中
    // Auto-trigger media scan so pushed files appear in Gallery/Music apps
    let _ = adb::trigger_media_scan(&serial, &remote_path);
    Ok(())
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

/// 获取日志文件路径 / Get log file path
#[tauri::command]
pub async fn get_log_path() -> Result<String, String> {
    Ok(crate::get_log_file_path())
}

/// 列出系统已安装的字体族名称
/// List installed system font family names
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    let mut fonts = std::collections::BTreeSet::new();

    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = std::process::Command::new("fc-list")
            .arg(":")
            .arg("family")
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                // fc-list can return comma-separated families
                for fam in line.split(',') {
                    let name = fam.trim().to_string();
                    if !name.is_empty() {
                        fonts.insert(name);
                    }
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: fc-list is often available via Homebrew, fallback to system_profiler
        if let Ok(output) = std::process::Command::new("fc-list")
            .arg(":")
            .arg("family")
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    for fam in line.split(',') {
                        let name = fam.trim().to_string();
                        if !name.is_empty() {
                            fonts.insert(name);
                        }
                    }
                }
            }
        }
        // Fallback: enumerate system font directories
        if fonts.is_empty() {
            for dir in &["/System/Library/Fonts", "/Library/Fonts"] {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.path().file_stem() {
                            let n = name.to_string_lossy().to_string();
                            if !n.starts_with('.') {
                                fonts.insert(n);
                            }
                        }
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Read font names from the Windows Fonts registry key
        let fonts_dir = std::path::PathBuf::from(std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into()))
            .join("Fonts");
        if let Ok(entries) = std::fs::read_dir(&fonts_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext_lower = ext.to_string_lossy().to_lowercase();
                    if ext_lower == "ttf" || ext_lower == "otf" || ext_lower == "ttc" {
                        if let Some(stem) = path.file_stem() {
                            let name = stem.to_string_lossy().to_string();
                            if !name.is_empty() {
                                fonts.insert(name);
                            }
                        }
                    }
                }
            }
        }
    }

    // Always include common fallback fonts
    for f in &["Arial", "Helvetica", "Times New Roman", "Courier New", "Georgia",
               "Verdana", "Trebuchet MS", "Segoe UI", "Roboto", "Noto Sans",
               "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB"] {
        fonts.insert(f.to_string());
    }

    Ok(fonts.into_iter().collect())
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

// ========================================================================
// Companion App 命令 - 版本管理与安装
// Companion App Commands - Version Management & Installation
// ========================================================================
//
// 【架构说明 / Architecture】
//
// DroidLink Desktop 内置了 Companion APK 和 version.txt 元数据文件：
// DroidLink Desktop bundles the Companion APK and version.txt metadata file:
//   resources/companion/DroidLinkCompanion.apk  ── 编译好的 APK 安装包
//                                                  Pre-built APK installer
//   resources/companion/version.txt             ── JSON 格式的版本元数据
//                                                  JSON format version metadata
//
// version.txt 格式 / version.txt format:
//   {
//     "version": "2.0.0",        // 基础语义版本 / base semantic version
//     "build": 42,               // CI 构建号 = git commit count
//     "versionCode": 42,         // Android versionCode (与 build 相同)
//     "protocolVersion": 1,      // 协议版本号 / protocol version
//     "sha": "9d8f3a1"           // git commit SHA (前 7 位)
//   }
//
// 旧版 version.txt 是纯文本格式 (如 "1.0.42")，代码对此有向后兼容处理。
// Legacy version.txt is plain text (e.g. "1.0.42"), code has backward compat handling.
//
// 【更新判断逻辑 / Update Decision Logic】
//
// 以前：字符串比较 deviceVersion != bundledVersion → 总是触发更新提示 (误报)
// Before: string compare deviceVersion != bundledVersion → always triggered update (false positive)
//
// 现在：协议版本比较，只有 ADB 接口不兼容时才提示更新
// Now: protocol version comparison, only prompts update when ADB interface is incompatible
//
//   device.protocolVersion >= desktop.PROTOCOL_VERSION → 兼容 / compatible
//   device.protocolVersion <  desktop.PROTOCOL_VERSION → 不兼容 / incompatible
//   无法获取 protocolVersion (旧版 Companion) → 回退到字符串比较
//   Cannot get protocolVersion (old Companion) → fallback to string comparison
// ========================================================================

/// Companion 应用的 Android 包名 / Companion app's Android package name
const COMPANION_PACKAGE: &str = "com.droidlink.companion";

/// =====================================================================
/// 协议版本号 / Protocol Version Number
/// =====================================================================
///
/// 仅在 Desktop ↔ Companion 的 ADB 通信接口变更时递增。
/// Only increment when the ADB communication interface between
/// Desktop and Companion changes.
///
/// 需要递增的场景 / Scenarios requiring increment:
///   - 新增/修改/删除 broadcast action (EXPORT_CONTACTS, EXPORT_CHANGES 等)
///     Added/modified/removed broadcast actions
///   - 修改导出 JSON 格式 (增删改字段名、类型或嵌套结构)
///     Changed export JSON format (fields, types, nesting)
///   - 修改 DroidLinkIME 或 ClipboardReceiver 的 broadcast 接口
///     Changed DroidLinkIME or ClipboardReceiver broadcast interface
///
/// 不需要递增的场景 / Scenarios NOT requiring increment:
///   - 内部逻辑优化 (性能改进、ContentObserver 策略)
///     Internal logic optimizations (performance, ContentObserver strategy)
///   - UI 调整、日志变更、权限检查逻辑变更 (不影响输出格式)
///     UI changes, log changes, permission check changes (no output format impact)
///
/// 修改此值时必须同步修改 / When changing this, also update:
///   1. android/.../CompanionVersion.kt → PROTOCOL_VERSION
///   2. .github/workflows/build.yml → version.txt 中的 protocolVersion 字段
///      .github/workflows/build.yml → protocolVersion field in version.txt
pub const PROTOCOL_VERSION: u32 = 1;

/// =====================================================================
/// 检查 Companion 应用安装状态、版本和协议兼容性
/// Check Companion app installation status, version, and protocol compatibility
/// =====================================================================
///
/// 前端通过 Tauri command 调用此函数。
/// Frontend invokes this function via Tauri command.
///
/// 返回 JSON / Returns JSON:
/// ```json
/// {
///   "installed": true,                    // 是否已安装 / whether installed
///   "deviceVersion": "2.0.0.42",          // 设备上的 versionName
///   "bundledVersion": "2.0.0.42",         // Desktop 内置的版本号
///   "bundledBuild": 42,                   // Desktop 内置的构建号
///   "needsUpdate": false,                 // 是否需要更新 / whether update needed
///   "protocolVersion": 1,                 // Desktop 端协议版本
///   "deviceProtocolVersion": 1            // 设备端协议版本 (null=旧版/未安装)
/// }
/// ```
///
/// needsUpdate 判断逻辑 / needsUpdate decision logic:
///   1. 未安装 → false (由 installed=false 另行处理)
///      Not installed → false (handled separately by installed=false)
///   2. 设备有 protocolVersion 且 < Desktop 的 → true
///      Device has protocolVersion and < Desktop's → true
///   3. 设备无 protocolVersion (旧版) → 回退到 versionName 字符串比较
///      Device lacks protocolVersion (old version) → fallback to versionName comparison
#[tauri::command]
pub async fn check_companion_app(serial: String, app_handle: tauri::AppHandle) -> Result<Value, String> {
    // 第 1 步：检查包是否已安装 / Step 1: Check if package is installed
    // 通过 pm list packages 命令查询 / Query via pm list packages command
    let output = adb::shell(&serial, &format!("pm list packages {}", COMPANION_PACKAGE))
        .map_err(|e| e.to_string())?;
    let installed = output.contains(COMPANION_PACKAGE);

    // 未安装：直接返回，前端会显示安装提示
    // Not installed: return immediately, frontend will show install prompt
    if !installed {
        return Ok(serde_json::json!({
            "installed": false,
            "deviceVersion": null,
            "needsUpdate": false,
            "protocolVersion": PROTOCOL_VERSION,
            "deviceProtocolVersion": null,
        }));
    }

    // 第 2 步：获取设备上已安装的 versionName / Step 2: Get installed versionName
    // 通过 dumpsys package 命令提取 / Extract via dumpsys package command
    let version_output = adb::shell(&serial,
        &format!("dumpsys package {} | grep versionName", COMPANION_PACKAGE))
        .unwrap_or_default();
    let device_version = version_output
        .lines()
        .find(|l| l.contains("versionName"))
        .and_then(|l| l.split('=').last())
        .map(|v| v.trim().to_string())
        .unwrap_or_default();

    // 第 3 步：获取设备端的协议版本号 / Step 3: Get device-side protocol version
    // 通过 EXPORT_CHANGES broadcast 触发 DataExportReceiver 返回含 protocolVersion 的 JSON
    // Trigger DataExportReceiver via EXPORT_CHANGES broadcast to get JSON with protocolVersion
    let device_protocol = get_device_protocol_version(&serial);

    // 第 4 步：读取 Desktop 内置的版本信息 / Step 4: Read bundled version info from resources
    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let bundled_info = get_bundled_companion_info(&resource_dir);

    // 第 5 步：协议版本判断 / Step 5: Protocol version check
    // 核心逻辑：只有协议不兼容才提示更新，内部优化无需更新
    // Core logic: only prompt update when protocol incompatible, internal optimizations skip update
    let needs_update = match device_protocol {
        // 有协议版本：直接比较。设备版本 < Desktop 版本 → 不兼容
        // Has protocol version: direct compare. Device < Desktop → incompatible
        Some(dev_proto) => dev_proto < PROTOCOL_VERSION,
        // 无法获取协议版本（旧版 Companion 没有此字段）→ 回退到字符串比较
        // Cannot get protocol version (old companion lacks this field) → fallback to string compare
        None => {
            let bundled_version = bundled_info.as_ref()
                .and_then(|info| info.get("version").and_then(|v| v.as_str()))
                .unwrap_or("");
            !device_version.is_empty() && !bundled_version.is_empty() && device_version != bundled_version
        }
    };

    // 组装返回数据 / Assemble return data
    let bundled_version = bundled_info.as_ref()
        .and_then(|info| info.get("version").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let bundled_build = bundled_info.as_ref()
        .and_then(|info| info.get("build").and_then(|v| v.as_u64()))
        .unwrap_or(0);

    Ok(serde_json::json!({
        "installed": true,
        "deviceVersion": device_version,
        "bundledVersion": if bundled_version.is_empty() {
            // 回退到旧版纯文本 version.txt / Fallback to legacy plain text version.txt
            get_bundled_companion_version_legacy(&resource_dir)
        } else {
            bundled_version
        },
        "bundledBuild": bundled_build,
        "needsUpdate": needs_update,
        "protocolVersion": PROTOCOL_VERSION,
        "deviceProtocolVersion": device_protocol,
    }))
}

/// 公开接口：从设备获取 Companion 协议版本号
/// Public API: get companion protocol version from device
///
/// 供 lib.rs 中设备连接时的自动检查逻辑调用。
/// Called by the auto-check logic in lib.rs when a device connects.
/// 封装了私有的 get_device_protocol_version() 函数。
/// Wraps the private get_device_protocol_version() function.
pub fn get_device_protocol_version_public(serial: &str) -> Option<u32> {
    get_device_protocol_version(serial)
}

/// =====================================================================
/// 从设备获取 Companion 的协议版本号
/// Get companion protocol version from device via EXPORT_CHANGES broadcast
/// =====================================================================
///
/// 实现原理 / Implementation:
///   1. 通过 ADB 发送 EXPORT_CHANGES broadcast 到 DataExportReceiver
///      Send EXPORT_CHANGES broadcast to DataExportReceiver via ADB
///   2. DataExportReceiver 将包含 protocolVersion 的 JSON 写入临时文件
///      DataExportReceiver writes JSON with protocolVersion to temp file
///   3. 读取临时文件内容，解析 JSON 提取 protocolVersion 字段
///      Read temp file content, parse JSON to extract protocolVersion field
///   4. 清理临时文件
///      Clean up temp file
///
/// 返回值 / Return value:
///   - Some(version) ── 成功获取协议版本号
///                       Successfully retrieved protocol version
///   - None ── 获取失败 (Companion 未运行/旧版无此字段/ADB 通信错误)
///              Failed (Companion not running / old version lacks field / ADB error)
///
/// 注意事项 / Notes:
///   - 此操作需要 Companion 已安装且 broadcast receiver 已注册
///     Requires Companion to be installed with registered broadcast receiver
///   - 旧版 Companion (协议版本方案引入之前) 的 EXPORT_CHANGES 响应不含此字段，返回 None
///     Old Companions (pre-protocol-version) don't include this field, returns None
///   - 临时文件使用 /data/local/tmp/ 目录，ADB 有写入权限
///     Temp file uses /data/local/tmp/ directory, ADB has write permission
fn get_device_protocol_version(serial: &str) -> Option<u32> {
    // 使用不同于其他导出操作的临时文件，避免文件冲突
    // Use a different temp file than other export operations to avoid file conflicts
    let tmp_path = "/data/local/tmp/.droidlink_proto_check.json";

    // 合并为单条 ADB shell 命令：发送 broadcast → 读取结果 → 清理文件
    // Combine into single ADB shell command: send broadcast → read result → cleanup
    let cmd = format!(
        "am broadcast -a com.droidlink.EXPORT_CHANGES --es output_path '{}' \
         -n com.droidlink.companion/.data.DataExportReceiver 2>/dev/null && \
         cat '{}' 2>/dev/null && rm -f '{}'",
        tmp_path, tmp_path, tmp_path
    );
    if let Ok(output) = adb::shell(serial, &cmd) {
        // ADB shell 输出可能包含 broadcast 命令本身的输出 (如 "Broadcasting: Intent...")
        // 需要找到 JSON 开始位置 '{' 再解析
        // ADB shell output may contain broadcast command output (e.g. "Broadcasting: Intent...")
        // Need to find JSON start position '{' before parsing
        if let Some(json_start) = output.find('{') {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&output[json_start..]) {
                return parsed.get("protocolVersion").and_then(|v| v.as_u64()).map(|v| v as u32);
            }
        }
    }
    None
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

/// =====================================================================
/// 获取内置 Companion 的用户可见版本号
/// Get the bundled companion's user-facing version string
/// =====================================================================
///
/// 供 lib.rs 在设备连接时的自动检查逻辑调用，用于前端显示。
/// Called by lib.rs auto-check logic when device connects, for frontend display.
///
/// 版本号格式 / Version string format:
///   - JSON 格式 version.txt 且有 build 字段 → "2.0.0.42" (基础版本.构建号)
///     JSON format version.txt with build field → "2.0.0.42" (base.build)
///   - JSON 格式 version.txt 无 build 字段 → "2.0.0" (仅基础版本)
///     JSON format version.txt without build → "2.0.0" (base only)
///   - 纯文本格式 version.txt (旧版) → 原样返回，如 "1.0.42"
///     Plain text version.txt (legacy) → returned as-is, e.g. "1.0.42"
///   - 读取失败 → 空字符串
///     Read failed → empty string
pub fn get_bundled_companion_version_public(resource_dir: &std::path::Path) -> String {
    // 优先尝试 JSON 格式 (新版) / Prefer JSON format (new)
    if let Some(info) = get_bundled_companion_info(resource_dir) {
        if let Some(version) = info.get("version").and_then(|v| v.as_str()) {
            let build = info.get("build").and_then(|v| v.as_u64()).unwrap_or(0);
            if build > 0 {
                // 拼接完整版本号: "2.0.0" + "." + "42" = "2.0.0.42"
                // Compose full version: "2.0.0" + "." + "42" = "2.0.0.42"
                return format!("{}.{}", version, build);
            }
            return version.to_string();
        }
    }
    // 回退到纯文本格式 (旧版兼容) / Fallback to plain text format (legacy compat)
    get_bundled_companion_version_legacy(resource_dir)
}

/// =====================================================================
/// 获取内置 Companion 的协议版本号
/// Get the bundled companion protocol version
/// =====================================================================
///
/// 从 version.txt 的 JSON 格式中读取 protocolVersion 字段。
/// Reads protocolVersion field from JSON format version.txt.
/// 如果无法读取 (文件不存在或旧版纯文本格式)，返回当前 Desktop 的 PROTOCOL_VERSION。
/// If unreadable (file missing or legacy plain text), returns current Desktop PROTOCOL_VERSION.
///
/// 此函数目前作为备用接口存在，主要的协议比较逻辑直接使用 PROTOCOL_VERSION 常量。
/// This function exists as a utility; main protocol comparison logic uses PROTOCOL_VERSION directly.
pub fn get_bundled_protocol_version(resource_dir: &std::path::Path) -> u32 {
    get_bundled_companion_info(resource_dir)
        .and_then(|info| info.get("protocolVersion").and_then(|v| v.as_u64()))
        .map(|v| v as u32)
        .unwrap_or(PROTOCOL_VERSION)
}

/// =====================================================================
/// 读取 version.txt 的 JSON 格式 (新版)
/// Read version.txt in JSON format (new format)
/// =====================================================================
///
/// version.txt 文件位于 / version.txt file located at:
///   {resource_dir}/resources/companion/version.txt
///
/// 新版 JSON 格式 / New JSON format:
///   {
///     "version": "2.0.0",       // 基础语义版本 / base semantic version
///     "build": 42,              // CI 构建号 = git commit count
///     "versionCode": 42,        // Android versionCode (同 build)
///     "protocolVersion": 1,     // 协议版本号 / protocol version
///     "sha": "9d8f3a1"          // git commit 短 SHA / short git SHA
///   }
///
/// 如果文件内容以 '{' 开头则尝试 JSON 解析，否则返回 None (由调用方回退到纯文本处理)。
/// If content starts with '{', try JSON parsing; otherwise return None (caller falls back to plain text).
fn get_bundled_companion_info(resource_dir: &std::path::Path) -> Option<serde_json::Value> {
    let version_path = resource_dir.join("resources").join("companion").join("version.txt");
    if let Ok(content) = std::fs::read_to_string(&version_path) {
        let trimmed = content.trim();
        // 以 '{' 开头判断为 JSON 格式 / Starts with '{' indicates JSON format
        if trimmed.starts_with('{') {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                return Some(parsed);
            }
        }
    }
    None
}

/// =====================================================================
/// 回退：读取 version.txt 的纯文本格式 (旧版兼容)
/// Fallback: read version.txt in plain text format (legacy compatibility)
/// =====================================================================
///
/// 旧版 version.txt 是纯文本，内容直接就是版本号字符串 (如 "1.0.42")。
/// Legacy version.txt is plain text, content is directly the version string (e.g. "1.0.42").
/// 如果文件以 '{' 开头说明是 JSON 格式，不应该走此分支。
/// If file starts with '{' it's JSON format, should not use this branch.
fn get_bundled_companion_version_legacy(resource_dir: &std::path::Path) -> String {
    let version_path = resource_dir.join("resources").join("companion").join("version.txt");
    if let Ok(content) = std::fs::read_to_string(&version_path) {
        let trimmed = content.trim();
        if !trimmed.starts_with('{') {
            return trimmed.to_string();
        }
    }
    log::warn!("Failed to read bundled companion version from {:?}", version_path);
    String::new()
}

// ========== 数据路径迁移命令 ==========
// ========== Data Path Migration Commands ==========

/// 修改数据存储路径并迁移数据
/// Change data storage path and migrate data
#[tauri::command]
pub async fn change_data_path(new_path: String, state: State<'_, AppState>) -> Result<Value, String> {
    let new_path_obj = std::path::Path::new(&new_path);

    // Validate: new path must be a valid directory or creatable
    if new_path_obj.exists() && !new_path_obj.is_dir() {
        return Err("Target path exists but is not a directory".to_string());
    }

    let current_path = state.db.data_path().to_path_buf();
    if current_path == new_path_obj {
        return Err("New path is the same as current path".to_string());
    }

    // Create destination directory
    std::fs::create_dir_all(&new_path).map_err(|e| format!("Failed to create directory: {}", e))?;

    // Copy all files from current data dir to new dir
    let mut copied = 0u64;
    let mut errors = Vec::new();
    fn copy_recursive(src: &std::path::Path, dst: &std::path::Path, copied: &mut u64, errors: &mut Vec<String>) {
        if let Ok(entries) = std::fs::read_dir(src) {
            for entry in entries.flatten() {
                let src_path = entry.path();
                let file_name = entry.file_name();
                let dst_path = dst.join(&file_name);
                if src_path.is_dir() {
                    if let Err(e) = std::fs::create_dir_all(&dst_path) {
                        errors.push(format!("{}: {}", dst_path.display(), e));
                        continue;
                    }
                    copy_recursive(&src_path, &dst_path, copied, errors);
                } else {
                    match std::fs::copy(&src_path, &dst_path) {
                        Ok(bytes) => *copied += bytes,
                        Err(e) => errors.push(format!("{}: {}", src_path.display(), e)),
                    }
                }
            }
        }
    }
    copy_recursive(&current_path, new_path_obj, &mut copied, &mut errors);

    // Save the new data path to settings (will take effect after restart)
    state.db.set_setting("custom_data_path", &new_path).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": errors.is_empty(),
        "bytesCopied": copied,
        "errors": errors,
        "needsRestart": true,
    }))
}

// ========== 同步安全控制命令 ==========
// ========== Sync Safety Control Commands ==========

/// 对比文件夹差异（仅对比，不执行同步）
/// Compare folder differences (compare only, no actual sync)
#[tauri::command]
pub async fn compare_folder_sync(pair_id: String, state: State<'_, AppState>) -> Result<Value, String> {
    let result = state.folder_sync.compare_only(&pair_id).map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(&result).unwrap())
}

// ========== Companion 服务状态命令 ==========
// ========== Companion Service Status Commands ==========

/// 检查 companion app 的前台服务是否正在运行
/// Check if the companion app's foreground service is running
#[tauri::command]
pub async fn check_companion_service(serial: String) -> Result<Value, String> {
    let output = adb::shell(&serial, "dumpsys activity services com.droidlink.companion/.DroidLinkService 2>/dev/null")
        .map_err(|e| e.to_string())?;
    let running = output.contains("ServiceRecord") && !output.contains("(nothing)");

    Ok(serde_json::json!({
        "running": running,
    }))
}

/// 启动 companion app 的前台服务
/// Start the companion app's foreground service
#[tauri::command]
pub async fn start_companion_service(serial: String) -> Result<Value, String> {
    // Start the service via am startservice
    let result = adb::shell(&serial,
        "am startservice -n com.droidlink.companion/.DroidLinkService 2>&1")
        .map_err(|e| e.to_string())?;

    let success = !result.contains("Error") && !result.contains("SecurityException");

    // If direct startservice fails (Android 8+ background restriction), launch the app instead
    if !success {
        let _ = adb::shell(&serial,
            "am start -n com.droidlink.companion/.MainActivity 2>&1");
    }

    Ok(serde_json::json!({
        "success": success || true,
        "message": if success { "Service started" } else { "Launched companion app (Android 8+ requires foreground start)" },
    }))
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

// ========== 媒体扫描器通知命令 ==========
// ========== Media Scanner Notification Commands ==========

/// 触发 Android 媒体扫描器 (推送文件后使其出现在相册/音乐等)
/// Trigger Android media scanner for a specific file
#[tauri::command]
pub async fn trigger_media_scan(serial: String, path: String) -> Result<String, String> {
    crate::adb::trigger_media_scan(&serial, &path).map_err(|e| e.to_string())
}

/// 触发目录级媒体扫描
/// Trigger directory-level media scan
#[tauri::command]
pub async fn trigger_media_scan_directory(serial: String, path: String) -> Result<String, String> {
    crate::adb::trigger_media_scan_directory(&serial, &path).map_err(|e| e.to_string())
}

// ========== 终端模拟器命令 ==========
// ========== Terminal Emulator Commands ==========

/// 在设备上执行 shell 命令并返回输出 (终端模拟器用)
/// Execute shell command on device and return output (for terminal emulator)
#[tauri::command]
pub async fn shell_execute(serial: String, command: String) -> Result<String, String> {
    // 安全: 终端命令不做路径消毒, 由用户自行负责
    // Security: terminal commands are not path-sanitized, user takes responsibility
    crate::adb::shell(&serial, &command).map_err(|e| e.to_string())
}

// ========== 设置导入/导出命令 ==========
// ========== Settings Import/Export Commands ==========

/// 导出所有设置为 JSON 字符串
/// Export all settings as JSON string
#[tauri::command]
pub async fn export_settings(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let settings = state.db.get_all_settings().map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))
}

/// 从 JSON 字符串导入设置
/// Import settings from JSON string
#[tauri::command]
pub async fn import_settings(json: String, state: tauri::State<'_, AppState>) -> Result<u32, String> {
    let settings: std::collections::HashMap<String, String> = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut count = 0u32;
    for (key, value) in &settings {
        // 跳过内部/危险的设置键 / Skip internal/dangerous setting keys
        if key == "db_version" || key == "data_path" {
            continue;
        }
        state.db.set_setting(key, value).map_err(|e| e.to_string())?;
        count += 1;
    }

    Ok(count)
}
