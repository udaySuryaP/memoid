import type { AccountId, IdentityBindingId } from "./identifiers.js";

const PROVIDER_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PROVIDER_SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type IdentityBindingState = "ACTIVE" | "DISABLED" | "DELETED";

export interface AccountIdentityBinding {
  readonly id: IdentityBindingId;
  readonly accountId: AccountId;
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly normalizedEmail: string;
  readonly emailVerified: boolean;
  readonly state: IdentityBindingState;
}

export interface ProviderIdentityEvidence {
  readonly providerKey: string;
  readonly providerSubject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly providerSessionId: string;
  readonly impersonated: boolean;
}

export type IdentityBindingDecision =
  | { readonly outcome: "CREATE_ACCOUNT_BINDING"; readonly normalizedEmail: string }
  | {
      readonly outcome: "USE_EXISTING_BINDING" | "UPDATE_EXISTING_EMAIL";
      readonly binding: AccountIdentityBinding;
      readonly normalizedEmail: string;
    }
  | {
      readonly outcome: "DENY";
      readonly reason:
        | "EMAIL_NOT_VERIFIED"
        | "IMPERSONATION_NOT_ALLOWED"
        | "IDENTITY_BINDING_DISABLED"
        | "IDENTITY_LINK_AMBIGUOUS";
    };

export function parseProviderKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!PROVIDER_KEY.test(normalized)) throw new Error("Identity provider key is invalid");
  return normalized;
}

export function parseProviderSubject(value: string): string {
  const normalized = value.trim();
  if (!PROVIDER_SUBJECT.test(normalized)) throw new Error("Identity provider subject is invalid");
  return normalized;
}

export function normalizeVerifiedEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 320 || !SIMPLE_EMAIL.test(normalized))
    throw new Error("Verified email address is invalid");
  return normalized;
}

export function decideIdentityBinding(
  evidence: ProviderIdentityEvidence,
  existingBySubject: AccountIdentityBinding | null,
  existingByEmail: AccountIdentityBinding | null,
): IdentityBindingDecision {
  parseProviderKey(evidence.providerKey);
  parseProviderSubject(evidence.providerSubject);
  if (!evidence.emailVerified) return { outcome: "DENY", reason: "EMAIL_NOT_VERIFIED" };
  if (evidence.impersonated) return { outcome: "DENY", reason: "IMPERSONATION_NOT_ALLOWED" };
  const normalizedEmail = normalizeVerifiedEmail(evidence.email);

  if (existingBySubject) {
    if (!existingBySubject.emailVerified || existingBySubject.state !== "ACTIVE")
      return { outcome: "DENY", reason: "IDENTITY_BINDING_DISABLED" };
    if (existingByEmail && existingByEmail.accountId !== existingBySubject.accountId)
      return { outcome: "DENY", reason: "IDENTITY_LINK_AMBIGUOUS" };
    return {
      outcome:
        existingBySubject.normalizedEmail === normalizedEmail
          ? "USE_EXISTING_BINDING"
          : "UPDATE_EXISTING_EMAIL",
      binding: existingBySubject,
      normalizedEmail,
    };
  }

  if (existingByEmail) return { outcome: "DENY", reason: "IDENTITY_LINK_AMBIGUOUS" };
  return { outcome: "CREATE_ACCOUNT_BINDING", normalizedEmail };
}
