#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>

static size_t exportedLength = 0;

void pushlabFree(char *value);

static SecIdentityRef copyIdentityForCertificateHash(const char *certificateHash) {
	if (certificateHash == NULL || certificateHash[0] == '\0') return NULL;
	NSString *hash = [NSString stringWithUTF8String:certificateHash];
	NSDictionary *query = @{
		(__bridge id)kSecClass: (__bridge id)kSecClassIdentity,
		(__bridge id)kSecReturnRef: @YES,
		(__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitAll,
	};
	CFArrayRef items = NULL;
	OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, (CFTypeRef *)&items);
	if (status != errSecSuccess || items == NULL) return NULL;

	SecIdentityRef match = NULL;
	for (id item in (__bridge NSArray *)items) {
		SecIdentityRef identity = (__bridge SecIdentityRef)item;
		SecCertificateRef certificate = NULL;
		if (SecIdentityCopyCertificate(identity, &certificate) != errSecSuccess) continue;
		CFDataRef certificateData = SecCertificateCopyData(certificate);
		if (certificateData == NULL) {
			CFRelease(certificate);
			continue;
		}
		uint8_t digest[CC_SHA1_DIGEST_LENGTH];
		CC_SHA1(CFDataGetBytePtr(certificateData), (CC_LONG)CFDataGetLength(certificateData), digest);
		NSMutableString *itemHash = [NSMutableString stringWithCapacity:CC_SHA1_DIGEST_LENGTH * 2];
		for (size_t index = 0; index < CC_SHA1_DIGEST_LENGTH; index++) [itemHash appendFormat:@"%02X", digest[index]];
		CFRelease(certificateData);
		CFRelease(certificate);
		if ([itemHash isEqualToString:hash]) {
			match = (SecIdentityRef)CFRetain(identity);
			break;
		}
	}
	CFRelease(items);
	return match;
}

__attribute__((visibility("default")))
char *pushlabExportIdentityP12(const char *certificateHash, const char *passphrase, char **error) {
	@try {
		SecIdentityRef identity = copyIdentityForCertificateHash(certificateHash);
		if (identity == NULL) {
			*error = strdup("未找到证书对应的私钥身份");
			return NULL;
		}
		SecCertificateRef certificate = NULL;
		OSStatus status = SecIdentityCopyCertificate(identity, &certificate);
		if (status != errSecSuccess) {
			CFRelease(identity);
			*error = strdup("读取证书失败");
			return NULL;
		}
		NSArray *items = @[(__bridge id)identity, (__bridge id)certificate];
		CFDataRef p12Data = NULL;
		CFStringRef exportPassphrase = (passphrase != NULL && passphrase[0] != '\0')
			? (__bridge CFStringRef)[NSString stringWithUTF8String:passphrase]
			: NULL;
		SecItemImportExportKeyParameters parameters = {0};
		parameters.version = SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION;
		parameters.passphrase = exportPassphrase;
		// Keys require kSecItemPemArmour and secure passphrase handling; export format controls wrapping.
		parameters.flags = 0;
		parameters.keyAttributes = NULL;
		parameters.keyUsage = NULL;
		status = SecItemExport(
			(__bridge CFArrayRef)items,
			kSecFormatPKCS12,
			0,
			&parameters,
			&p12Data
		);
		CFRelease(certificate);
		CFRelease(identity);
		NSData *p12 = CFBridgingRelease(p12Data);
		if (status != errSecSuccess || p12.length == 0) {
				NSString *message = [NSString stringWithFormat:@"导出证书失败：OSStatus %d", (int)status];
			*error = strdup(message.UTF8String);
			return NULL;
		}
		char *result = malloc(p12.length);
		memcpy(result, p12.bytes, p12.length);
		exportedLength = p12.length;
		return result;
	} @catch (NSException *exception) {
		NSString *message = [NSString stringWithFormat:@"%@", exception];
		*error = strdup(message.UTF8String);
		return NULL;
	}
}

__attribute__((visibility("default")))
int pushlabExportIdentityLength(const char *result) {
	if (result == NULL) return 0;
	return (int)exportedLength;
}

__attribute__((visibility("default")))
char *pushlabExportCertificatePem(const char *certificateHash, char **error) {
	SecIdentityRef identity = copyIdentityForCertificateHash(certificateHash);
	if (identity == NULL) {
		*error = strdup("未找到证书对应的私钥身份");
		return NULL;
	}
	SecCertificateRef certificate = NULL;
	OSStatus status = SecIdentityCopyCertificate(identity, &certificate);
	CFRelease(identity);
	if (status != errSecSuccess || certificate == NULL) {
		*error = strdup("读取证书失败");
		return NULL;
	}
	CFDataRef data = SecCertificateCopyData(certificate);
	SecExternalFormat format = kSecFormatPEMSequence;
	CFDataRef pem = NULL;
	status = SecItemExport(certificate, format, 0, NULL, &pem);
	CFRelease(certificate);
	if (data != NULL) CFRelease(data);
	if (status != errSecSuccess || pem == NULL) {
		*error = strdup("导出证书失败");
		return NULL;
	}
	NSData *resultData = CFBridgingRelease(pem);
	char *result = malloc(resultData.length + 1);
	memcpy(result, resultData.bytes, resultData.length);
	result[resultData.length] = '\0';
	exportedLength = resultData.length;
	return result;
}

__attribute__((visibility("default")))
char *pushlabExportIdentityPem(const char *certificateHash, const char *passphrase, char **error) {
	SecIdentityRef identity = copyIdentityForCertificateHash(certificateHash);
	if (identity == NULL) {
		*error = strdup("未找到证书对应的私钥身份");
		return NULL;
	}
	SecKeyRef key = NULL;
	OSStatus status = SecIdentityCopyPrivateKey(identity, &key);
	if (status != errSecSuccess || key == NULL) {
		CFRelease(identity);
		*error = strdup("读取私钥失败");
		return NULL;
	}
	CFDataRef keyData = NULL;
	SecItemImportExportKeyParameters parameters = {0};
	parameters.version = SEC_KEY_IMPORT_EXPORT_PARAMS_VERSION;
	parameters.passphrase = (passphrase != NULL && passphrase[0] != '\0') ? (__bridge CFStringRef)[NSString stringWithUTF8String:passphrase] : NULL;
	status = SecItemExport(key, kSecFormatWrappedOpenSSL, 0, &parameters, &keyData);
	CFRelease(key);
	CFRelease(identity);
	if (status != errSecSuccess || keyData == NULL) {
		*error = strdup("导出私钥失败");
		return NULL;
	}
	NSData *data = CFBridgingRelease(keyData);
	char *result = malloc(data.length + 1);
	memcpy(result, data.bytes, data.length);
	result[data.length] = '\0';
	exportedLength = data.length;
	return result;
}

__attribute__((visibility("default")))
int pushlabDebugExport(const char *certificateHash) {
	char *value = pushlabExportIdentityP12(certificateHash, "pushlab", NULL);
	if (value == NULL) return -1;
	int length = pushlabExportIdentityLength(value);
	FILE *file = fopen("/tmp/pushlab-debug.p12", "wb");
	if (file == NULL) return -2;
	fwrite(value, 1, length, file);
	fclose(file);
	pushlabFree(value);
	return length;
}

__attribute__((visibility("default")))
void pushlabFree(char *value) {
	free(value);
}
