export const RECEIPT_VALIDATION_STATES = ["UNVALIDATED", "AUTHENTICATED", "REJECTED"] as const;
export type ReceiptValidationState = (typeof RECEIPT_VALIDATION_STATES)[number];

export const RECEIPT_DISPOSITIONS = [
  "PENDING",
  "PROCESSING",
  "PROCESSED",
  "IGNORED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
] as const;
export type ReceiptDisposition = (typeof RECEIPT_DISPOSITIONS)[number];

export const RECEIPT_REGISTRATION_OUTCOMES = ["CREATED", "DUPLICATE", "CONFLICT"] as const;
export type ReceiptRegistrationOutcome = (typeof RECEIPT_REGISTRATION_OUTCOMES)[number];

function boundedKey(value: string, name: string, maximum: number): string {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > maximum ||
    !/^[a-z0-9][a-z0-9._:/-]*$/.test(normalized)
  )
    throw new Error(`${name} must be a normalized key of at most ${maximum} characters`);
  return normalized;
}

export const providerKey = (value: string): string => boundedKey(value, "Provider key", 64);
export const receiptScopeKey = (value: string): string =>
  boundedKey(value, "Receipt scope key", 256);
