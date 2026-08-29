import type { AccountId } from "./identifiers.js";
import type { Instant } from "./values.js";

export const ASSERTION_ORIGINS = [
  "USER_AUTHORED",
  "AI_INFERRED",
  "SOURCE_DERIVED",
  "SYSTEM_DERIVED",
] as const;
export type AssertionOrigin = (typeof ASSERTION_ORIGINS)[number];

export const ASSERTION_CONFIRMATIONS = ["NONE", "EXPLICIT_USER"] as const;
export type AssertionConfirmation = (typeof ASSERTION_CONFIRMATIONS)[number];

export type CandidateAssertionBasis =
  | {
      readonly origin: AssertionOrigin;
      readonly confirmation: "NONE";
      readonly confirmedAt?: never;
      readonly confirmedByAccountId?: never;
    }
  | {
      readonly origin: AssertionOrigin;
      readonly confirmation: "EXPLICIT_USER";
      readonly confirmedAt: Instant;
      readonly confirmedByAccountId: AccountId;
    };

export function candidateAssertionBasis(input: CandidateAssertionBasis): CandidateAssertionBasis {
  if (!(ASSERTION_ORIGINS as readonly string[]).includes(input.origin))
    throw new Error(`Unsupported assertion origin: ${input.origin}`);
  if (input.confirmation === "NONE") {
    if (input.confirmedAt !== undefined || input.confirmedByAccountId !== undefined)
      throw new Error("Unconfirmed assertions cannot carry confirmation attribution");
    return Object.freeze({ origin: input.origin, confirmation: input.confirmation });
  }
  if (!input.confirmedAt || !input.confirmedByAccountId)
    throw new Error("Explicit user confirmation requires Account and timestamp attribution");
  return Object.freeze({ ...input });
}
