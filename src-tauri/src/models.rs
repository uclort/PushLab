use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Environment {
    Development,
    Production,
}

impl Environment {
    pub fn host(&self) -> &'static str {
        match self {
            Self::Development => "api.sandbox.push.apple.com",
            Self::Production => "api.push.apple.com",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AuthMode {
    Token,
    Keychain,
    Certificate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PushSettings {
    pub environment: Environment,
    pub auth_mode: AuthMode,
    pub team_id: String,
    pub key_id: String,
    pub topic: String,
    pub token_key_path: String,
    pub certificate_path: String,
    pub private_key_path: String,
    pub keychain_identity: String,
    pub keychain_identity_id: String,
    pub device_token: String,
    pub push_type: String,
    pub priority: u8,
    pub collapse_id: String,
    pub expiration: String,
    pub payload: String,
}

impl Default for PushSettings {
    fn default() -> Self {
        Self {
            environment: Environment::Development,
            auth_mode: AuthMode::Keychain,
            team_id: String::new(),
            key_id: String::new(),
            topic: String::new(),
            token_key_path: String::new(),
            certificate_path: String::new(),
            private_key_path: String::new(),
            keychain_identity: String::new(),
            keychain_identity_id: String::new(),
            device_token: String::new(),
            push_type: "alert".into(),
            priority: 10,
            collapse_id: String::new(),
            expiration: "0".into(),
            payload: serde_json::to_string_pretty(&serde_json::json!({
                "aps": {
                    "alert": {
                        "title": "PushLab",
                        "body": "这是一条测试推送"
                    },
                    "sound": "default",
                    "badge": 1
                }
            }))
            .expect("默认 Payload 必须可以序列化"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    #[serde(flatten)]
    pub settings: PushSettings,
    #[serde(default)]
    pub certificate_passphrase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeychainCertificate {
    pub id: String,
    pub name: String,
    pub topic: String,
    pub expires_at: String,
    pub valid_from: String,
    pub subject: String,
    pub team_id: String,
    pub environment: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialField {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialInfo {
    pub title: String,
    pub fields: Vec<CredentialField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadHistoryItem {
    pub id: String,
    pub created_at: String,
    pub topic: String,
    pub push_type: String,
    pub priority: u8,
    pub collapse_id: String,
    pub expiration: String,
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTokenHistoryItem {
    pub id: String,
    pub created_at: String,
    pub token: String,
    pub environment: Environment,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushErrorInfo {
    pub code: String,
    pub message: String,
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResult {
    pub ok: bool,
    pub status: u16,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_info: Option<PushErrorInfo>,
    pub apns_id: String,
    pub host: String,
    pub duration_ms: u128,
    pub response_body: String,
}
