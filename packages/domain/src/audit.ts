export const AUDIT_CATEGORIES = [
  "SECURITY",
  "DATA_INTEGRITY",
  "OPERATION",
  "INTEGRATION",
  "SYSTEM",
  "PRODUCT",
] as const;

export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const AUDIT_OUTCOMES = ["SUCCESS", "FAILURE", "DENIED", "CANCELLED", "PARTIAL"] as const;

export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export type SanitizedMetadataValue =
  string | number | boolean | null | readonly (string | number | boolean | null)[];
export type SanitizedMetadata = Readonly<Record<string, SanitizedMetadataValue>>;

const CONTROL_KEY = /^[A-Z][A-Z0-9_]{0,63}$/;
const FORBIDDEN_KEY =
  /(AUTHORIZATION|COOKIE|PASSWORD|PASSCODE|TOKEN|SECRET|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|REFRESH|SESSION|CREDENTIAL|RAW_?PAYLOAD|PROMPT|TRANSCRIPT|REPOSITORY_?BLOB|EXCEPTION|STACK)/i;

export function controlledKey(value: string, name: string): string {
  if (!CONTROL_KEY.test(value)) throw new Error(`${name} must be an uppercase controlled key`);
  return value;
}

function safeScalar(value: unknown, name: string): string | number | boolean | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length <= 512) return value;
  throw new Error(`${name} must be a bounded scalar`);
}

export function sanitizedMetadata(input: unknown): SanitizedMetadata {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new Error("Sanitized metadata must be an object");
  const entries = Object.entries(input);
  if (entries.length > 32) throw new Error("Sanitized metadata cannot exceed 32 keys");
  const output: Record<string, SanitizedMetadataValue> = {};
  for (const [key, value] of entries) {
    if (!CONTROL_KEY.test(key) || FORBIDDEN_KEY.test(key))
      throw new Error(`Unsafe sanitized metadata key: ${key}`);
    if (Array.isArray(value)) {
      if (value.length > 16) throw new Error(`${key} cannot exceed 16 values`);
      output[key] = Object.freeze(value.map((item) => safeScalar(item, key)));
    } else {
      output[key] = safeScalar(value, key);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 8192)
    throw new Error("Sanitized metadata cannot exceed 8192 bytes");
  return Object.freeze(output);
}
