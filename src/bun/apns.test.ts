import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createProviderToken, normalizeDeviceToken, validatePushRequest } from "./apns";
import { parseKeychainIdentities } from "./keychain";
import { prependDeviceTokenHistory, prependPayloadHistory } from "./history";
import type { DeviceTokenHistoryItem, PayloadHistoryItem } from "../shared/types";
import type { PushRequest } from "../shared/types";

const request: PushRequest = {
	environment: "development",
	authMode: "token",
	teamId: "ABCDE12345",
	keyId: "ABCDE12345",
	topic: "com.example.app",
	tokenKeyPath: "/tmp/AuthKey.p8",
	certificatePath: "",
	privateKeyPath: "",
	keychainIdentity: "",
	keychainIdentityId: "",
	certificatePassphrase: "",
	deviceToken: "<0123 4567 89ab cdef 0123 4567 89ab cdef>",
	pushType: "alert",
	priority: 10,
	collapseId: "",
	expiration: "0",
	payload: '{"aps":{"alert":"hello"}}',
};

describe("APNs request validation", () => {
	test("normalizes tokens copied from Xcode", () => {
		expect(normalizeDeviceToken(request.deviceToken)).toBe("0123456789abcdef0123456789abcdef");
	});

	test("rejects priority 10 for background pushes", () => {
		expect(() => validatePushRequest({ ...request, pushType: "background" })).toThrow("优先级必须为 5");
	});

	test("finds only Apple push identities in Keychain output", () => {
		const identities = parseKeychainIdentities(`
  1) 1111111111111111111111111111111111111111 "Apple Distribution: Example (TEAM123456)"
  2) 2222222222222222222222222222222222222222 "Apple Push Services: com.example.app" (CSSMERR_TP_NOT_TRUSTED)
     2 valid identities found
`);
		expect(identities).toEqual([{ id: "2222222222222222222222222222222222222222", name: "Apple Push Services: com.example.app" }]);
	});

	test("requires a selected Keychain identity", () => {
		expect(() => validatePushRequest({ ...request, authMode: "keychain" })).toThrow("请选择钥匙串中的推送证书");
	});


	test("keeps only the newest 50 payload history items", () => {
		const item = (index: number): PayloadHistoryItem => ({
			id: String(index),
			createdAt: new Date(index).toISOString(),
			topic: "com.example.app",
			pushType: "alert",
			priority: 10,
			collapseId: "",
			expiration: "0",
			payload: `{"index":${index}}`,
		});
		const history = Array.from({ length: 50 }, (_, index) => item(index));
		const result = prependPayloadHistory(item(50), history);
		expect(result).toHaveLength(50);
		expect(result[0]?.id).toBe("50");
		expect(result.at(-1)?.id).toBe("48");
	});

	test("deduplicates and moves matching payload history to the top", () => {
		const base: PayloadHistoryItem = {
			id: "old",
			createdAt: new Date(0).toISOString(),
			topic: "com.example.app",
			pushType: "alert",
			priority: 10,
			collapseId: "",
			expiration: "0",
			payload: '{"aps":{"alert":"same"}}',
		};
		const moved = prependPayloadHistory({ ...base, id: "new", createdAt: new Date().toISOString() }, [
			base,
			{ ...base, id: "other", payload: '{"aps":{"alert":"other"}}' },
		]);
		expect(moved).toHaveLength(2);
		expect(moved[0]?.id).toBe("old");
	});

	test("keeps only the newest 10 device tokens", () => {
		const item = (index: number): DeviceTokenHistoryItem => ({
			id: String(index),
			createdAt: new Date(index).toISOString(),
			token: String(index),
			environment: "development",
		});
		const result = prependDeviceTokenHistory(item(10), Array.from({ length: 10 }, (_, index) => item(index)));
		expect(result).toHaveLength(10);
		expect(result[0]?.token).toBe("10");
	});

	test("creates an ES256 provider token with APNs claims", () => {
		const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
		const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
		const token = createProviderToken("TEAM123456", "KEY1234567", pem, 1_700_000_000_000);
		const [header, claims, signature] = token.split(".");
		expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY1234567" });
		expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
		expect(Buffer.from(signature!, "base64url")).toHaveLength(64);
	});
});
