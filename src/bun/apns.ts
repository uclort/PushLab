import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { createPrivateKey, createSign, X509Certificate } from "node:crypto";
import {
	connect,
	constants,
	type IncomingHttpHeaders,
	type OutgoingHttpHeaders,
	type SecureClientSessionOptions,
} from "node:http2";
import type { PushRequest, PushResult } from "../shared/types";
import { exportKeychainCertificatePem, exportKeychainIdentityPem, loadKeychainHelper } from "./keychain-helper";

const APNS_HOSTS = {
	development: "api.sandbox.push.apple.com",
	production: "api.push.apple.com",
} as const;

function base64Url(value: string | Buffer): string {
	return Buffer.from(value).toString("base64url");
}

export function normalizeDeviceToken(value: string): string {
	return value.replace(/[\s<>]/g, "");
}

export function validatePushRequest(request: PushRequest): { deviceToken: string; payloadBytes: number } {
	const deviceToken = normalizeDeviceToken(request.deviceToken);
	if (!/^[a-fA-F0-9]+$/.test(deviceToken) || deviceToken.length < 32 || deviceToken.length % 2 !== 0) {
		throw new Error("Device Token 必须是有效的十六进制字符串");
	}
	if (!request.topic.trim()) throw new Error("Topic（Bundle ID）不能为空");

	let payload: unknown;
	try {
		payload = JSON.parse(request.payload);
	} catch {
		throw new Error("Payload 不是有效的 JSON");
	}
	if (!payload || typeof payload !== "object" || !("aps" in payload)) throw new Error("Payload 必须包含 aps 对象");

	const payloadBytes = Buffer.byteLength(request.payload, "utf8");
	const maxPayloadBytes = request.pushType === "voip" ? 5120 : 4096;
	if (payloadBytes > maxPayloadBytes) {
		throw new Error(`Payload 为 ${payloadBytes} 字节，超过 ${maxPayloadBytes} 字节限制`);
	}
	if (request.pushType === "background" && request.priority !== 5) {
		throw new Error("background 推送的优先级必须为 5");
	}
	if (request.authMode === "token") {
		if (!request.teamId.trim()) throw new Error("Team ID 不能为空");
		if (!request.keyId.trim()) throw new Error("Key ID 不能为空");
		if (!request.tokenKeyPath.trim()) throw new Error("请选择 APNs Auth Key（.p8）");
	} else if (request.authMode === "keychain") {
		if (!request.keychainIdentityId.trim()) throw new Error("请选择钥匙串中的推送证书");
	} else if (!request.certificatePath.trim()) {
		throw new Error("请选择推送证书（.p12/.pfx/.pem/.cer）");
	}
	return { deviceToken, payloadBytes };
}

export function createProviderToken(teamId: string, keyId: string, keyPem: string, now = Date.now()): string {
	const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId.trim() }));
	const claims = base64Url(JSON.stringify({ iss: teamId.trim(), iat: Math.floor(now / 1000) }));
	const unsignedToken = `${header}.${claims}`;
	const signer = createSign("SHA256");
	signer.update(unsignedToken);
	signer.end();
	const signature = signer.sign({ key: createPrivateKey(keyPem), dsaEncoding: "ieee-p1363" });
	return `${unsignedToken}.${base64Url(signature)}`;
}

function certificatePem(data: Buffer): Buffer | string {
	if (data.toString("utf8").includes("BEGIN CERTIFICATE")) return data;
	return new X509Certificate(data).toString();
}

function createTlsOptions(request: PushRequest): SecureClientSessionOptions {
	const options: SecureClientSessionOptions = { ALPNProtocols: ["h2"] };
	if (request.authMode !== "certificate") return options;
	const certificate = readFileSync(request.certificatePath);
	const extension = extname(request.certificatePath).toLowerCase();
	if (extension === ".p12" || extension === ".pfx") {
		options.pfx = certificate;
		if (request.certificatePassphrase) options.passphrase = request.certificatePassphrase;
		return options;
	}
	options.cert = certificatePem(certificate);
	if (request.privateKeyPath) {
		options.key = readFileSync(request.privateKeyPath);
	} else if (certificate.toString("utf8").includes("PRIVATE KEY")) {
		options.key = certificate;
	} else {
		throw new Error("该证书不包含私钥，请额外选择 .key/.pem 私钥文件");
	}
	if (request.certificatePassphrase) options.passphrase = request.certificatePassphrase;
	return options;
}

function responseReason(status: number, body: string): string {
	if (status === 200) return "Success";
	try {
		const parsed = JSON.parse(body) as { reason?: string };
		return parsed.reason || `HTTP ${status}`;
	} catch {
		return body || `HTTP ${status}`;
	}
}

async function sendPushWithCertificateFile(request: PushRequest & {
	host: string;
	headers: OutgoingHttpHeaders;
	startedAt: number;
}): Promise<PushResult> {
	const session = connect(`https://${request.host}`, createTlsOptions(request));
	let responseHeaders: IncomingHttpHeaders = {};
	let responseBody = "";
	let settled = false;

	return await new Promise<PushResult>((resolve, reject) => {
		const settle = () => {
			settled = true;
		};
		const timeout = setTimeout(() => {
			if (settled) return;
			settle();
			session.close();
			reject(new Error("连接 APNs 超时（20 秒）"));
		}, 20_000);
		const complete = () => {
			if (settled) return;
			settle();
			clearTimeout(timeout);
			session.close();
			const statusValue = responseHeaders[constants.HTTP2_HEADER_STATUS];
			const status = typeof statusValue === "number" ? statusValue : Number(statusValue || 0);
			const apnsIdValue = responseHeaders["apns-id"];
			resolve({
				ok: status === 200,
				status,
				reason: responseReason(status, responseBody),
				apnsId: Array.isArray(apnsIdValue) ? apnsIdValue[0] || "" : apnsIdValue || "",
				host: request.host,
				durationMs: Date.now() - request.startedAt,
				responseBody,
			});
		};
		const fail = (error: Error) => {
			if (settled) return;
			settle();
			clearTimeout(timeout);
			session.close();
			reject(error);
		};

		session.once("error", fail);
		const stream = session.request(request.headers);
		stream.setEncoding("utf8");
		stream.on("response", (incomingHeaders) => {
			responseHeaders = incomingHeaders;
		});
		stream.on("data", (chunk: string) => {
			responseBody += chunk;
		});
		stream.once("error", fail);
		stream.once("end", complete);
		stream.end(request.payload);
	});
}

async function sendPushWithKeychain(
	request: PushRequest,
	host: string,
	headers: OutgoingHttpHeaders,
	startedAt: number,
): Promise<PushResult> {
	if (process.platform !== "darwin") throw new Error("钥匙串证书仅支持 macOS");
	const helper = loadKeychainHelper();
	if (!helper) throw new Error("钥匙串辅助库未加载，请重新构建应用");
	const exportPassphrase = request.certificatePassphrase || "pushlab";
	const certificate = exportKeychainCertificatePem(helper, request.keychainIdentityId);
	const encryptedKey = exportKeychainIdentityPem(helper, request.keychainIdentityId, exportPassphrase);
	const key = decryptKey(encryptedKey, exportPassphrase);
	const certificatePath = join("/tmp", `pushlab-${Date.now()}.crt`);
	const privateKeyPath = join("/tmp", `pushlab-${Date.now()}.key`);
	try {
		await Promise.all([
			Bun.write(certificatePath, certificate),
			Bun.write(privateKeyPath, key),
		]);
		return await sendPushWithCertificateFile({
			...request,
			authMode: "certificate",
			certificatePath,
			privateKeyPath,
			host,
			headers,
			startedAt,
			certificatePassphrase: "",
		});
	} finally {
		rmSync(certificatePath, { force: true });
		rmSync(privateKeyPath, { force: true });
	}
}

function decryptKey(encryptedKey: Uint8Array, passphrase: string): Uint8Array {
	const input = join("/tmp", `pushlab-encrypted-${Date.now()}.pem`);
	const output = join("/tmp", `pushlab-decrypted-${Date.now()}.pem`);
	try {
		writeFileSync(input, encryptedKey);
		const result = Bun.spawnSync([
			"/usr/bin/openssl", "rsa", "-in", input, "-passin", `pass:${passphrase}`, "-out", output,
		]);
		if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr) || "解密钥匙串私钥失败");
		return new Uint8Array(readFileSync(output));
	} finally {
		rmSync(input, { force: true });
		rmSync(output, { force: true });
	}
}

export async function sendPush(request: PushRequest): Promise<PushResult> {
	const startedAt = Date.now();
	const { deviceToken } = validatePushRequest(request);
	const host = APNS_HOSTS[request.environment];
	const headers: OutgoingHttpHeaders = {
		[constants.HTTP2_HEADER_METHOD]: "POST",
		[constants.HTTP2_HEADER_PATH]: `/3/device/${deviceToken}`,
		"apns-topic": request.topic.trim(),
		"apns-push-type": request.pushType,
		"apns-priority": String(request.priority),
		"content-type": "application/json",
	};
	if (request.collapseId.trim()) headers["apns-collapse-id"] = request.collapseId.trim();
	if (request.expiration.trim()) {
		if (!/^\d+$/.test(request.expiration.trim())) throw new Error("Expiration 必须是 Unix 时间戳（秒）");
		headers["apns-expiration"] = request.expiration.trim();
	}
	if (request.authMode === "token") {
		const keyPem = readFileSync(request.tokenKeyPath, "utf8");
		headers.authorization = `bearer ${createProviderToken(request.teamId, request.keyId, keyPem)}`;
	}
	if (request.authMode === "keychain") return await sendPushWithKeychain(request, host, headers, startedAt);
	return await sendPushWithCertificateFile({ ...request, host, headers, startedAt });
}
