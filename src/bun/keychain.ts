import { X509Certificate } from "node:crypto";
import type { Environment, KeychainCertificate } from "../shared/types";

const PUSH_CERTIFICATE_NAMES = [
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

export function isPushCertificateName(name: string): boolean {
	return PUSH_CERTIFICATE_NAMES.some((marker) => name.includes(marker));
}

function certificateEnvironment(name: string): Environment | "both" {
	if (/Development|Sandbox/i.test(name)) return "development";
	if (/Production/i.test(name)) return "production";
	return "both";
}

function topicFromName(name: string): string {
	const separator = name.indexOf(":");
	return separator >= 0 ? name.slice(separator + 1).trim() : "";
}

export function parseKeychainIdentities(output: string): Array<{ id: string; name: string }> {
	const identities = output
		.split(/\r?\n/)
		.map((line) => line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*?)"(?:\s+\([^)]*\))?\s*$/i))
		.filter((match): match is RegExpMatchArray => Boolean(match))
		.map((match) => ({ id: match[1]!.toUpperCase(), name: match[2]! }))
		.filter(({ name }) => isPushCertificateName(name));
	return [...new Map(identities.map((identity) => [identity.id, identity])).values()];
}

type CertificateDetails = { topic: string; expiresAt: string; validFrom: string; subject: string; issuer: string; fingerprint: string };

export function parseKeychainCertificates(output: string): Map<string, CertificateDetails> {
	const certificates = new Map<string, CertificateDetails>();
	const pemBlocks = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
	for (const pem of pemBlocks) {
		try {
			const certificate = new X509Certificate(pem);
			const id = certificate.fingerprint.replaceAll(":", "").toUpperCase();
			const uid = certificate.subject
				.split(/\n|,\s*/)
				.find((part) => part.startsWith("UID="))
				?.slice(4);
			certificates.set(id, {
				topic: uid || "",
				expiresAt: new Date(certificate.validTo).toISOString(),
				validFrom: new Date(certificate.validFrom).toISOString(),
				subject: certificate.subject,
				issuer: certificate.issuer,
				fingerprint: certificate.fingerprint,
			});
		} catch {
			// Skip malformed or unsupported certificates from the user's keychains.
		}
	}
	return certificates;
}

async function command(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	return { stdout, stderr, exitCode };
}

export async function listKeychainPushCertificates(): Promise<KeychainCertificate[]> {
	if (process.platform !== "darwin") return [];

	// Do not pass -v: APNs client certificates can be reported as
	// CSSMERR_TP_NOT_TRUSTED by the generic "basic" policy even while they are
	// valid for APNs client authentication. SmartPush also enumerates all certs.
	const [identityResult, certificateResult] = await Promise.all([
		command(["/usr/bin/security", "find-identity", "-p", "basic"]),
		command(["/usr/bin/security", "find-certificate", "-a", "-p"]),
	]);
	if (identityResult.exitCode !== 0) {
		throw new Error(identityResult.stderr.trim() || "读取钥匙串证书失败");
	}

	const identities = parseKeychainIdentities(identityResult.stdout);
	const certificateDetails = certificateResult.exitCode === 0
		? parseKeychainCertificates(certificateResult.stdout)
		: new Map<string, CertificateDetails>();

	return identities.map((identity) => {
		const details = certificateDetails.get(identity.id);
		const subject = details?.subject || "";
		return {
			...identity,
			topic: details?.topic || topicFromName(identity.name),
			expiresAt: details?.expiresAt || "",
			validFrom: details?.validFrom || "",
			subject,
			teamId: subject.split(/\n|,\s*/).find((part) => part.startsWith("OU="))?.slice(3) || "",
			environment: certificateEnvironment(identity.name),
		};
	});
}
