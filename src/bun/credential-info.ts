import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import type { CredentialInfo, KeychainCertificate } from "../shared/types";

function dateTime(value: string): string {
	return value ? new Date(value).toLocaleString() : "未知";
}

function organizationFromSubject(subject: string): string {
	const match = subject.match(/(?:^|\n|,)\s*O=((?:\\.|[^\n,])*)/);
	return match?.[1]
		?.replace(/\\,/g, ",")
		.replace(/\\\\/g, "\\")
		.trim() || "未知";
}

function commonCertificateFields(certificate: X509Certificate): CredentialInfo["fields"] {
	const uid = certificate.subject.split(/\n|,\s*/).find((part) => part.startsWith("UID="))?.slice(4);
	const organization = organizationFromSubject(certificate.subject);
	const team = certificate.subject.split(/\n|,\s*/).find((part) => part.startsWith("OU="))?.slice(3);
	return [
		{ label: "Bundle ID", value: uid || "未识别" },
		{ label: "Team ID", value: team || "未识别" },
		{ label: "组织", value: organization || "未知" },
		{ label: "创建时间", value: dateTime(certificate.validFrom) },
		{ label: "过期时间", value: dateTime(certificate.validTo) },
		{ label: "证书指纹", value: certificate.fingerprint.toUpperCase() },
	];
}

export function keychainCredentialInfo(certificate: KeychainCertificate): CredentialInfo {
	return {
		title: certificate.name,
		fields: [
			{ label: "环境", value: certificate.environment === "development" ? "开发" : certificate.environment === "production" ? "生产" : "通用（开发 / 生产）" },
			{ label: "Bundle ID", value: certificate.topic || "未识别" },
			{ label: "创建时间", value: dateTime(certificate.validFrom || "") },
			{ label: "过期时间", value: dateTime(certificate.expiresAt) },
			{ label: "组织", value: organizationFromSubject(certificate.subject) },
			{ label: "Team ID", value: certificate.teamId || "未识别" },
			{ label: "证书指纹", value: certificate.id },
		],
	};
}

export function fileCredentialInfo(path: string, kind: "certificate" | "token"): CredentialInfo {
	if (!path) return { title: "", fields: [] };
	const data = readFileSync(path);
	if (kind === "token") {
		const text = data.toString("utf8");
		return {
			title: path.split(/[\\/]/).pop() || path,
			fields: [
				{ label: "类型", value: "APNs Auth Key（.p8）" },
				{ label: "文件大小", value: `${data.length} B` },
				{ label: "私钥格式", value: text.includes("BEGIN PRIVATE KEY") ? "PKCS#8" : "PEM" },
			],
		};
	}
	const certificate = new X509Certificate(data);
	return {
		title: path.split(/[\\/]/).pop() || path,
		fields: commonCertificateFields(certificate),
	};
}
