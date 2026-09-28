use chrono::{DateTime, Utc};
use sha1::{Digest, Sha1};
use x509_parser::{certificate::X509Certificate, parse_x509_certificate};

use crate::models::{CredentialField, CredentialInfo};

const UID_OID: &str = "0.9.2342.19200300.100.1.1";
const ORGANIZATION_OID: &str = "2.5.4.10";
const ORGANIZATIONAL_UNIT_OID: &str = "2.5.4.11";

pub struct CertificateDetails {
    pub title: String,
    pub topic: String,
    pub team_id: String,
    pub organization: String,
    pub subject: String,
    pub issuer: String,
    pub valid_from: String,
    pub expires_at: String,
    pub fingerprint: String,
}

fn der_from_data(data: &[u8]) -> Result<Vec<u8>, String> {
    if data.starts_with(b"-----BEGIN") {
        let entries =
            pem::parse_many(data).map_err(|error| format!("证书 PEM 格式无效：{error}"))?;
        return entries
            .into_iter()
            .find(|entry| entry.tag() == "CERTIFICATE")
            .map(|entry| entry.contents().to_vec())
            .ok_or_else(|| "文件中未找到 CERTIFICATE 段".to_string());
    }
    Ok(data.to_vec())
}

fn attribute(certificate: &X509Certificate<'_>, oid: &str) -> String {
    certificate
        .subject()
        .iter_attributes()
        .find(|attribute| attribute.attr_type().to_id_string() == oid)
        .and_then(|attribute| attribute.as_str().ok())
        .unwrap_or_default()
        .to_string()
}

fn display_time(timestamp: i64) -> String {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .map(|date| date.to_rfc3339())
        .unwrap_or_default()
}

pub fn parse_certificate_details(data: &[u8]) -> Result<CertificateDetails, String> {
    let der = der_from_data(data)?;
    let (_, certificate) =
        parse_x509_certificate(&der).map_err(|error| format!("无法解析 X.509 证书：{error}"))?;
    let title = certificate
        .subject()
        .iter_common_name()
        .next()
        .and_then(|attribute| attribute.as_str().ok())
        .unwrap_or("未命名证书")
        .to_string();
    let fingerprint = Sha1::digest(&der)
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":");

    Ok(CertificateDetails {
        title,
        topic: attribute(&certificate, UID_OID),
        team_id: attribute(&certificate, ORGANIZATIONAL_UNIT_OID),
        organization: attribute(&certificate, ORGANIZATION_OID),
        subject: certificate.subject().to_string(),
        issuer: certificate.issuer().to_string(),
        valid_from: display_time(certificate.validity().not_before.timestamp()),
        expires_at: display_time(certificate.validity().not_after.timestamp()),
        fingerprint,
    })
}

pub fn inspect_certificate_file(
    path: &str,
    passphrase: Option<&str>,
) -> Result<CredentialInfo, String> {
    let data = std::fs::read(path).map_err(|error| format!("无法读取证书文件：{error}"))?;
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".p12") || lower.ends_with(".pfx") {
        reqwest::Identity::from_pkcs12_der(&data, passphrase.unwrap_or_default())
            .map_err(|error| format!("PKCS#12 证书或密码无效：{error}"))?;
        return Ok(CredentialInfo {
            title: std::path::Path::new(path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(path)
                .to_string(),
            fields: vec![
                CredentialField {
                    label: "类型".into(),
                    value: "PKCS#12 客户端身份".into(),
                },
                CredentialField {
                    label: "文件大小".into(),
                    value: format!("{} B", data.len()),
                },
                CredentialField {
                    label: "私钥".into(),
                    value: "已验证包含可用私钥".into(),
                },
            ],
        });
    }

    credential_info_from_details(parse_certificate_details(&data)?)
}

pub fn credential_info_from_details(details: CertificateDetails) -> Result<CredentialInfo, String> {
    Ok(CredentialInfo {
        title: details.title,
        fields: vec![
            CredentialField {
                label: "Bundle ID".into(),
                value: value_or_unknown(details.topic),
            },
            CredentialField {
                label: "Team ID".into(),
                value: value_or_unknown(details.team_id),
            },
            CredentialField {
                label: "组织".into(),
                value: value_or_unknown(details.organization),
            },
            CredentialField {
                label: "签发者".into(),
                value: value_or_unknown(details.issuer),
            },
            CredentialField {
                label: "创建时间".into(),
                value: value_or_unknown(details.valid_from),
            },
            CredentialField {
                label: "过期时间".into(),
                value: value_or_unknown(details.expires_at),
            },
            CredentialField {
                label: "证书指纹".into(),
                value: details.fingerprint,
            },
        ],
    })
}

fn value_or_unknown(value: String) -> String {
    if value.trim().is_empty() {
        "未识别".into()
    } else {
        value
    }
}

pub fn inspect_token_key(path: &str) -> Result<CredentialInfo, String> {
    let data = std::fs::read(path).map_err(|error| format!("无法读取 Auth Key：{error}"))?;
    let text = String::from_utf8_lossy(&data);
    jsonwebtoken::EncodingKey::from_ec_pem(&data)
        .map_err(|error| format!("Auth Key 不是有效的 EC 私钥：{error}"))?;
    Ok(CredentialInfo {
        title: std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(path)
            .to_string(),
        fields: vec![
            CredentialField {
                label: "类型".into(),
                value: "APNs Auth Key（.p8）".into(),
            },
            CredentialField {
                label: "文件大小".into(),
                value: format!("{} B", data.len()),
            },
            CredentialField {
                label: "私钥格式".into(),
                value: if text.contains("BEGIN PRIVATE KEY") {
                    "PKCS#8".into()
                } else {
                    "PEM".into()
                },
            },
        ],
    })
}
