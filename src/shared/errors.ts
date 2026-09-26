export type PushErrorInfo = {
	code: string;
	message: string;
	suggestion: string;
};

export const APNS_ERROR_GUIDE: PushErrorInfo[] = [
	{ code: "BadCollapseId", message: "collapse id 无效或超过长度限制。", suggestion: "检查 Collapse ID，确保不超过 64 字节。" },
	{ code: "BadDeviceToken", message: "device token 无效。常见原因是 App 包或环境不匹配，或 token 已失效。", suggestion: "确认当前环境和 App 包一致；如果是开发包请切换到开发环境。" },
	{ code: "BadExpirationDate", message: "expiration 时间格式或数值无效。", suggestion: "使用 Unix 秒级时间戳，或留空表示不保留。" },
	{ code: "BadMessageId", message: "apns-id 格式无效。", suggestion: "检查 apns-id 是否符合 UUID 格式。" },
	{ code: "BadPriority", message: "priority 值无效。", suggestion: "alert 通知可用 10，background 必须用 5。" },
	{ code: "BadTopic", message: "topic 无效或与证书不匹配。", suggestion: "确认 topic 与证书绑定的 Bundle ID 一致。" },
	{ code: "CertificateError", message: "证书或私钥加载失败。", suggestion: "检查证书文件、密码和私钥是否匹配。" },
	{ code: "DuplicateHeaders", message: "请求头重复。", suggestion: "检查是否重复设置了相同的 APNs 头。" },
	{ code: "IdleTimeout", message: "连接空闲超时。", suggestion: "减少空闲时间或重试。" },
	{ code: "InvalidPushType", message: "push type 无效或与 payload 不匹配。", suggestion: "确认 push type 与 payload 结构和 App 能力一致。" },
	{ code: "MissingRequiredTopic", message: "缺少必需的 topic。", suggestion: "请选择或填写 Bundle ID。" },
	{ code: "PayloadEmpty", message: "payload 为空。", suggestion: "至少包含 aps 对象。" },
	{ code: "TopicDisallowed", message: "当前证书不允许向该 topic 推送。", suggestion: "确认证书与 App Bundle ID 匹配。" },
	{ code: "InvalidExpiration", message: "expiration 值无效。", suggestion: "使用 Unix 秒级时间戳。" },
	{ code: "InvalidPriority", message: "priority 值无效。", suggestion: "使用 10 或 5。" },
	{ code: "MissingTopic", message: "缺少 topic 头。", suggestion: "请选择或填写 Bundle ID。" },
	{ code: "PayloadTooLarge", message: "payload 超过大小限制。", suggestion: "精简 JSON，alert 最大 4KB，voip 最大 5KB。" },
	{ code: "TooManyRequests", message: "请求过于频繁。", suggestion: "稍后重试。" },
	{ code: "InvalidTokenDeliveryAttempt", message: "token 投递尝试无效。", suggestion: "检查 token 是否已注册。" },
	{ code: "Unregistered", message: "设备 token 已注销。", suggestion: "重新获取 token 后再试。" },
	{ code: "BadCertificate", message: "证书无效。", suggestion: "检查证书文件、密码和私钥。" },
	{ code: "ExpiredProviderToken", message: "provider token 已过期。", suggestion: "重新生成或更新 token。" },
	{ code: "InvalidProviderToken", message: "provider token 无效。", suggestion: "检查 Team ID、Key ID 和 .p8 文件。" },
	{ code: "MissingProviderToken", message: "缺少 provider token。", suggestion: "请选择 .p8 文件并填写 Team ID / Key ID。" },
	{ code: "InvalidPushContent", message: "推送内容无效。", suggestion: "检查 payload 是否符合 Apple 规范。" },
];

const errorMap = new Map(APNS_ERROR_GUIDE.map((error) => [error.code, error]));

export function describeApnsError(reason: string): PushErrorInfo {
	return errorMap.get(reason) ?? {
		code: reason,
		message: "APNs 返回了未识别的错误。",
		suggestion: "请根据官方文档或响应内容排查。",
	};
}
