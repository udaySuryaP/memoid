export const REVIEW_POLICIES = ["MANUAL", "AUTOMATIC"] as const;
export type ReviewPolicy = (typeof REVIEW_POLICIES)[number];

export function parseReviewPolicy(value: string | null | undefined): ReviewPolicy {
  if (value === null || value === undefined) return "MANUAL";
  if ((REVIEW_POLICIES as readonly string[]).includes(value)) return value as ReviewPolicy;
  throw new Error(`Unsupported review policy: ${value}`);
}

export type PositiveVersion = number & { readonly __kind: "PositiveVersion" };
export type PositiveSequence = number & { readonly __kind: "PositiveSequence" };
export type NonNegativeSequence = number & { readonly __kind: "NonNegativeSequence" };

function parseSafeInteger(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new Error(`${name} must be a safe integer greater than or equal to ${minimum}`);
  return value;
}

export const positiveVersion = (value: number): PositiveVersion =>
  parseSafeInteger(value, "version", 1) as PositiveVersion;

export const positiveSequence = (value: number): PositiveSequence =>
  parseSafeInteger(value, "sequence", 1) as PositiveSequence;

export const nonNegativeSequence = (value: number): NonNegativeSequence =>
  parseSafeInteger(value, "sequence", 0) as NonNegativeSequence;

export type Instant = string & { readonly __kind: "Instant" };

export function parseInstant(value: string): Instant {
  const hasDateTimeSeparator = value.length >= 20 && value[10] === "T";
  const offsetStart = value.length - 6;
  const hasExplicitZone =
    value.endsWith("Z") ||
    ((value[offsetStart] === "+" || value[offsetStart] === "-") && value.at(-3) === ":");
  if (!hasDateTimeSeparator || !hasExplicitZone)
    throw new Error("Instant must be an ISO-8601 timestamp");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new Error("Instant must be an ISO-8601 timestamp");
  return parsed.toISOString() as Instant;
}
