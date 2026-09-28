export type Environment = "development" | "production";
export type AuthMode = "token" | "keychain" | "certificate";
export type CredentialKind = "tokenKey" | "certificate" | "privateKey";

export interface KeychainCertificate {
  id: string;
  name: string;
  topic: string;
  expiresAt: string;
  validFrom: string;
  subject: string;
  teamId: string;
  environment: Environment | "both";
}

export interface CredentialInfo {
  title: string;
  fields: Array<{ label: string; value: string }>;
}

export interface PushSettings {
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
}

export interface PushRequest extends PushSettings {
  certificatePassphrase: string;
}

export interface DeviceTokenHistoryItem {
  id: string;
  createdAt: string;
  token: string;
  environment: Environment;
}

export interface PayloadHistoryItem {
  id: string;
  createdAt: string;
  topic: string;
  pushType: string;
  priority: 5 | 10;
  collapseId: string;
  expiration: string;
  payload: string;
}

export interface PushErrorInfo {
  code: string;
  message: string;
  suggestion: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  reason: string;
  reasonInfo?: PushErrorInfo;
  apnsId: string;
  host: string;
  durationMs: number;
  responseBody: string;
}
