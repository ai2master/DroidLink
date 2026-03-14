// DroidLink 主入口模块 - 初始化应用状态、事件路由、命令注册
// DroidLink main entry module - initialize app state, event routing, command registration
//
// 安全约束 / Security constraints:
// - 桌面端与 Android 端之间不允许建立任何网络连接 (No network connections between desktop and Android)
// - 不允许使用 adb forward 端口转发 (No adb forward port forwarding)
// - 所有通信仅通过 adb shell 命令和 adb push/pull 文件传输 (All comms via adb shell + adb push/pull only)
// - TcpStream 仅用于检测本机 ADB 服务器守护进程 (TcpStream only for local ADB server daemon detection)

pub mod adb;
pub mod clipboard;
pub mod commands;
pub mod db;
pub mod filemanager;
pub mod scrcpy;
pub mod sync;
pub mod transfer;
pub mod version;

use std::sync::Arc;
use tauri::{Manager, Emitter};

use adb::DeviceMonitor;
use clipboard::ClipboardBridge;
use db::Database;
use scrcpy::ScrcpyManager;
use sync::SyncEngine;
use transfer::FolderSync;
use version::VersionManager;

pub mod app_state {
    use super::*;

    pub struct AppState {
        pub db: Arc<Database>,
        pub sync_engine: Arc<SyncEngine>,
        pub version_manager: Arc<VersionManager>,
        pub clipboard_bridge: Arc<ClipboardBridge>,
        pub scrcpy_manager: Arc<ScrcpyManager>,
        pub folder_sync: Arc<FolderSync>,
        pub device_monitor: Arc<DeviceMonitor>,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Linux: 启用 WebKitGTK GPU 硬件加速，适配 Intel/AMD/NVIDIA 显卡
    // Linux: Enable WebKitGTK GPU hardware acceleration for Intel/AMD/NVIDIA
    #[cfg(target_os = "linux")]
    {
        // 启用硬件加速合成 / Enable hardware-accelerated compositing
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "0");
        }
        // NVIDIA 闭源驱动: 如果 DMA-BUF 渲染器有问题，用户可以手动设置此变量
        // NVIDIA proprietary driver: if DMA-BUF renderer causes issues, user can set this
        // WEBKIT_DISABLE_DMABUF_RENDERER=1
    }

    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();

    // 纯 ADB USB 模式，不使用任何 TCP/网络连接
    // Pure ADB USB mode, no TCP/network connections
    log::info!("DroidLink starting (pure ADB mode, no TCP)...");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("Failed to get app data dir");
            let data_path = data_dir.join("droidlink-data");

            log::info!("Data path: {:?}", data_path);

            // 先初始化数据库，读取工具路径设置
            // Initialize database first to read tool path settings
            let db = Arc::new(Database::new(&data_path).expect("Failed to initialize database"));

            // 从数据库读取 ADB/scrcpy 来源设置
            // Read ADB/scrcpy source settings from database
            let adb_source = db.get_setting("adb_source")
                .ok().flatten().unwrap_or_else(|| "bundled".to_string());
            let adb_custom_path = db.get_setting("adb_custom_path")
                .ok().flatten().unwrap_or_default();

            // ========== 初始化 ADB (根据用户设置选择来源) ==========
            // ========== Initialize ADB (source based on user settings) ==========
            let resource_dir = app.path().resource_dir().unwrap_or_else(|_| data_dir.clone());
            match adb::init_adb(&resource_dir, &adb_source, &adb_custom_path) {
                Ok(info) => {
                    log::info!("ADB 初始化成功 / ADB initialized: path={}, port={}, source={}, reused={}",
                        info.adb_path, info.port, info.source, info.reused_server);
                }
                Err(e) => {
                    log::warn!("ADB 初始化失败 / ADB init failed (app will still start): {}", e);
                }
            }

            // 初始化 scrcpy 路径设置
            // Initialize scrcpy path settings
            let scrcpy_source = db.get_setting("scrcpy_source")
                .ok().flatten().unwrap_or_else(|| "system".to_string());
            let scrcpy_custom_path = db.get_setting("scrcpy_custom_path")
                .ok().flatten().unwrap_or_default();
            scrcpy::set_scrcpy_source(&scrcpy_source);
            if !scrcpy_custom_path.is_empty() {
                scrcpy::set_scrcpy_custom_path(&scrcpy_custom_path);
            }

            // 初始化版本管理器 / Initialize version manager
            let version_manager = Arc::new(VersionManager::new(db.clone(), &data_path));

            // 初始化同步引擎 (纯 ADB, 无 TCP)
            // Initialize sync engine (pure ADB, no TCP)
            let sync_engine = Arc::new(SyncEngine::new(db.clone()));

            // 初始化剪贴板桥接 (纯 ADB, 无 TCP)
            // Initialize clipboard bridge (pure ADB, no TCP)
            let clipboard_bridge = Arc::new(ClipboardBridge::new());

            // 初始化 scrcpy 管理器
            // Initialize scrcpy manager
            let scrcpy_manager = Arc::new(ScrcpyManager::new());

            // 初始化文件夹同步
            // Initialize folder sync
            let mut folder_sync_inner = FolderSync::new(db.clone());

            // 初始化设备监控器
            // Initialize device monitor
            let device_monitor = Arc::new(DeviceMonitor::new());

            // 设置事件通道 (同步引擎 -> 前端)
            // Set up event channels (sync engine -> frontend)
            let (sync_tx, sync_rx) = crossbeam_channel::unbounded();
            sync_engine.set_event_sender(sync_tx);

            let (folder_tx, folder_rx) = crossbeam_channel::unbounded();
            folder_sync_inner.set_event_sender(folder_tx);
            let folder_sync = Arc::new(folder_sync_inner);

            // 设备监控事件
            // Device monitor events
            let (device_tx, device_rx) = crossbeam_channel::unbounded();
            device_monitor.start(device_tx);

            // 转发事件到前端
            // Forward events to frontend
            let app_handle = app.handle().clone();
            let se = sync_engine.clone();
            let db_for_events = db.clone();

            std::thread::spawn(move || {
                loop {
                    crossbeam_channel::select! {
                        recv(device_rx) -> msg => {
                            if let Ok(event) = msg {
                                match event {
                                    adb::DeviceEvent::Connected(info) => {
                                        log::info!("设备已连接 / Device connected: {} ({})", info.display_name, info.serial);
                                        let _ = app_handle.emit("device-connected", &info);

                                        // 检查 companion app 是否已安装，通知前端
                                        // Check if companion app is installed, notify frontend
                                        let serial_for_check = info.serial.clone();
                                        let app_handle_for_check = app_handle.clone();
                                        std::thread::spawn(move || {
                                            let output = adb::shell(&serial_for_check, "pm list packages com.droidlink.companion 2>/dev/null");
                                            let installed = output.as_ref().map(|o| o.contains("com.droidlink.companion")).unwrap_or(false);

                                            let version = if installed {
                                                adb::shell(&serial_for_check, "dumpsys package com.droidlink.companion | grep versionName")
                                                    .ok()
                                                    .and_then(|v| v.lines().find(|l| l.contains("versionName")).map(|l| l.split('=').last().unwrap_or("").trim().to_string()))
                                                    .unwrap_or_default()
                                            } else {
                                                String::new()
                                            };

                                            let _ = app_handle_for_check.emit("companion-status", serde_json::json!({
                                                "serial": serial_for_check,
                                                "installed": installed,
                                                "version": version,
                                            }));

                                            if !installed {
                                                log::info!("Companion app NOT installed on {}. Frontend will prompt user.", serial_for_check);
                                            }
                                        });

                                        // 仅在用户启用 autoSync 时才自动同步，默认不自动同步
                                        // Only auto-sync if user has enabled autoSync setting, default OFF
                                        let auto_sync_enabled = db_for_events
                                            .get_setting("auto_sync")
                                            .ok()
                                            .flatten()
                                            .map(|v| v == "true")
                                            .unwrap_or(false);
                                        if auto_sync_enabled {
                                            log::info!("Auto-sync enabled, starting sync for {}", info.serial);
                                            se.start_sync(&info.serial);
                                        } else {
                                            log::info!("Auto-sync disabled, skipping auto-sync for {}", info.serial);
                                        }
                                    }
                                    adb::DeviceEvent::Disconnected(serial) => {
                                        log::info!("设备已断开 / Device disconnected: {}", serial);
                                        let _ = app_handle.emit("device-disconnected", &serial);
                                        se.stop_sync(&serial);
                                    }
                                }
                            }
                        },
                        recv(sync_rx) -> msg => {
                            if let Ok(event) = msg {
                                match &event {
                                    sync::SyncEvent::Started { serial, data_type } => {
                                        let _ = app_handle.emit("sync-status", serde_json::json!({
                                            "type": "started", "serial": serial, "dataType": data_type
                                        }));
                                    }
                                    sync::SyncEvent::Progress { serial, data_type, current, total } => {
                                        let _ = app_handle.emit("sync-progress", serde_json::json!({
                                            "serial": serial, "dataType": data_type, "current": current, "total": total
                                        }));
                                    }
                                    sync::SyncEvent::Completed { serial, data_type, items_synced } => {
                                        let _ = app_handle.emit("sync-status", serde_json::json!({
                                            "type": "completed", "serial": serial, "dataType": data_type, "itemsSynced": items_synced
                                        }));
                                    }
                                    sync::SyncEvent::Error { serial, data_type, message } => {
                                        let _ = app_handle.emit("sync-error", serde_json::json!({
                                            "serial": serial, "dataType": data_type, "message": message
                                        }));
                                    }
                                }
                            }
                        },
                        recv(folder_rx) -> msg => {
                            if let Ok(event) = msg {
                                match &event {
                                    transfer::FolderSyncEvent::Progress { pair_id, current, total, file, action, bytes } => {
                                        let _ = app_handle.emit("folder-sync-progress", serde_json::json!({
                                            "pairId": pair_id, "current": current, "total": total, "file": file,
                                            "action": action, "bytes": bytes
                                        }));
                                    }
                                    transfer::FolderSyncEvent::Completed { pair_id, result } => {
                                        let _ = app_handle.emit("folder-sync-progress", serde_json::json!({
                                            "pairId": pair_id, "type": "completed", "result": serde_json::to_value(result).unwrap()
                                        }));
                                    }
                                    transfer::FolderSyncEvent::Error { pair_id, message } => {
                                        let _ = app_handle.emit("folder-sync-progress", serde_json::json!({
                                            "pairId": pair_id, "type": "error", "message": message
                                        }));
                                    }
                                    _ => {}
                                }
                            }
                        },
                    }
                }
            });

            // 存储应用状态
            // Store application state
            let state = app_state::AppState {
                db,
                sync_engine,
                version_manager,
                clipboard_bridge,
                scrcpy_manager,
                folder_sync,
                device_monitor,
            };
            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 设备命令 / Device commands
            commands::get_devices,
            commands::get_device_info,
            commands::check_adb,
            commands::get_adb_info,
            // 联系人命令 / Contact commands
            commands::get_contacts,
            commands::get_contact_history,
            commands::delete_contact,
            commands::export_contacts,
            // 短信命令 / Message commands
            commands::get_messages,
            commands::get_conversations,
            commands::export_messages,
            // 通话记录命令 / Call log commands
            commands::get_call_logs,
            commands::export_call_logs,
            // 同步命令 / Sync commands
            commands::trigger_sync,
            commands::start_auto_sync,
            commands::get_sync_status,
            commands::get_sync_config,
            commands::set_sync_config,
            // 版本历史命令 / Version history commands
            commands::get_version_history,
            commands::get_version_detail,
            commands::restore_version,
            commands::compare_versions,
            commands::delete_old_versions,
            // 文件管理命令 / File manager commands
            commands::list_files,
            commands::pull_file,
            commands::push_file,
            commands::delete_file,
            commands::create_folder,
            // 文件夹同步命令 / Folder sync commands
            commands::get_folder_sync_pairs,
            commands::add_folder_sync_pair,
            commands::remove_folder_sync_pair,
            commands::trigger_folder_sync,
            commands::get_transfer_info,
            commands::clean_folder_versions,
            // 剪贴板命令 / Clipboard commands
            commands::get_clipboard_content,
            commands::send_clipboard_to_device,
            commands::get_clipboard_info,
            // 文件传输命令 / File transfer commands
            commands::send_file_to_device,
            commands::receive_file_from_device,
            commands::send_folder_to_device,
            // scrcpy 命令 / scrcpy commands
            commands::start_scrcpy,
            commands::stop_scrcpy,
            commands::is_scrcpy_running,
            commands::check_scrcpy,
            // DroidLink IME 命令 (中日韩输入) / DroidLink IME commands (CJK input)
            commands::send_text_to_device,
            commands::send_key_to_device,
            commands::send_backspace_to_device,
            commands::send_enter_to_device,
            commands::setup_droidlink_ime,
            commands::restore_default_ime,
            // 键盘直通命令 (手机自带输入法) / Keyboard passthrough commands (native IME)
            commands::passthrough_keyevent,
            commands::passthrough_text,
            commands::list_device_imes,
            commands::get_current_ime,
            commands::switch_ime,
            // Companion App 命令 / Companion App commands
            commands::check_companion_app,
            commands::install_companion_app,
            // 设置命令 / Settings commands
            commands::get_settings,
            commands::set_settings,
            commands::get_data_path,
            commands::open_in_explorer,
            // 工具路径命令 / Tool path commands
            commands::get_tool_sources,
            commands::update_tool_paths,
            commands::validate_tool_path,
            // 文件读写命令 / File I/O commands
            commands::read_text_file,
            commands::write_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DroidLink");
}
