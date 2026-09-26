import type { RPCSchema } from "electrobun/main";

export type Environment = "development" | "production";
export type AuthMode = "token" | "keychain" | "certificate";
export type CredentialKind = "tokenKey" | "certificate" | "privateKey";

export type KeychainCertificate = {
	id: string;
	name: string;
	topic: string;
	expiresAt: string;
	validFrom: string;
	subject: string;
	teamId: string;
	environment: Environment | "both";
};

export type CredentialInfo = {
	title: string;
	fields: Array<{ label: string; value: string }>;
};

export type PushSettings = {
	environment: Environment;
	authMode: AuthMode;
	teamId: string;
	keyId: string;
	topic: string;
	tokenKeyPath: string;
	certificatePath: string;
	privateKeyPath: string;
	keychainIdentity: string;
	keychainIdentityId: string;
	deviceToken: string;
	pushType: string;
	priority: 5 | 10;
	collapseId: string;
	expiration: string;
	payload: string;
};

export type PushRequest = PushSettings & {
	certificatePassphrase: string;
};

export type DeviceTokenHistoryItem = {
	id: string;
	createdAt: string;
	token: string;
	environment: Environment;
};

export type PayloadHistoryItem = {
	id: string;
	createdAt: string;
	topic: string;
	pushType: string;
	priority: 5 | 10;
	collapseId: string;
	expiration: string;
	payload: string;
};

export type PushErrorInfo = {
	code: string;
	message: string;
	suggestion: string;
};

export type PushResult = {
	ok: boolean;
	status: number;
	reason: string;
	reasonInfo?: PushErrorInfo;
	apnsId: string;
	host: string;
	durationMs: number;
	responseBody: string;
};

export type PushLabRPC = {
	bun: RPCSchema<{
		requests: {
			loadSettings: { params: {}; response: PushSettings };
			saveSettings: {
				params: { settings: PushSettings };
				response: { success: boolean };
			};
			listKeychainCertificates: {
				params: {};
				response: KeychainCertificate[];
			};
			inspectCredential: {
				params: { kind: "keychain" | "certificate" | "token"; value: string; passphrase?: string };
				response: CredentialInfo;
			};
			loadPayloadHistory: { params: {}; response: PayloadHistoryItem[] };
			clearPayloadHistory: { params: {}; response: { success: boolean } };
			loadDeviceTokenHistory: { params: {}; response: DeviceTokenHistoryItem[] };
			clearDeviceTokenHistory: { params: {}; response: { success: boolean } };
			showContextMenu: {
				params: { editable: boolean; hasSelection: boolean };
				response: { shown: boolean };
			};
			pickCredential: {
				params: { kind: CredentialKind };
				response: { path: string; name: string } | null;
			};
			sendPush: { params: PushRequest; response: PushResult };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {};
	}>;
};
