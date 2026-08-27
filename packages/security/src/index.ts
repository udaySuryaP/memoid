import { createHmac, timingSafeEqual } from "node:crypto";

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
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ReturnIntent;
  return parsed.expiresAt > now && parsed.route.startsWith("/") && !parsed.route.startsWith("//")
    ? parsed
    : null;
}
