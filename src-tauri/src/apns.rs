use std::{
    fs,
    process::{Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use http::Version;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use reqwest::{Client, Identity};
use serde::Serialize;
use tempfile::NamedTempFile;
use uuid::Uuid;

use crate::{
    error_guide::describe_apns_error,
    keychain,
    models::{AuthMode, PushRequest, PushResult},
};

#[derive(Serialize)]
struct ProviderClaims<'a> {
    iss: &'a str,
    iat: u64,
}

pub fn normalize_device_token(value: &str) -> String {
    value
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '<' && *character != '>')
        .collect()
}

pub fn validate_push_request(request: &PushRequest) -> Result<(String, usize), String> {
    let settings = &request.settings;
    let device_token = normalize_device_token(&settings.device_token);
    if device_token.len() < 32
        || !device_token.len().is_multiple_of(2)
        || !device_token
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Device Token 必须是有效的十六进制字符串".into());
    }
    if settings.topic.trim().is_empty() {
        return Err("Topic（Bundle ID）不能为空".into());
    }
    let payload: serde_json::Value = serde_json::from_str(&settings.payload)
        .map_err(|_| "Payload 不是有效的 JSON".to_string())?;
    if payload
        .get("aps")
        .and_then(|value| value.as_object())
        .is_none()
    {
        return Err("Payload 必须包含 aps 对象".into());
    }
    let payload_bytes = settings.payload.len();
    let maximum = if settings.push_type == "voip" {
        5120
    } else {
        4096
    };
    if payload_bytes > maximum {
        return Err(format!(
            "Payload 为 {payload_bytes} 字节，超过 {maximum} 字节限制"
        ));
    }
    if settings.push_type == "background" && settings.priority != 5 {
        return Err("background 推送的优先级必须为 5".into());
    }
    if settings.priority != 5 && settings.priority != 10 {
        return Err("Priority 只能是 5 或 10".into());
    }
    if !settings.expiration.trim().is_empty()
        && !settings
            .expiration
            .trim()
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err("Expiration 必须是 Unix 时间戳（秒）".into());
    }
    match settings.auth_mode {
        AuthMode::Token => {
            if settings.team_id.trim().is_empty() {
                return Err("Team ID 不能为空".into());
            }
            if settings.key_id.trim().is_empty() {
                return Err("Key ID 不能为空".into());
            }
            if settings.token_key_path.trim().is_empty() {
                return Err("请选择 APNs Auth Key（.p8）".into());
            }
        }
        AuthMode::Keychain if settings.keychain_identity_id.trim().is_empty() => {
            return Err("请选择钥匙串中的推送证书".into());
        }
        AuthMode::Certificate if settings.certificate_path.trim().is_empty() => {
            return Err("请选择推送证书（.p12/.pfx/.pem/.cer）".into());
        }
        _ => {}
    }
    Ok((device_token, payload_bytes))
}

pub fn create_provider_token(
    team_id: &str,
    key_id: &str,
    key_pem: &[u8],
    now_seconds: u64,
) -> Result<String, String> {
    let mut header = Header::new(Algorithm::ES256);
    header.kid = Some(key_id.trim().to_string());
    encode(
        &header,
        &ProviderClaims {
            iss: team_id.trim(),
            iat: now_seconds,
        },
        &EncodingKey::from_ec_pem(key_pem)
            .map_err(|error| format!("Auth Key 不是有效的 EC 私钥：{error}"))?,
    )
    .map_err(|error| format!("生成 Provider Token 失败：{error}"))
}

fn decrypt_private_key(key: &[u8], passphrase: &str) -> Result<Vec<u8>, String> {
    if passphrase.is_empty() {
        return Ok(key.to_vec());
    }
    use std::io::Write;

    let mut input =
        NamedTempFile::new().map_err(|error| format!("无法创建私钥临时文件：{error}"))?;
    input
        .write_all(key)
        .map_err(|error| format!("无法写入私钥临时文件：{error}"))?;
    let mut child = Command::new("openssl")
        .arg("pkey")
        .arg("-in")
        .arg(input.path())
        .args(["-passin", "stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 OpenSSL 解密私钥：{error}"))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法写入 OpenSSL".to_string())?;
        stdin
            .write_all(format!("{passphrase}\n").as_bytes())
            .map_err(|error| format!("无法向 OpenSSL 写入私钥：{error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 OpenSSL 失败：{error}"))?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn certificate_client(request: &PushRequest) -> Result<Client, String> {
    let settings = &request.settings;
    let certificate = fs::read(&settings.certificate_path)
        .map_err(|error| format!("无法读取证书文件：{error}"))?;
    let lower = settings.certificate_path.to_ascii_lowercase();
    if lower.ends_with(".p12") || lower.ends_with(".pfx") {
        let identity = Identity::from_pkcs12_der(&certificate, &request.certificate_passphrase)
            .map_err(|error| format!("证书或密码无效：{error}"))?;
        return Client::builder()
            .use_native_tls()
            .identity(identity)
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|error| format!("创建证书连接失败：{error}"));
    }

    let mut certificate_pem = if certificate.starts_with(b"-----BEGIN") {
        certificate
    } else {
        pem::encode(&pem::Pem::new("CERTIFICATE", certificate)).into_bytes()
    };
    let key = if settings.private_key_path.trim().is_empty() {
        if certificate_pem
            .windows(17)
            .any(|value| value == b"BEGIN PRIVATE KEY")
        {
            Vec::new()
        } else {
            return Err("该证书不包含私钥，请额外选择 .key/.pem 私钥文件".into());
        }
    } else {
        let key = fs::read(&settings.private_key_path)
            .map_err(|error| format!("无法读取私钥文件：{error}"))?;
        decrypt_private_key(&key, &request.certificate_passphrase)?
    };
    certificate_pem.extend_from_slice(&key);
    let identity = Identity::from_pem(&certificate_pem)
        .map_err(|error| format!("证书或私钥格式无效：{error}"))?;
    Client::builder()
        .use_rustls_tls()
        .identity(identity)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建证书连接失败：{error}"))
}

fn keychain_client(request: &PushRequest) -> Result<Client, String> {
    let passphrase = Uuid::new_v4().to_string();
    let identity_data =
        keychain::export_pkcs12(&request.settings.keychain_identity_id, &passphrase)?;
    let identity = Identity::from_pkcs12_der(&identity_data, &passphrase)
        .map_err(|error| format!("加载钥匙串身份失败：{error}"))?;
    Client::builder()
        .use_native_tls()
        .identity(identity)
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建钥匙串证书连接失败：{error}"))
}

fn token_client() -> Result<Client, String> {
    Client::builder()
        .use_rustls_tls()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建 APNs 连接失败：{error}"))
}

pub async fn send_push(request: PushRequest) -> Result<PushResult, String> {
    let started_at = Instant::now();
    let (device_token, _) = validate_push_request(&request)?;
    let settings = &request.settings;
    let host = settings.environment.host();
    let client = match settings.auth_mode {
        AuthMode::Token => token_client()?,
        AuthMode::Keychain => keychain_client(&request)?,
        AuthMode::Certificate => certificate_client(&request)?,
    };
    let mut builder = client
        .post(format!("https://{host}/3/device/{device_token}"))
        .version(Version::HTTP_2)
        .header("apns-topic", settings.topic.trim())
        .header("apns-push-type", settings.push_type.trim())
        .header("apns-priority", settings.priority.to_string())
        .header("content-type", "application/json");
    if !settings.collapse_id.trim().is_empty() {
        builder = builder.header("apns-collapse-id", settings.collapse_id.trim());
    }
    if !settings.expiration.trim().is_empty() {
        builder = builder.header("apns-expiration", settings.expiration.trim());
    }
    if settings.auth_mode == AuthMode::Token {
        let key = fs::read(&settings.token_key_path)
            .map_err(|error| format!("无法读取 Auth Key：{error}"))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("系统时间无效：{error}"))?
            .as_secs();
        let token = create_provider_token(&settings.team_id, &settings.key_id, &key, now)?;
        builder = builder.bearer_auth(token);
    }

    let response = builder
        .body(settings.payload.clone())
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "连接 APNs 超时（20 秒）".to_string()
            } else {
                format!("连接 APNs 失败：{error}")
            }
        })?;
    let status = response.status().as_u16();
    let apns_id = response
        .headers()
        .get("apns-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let response_body = response.text().await.unwrap_or_default();
    let reason = if status == 200 {
        "Success".into()
    } else {
        serde_json::from_str::<serde_json::Value>(&response_body)
            .ok()
            .and_then(|value| value.get("reason")?.as_str().map(ToString::to_string))
            .unwrap_or_else(|| format!("HTTP {status}"))
    };
    Ok(PushResult {
        ok: status == 200,
        status,
        reason_info: (status != 200).then(|| describe_apns_error(&reason)),
        reason,
        apns_id,
        host: host.into(),
        duration_ms: started_at.elapsed().as_millis(),
        response_body,
    })
}

#[cfg(test)]
mod tests {
    use p256::{
        SecretKey,
        pkcs8::{EncodePrivateKey, LineEnding},
    };

    use super::*;
    use crate::models::{AuthMode, Environment, PushSettings};

    fn request() -> PushRequest {
        PushRequest {
            settings: PushSettings {
                environment: Environment::Development,
                auth_mode: AuthMode::Token,
                team_id: "TEAM123456".into(),
                key_id: "KEY1234567".into(),
                topic: "com.example.app".into(),
                token_key_path: "/tmp/AuthKey.p8".into(),
                certificate_path: String::new(),
                private_key_path: String::new(),
                keychain_identity: String::new(),
                keychain_identity_id: String::new(),
                device_token: "<0123 4567 89ab cdef 0123 4567 89ab cdef>".into(),
                push_type: "alert".into(),
                priority: 10,
                collapse_id: String::new(),
                expiration: "0".into(),
                payload: r#"{"aps":{"alert":"hello"}}"#.into(),
            },
            certificate_passphrase: String::new(),
        }
    }

    #[test]
    fn normalizes_xcode_tokens() {
        assert_eq!(
            normalize_device_token(&request().settings.device_token),
            "0123456789abcdef0123456789abcdef"
        );
    }

    #[test]
    fn rejects_background_priority_ten() {
        let mut request = request();
        request.settings.push_type = "background".into();
        assert!(
            validate_push_request(&request)
                .unwrap_err()
                .contains("必须为 5")
        );
    }

    #[test]
    fn creates_es256_provider_token() {
        let secret = SecretKey::random(&mut p256::elliptic_curve::rand_core::OsRng);
        let pem = secret.to_pkcs8_pem(LineEnding::LF).unwrap();
        let token =
            create_provider_token("TEAM123456", "KEY1234567", pem.as_bytes(), 1_700_000_000)
                .unwrap();
        assert_eq!(token.split('.').count(), 3);
    }
}
