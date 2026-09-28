use crate::models::PushErrorInfo;

pub fn describe_apns_error(reason: &str) -> PushErrorInfo {
    let (message, suggestion) = match reason {
        "BadCollapseId" => (
            "Collapse ID 无效或超过长度限制。",
            "检查 Collapse ID，确保不超过 64 字节。",
        ),
        "BadDeviceToken" => (
            "Device Token 无效，可能与 App 包或环境不匹配。",
            "确认开发包使用开发环境，正式包使用生产环境，并重新获取 Token。",
        ),
        "BadExpirationDate" | "InvalidExpiration" => (
            "Expiration 时间格式或数值无效。",
            "使用 Unix 秒级时间戳，或填写 0 表示不保留。",
        ),
        "BadPriority" | "InvalidPriority" => (
            "Priority 值无效。",
            "普通通知可用 10，background 必须使用 5。",
        ),
        "BadTopic" | "MissingRequiredTopic" | "MissingTopic" => (
            "Topic 无效、缺失或与凭据不匹配。",
            "确认 Bundle ID 与证书或 Auth Key 所属 App 一致。",
        ),
        "CertificateError" | "BadCertificate" => (
            "证书或私钥加载失败。",
            "检查证书文件、密码、私钥及二者是否匹配。",
        ),
        "InvalidPushType" => (
            "Push Type 无效或与 Payload 不匹配。",
            "确认 Push Type、Payload 结构和 App Capability 一致。",
        ),
        "PayloadEmpty" => ("Payload 为空。", "Payload 至少需要包含 aps 对象。"),
        "PayloadTooLarge" => (
            "Payload 超过大小限制。",
            "精简 JSON；普通推送最大 4 KB，VoIP 最大 5 KB。",
        ),
        "TopicDisallowed" => (
            "当前凭据不允许向该 Topic 推送。",
            "更换与 Bundle ID 匹配的证书或 Auth Key。",
        ),
        "TooManyRequests" => ("请求过于频繁。", "降低发送频率并稍后重试。"),
        "Unregistered" => (
            "Device Token 已注销。",
            "重新启动 App 获取最新 Token 后再试。",
        ),
        "ExpiredProviderToken" => (
            "Provider Token 已过期。",
            "重新发送以生成新的 Provider Token。",
        ),
        "InvalidProviderToken" => (
            "Provider Token 无效。",
            "检查 Team ID、Key ID 和 .p8 文件是否配套。",
        ),
        "MissingProviderToken" => (
            "缺少 Provider Token。",
            "请选择 .p8 文件并填写 Team ID 与 Key ID。",
        ),
        "InvalidPushContent" => ("推送内容无效。", "检查 Payload 是否符合 Apple APNs 规范。"),
        _ => (
            "APNs 返回了未识别的错误。",
            "根据响应内容和 Apple 官方文档继续排查。",
        ),
    };

    PushErrorInfo {
        code: reason.to_string(),
        message: message.to_string(),
        suggestion: suggestion.to_string(),
    }
}
