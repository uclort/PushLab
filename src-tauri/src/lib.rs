mod apns;
mod certificate;
mod error_guide;
mod keychain;
mod models;
mod storage;

use std::time::Instant;

use tauri::{
    AppHandle, Emitter,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
};

use models::{
    CredentialInfo, DeviceTokenHistoryItem, KeychainCertificate, PayloadHistoryItem, PushRequest,
    PushResult, PushSettings,
};

#[tauri::command]
fn load_settings(app: AppHandle) -> PushSettings {
    storage::load_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: PushSettings) -> Result<(), String> {
    storage::save_settings(&app, &settings)
}

#[tauri::command]
fn list_keychain_certificates() -> Result<Vec<KeychainCertificate>, String> {
    keychain::list()
}

#[tauri::command]
fn inspect_credential(
    kind: String,
    value: String,
    passphrase: Option<String>,
) -> Result<CredentialInfo, String> {
    match kind.as_str() {
        "keychain" => keychain::inspect(&value),
        "token" => certificate::inspect_token_key(&value),
        "certificate" => certificate::inspect_certificate_file(&value, passphrase.as_deref()),
        _ => Err("不支持的凭据类型".into()),
    }
}

#[tauri::command]
fn load_payload_history(app: AppHandle) -> Vec<PayloadHistoryItem> {
    storage::load_payload_history(&app)
}

#[tauri::command]
fn clear_payload_history(app: AppHandle) -> Result<(), String> {
    storage::clear_payload_history(&app)
}

#[tauri::command]
fn load_device_token_history(app: AppHandle) -> Vec<DeviceTokenHistoryItem> {
    storage::load_device_token_history(&app)
}

#[tauri::command]
fn clear_device_token_history(app: AppHandle) -> Result<(), String> {
    storage::clear_device_token_history(&app)
}

#[tauri::command]
async fn send_push(app: AppHandle, request: PushRequest) -> Result<PushResult, String> {
    let started_at = Instant::now();
    storage::save_settings(&app, &request.settings)?;
    storage::save_payload_history(&app, &request)?;
    storage::save_device_token_history(&app, &request)?;
    let host = request.settings.environment.host().to_string();
    Ok(match apns::send_push(request).await {
        Ok(result) => result,
        Err(reason) => PushResult {
            ok: false,
            status: 0,
            reason,
            reason_info: None,
            apns_id: String::new(),
            host,
            duration_ms: started_at.elapsed().as_millis(),
            response_body: String::new(),
        },
    })
}

fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let about = AboutMetadata {
        name: Some("PushLab".into()),
        version: Some(app.package_info().version.to_string()),
        copyright: Some("Copyright © 2026 PushLab".into()),
        ..Default::default()
    };
    let preferences = MenuItem::with_id(
        app,
        "open-preferences",
        "偏好设置…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    let check_update = MenuItem::with_id(app, "check-update", "检查更新…", true, None::<&str>)?;
    let app_menu = Submenu::with_items(
        app,
        "PushLab",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("关于 PushLab"), Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &preferences,
            &check_update,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("隐藏 PushLab"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?,
            &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 PushLab"))?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        app,
        "文件",
        true,
        &[&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::bring_all_to_front(app, Some("前置全部窗口"))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .menu(application_menu)
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "check-update" => {
                    let _ = app.emit("pushlab://check-update", ());
                }
                "open-preferences" => {
                    let _ = app.emit("pushlab://open-preferences", ());
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            list_keychain_certificates,
            inspect_credential,
            load_payload_history,
            clear_payload_history,
            load_device_token_history,
            clear_device_token_history,
            send_push,
        ])
        .run(tauri::generate_context!())
        .expect("启动 PushLab 失败");
}
