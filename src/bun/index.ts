import { app, ApplicationMenu, BrowserView, BrowserWindow, ContextMenu, Utils } from "electrobun/main";
import { basename, dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { sendPush } from "./apns";
import { listKeychainPushCertificates } from "./keychain";
import { fileCredentialInfo, keychainCredentialInfo } from "./credential-info";
import { prependDeviceTokenHistory, prependPayloadHistory } from "./history";
import type { CredentialKind, DeviceTokenHistoryItem, PayloadHistoryItem, PushLabRPC, PushRequest, PushSettings } from "../shared/types";
import { describeApnsError } from "../shared/errors";

const settingsPath = join(Utils.paths.userData, "push-lab-settings.json");
const historyPath = join(Utils.paths.userData, "push-lab-payload-history.json");
const tokenHistoryPath = join(Utils.paths.userData, "push-lab-device-token-history.json");
const defaultSettings: PushSettings = {
	environment: "development",
	authMode: "keychain",
	teamId: "",
	keyId: "",
	topic: "",
	tokenKeyPath: "",
	certificatePath: "",
	privateKeyPath: "",
	keychainIdentity: "",
	keychainIdentityId: "",
	deviceToken: "",
	pushType: "alert",
	priority: 10,
	collapseId: "",
	expiration: "0",
	payload: JSON.stringify(
		{ aps: { alert: { title: "PushLab", body: "这是一条测试推送" }, sound: "default", badge: 1 } },
		null,
		2,
	),
};

function loadSettings(): PushSettings {
	try {
		if (!existsSync(settingsPath)) return defaultSettings;
		const saved = JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<PushSettings>;
		return { ...defaultSettings, ...saved };
	} catch {
		return defaultSettings;
	}
}

async function saveSettings(settings: PushSettings): Promise<void> {
	await Bun.write(settingsPath, JSON.stringify(settings, null, 2));
}


function loadPayloadHistory(): PayloadHistoryItem[] {
	try {
		if (!existsSync(historyPath)) return [];
		const history = JSON.parse(readFileSync(historyPath, "utf8")) as PayloadHistoryItem[];
		return Array.isArray(history) ? history.slice(0, 50) : [];
	} catch {
		return [];
	}
}

async function savePayloadHistory(request: PushRequest): Promise<void> {
	const item: PayloadHistoryItem = {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		topic: request.topic,
		pushType: request.pushType,
		priority: request.priority,
		collapseId: request.collapseId,
		expiration: request.expiration,
		payload: request.payload,
	};
	await Bun.write(historyPath, JSON.stringify(prependPayloadHistory(item, loadPayloadHistory()), null, 2));
}


function loadDeviceTokenHistory(): DeviceTokenHistoryItem[] {
	try {
		if (!existsSync(tokenHistoryPath)) return [];
		const history = JSON.parse(readFileSync(tokenHistoryPath, "utf8")) as DeviceTokenHistoryItem[];
		return Array.isArray(history) ? history.slice(0, 10) : [];
	} catch {
		return [];
	}
}

async function saveDeviceTokenHistory(request: PushRequest): Promise<void> {
	const token = request.deviceToken.replace(/[\s<>]/g, "");
	if (!token) return;
	const item: DeviceTokenHistoryItem = {
		id: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		token,
		environment: request.environment,
	};
	await Bun.write(tokenHistoryPath, JSON.stringify(prependDeviceTokenHistory(item, loadDeviceTokenHistory()), null, 2));
}

function allowedTypes(kind: CredentialKind): string {
	if (kind === "tokenKey") return "p8,pem";
	if (kind === "privateKey") return "key,pem";
	return "p12,pfx,pem,cer,crt";
}

ApplicationMenu.setApplicationMenu([
	{
		label: "PushLab",
		submenu: [
			{ label: "关于 PushLab", role: "about" },
			{ type: "separator" },
			{ label: "隐藏 PushLab", role: "hide" },
			{ label: "隐藏其他应用", role: "hideOthers" },
			{ label: "显示全部", role: "showAll" },
			{ type: "separator" },
			{ label: "退出 PushLab", action: "quit-app", accelerator: "CommandOrControl+Q" },
		],
	},
	{
		label: "文件",
		submenu: [
			{ label: "关闭窗口", action: "close-window", accelerator: "CommandOrControl+W" },
		],
	},
	{
		label: "编辑",
		submenu: [
			{ label: "撤销", role: "undo" },
			{ label: "重做", role: "redo" },
			{ type: "separator" },
			{ label: "剪切", role: "cut" },
			{ label: "复制", role: "copy" },
			{ label: "粘贴", role: "paste" },
			{ label: "粘贴并匹配样式", role: "pasteAndMatchStyle" },
			{ label: "删除", role: "delete" },
			{ type: "separator" },
			{ label: "全选", role: "selectAll" },
		],
	},
	{
		label: "窗口",
		submenu: [
			{ label: "最小化", role: "minimize" },
			{ label: "缩放", role: "zoom" },
			{ type: "separator" },
			{ label: "前置全部窗口", role: "bringAllToFront" },
		],
	},
]);

const rpc = BrowserView.defineRPC<PushLabRPC>({
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			loadSettings: () => loadSettings(),
			saveSettings: async ({ settings }) => {
				await saveSettings(settings);
				return { success: true };
			},
			listKeychainCertificates: () => listKeychainPushCertificates(),
			inspectCredential: ({ kind, value }) => {
				if (kind === "keychain") {
					const certificate = listKeychainPushCertificates()
						.then((certificates) => certificates.find(({ id }) => id === value))
						.then((certificate) => certificate ? keychainCredentialInfo(certificate) : { title: "", fields: [] });
					return certificate;
				}
				if (kind === "token") return fileCredentialInfo(value, "token");
				return fileCredentialInfo(value, "certificate");
			},
			loadPayloadHistory: () => loadPayloadHistory(),
			clearPayloadHistory: async () => {
				await Bun.write(historyPath, "[]");
				return { success: true };
			},
			loadDeviceTokenHistory: () => loadDeviceTokenHistory(),
			clearDeviceTokenHistory: async () => {
				await Bun.write(tokenHistoryPath, "[]");
				return { success: true };
			},
			showContextMenu: ({ editable, hasSelection }) => {
				ContextMenu.showContextMenu(editable
					? [
						{ label: "撤销", role: "undo" },
						{ label: "重做", role: "redo" },
						{ type: "separator" },
						{ label: "剪切", role: "cut" },
						{ label: "复制", role: "copy" },
						{ label: "粘贴", role: "paste" },
						{ label: "粘贴并匹配样式", role: "pasteAndMatchStyle" },
						{ label: "删除", role: "delete" },
						{ type: "separator" },
						{ label: "全选", role: "selectAll" },
					]
					: [
						{ label: "复制", role: "copy", enabled: hasSelection },
						{ label: "全选", role: "selectAll" },
					]);
				return { shown: true };
			},
			pickCredential: async ({ kind }) => {
				const current = loadSettings();
				const currentPath = kind === "tokenKey"
					? current.tokenKeyPath
					: kind === "privateKey"
						? current.privateKeyPath
						: current.certificatePath;
				const paths = await Utils.openFileDialog({
					startingFolder: currentPath ? dirname(currentPath) : Bun.env["HOME"] || "/",
					allowedFileTypes: allowedTypes(kind),
					canChooseFiles: true,
					canChooseDirectory: false,
					allowsMultipleSelection: false,
				});
				const path = paths[0];
				return path ? { path, name: basename(path) } : null;
			},
			sendPush: async (request: PushRequest) => {
				const { certificatePassphrase: _secret, ...settings } = request;
				await Promise.all([saveSettings(settings), savePayloadHistory(request), saveDeviceTokenHistory(request)]);
				try {
					const result = await sendPush(request);
				return { ...result, reasonInfo: result.ok ? undefined : describeApnsError(result.reason) };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return {
						ok: false,
						status: 0,
						reason: message,
						apnsId: "",
						host: request.environment === "development"
							? "api.sandbox.push.apple.com"
							: "api.push.apple.com",
						durationMs: 0,
						responseBody: "",
					};
				}
			},
		},
		messages: {},
	},
});

const mainWindow = new BrowserWindow({
	title: "PushLab · APNs 调试工具",
	url: "views://mainview/index.html",
	rpc,
	frame: { width: 1180, height: 820 },
});

ApplicationMenu.on("application-menu-clicked", (event) => {
	const action = (event as { data?: { action?: string } }).data?.action;
	if (action === "quit-app") app.quit();
	if (action === "close-window") mainWindow.close();
});
