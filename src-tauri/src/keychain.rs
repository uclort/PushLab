#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::{
        array::CFArray,
        base::{CFTypeRef, TCFType},
        data::CFData,
        string::CFString,
    };
    use core_foundation_sys::{
        array::CFArrayRef, base::OSStatus, data::CFDataRef, string::CFStringRef,
    };
    use security_framework::{
        identity::SecIdentity,
        item::{ItemClass, ItemSearchOptions, Limit, Reference, SearchResult},
    };
    use sha1::{Digest, Sha1};

    use crate::{
        certificate::{credential_info_from_details, parse_certificate_details},
        models::{CredentialInfo, KeychainCertificate},
    };

    const PUSH_CERTIFICATE_MARKERS: &[&str] = &[
        "Apple Development IOS Push Services:",
        "Apple Production IOS Push Services:",
        "Apple Development Mac Push Services:",
        "Apple Production Mac Push Services:",
        "Apple Push Services:",
        "Apple Sandbox Push Services:",
        "Website Push ID:",
        "VoIP Services:",
        "WatchKit Services:",
    ];

    #[repr(C)]
    struct SecItemImportExportKeyParameters {
        version: u32,
        flags: u32,
        passphrase: CFTypeRef,
        alert_title: CFStringRef,
        alert_prompt: CFStringRef,
        access_ref: *const std::ffi::c_void,
        key_usage: CFArrayRef,
        key_attributes: CFArrayRef,
    }

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        fn SecItemExport(
            item: CFTypeRef,
            output_format: u32,
            flags: u32,
            key_parameters: *const SecItemImportExportKeyParameters,
            exported_data: *mut CFDataRef,
        ) -> OSStatus;
    }

    fn identity_hash(identity: &SecIdentity) -> Result<String, String> {
        let certificate = identity
            .certificate()
            .map_err(|error| format!("读取钥匙串证书失败：{error}"))?;
        Ok(Sha1::digest(certificate.to_der())
            .iter()
            .map(|byte| format!("{byte:02X}"))
            .collect::<String>())
    }

    fn identities() -> Result<Vec<SecIdentity>, String> {
        let result = ItemSearchOptions::new()
            .class(ItemClass::identity())
            .load_refs(true)
            .limit(Limit::All)
            .search();
        match result {
            Ok(items) => Ok(items
                .into_iter()
                .filter_map(|item| match item {
                    SearchResult::Ref(Reference::Identity(identity)) => Some(identity),
                    _ => None,
                })
                .collect()),
            Err(error) if error.code() == -25300 => Ok(Vec::new()),
            Err(error) => Err(format!("读取钥匙串身份失败：{error}")),
        }
    }

    fn is_push_certificate(name: &str) -> bool {
        PUSH_CERTIFICATE_MARKERS
            .iter()
            .any(|marker| name.contains(marker))
    }

    fn environment(name: &str) -> String {
        if name.contains("Development") || name.contains("Sandbox") {
            "development".into()
        } else if name.contains("Production") {
            "production".into()
        } else {
            "both".into()
        }
    }

    pub fn list() -> Result<Vec<KeychainCertificate>, String> {
        let mut certificates = Vec::new();
        for identity in identities()? {
            let certificate = identity
                .certificate()
                .map_err(|error| format!("读取钥匙串证书失败：{error}"))?;
            let details = parse_certificate_details(&certificate.to_der())?;
            if !is_push_certificate(&details.title) {
                continue;
            }
            certificates.push(KeychainCertificate {
                id: identity_hash(&identity)?,
                name: details.title,
                topic: details.topic,
                expires_at: details.expires_at,
                valid_from: details.valid_from,
                subject: details.subject,
                team_id: details.team_id,
                environment: environment(&certificate.subject_summary()),
            });
        }
        certificates.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(certificates)
    }

    fn find_identity(id: &str) -> Result<SecIdentity, String> {
        identities()?
            .into_iter()
            .find(|identity| identity_hash(identity).is_ok_and(|hash| hash == id))
            .ok_or_else(|| "未找到证书对应的钥匙串私钥身份".to_string())
    }

    pub fn inspect(id: &str) -> Result<CredentialInfo, String> {
        let identity = find_identity(id)?;
        let certificate = identity
            .certificate()
            .map_err(|error| format!("读取钥匙串证书失败：{error}"))?;
        credential_info_from_details(parse_certificate_details(&certificate.to_der())?)
    }

    pub fn export_pkcs12(id: &str, passphrase: &str) -> Result<Vec<u8>, String> {
        let identity = find_identity(id)?;
        let certificate = identity
            .certificate()
            .map_err(|error| format!("读取钥匙串证书失败：{error}"))?;
        let items = CFArray::from_CFTypes(&[identity.as_CFType(), certificate.as_CFType()]);
        let password = CFString::new(passphrase);
        let parameters = SecItemImportExportKeyParameters {
            version: 0,
            flags: 0,
            passphrase: password.as_CFTypeRef(),
            alert_title: std::ptr::null(),
            alert_prompt: std::ptr::null(),
            access_ref: std::ptr::null(),
            key_usage: std::ptr::null(),
            key_attributes: std::ptr::null(),
        };
        let mut data: CFDataRef = std::ptr::null();
        let status = unsafe { SecItemExport(items.as_CFTypeRef(), 12, 0, &parameters, &mut data) };
        if status != 0 || data.is_null() {
            return Err(format!("导出钥匙串身份失败：OSStatus {status}"));
        }
        let data = unsafe { CFData::wrap_under_create_rule(data) };
        Ok(data.bytes().to_vec())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use crate::models::{CredentialInfo, KeychainCertificate};

    pub fn list() -> Result<Vec<KeychainCertificate>, String> {
        Ok(Vec::new())
    }

    pub fn inspect(_id: &str) -> Result<CredentialInfo, String> {
        Err("钥匙串证书仅支持 macOS".into())
    }

    pub fn export_pkcs12(_id: &str, _passphrase: &str) -> Result<Vec<u8>, String> {
        Err("钥匙串证书仅支持 macOS".into())
    }
}

pub use platform::{export_pkcs12, inspect, list};
