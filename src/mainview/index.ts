import Electrobun, { Electroview } from "electrobun/view";
import type { AuthMode, CredentialInfo, CredentialKind, DeviceTokenHistoryItem, Environment, KeychainCertificate, PayloadHistoryItem, PushLabRPC, PushRequest, PushResult, PushSettings } from "../shared/types";

const rpc = Electroview.defineRPC<PushLabRPC>({
	maxRequestTime: 30_000,
	handlers: { requests: {}, messages: {} },
});
const app = new Electrobun.Electroview({ rpc });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tokenAuth = $("token-auth");
const keychainAuth = $("keychain-auth");
const certificateAuth = $("certificate-auth");
const payload = $<HTMLTextAreaElement>("payload");
const payloadSize = $("payload-size");
const payloadError = $("payload-error");
const pushType = $<HTMLSelectElement>("push-type");
const priority = $<HTMLSelectElement>("priority");
const connectionState = $("connection-state");
const sendButton = $<HTMLButtonElement>("send-button");

let environment: Environment = "development";
let authMode: AuthMode = "token";
let tokenKeyPath = "";
let certificatePath = "";
let privateKeyPath = "";
let keychainIdentity = "";
let keychainIdentityId = "";
let keychainCertificates: KeychainCertificate[] = [];
let selectedBundleId = "";
let payloadHistory: PayloadHistoryItem[] = [];
let deviceTokenHistory: DeviceTokenHistoryItem[] = [];

const templates: Record<string, object> = {
	default: { aps: { alert: { title: "PushLab", body: "这是一条测试推送" }, sound: "default", badge: 1 } },
	simple: { aps: { alert: "这是一条测试推送" } },
	background: { aps: { "content-available": 1 } },
	liveactivity: { aps: { timestamp: Math.floor(Date.now() / 1000), event: "update", "content-state": { status: "running" } } },
};

function readSettings(): PushSettings {
	return {
		environment,
		authMode,
		teamId: $<HTMLInputElement>("team-id").value.trim(),
		keyId: $<HTMLInputElement>("key-id").value.trim(),
		topic: selectedBundleId,
		tokenKeyPath,
		certificatePath,
		privateKeyPath,
		keychainIdentity,
		keychainIdentityId,
		deviceToken: $<HTMLTextAreaElement>("device-token").value.trim(),
		pushType: pushType.value,
		priority: Number(priority.value) as 5 | 10,
		collapseId: $<HTMLInputElement>("collapse-id").value.trim(),
		expiration: $<HTMLInputElement>("expiration").value.trim(),
		payload: payload.value,
	};
}

function applySettings(settings: PushSettings) {
	environment = settings.environment;
	authMode = settings.authMode;
	tokenKeyPath = settings.tokenKeyPath;
	certificatePath = settings.certificatePath;
	privateKeyPath = settings.privateKeyPath;
	keychainIdentity = settings.keychainIdentity;
	keychainIdentityId = settings.keychainIdentityId;
	$<HTMLInputElement>("team-id").value = settings.teamId;
	$<HTMLInputElement>("key-id").value = settings.keyId;
	void refreshCredentialDetails();
	$<HTMLTextAreaElement>("device-token").value = settings.deviceToken;
	pushType.value = settings.pushType;
	priority.value = String(settings.priority);
	$<HTMLInputElement>("collapse-id").value = settings.collapseId;
	$<HTMLInputElement>("expiration").value = settings.expiration;
	payload.value = settings.payload;
	updateFileLabel("token-key", tokenKeyPath, "选择 .p8 文件", "Apple Developer 下载的私钥");
	updateFileLabel("certificate", certificatePath, "选择证书文件", "支持 .p12 / .pfx / .pem / .cer");
	$("private-key-path").textContent = privateKeyPath ? `私钥：${privateKeyPath}` : "";
	refreshTabs();
	refreshPayloadState();
	refreshSummary();
}

function updateFileLabel(prefix: "token-key" | "certificate", path: string, fallbackName: string, fallbackPath: string) {
	$(`${prefix}-name`).textContent = path ? path.split(/[\\/]/).pop() || path : fallbackName;
	$(`${prefix}-path`).textContent = path || fallbackPath;
}

function renderCredentialDetails(info: CredentialInfo | null) {
	const container = $("credential-details");
	if (!info || !info.title || !info.fields.length) {
		container.classList.add("hidden");
		return;
	}
	container.classList.remove("hidden");
	$("credential-title").textContent = info.title;
	$("credential-fields").innerHTML = info.fields
		.map(({ label, value }) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
		.join("");
}

async function refreshCredentialDetails() {
	try {
		if (authMode === "keychain") {
			const id = $<HTMLSelectElement>("keychain-certificate").value;
			if (!id) {
				renderCredentialDetails(null);
				return;
			}
			renderCredentialDetails(await app.rpc!.request.inspectCredential({ kind: "keychain", value: id }));
			return;
		}
		if (authMode === "certificate") {
			if (!certificatePath) {
				renderCredentialDetails(null);
				return;
			}
			renderCredentialDetails(await app.rpc!.request.inspectCredential({ kind: "certificate", value: certificatePath }));
			return;
		}
		if (authMode === "token") {
			if (!tokenKeyPath) {
				renderCredentialDetails(null);
				return;
			}
			renderCredentialDetails(await app.rpc!.request.inspectCredential({ kind: "token", value: tokenKeyPath }));
			return;
		}
		renderCredentialDetails(null);
	} catch {
		renderCredentialDetails(null);
	}
}

function refreshTabs() {
	document.querySelectorAll<HTMLButtonElement>(".env-button").forEach((button) => button.classList.toggle("active", button.dataset["env"] === environment));
	document.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((button) => button.classList.toggle("active", button.dataset["auth"] === authMode));
	tokenAuth.classList.toggle("hidden", authMode !== "token");
	keychainAuth.classList.toggle("hidden", authMode !== "keychain");
	certificateAuth.classList.toggle("hidden", authMode !== "certificate");
}

function certificateDescription(certificate: KeychainCertificate): string {
	const environmentName = certificate.environment === "development"
		? "开发"
		: certificate.environment === "production"
			? "生产"
			: "通用证书";
	const expiration = certificate.expiresAt
		? new Date(certificate.expiresAt).toLocaleDateString()
		: "有效期未知";
	return `${certificate.name} · ${environmentName} · ${expiration}`;
}

function applyKeychainCertificate(certificate: KeychainCertificate | undefined) {
	if (!certificate) {
		keychainIdentity = "";
		keychainIdentityId = "";
		selectedBundleId = "";
		renderCredentialDetails(null);
		$("keychain-certificate-info").textContent = keychainCertificates.length
			? "请选择一张推送证书"
			: "未找到包含私钥的有效 Apple 推送证书";
		return;
	}
	keychainIdentity = certificate.name;
	keychainIdentityId = certificate.id;
	selectedBundleId = certificate.topic;
	if (certificate.environment !== "both") environment = certificate.environment;
	void refreshCredentialDetails();
	refreshTabs();
	refreshSummary();
}

async function loadKeychainCertificates() {
	const refreshButton = $<HTMLButtonElement>("refresh-keychain");
	const select = $<HTMLSelectElement>("keychain-certificate");
	refreshButton.disabled = true;
	select.disabled = true;
	select.innerHTML = '<option value="">正在读取钥匙串…</option>';
	try {
		keychainCertificates = await app.rpc!.request.listKeychainCertificates({});
		select.innerHTML = "";
		if (!keychainCertificates.length) {
			select.add(new Option("未找到推送证书", ""));
			applyKeychainCertificate(undefined);
			return;
		}
		select.add(new Option("请选择推送证书", ""));
		for (const certificate of keychainCertificates) {
			select.add(new Option(certificateDescription(certificate), certificate.id));
		}
		const savedCertificate = keychainCertificates.find(({ id }) => id === keychainIdentityId)
			|| keychainCertificates.find(({ name }) => name === keychainIdentity);
		select.value = savedCertificate?.id || "";
		const selectedCertificate = keychainCertificates.find(({ id }) => id === select.value);
		if (authMode === "keychain") {
			applyKeychainCertificate(selectedCertificate);
		} else if (selectedCertificate) {
			void refreshCredentialDetails();
		}
	} catch (error) {
		select.innerHTML = '<option value="">读取钥匙串失败</option>';
		$("keychain-certificate-info").textContent = error instanceof Error ? error.message : String(error);
	} finally {
		refreshButton.disabled = false;
		select.disabled = false;
	}
}

function historyDescription(item: PayloadHistoryItem): string {
	const date = new Date(item.createdAt);
	const time = date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
	return `${time} · ${item.pushType} · ${item.topic || "无 Bundle ID"}`;
}

async function loadPayloadHistory() {
	payloadHistory = await app.rpc!.request.loadPayloadHistory({});
	const select = $<HTMLSelectElement>("payload-history");
	select.innerHTML = "";
	select.add(new Option(`历史消息（${payloadHistory.length}/50）`, ""));
	for (const item of payloadHistory) select.add(new Option(historyDescription(item), item.id));
	resetClearButton($<HTMLButtonElement>("clear-payload-history"), payloadHistory.length > 0);
}

function deviceTokenDescription(item: DeviceTokenHistoryItem): string {
	const tail = item.token.slice(-6);
	const environmentName = item.environment === "development" ? "开发" : "生产";
	return `${environmentName} · …${tail}`;
}

async function loadDeviceTokenHistory() {
	deviceTokenHistory = await app.rpc!.request.loadDeviceTokenHistory({});
	const select = $<HTMLSelectElement>("device-token-history");
	select.innerHTML = "";
	select.add(new Option(`Token 历史（${deviceTokenHistory.length}/10）`, ""));
	for (const item of deviceTokenHistory) select.add(new Option(deviceTokenDescription(item), item.id));
	resetClearButton($<HTMLButtonElement>("clear-device-token-history"), deviceTokenHistory.length > 0);
}

function resetClearButton(button: HTMLButtonElement, enabled: boolean) {
	button.textContent = "清空";
	button.dataset["confirming"] = "false";
	button.disabled = !enabled;
}

async function clearHistory(
	button: HTMLButtonElement,
	clear: () => Promise<{ success: boolean }>,
	reload: () => Promise<void>,
) {
	if (button.dataset["confirming"] !== "true") {
		button.dataset["confirming"] = "true";
		button.textContent = "确认清空";
		window.setTimeout(() => {
			if (button.dataset["confirming"] === "true") resetClearButton(button, true);
		}, 3_000);
		return;
	}

	button.dataset["confirming"] = "false";
	button.disabled = true;
	button.textContent = "清空中…";
	try {
		await clear();
		await reload();
		setConnectionState("success", "历史已清空");
	} catch (error) {
		resetClearButton(button, true);
		setConnectionState("error", error instanceof Error ? error.message : "清空历史失败");
	}
}

function applyPayloadHistory(item: PayloadHistoryItem) {
	payload.value = item.payload;
	pushType.value = item.pushType;
	priority.value = String(item.priority);
	$<HTMLInputElement>("collapse-id").value = item.collapseId;
	$<HTMLInputElement>("expiration").value = item.expiration;
	$<HTMLSelectElement>("payload-template").value = "custom";
	refreshPayloadState();
	refreshSummary();
}

function refreshPayloadState() {
	const bytes = new TextEncoder().encode(payload.value).length;
	const limit = pushType.value === "voip" ? 5120 : 4096;
	payloadSize.textContent = `${bytes.toLocaleString()} B / ${limit.toLocaleString()} B`;
	payloadSize.style.color = bytes > limit ? "var(--danger)" : "";
	try {
		const value = JSON.parse(payload.value) as Record<string, unknown>;
		payloadError.textContent = value["aps"] ? "" : "Payload 必须包含 aps 对象";
	} catch {
		payloadError.textContent = "JSON 格式错误";
	}
}

function refreshSummary() {
	const envName = environment === "development" ? "开发环境" : "生产环境";
	$("send-summary").textContent = `${envName} · ${pushType.value} · Priority ${priority.value}`;
}


function setConnectionState(state: "idle" | "sending" | "success" | "error", text: string) {
	connectionState.className = `connection-state ${state === "idle" ? "" : state}`;
	connectionState.innerHTML = `<span></span>${text}`;
}

async function pickCredential(kind: CredentialKind) {
	const selected = await app.rpc!.request.pickCredential({ kind });
	if (!selected) return;
	if (kind === "tokenKey") {
		tokenKeyPath = selected.path;
		updateFileLabel("token-key", selected.path, "", "");
	} else if (kind === "certificate") {
		certificatePath = selected.path;
		updateFileLabel("certificate", selected.path, "", "");
	} else {
		privateKeyPath = selected.path;
		$("private-key-path").textContent = `私钥：${selected.path}`;
	}
	await app.rpc!.request.saveSettings({ settings: readSettings() });
	await refreshCredentialDetails();
}

function showResult(result: PushResult) {
	$("empty-result").classList.add("hidden");
	const content = $("result-content");
	content.className = `result-content ${result.ok ? "success" : "error"}`;
	$("result-icon").textContent = result.ok ? "✓" : "!";
	$("result-title").textContent = result.ok ? "推送已被 APNs 接收" : "推送发送失败";
	$("result-time").textContent = `${new Date().toLocaleTimeString()} · ${result.durationMs} ms`;
	$("result-status").textContent = result.status ? `HTTP ${result.status}` : "LOCAL";
	$("result-apns-id").textContent = result.apnsId || "—";
	$("result-host").textContent = result.host;
	$("result-error-details").classList.toggle("hidden", result.ok);
	if (!result.ok) {
		const info = result.reasonInfo;
		const isApnsCode = Boolean(info?.code && /^([A-Z][A-Za-z0-9]+)$/.test(info.code));
		const timeout = result.reason.includes("超时") || /timeout/i.test(result.reason);
		$("result-reason").textContent = isApnsCode
			? info!.code
			: timeout
				? "网络超时"
				: "本地请求失败";
		$("result-reason").title = result.responseBody || result.reason;
		$("result-reason-message").textContent = isApnsCode
			? info!.message
			: result.reason;
		$("result-reason-suggestion").textContent = isApnsCode
			? info!.suggestion
			: timeout
				? "请检查网络、代理或 APNs 可达性，然后重试。"
				: "请检查证书、网络连接和输入配置。";
	}
}

async function send() {
	if (sendButton.disabled) return;
	refreshPayloadState();
	if (payloadError.textContent) {
		payload.focus();
		return;
	}
	const request: PushRequest = {
		...readSettings(),
		certificatePassphrase: $<HTMLInputElement>("certificate-passphrase").value,
	};
	sendButton.disabled = true;
	sendButton.classList.add("is-loading");
	$("send-button-label").textContent = "推送中";
	setConnectionState("sending", "正在连接 APNs");
	try {
		const result = await app.rpc!.request.sendPush(request);
		showResult(result);
		setConnectionState(result.ok ? "success" : "error", result.ok ? "发送成功" : "发送失败");
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		showResult({ ok: false, status: 0, reason, apnsId: "", host: "—", durationMs: 0, responseBody: "" });
		setConnectionState("error", "发送失败");
	} finally {
		sendButton.classList.remove("is-loading");
		sendButton.disabled = false;
		$("send-button-label").textContent = "推送";
		void loadPayloadHistory();
		void loadDeviceTokenHistory();
	}
}

document.querySelectorAll<HTMLButtonElement>(".env-button").forEach((button) => button.addEventListener("click", () => {
	environment = button.dataset["env"] as Environment;
	refreshTabs();
	refreshSummary();
}));
document.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((button) => button.addEventListener("click", () => {
	authMode = button.dataset["auth"] as AuthMode;
	refreshTabs();
	void refreshCredentialDetails();
	if (authMode === "keychain") {
		if (!keychainCertificates.length) {
			void loadKeychainCertificates();
		} else {
			applyKeychainCertificate(keychainCertificates.find(({ id }) => id === $<HTMLSelectElement>("keychain-certificate").value));
		}
	}
	void app.rpc!.request.saveSettings({ settings: readSettings() });
}));
$("pick-token-key").addEventListener("click", () => void pickCredential("tokenKey"));
$("pick-certificate").addEventListener("click", () => void pickCredential("certificate"));
$("pick-private-key").addEventListener("click", () => void pickCredential("privateKey"));
$("refresh-keychain").addEventListener("click", () => void loadKeychainCertificates());
$<HTMLSelectElement>("keychain-certificate").addEventListener("change", (event) => {
	applyKeychainCertificate(keychainCertificates.find(({ id }) => id === (event.target as HTMLSelectElement).value));
	void refreshCredentialDetails();
	void app.rpc!.request.saveSettings({ settings: readSettings() });
});
payload.addEventListener("input", () => {
	$<HTMLSelectElement>("payload-template").value = "custom";
	$<HTMLSelectElement>("payload-history").value = "";
	refreshPayloadState();
});
pushType.addEventListener("change", () => {
	if (pushType.value === "background") priority.value = "5";
	refreshPayloadState();
	refreshSummary();
});
priority.addEventListener("change", refreshSummary);
$<HTMLSelectElement>("payload-template").addEventListener("change", (event) => {
	const key = (event.target as HTMLSelectElement).value;
	$<HTMLSelectElement>("payload-history").value = "";
	payload.value = JSON.stringify(templates[key], null, 2);
	if (key === "background") {
		pushType.value = "background";
		priority.value = "5";
	} else if (key === "liveactivity") {
		pushType.value = "liveactivity";
		priority.value = "10";
	} else {
		pushType.value = "alert";
		priority.value = "10";
	}
	refreshPayloadState();
	refreshSummary();
});
$<HTMLSelectElement>("device-token-history").addEventListener("change", async (event) => {
	const select = event.target as HTMLSelectElement;
	const item = deviceTokenHistory.find(({ id }) => id === select.value);
	if (item) {
		$<HTMLTextAreaElement>("device-token").value = item.token;
		environment = item.environment;
		refreshTabs();
		refreshSummary();
	}
});
$<HTMLSelectElement>("payload-history").addEventListener("change", async (event) => {
	const select = event.target as HTMLSelectElement;
	const item = payloadHistory.find(({ id }) => id === select.value);
	if (item) applyPayloadHistory(item);
});
$<HTMLButtonElement>("clear-device-token-history").addEventListener("click", (event) => {
	const button = event.currentTarget as HTMLButtonElement;
	void clearHistory(
		button,
		() => app.rpc!.request.clearDeviceTokenHistory({}),
		loadDeviceTokenHistory,
	);
});
$<HTMLButtonElement>("clear-payload-history").addEventListener("click", (event) => {
	const button = event.currentTarget as HTMLButtonElement;
	void clearHistory(
		button,
		() => app.rpc!.request.clearPayloadHistory({}),
		loadPayloadHistory,
	);
});
$("format-json").addEventListener("click", () => {
	try {
		payload.value = JSON.stringify(JSON.parse(payload.value), null, 2);
		$<HTMLSelectElement>("payload-template").value = "custom";
		$<HTMLSelectElement>("payload-history").value = "";
		refreshPayloadState();
	} catch {
		payloadError.textContent = "无法格式化：JSON 格式错误";
	}
});
$("clear-log").addEventListener("click", () => {
	$("result-content").classList.add("hidden");
	$("empty-result").classList.remove("hidden");
	setConnectionState("idle", "等待发送");
});
sendButton.addEventListener("click", () => void send());
document.addEventListener("contextmenu", (event) => {
	const target = event.target as HTMLElement | null;
	const editable = target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| Boolean(target?.isContentEditable);
	if (editable || Boolean(window.getSelection()?.toString())) return;
	event.preventDefault();
	event.stopPropagation();
}, { capture: true });
document.addEventListener("keydown", (event) => {
	if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void send();
});

void app.rpc!.request.loadSettings({}).then((settings) => {
	applySettings(settings);
	return Promise.all([loadKeychainCertificates(), loadPayloadHistory(), loadDeviceTokenHistory()]);
});
