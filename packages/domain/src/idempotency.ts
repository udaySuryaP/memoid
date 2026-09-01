import { controlledKey } from "./audit.js";

export const IDEMPOTENCY_STATES = [
  "IN_PROGRESS",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
] as const;

export type IdempotencyState = (typeof IDEMPOTENCY_STATES)[number];

export const IDEMPOTENCY_CLAIM_OUTCOMES = [
  "CLAIMED",
  "IN_PROGRESS",
  "REPLAY",
  "RETRY_CLAIMED",
  "TERMINAL_FAILURE",
  "CONFLICT",
] as const;

export type IdempotencyClaimOutcome = (typeof IDEMPOTENCY_CLAIM_OUTCOMES)[number];

export const idempotencyAction = (value: string): string => controlledKey(value, "action key");

export function sha256Hex(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized))
    throw new Error("SHA-256 value must be 64 hex characters");
  return normalized;
}
