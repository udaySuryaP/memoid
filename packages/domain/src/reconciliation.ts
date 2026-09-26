import type {
  CandidateAssertionId,
  ContextIdentityId,
  ContextRecordId,
  EvidenceReferenceId,
  ProjectId,
  SourceAuthorityAssignmentId,
  WorkingContextItemId,
} from "./identifiers.js";
import type { AuthorityQualification } from "./source-authority.js";

export const RECONCILIATION_CLASSES = [
  "NEW",
  "CHANGED",
  "SUPERSEDED",
  "CONFLICTING",
  "OBSOLETE",
  "UNCERTAIN",
  "UNCHANGED",
] as const;

export type ReconciliationClass = (typeof RECONCILIATION_CLASSES)[number];

export const RECONCILIATION_SCHEMA_VERSION = "reconciliation-output.v1";
export const RECONCILIATION_PROMPT_VERSION = "reconciliation-prompt.v1";
export const RECONCILIATION_COMPACTION_VERSION = "reasoning-packet.v1";
export const RECONCILIATION_NORMALIZATION_VERSION = "semantic-normalization.v1";

export const REASON_CODES = [
  "NO_CURRENT_CONTEXT",
  "EXACT_ASSERTION_MATCH",
  "DUPLICATE_CANDIDATE",
  "AUTHORITY_DISQUALIFIED",
  "MISSING_REQUIRED_EVIDENCE",
  "ACTIVE_CONFLICT",
  "ACTIVE_UNCERTAINTY",
  "KNOWN_SUPERSESSION",
  "MODEL_SEMANTIC_COMPARISON",
] as const;
export type ReconciliationReasonCode = (typeof REASON_CODES)[number];

export interface ReconciliationBasis {
  readonly projectId: ProjectId;
  readonly candidateAssertionId: CandidateAssertionId;
  readonly contextIdentityId: ContextIdentityId;
  readonly currentContextRecordId: ContextRecordId | null;
  readonly currentContextVersion: number;
  readonly workingContextVersion: number;
  readonly authorityVersion: number;
  readonly evidenceFrontierVersion: number;
  readonly integrityVersion: number;
  readonly engineContractVersion: string;
}

export interface ReconciliationOutcome {
  readonly classification: ReconciliationClass;
  readonly semanticIdentity: string;
  readonly normalizedAssertion: Readonly<Record<string, unknown>> | null;
  readonly evidenceReferenceIds: readonly EvidenceReferenceId[];
  readonly conflict: boolean;
  readonly uncertain: boolean;
  readonly reasonCodes: readonly ReconciliationReasonCode[];
  readonly justification: string | null;
}

export interface ReconciliationResult extends ReconciliationOutcome {
  readonly path: "DETERMINISTIC" | "MODEL";
  readonly schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
}

export interface WorkingContextResult {
  readonly reconciliationId: string;
  readonly workingContextItemId: WorkingContextItemId | null;
  readonly replayed: boolean;
}

export interface DeterministicComparison {
  readonly semanticIdentity: string;
  readonly candidateAssertion: Readonly<Record<string, unknown>>;
  readonly candidateHash: string;
  readonly duplicateCandidate: boolean;
  readonly currentAssertion: Readonly<Record<string, unknown>> | null;
  readonly currentHash: string | null;
  readonly currentIsKnownHistorical: boolean;
  readonly authorityQualification: AuthorityQualification | "SHADOWED";
  readonly evidenceRequired: boolean;
  readonly evidenceReferenceIds: readonly EvidenceReferenceId[];
  readonly activeConflict: boolean;
  readonly activeUncertainty: boolean;
}

function normalizedValue(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error("Semantic assertion exceeds maximum nesting depth");
  if (typeof value === "string") {
    const text = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (text.length > 8_192) throw new Error("Semantic string exceeds maximum length");
    return text;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Semantic number must be finite");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => normalizedValue(item, depth + 1));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length > 128) throw new Error("Semantic object has too many fields");
    return Object.fromEntries(
      entries.map(([key, item]) => [key, normalizedValue(item, depth + 1)]),
    );
  }
  throw new Error("Semantic assertion contains an unsupported value");
}

export function normalizeAssertion(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Assertion must be an object");
  const normalized = normalizedValue(value) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > 65_536)
    throw new Error("Assertion exceeds 65536 bytes");
  return Object.freeze(normalized);
}

export function stableAssertionHash(value: unknown): string {
  const input = new TextEncoder().encode(JSON.stringify(normalizeAssertion(value)));
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const rotate = (word: number, count: number) => (word >>> count) | (word << (32 - count));
  const schedule = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      schedule[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = schedule[index - 15]!;
      const right = schedule[index - 2]!;
      const s0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const s1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      schedule[index] = (schedule[index - 16]! + s0 + schedule[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choice + constants[index]! + schedule[index]!) >>> 0;
      const sum0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function deterministicOutcome(
  input: DeterministicComparison,
  classification: ReconciliationClass,
  reason: ReconciliationReasonCode,
): ReconciliationResult {
  return Object.freeze({
    classification,
    semanticIdentity: input.semanticIdentity,
    normalizedAssertion:
      classification === "UNCHANGED" ? null : normalizeAssertion(input.candidateAssertion),
    evidenceReferenceIds: Object.freeze([...new Set(input.evidenceReferenceIds)].sort()),
    conflict: classification === "CONFLICTING",
    uncertain: classification === "UNCERTAIN",
    reasonCodes: Object.freeze([reason]),
    justification: null,
    path: "DETERMINISTIC",
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
  });
}

export function deterministicReconciliation(
  input: DeterministicComparison,
): ReconciliationResult | null {
  if (input.duplicateCandidate)
    return deterministicOutcome(input, "UNCHANGED", "DUPLICATE_CANDIDATE");
  if (input.currentHash !== null && input.candidateHash === input.currentHash)
    return deterministicOutcome(input, "UNCHANGED", "EXACT_ASSERTION_MATCH");
  if (input.authorityQualification !== "EFFECTIVE")
    return deterministicOutcome(input, "UNCERTAIN", "AUTHORITY_DISQUALIFIED");
  if (input.evidenceRequired && input.evidenceReferenceIds.length === 0)
    return deterministicOutcome(input, "UNCERTAIN", "MISSING_REQUIRED_EVIDENCE");
  if (input.activeConflict) return deterministicOutcome(input, "CONFLICTING", "ACTIVE_CONFLICT");
  if (input.activeUncertainty)
    return deterministicOutcome(input, "UNCERTAIN", "ACTIVE_UNCERTAINTY");
  if (input.currentIsKnownHistorical)
    return deterministicOutcome(input, "SUPERSEDED", "KNOWN_SUPERSESSION");
  if (input.currentAssertion === null)
    return deterministicOutcome(input, "NEW", "NO_CURRENT_CONTEXT");
  return null;
}

export interface ModelReconciliationOutput {
  readonly classification: string;
  readonly semanticIdentity: string;
  readonly normalizedAssertion: unknown;
  readonly evidenceReferenceIds: readonly string[];
  readonly conflict: boolean;
  readonly uncertain: boolean;
  readonly reasonCodes: readonly string[];
  readonly justification: string | null;
}

export function validateModelOutput(
  value: unknown,
  scope: {
    readonly semanticIdentity: string;
    readonly allowedEvidenceReferenceIds: readonly EvidenceReferenceId[];
  },
): ReconciliationResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MODEL_OUTPUT_INVALID_OBJECT");
  const record = value as Record<string, unknown>;
  const expected = [
    "classification",
    "semanticIdentity",
    "normalizedAssertion",
    "evidenceReferenceIds",
    "conflict",
    "uncertain",
    "reasonCodes",
    "justification",
  ].sort();
  const actual = Object.keys(record).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new Error("MODEL_OUTPUT_UNKNOWN_OR_MISSING_FIELDS");
  if (!(RECONCILIATION_CLASSES as readonly unknown[]).includes(record.classification))
    throw new Error("MODEL_OUTPUT_INVALID_CLASSIFICATION");
  if (record.semanticIdentity !== scope.semanticIdentity)
    throw new Error("MODEL_OUTPUT_FOREIGN_SEMANTIC_IDENTITY");
  if (
    !Array.isArray(record.evidenceReferenceIds) ||
    record.evidenceReferenceIds.some(
      (id) =>
        typeof id !== "string" ||
        !scope.allowedEvidenceReferenceIds.includes(id as EvidenceReferenceId),
    )
  )
    throw new Error("MODEL_OUTPUT_FORGED_EVIDENCE_REFERENCE");
  if (
    !Array.isArray(record.reasonCodes) ||
    record.reasonCodes.some((code) => !(REASON_CODES as readonly unknown[]).includes(code))
  )
    throw new Error("MODEL_OUTPUT_INVALID_REASON_CODE");
  if (typeof record.conflict !== "boolean" || typeof record.uncertain !== "boolean")
    throw new Error("MODEL_OUTPUT_INVALID_FLAGS");
  const classification = record.classification as ReconciliationClass;
  if (
    record.conflict !== (classification === "CONFLICTING") ||
    record.uncertain !== (classification === "UNCERTAIN")
  )
    throw new Error("MODEL_OUTPUT_INCONSISTENT_FLAGS");
  if (
    record.justification !== null &&
    (typeof record.justification !== "string" || record.justification.length > 500)
  )
    throw new Error("MODEL_OUTPUT_INVALID_JUSTIFICATION");
  return Object.freeze({
    classification,
    semanticIdentity: scope.semanticIdentity,
    normalizedAssertion:
      classification === "UNCHANGED" ? null : normalizeAssertion(record.normalizedAssertion),
    evidenceReferenceIds: Object.freeze(
      [...new Set(record.evidenceReferenceIds as EvidenceReferenceId[])].sort(),
    ),
    conflict: record.conflict,
    uncertain: record.uncertain,
    reasonCodes: Object.freeze(record.reasonCodes as ReconciliationReasonCode[]),
    justification: record.justification as string | null,
    path: "MODEL",
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
  });
}

export interface ReasoningPacketBudget {
  readonly maxEvidence: number;
  readonly maxWorkingContext: number;
  readonly maxCharactersPerItem: number;
  readonly maxSerializedBytes: number;
  readonly maxHistoryDepth: number;
}
export interface UntrustedEvidenceInput {
  readonly evidenceReferenceId: EvidenceReferenceId;
  readonly contentClassification:
    "PUBLIC_PROJECT_TEXT" | "SECRET" | "CREDENTIAL" | "UNKNOWN_SENSITIVE";
  readonly content: string;
  readonly authorityQualification: AuthorityQualification | "SHADOWED";
}
export interface ReasoningPacket {
  readonly contract: {
    readonly schemaVersion: string;
    readonly promptVersion: string;
    readonly compactionVersion: string;
    readonly normalizationVersion: string;
    readonly untrustedContentPolicy: "DATA_ONLY_NO_INSTRUCTIONS";
  };
  readonly semanticIdentity: string;
  readonly candidateAssertion: Readonly<Record<string, unknown>>;
  readonly reviewedContext: Readonly<Record<string, unknown>> | null;
  readonly workingContext: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly {
    readonly evidenceReferenceId: EvidenceReferenceId;
    readonly content: string;
    readonly authorityQualification: AuthorityQualification | "SHADOWED";
  }[];
  readonly omitted: readonly {
    readonly kind: "EVIDENCE" | "WORKING_CONTEXT";
    readonly reference: string;
    readonly reason: string;
  }[];
  readonly basis: ReconciliationBasis;
}

const secretMarker =
  /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:ghp|github_pat|sk)-[A-Za-z0-9_-]{16,}|\bBearer\s+[A-Za-z0-9._~-]{16,}|\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|(?:postgres|mysql):\/\/[^\s:@]+:[^\s@]+@)/u;

export function buildReasoningPacket(input: {
  readonly comparison: DeterministicComparison;
  readonly basis: ReconciliationBasis;
  readonly workingContext: readonly Readonly<Record<string, unknown>>[];
  readonly evidence: readonly UntrustedEvidenceInput[];
  readonly budget: ReasoningPacketBudget;
}): ReasoningPacket {
  for (const [key, value] of Object.entries(input.budget))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error(`Invalid reasoning packet budget: ${key}`);
  const omitted: { kind: "EVIDENCE" | "WORKING_CONTEXT"; reference: string; reason: string }[] = [];
  const workingLimit = Math.min(input.budget.maxWorkingContext, input.budget.maxHistoryDepth);
  const workingContext = input.workingContext.slice(0, workingLimit).map(normalizeAssertion);
  input.workingContext.slice(workingLimit).forEach((_, index) =>
    omitted.push({
      kind: "WORKING_CONTEXT",
      reference: String(index + workingLimit),
      reason:
        input.budget.maxHistoryDepth < input.budget.maxWorkingContext
          ? "HISTORY_DEPTH_BUDGET"
          : "ITEM_BUDGET",
    }),
  );
  const evidence = input.evidence.slice(0, input.budget.maxEvidence).flatMap((item) => {
    if (item.contentClassification !== "PUBLIC_PROJECT_TEXT" || secretMarker.test(item.content)) {
      omitted.push({
        kind: "EVIDENCE",
        reference: item.evidenceReferenceId,
        reason: "SENSITIVE_OR_UNCLASSIFIED",
      });
      return [];
    }
    const content = item.content.normalize("NFKC").slice(0, input.budget.maxCharactersPerItem);
    if (content.length < item.content.length)
      omitted.push({
        kind: "EVIDENCE",
        reference: item.evidenceReferenceId,
        reason: "ITEM_COMPACTED",
      });
    return [
      {
        evidenceReferenceId: item.evidenceReferenceId,
        content,
        authorityQualification: item.authorityQualification,
      },
    ];
  });
  input.evidence.slice(input.budget.maxEvidence).forEach((item) =>
    omitted.push({
      kind: "EVIDENCE",
      reference: item.evidenceReferenceId,
      reason: "ITEM_BUDGET",
    }),
  );
  const packet: ReasoningPacket = Object.freeze({
    contract: {
      schemaVersion: RECONCILIATION_SCHEMA_VERSION,
      promptVersion: RECONCILIATION_PROMPT_VERSION,
      compactionVersion: RECONCILIATION_COMPACTION_VERSION,
      normalizationVersion: RECONCILIATION_NORMALIZATION_VERSION,
      untrustedContentPolicy: "DATA_ONLY_NO_INSTRUCTIONS" as const,
    },
    semanticIdentity: input.comparison.semanticIdentity,
    candidateAssertion: normalizeAssertion(input.comparison.candidateAssertion),
    reviewedContext:
      input.comparison.currentAssertion === null
        ? null
        : normalizeAssertion(input.comparison.currentAssertion),
    workingContext: Object.freeze(workingContext),
    evidence: Object.freeze(evidence),
    omitted: Object.freeze(omitted),
    basis: input.basis,
  });
  if (Buffer.byteLength(JSON.stringify(packet), "utf8") > input.budget.maxSerializedBytes)
    throw new Error("REASONING_PACKET_BUDGET_EXCEEDED");
  return packet;
}

export interface ModelUsage {
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly totalUnits: number;
}
export interface ModelInvocationAccounting extends ModelUsage {
  readonly providerId: string;
  readonly modelId: string;
  readonly configurationVersion: string;
  readonly pricingVersion: string | null;
  readonly estimatedCostMicrounits: number | null;
  readonly latencyMs: number;
  readonly attempt: number;
  readonly succeeded: boolean;
  readonly failureCode: string | null;
}
export function estimateCostMicrounits(
  usage: ModelUsage,
  pricing: {
    readonly inputPerMillionMicrounits: number;
    readonly outputPerMillionMicrounits: number;
  },
): number {
  for (const value of [
    usage.inputUnits,
    usage.outputUnits,
    pricing.inputPerMillionMicrounits,
    pricing.outputPerMillionMicrounits,
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Usage and pricing must be non-negative safe integers");
  return Math.round(
    (usage.inputUnits * pricing.inputPerMillionMicrounits +
      usage.outputUnits * pricing.outputPerMillionMicrounits) /
      1_000_000,
  );
}

export type ReconciliationProviderFailureCode =
  | "TIMEOUT"
  | "TRANSPORT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_OUTPUT"
  | "SCHEMA_VALIDATION"
  | "REFUSAL"
  | "SAFETY_REJECTION"
  | "CONTEXT_TOO_LARGE"
  | "CONFIGURATION_INVALID"
  | "BUDGET_EXCEEDED";
export interface ModelConfiguration {
  readonly providerId: string;
  readonly modelId: string;
  readonly configurationVersion: string;
  readonly privacyClass: string;
  readonly fallbackAllowlist: readonly {
    readonly providerId: string;
    readonly modelId: string;
    readonly privacyClass: string;
  }[];
  readonly pricingVersion: string | null;
  readonly inputPerMillionMicrounits: number | null;
  readonly outputPerMillionMicrounits: number | null;
}
export interface EvidenceAuthorityBasis {
  readonly evidenceReferenceId: EvidenceReferenceId;
  readonly authorityAssignmentId: SourceAuthorityAssignmentId | null;
  readonly authorityQualification: AuthorityQualification | "SHADOWED";
}
