use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::Utc;
use serde::{Serialize, de::DeserializeOwned};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::models::{DeviceTokenHistoryItem, PayloadHistoryItem, PushRequest, PushSettings};

const SETTINGS_FILE: &str = "push-lab-settings.json";
const PAYLOAD_HISTORY_FILE: &str = "push-lab-payload-history.json";
const TOKEN_HISTORY_FILE: &str = "push-lab-device-token-history.json";
const LEGACY_CHANNELS: [&str; 2] = ["stable", "dev"];

fn app_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(directory)
}

fn app_data_path(app: &AppHandle, file: &str) -> Result<PathBuf, String> {
    Ok(app_data_directory(app)?.join(file))
}

fn read_json<T: DeserializeOwned>(path: impl AsRef<Path>) -> Option<T> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

fn write_json<T: Serialize>(path: impl AsRef<Path>, value: &T) -> Result<(), String> {
    let path = path.as_ref();
    let data =
        serde_json::to_vec_pretty(value).map_err(|error| format!("序列化数据失败：{error}"))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, data).map_err(|error| format!("写入临时数据失败：{error}"))?;
    fs::rename(&temporary, path).map_err(|error| format!("保存数据失败：{error}"))
}

fn read_json_with_legacy_migration<T>(directory: &Path, file: &str) -> Option<T>
where
    T: DeserializeOwned + Serialize,
{
    let current_path = directory.join(file);
    if current_path.exists() {
        return read_json(current_path);
    }

    for channel in LEGACY_CHANNELS {
        let legacy_path = directory.join(channel).join(file);
        let Some(value) = read_json::<T>(&legacy_path) else {
            continue;
        };
        if let Err(error) = write_json(&current_path, &value) {
            eprintln!("迁移旧版数据失败（{}）：{error}", legacy_path.display());
        }
        return Some(value);
    }

    None
}

pub fn load_settings(app: &AppHandle) -> PushSettings {
    let Ok(directory) = app_data_directory(app) else {
        return PushSettings::default();
    };
    read_json_with_legacy_migration(&directory, SETTINGS_FILE).unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &PushSettings) -> Result<(), String> {
    write_json(app_data_path(app, SETTINGS_FILE)?, settings)
}

pub fn load_payload_history(app: &AppHandle) -> Vec<PayloadHistoryItem> {
    let Ok(directory) = app_data_directory(app) else {
        return Vec::new();
    };
    let mut history: Vec<PayloadHistoryItem> =
        read_json_with_legacy_migration(&directory, PAYLOAD_HISTORY_FILE).unwrap_or_default();
    history.truncate(50);
    history
}

pub fn clear_payload_history(app: &AppHandle) -> Result<(), String> {
    write_json(
        app_data_path(app, PAYLOAD_HISTORY_FILE)?,
        &Vec::<PayloadHistoryItem>::new(),
    )
}

pub fn save_payload_history(app: &AppHandle, request: &PushRequest) -> Result<(), String> {
    let item = PayloadHistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        topic: request.settings.topic.clone(),
        push_type: request.settings.push_type.clone(),
        priority: request.settings.priority,
        collapse_id: request.settings.collapse_id.clone(),
        expiration: request.settings.expiration.clone(),
        payload: request.settings.payload.clone(),
    };
    let history = prepend_payload_history(item, load_payload_history(app));
    write_json(app_data_path(app, PAYLOAD_HISTORY_FILE)?, &history)
}

pub fn prepend_payload_history(
    item: PayloadHistoryItem,
    mut history: Vec<PayloadHistoryItem>,
) -> Vec<PayloadHistoryItem> {
    if let Some(index) = history
        .iter()
        .position(|entry| entry.payload == item.payload)
    {
        let id = history[index].id.clone();
        history.remove(index);
        history.insert(0, PayloadHistoryItem { id, ..item });
    } else {
        history.insert(0, item);
    }
    history.truncate(50);
    history
}

pub fn load_device_token_history(app: &AppHandle) -> Vec<DeviceTokenHistoryItem> {
    let Ok(directory) = app_data_directory(app) else {
        return Vec::new();
    };
    let mut history: Vec<DeviceTokenHistoryItem> =
        read_json_with_legacy_migration(&directory, TOKEN_HISTORY_FILE).unwrap_or_default();
    history.truncate(10);
    history
}

pub fn clear_device_token_history(app: &AppHandle) -> Result<(), String> {
    write_json(
        app_data_path(app, TOKEN_HISTORY_FILE)?,
        &Vec::<DeviceTokenHistoryItem>::new(),
    )
}

pub fn save_device_token_history(app: &AppHandle, request: &PushRequest) -> Result<(), String> {
    let token = crate::apns::normalize_device_token(&request.settings.device_token);
    if token.is_empty() {
        return Ok(());
    }
    let item = DeviceTokenHistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now().to_rfc3339(),
        token,
        environment: request.settings.environment.clone(),
    };
    let history = prepend_device_token_history(item, load_device_token_history(app));
    write_json(app_data_path(app, TOKEN_HISTORY_FILE)?, &history)
}

pub fn prepend_device_token_history(
    item: DeviceTokenHistoryItem,
    mut history: Vec<DeviceTokenHistoryItem>,
) -> Vec<DeviceTokenHistoryItem> {
    if let Some(index) = history.iter().position(|entry| entry.token == item.token) {
        let id = history[index].id.clone();
        history.remove(index);
        history.insert(0, DeviceTokenHistoryItem { id, ..item });
    } else {
        history.insert(0, item);
    }
    history.truncate(10);
    history
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Environment;

    fn payload_item(index: usize, payload: &str) -> PayloadHistoryItem {
        PayloadHistoryItem {
            id: format!("payload-{index}"),
            created_at: format!("2026-09-28T00:00:{index:02}Z"),
            topic: format!("dev.pushlab.test.{index}"),
            push_type: "alert".into(),
            priority: 10,
            collapse_id: String::new(),
            expiration: "0".into(),
            payload: payload.into(),
        }
    }

    fn token_item(index: usize, token: &str) -> DeviceTokenHistoryItem {
        DeviceTokenHistoryItem {
            id: format!("token-{index}"),
            created_at: format!("2026-09-28T00:00:{index:02}Z"),
            token: token.into(),
            environment: Environment::Development,
        }
    }

    #[test]
    fn payload_history_deduplicates_and_preserves_id() {
        let existing = payload_item(1, r#"{"aps":{"badge":1}}"#);
        let existing_id = existing.id.clone();
        let mut updated = payload_item(2, &existing.payload);
        updated.topic = "dev.pushlab.updated".into();

        let history = prepend_payload_history(updated, vec![payload_item(0, "{}"), existing]);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, existing_id);
        assert_eq!(history[0].topic, "dev.pushlab.updated");
    }

    #[test]
    fn payload_history_keeps_latest_fifty_items() {
        let history = (0..50)
            .map(|index| payload_item(index, &format!(r#"{{"index":{index}}}"#)))
            .collect();

        let history = prepend_payload_history(payload_item(50, r#"{"index":50}"#), history);

        assert_eq!(history.len(), 50);
        assert_eq!(history[0].id, "payload-50");
        assert_eq!(history[49].id, "payload-48");
    }

    #[test]
    fn token_history_deduplicates_and_preserves_id() {
        let existing = token_item(1, "device-token");
        let existing_id = existing.id.clone();
        let mut updated = token_item(2, "device-token");
        updated.environment = Environment::Production;

        let history = prepend_device_token_history(updated, vec![token_item(0, "other"), existing]);

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, existing_id);
        assert_eq!(history[0].environment, Environment::Production);
    }

    #[test]
    fn token_history_keeps_latest_ten_items() {
        let history = (0..10)
            .map(|index| token_item(index, &format!("token-{index}")))
            .collect();

        let history = prepend_device_token_history(token_item(10, "token-10"), history);

        assert_eq!(history.len(), 10);
        assert_eq!(history[0].id, "token-10");
        assert_eq!(history[9].id, "token-8");
    }

    #[test]
    fn legacy_migration_prefers_stable_and_does_not_overwrite_current_data() {
        let directory = std::env::temp_dir().join(format!("pushlab-storage-{}", Uuid::new_v4()));
        fs::create_dir_all(directory.join("stable")).expect("应创建 stable 测试目录");
        fs::create_dir_all(directory.join("dev")).expect("应创建 dev 测试目录");
        write_json(directory.join("stable/settings.json"), &"stable").expect("应写入 stable 数据");
        write_json(directory.join("dev/settings.json"), &"dev").expect("应写入 dev 数据");

        let migrated: String =
            read_json_with_legacy_migration(&directory, "settings.json").expect("应读取旧版数据");
        assert_eq!(migrated, "stable");
        assert_eq!(
            read_json::<String>(directory.join("settings.json")).as_deref(),
            Some("stable")
        );

        write_json(directory.join("settings.json"), &"current").expect("应写入当前数据");
        let current: String =
            read_json_with_legacy_migration(&directory, "settings.json").expect("应读取当前数据");
        assert_eq!(current, "current");

        fs::remove_dir_all(directory).expect("应清理测试目录");
    }
}
