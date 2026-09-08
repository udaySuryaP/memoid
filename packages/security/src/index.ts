import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-memoid_session";
export const AUTH_FLOW_COOKIE_NAME = "__Host-memoid_auth_flow";
export const GITHUB_FLOW_COOKIE_NAME = "__Host-memoid_github_flow";

export interface ReturnIntent {
  readonly nonce: string;
  readonly route: string;
  readonly expiresAt: number;
}

export function signReturnIntent(intent: ReturnIntent, key: Uint8Array): string {
  const payload = Buffer.from(JSON.stringify(intent)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyReturnIntent(
  value: string,
  key: Uint8Array,
  now = Date.now(),
): ReturnIntent | null {
  const [payload, supplied] = value.split(".");
  if (!payload || !supplied) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ReturnIntent;
    return parsed.expiresAt > now && parsed.route.startsWith("/") && !parsed.route.startsWith("//")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export interface AuthFlowState {
  readonly state: string;
  readonly codeVerifier: string;
  readonly returnPath: string;
  readonly stepUpIntentId?: string;
  readonly stepUpNonce?: string;
  readonly expiresAt: number;
}

export interface GitHubFlowState {
  readonly state: string;
  readonly intentId: string;
  readonly projectId: string;
  readonly installationId?: string;
  readonly idempotencyKey: string;
  readonly expiresAt: number;
}

function encryptionKey(secret: Uint8Array): Buffer {
  if (secret.byteLength < 32)
    throw new Error("Auth flow encryption secret must be at least 32 bytes");
  return createHash("sha256").update(secret).digest();
}

export function sealAuthFlowState(state: AuthFlowState, secret: Uint8Array): string {
  if (!state.returnPath.startsWith("/") || state.returnPath.startsWith("//"))
    throw new Error("Auth flow return path must be local");
  if ((state.stepUpIntentId === undefined) !== (state.stepUpNonce === undefined))
    throw new Error("Auth flow step-up evidence must be complete");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function unsealAuthFlowState(
  value: string,
  secret: Uint8Array,
  now = Date.now(),
): AuthFlowState | null {
  try {
    const encoded = Buffer.from(value, "base64url");
    if (encoded.byteLength < 29) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      encoded.subarray(0, 12),
    );
    decipher.setAuthTag(encoded.subarray(12, 28));
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString("utf8"),
    ) as AuthFlowState;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.returnPath !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= now ||
      !parsed.returnPath.startsWith("/") ||
      parsed.returnPath.startsWith("//") ||
      (parsed.stepUpIntentId !== undefined && typeof parsed.stepUpIntentId !== "string") ||
      (parsed.stepUpNonce !== undefined && typeof parsed.stepUpNonce !== "string") ||
      (parsed.stepUpIntentId === undefined) !== (parsed.stepUpNonce === undefined)
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function sealGitHubFlowState(state: GitHubFlowState, secret: Uint8Array): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function unsealGitHubFlowState(
  value: string,
  secret: Uint8Array,
  now = Date.now(),
): GitHubFlowState | null {
  try {
    const encoded = Buffer.from(value, "base64url");
    if (encoded.byteLength < 29) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      encoded.subarray(0, 12),
    );
    decipher.setAuthTag(encoded.subarray(12, 28));
    const parsed = JSON.parse(
      Buffer.concat([decipher.update(encoded.subarray(28)), decipher.final()]).toString("utf8"),
    ) as GitHubFlowState;
    if (
      hashProviderState(parsed.state).byteLength !== 32 ||
      !UUID_V7_FOR_PROVIDER_FLOW.test(parsed.intentId) ||
      !UUID_V7_FOR_PROVIDER_FLOW.test(parsed.projectId) ||
      (parsed.installationId !== undefined && !/^[1-9][0-9]{0,39}$/.test(parsed.installationId)) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(parsed.idempotencyKey) ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= now
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

const UUID_V7_FOR_PROVIDER_FLOW =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function createOpaqueSessionCredential(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashSessionCredential(token) };
}

export function createOpaqueStepUpNonce(): { nonce: string; hash: Buffer } {
  const nonce = randomBytes(32).toString("base64url");
  return { nonce, hash: createHash("sha256").update(nonce, "utf8").digest() };
}

export function createOpaqueProviderState(): { state: string; hash: Buffer } {
  const state = randomBytes(32).toString("base64url");
  return { state, hash: hashProviderState(state) };
}

export function hashProviderState(state: string): Buffer {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) throw new Error("Provider state is malformed");
  return createHash("sha256").update(state, "utf8").digest();
}

export function verifyGitHubWebhookSignature(
  payload: Uint8Array,
  signature: string | null,
  secrets: readonly Uint8Array[],
): boolean {
  if (!signature?.startsWith("sha256=") || secrets.length < 1 || secrets.length > 2) return false;
  const supplied = Buffer.from(signature.slice(7), "hex");
  if (supplied.byteLength !== 32) return false;
  let matched = false;
  for (const secret of secrets) {
    if (secret.byteLength < 32) throw new Error("GitHub webhook secret must be at least 32 bytes");
    const expected = createHmac("sha256", secret).update(payload).digest();
    matched = timingSafeEqual(expected, supplied) || matched;
  }
  return matched;
}

export function sanitizeGitHubDeliveryId(value: string | null): string | null {
  if (!value || value.length > 128 || !/^[A-Za-z0-9-]+$/.test(value)) return null;
  return value;
}

export function hashStepUpNonce(nonce: string): Buffer {
  if (nonce.length < 32 || nonce.length > 128) throw new Error("Step-up nonce is malformed");
  return createHash("sha256").update(nonce, "utf8").digest();
}

export function hashSessionCredential(token: string): Buffer {
  if (token.length < 32 || token.length > 128) throw new Error("Session credential is malformed");
  return createHash("sha256").update(token, "utf8").digest();
}

export function hashIdempotencyKey(value: string): Buffer {
  if (value.length < 32 || value.length > 256)
    throw new Error("Idempotency key must contain 32 to 256 characters");
  return createHash("sha256").update(value, "utf8").digest();
}

export function fingerprintLifecycleRequest(value: Readonly<Record<string, unknown>>): Buffer {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest();
}

export function serializeSessionCookie(token: string, maxAgeSeconds: number): string {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1)
    throw new Error("Session cookie max age is invalid");
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function serializeAuthFlowCookie(value: string, maxAgeSeconds = 600): string {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 900)
    throw new Error("Auth flow cookie max age is invalid");
  return `${AUTH_FLOW_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function serializeGitHubFlowCookie(value: string, maxAgeSeconds = 600): string {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 900)
    throw new Error("GitHub flow cookie max age is invalid");
  return `${GITHUB_FLOW_COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAgeSeconds}; Secure; HttpOnly; SameSite=Lax`;
}

export function clearHostCookie(
  name: typeof SESSION_COOKIE_NAME | typeof AUTH_FLOW_COOKIE_NAME | typeof GITHUB_FLOW_COOKIE_NAME,
): string {
  return `${name}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
}

export function isAllowedMutationOrigin(origin: string | null, expectedOrigin: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
