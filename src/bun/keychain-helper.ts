import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { dlopen, FFIType, ptr, CString, type Pointer } from "bun:ffi";

type KeychainHelper = {
	pushlabExportIdentityP12: (hash: string, passphrase: string, error: Pointer) => Pointer;
	pushlabExportIdentityPem: (hash: string, passphrase: string, error: Pointer) => Pointer;
	pushlabExportCertificatePem: (hash: string, error: Pointer) => Pointer;
	pushlabExportIdentityLength: (result: Pointer) => number;
	pushlabFree: (result: Pointer) => void;
};

export function loadKeychainHelper(): KeychainHelper | null {
	const path = join(dirname(process.execPath), "libPushLabKeychain.dylib");
	if (!existsSync(path)) return null;
	try {
		const library = dlopen(path, {
			pushlabExportIdentityP12: {
				args: [FFIType.cstring, FFIType.cstring, FFIType.ptr],
				returns: FFIType.ptr,
			},
			pushlabExportIdentityPem: { args: [FFIType.cstring, FFIType.cstring, FFIType.ptr], returns: FFIType.ptr },
			pushlabExportCertificatePem: { args: [FFIType.cstring, FFIType.ptr], returns: FFIType.ptr },
			pushlabExportIdentityLength: { args: [FFIType.ptr], returns: FFIType.int },
			pushlabFree: { args: [FFIType.ptr], returns: FFIType.void },
		});
		return library.symbols as unknown as KeychainHelper;
	} catch {
		return null;
	}
}

function callString(
	method: "pushlabExportIdentityP12" | "pushlabExportIdentityPem" | "pushlabExportCertificatePem",
	helper: KeychainHelper,
	args: [certificateHash: string, passphrase: string] | [certificateHash: string],
): Uint8Array {
	const errorBuffer = new Uint8Array(8);
	const errorPointer = ptr(errorBuffer, 0);
	const keyMethod = helper[method] as (hash: string, passphrase: string, error: Pointer) => Pointer;
	const result = args.length === 2
		? keyMethod(args[0]!, args[1]!, errorPointer)
		: helper.pushlabExportCertificatePem(args[0]!, errorPointer);
	if (!result) {
		const errorValue = new DataView(errorBuffer.buffer).getBigInt64(0, true);
		if (errorValue) throw new Error(new CString(errorValue));
		throw new Error("读取钥匙串身份失败");
	}
	try {
		const length = helper.pushlabExportIdentityLength(result);
		if (length <= 0) throw new Error("导出的证书为空");
		return new TextEncoder().encode(new CString(result, 0, length));
	} finally {
		helper.pushlabFree(result);
	}
}

export function exportKeychainIdentityP12(
	helper: KeychainHelper,
	certificateHash: string,
	passphrase: string,
): Uint8Array {
	return callString("pushlabExportIdentityP12", helper, [certificateHash, passphrase]);
}

export function exportKeychainIdentityPem(
	helper: KeychainHelper,
	certificateHash: string,
	passphrase: string,
): Uint8Array {
	return callString("pushlabExportIdentityPem", helper, [certificateHash, passphrase]);
}

export function exportKeychainCertificatePem(helper: KeychainHelper, certificateHash: string): Uint8Array {
	return callString("pushlabExportCertificatePem", helper, [certificateHash]);
}
