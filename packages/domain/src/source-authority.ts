import type {
  SourceAuthorityAssignmentId,
  SourceAuthorityScopeId,
  SourceId,
} from "./identifiers.js";

export const AUTHORITY_CATEGORY_FACETS = [
  "IMPLEMENTATION_STATE:CODE",
  "IMPLEMENTATION_STATE:CONFIGURATION",
  "ARCHITECTURE_INTENT:DOCUMENTATION",
  "ARCHITECTURE_INTENT:DECISION",
  "PROVIDER_STATE:ISSUE_STATE",
  "PROVIDER_STATE:PULL_REQUEST_STATE",
] as const;
export type AuthorityCategoryFacet = (typeof AUTHORITY_CATEGORY_FACETS)[number];
export type AuthorityCategory = AuthorityCategoryFacet extends `${infer C}:${string}` ? C : never;
export type AuthorityFacet = AuthorityCategoryFacet extends `${string}:${infer F}` ? F : never;

export const AUTHORITY_SCOPE_KINDS = ["PROJECT", "PATH_PREFIX"] as const;
export type AuthorityScopeKind = (typeof AUTHORITY_SCOPE_KINDS)[number];
export const AUTHORITY_REF_SELECTORS = ["ANY_REF", "DEFAULT_BRANCH", "EXACT_REF"] as const;
export type AuthorityRefSelector = (typeof AUTHORITY_REF_SELECTORS)[number];
export const AUTHORITY_REASON_KEYS = [
  "INITIAL_REVIEW",
  "SCOPE_CORRECTION",
  "SOURCE_REPLACEMENT",
  "DEFAULT_BRANCH_REVALIDATION",
  "ACCESS_DEGRADATION",
] as const;
export type AuthorityReasonKey = (typeof AUTHORITY_REASON_KEYS)[number];

export type AuthorityQualification =
  | "EFFECTIVE"
  | "MISSING"
  | "AMBIGUOUS"
  | "SOURCE_UNAVAILABLE"
  | "SOURCE_UNOBSERVED"
  | "SOURCE_BEHIND"
  | "REVALIDATION_REQUIRED";

function closedValue<T extends readonly string[]>(
  values: T,
  value: string,
  label: string,
): T[number] {
  if (!values.includes(value)) throw new Error(`Unsupported ${label}: ${value}`);
  return value as T[number];
}

export function parseAuthorityCategoryFacet(value: string): {
  readonly category: AuthorityCategory;
  readonly facet: AuthorityFacet;
} {
  const pair = closedValue(AUTHORITY_CATEGORY_FACETS, value, "authority category/facet");
  const [category, facet] = pair.split(":") as [AuthorityCategory, AuthorityFacet];
  return { category, facet };
}

export function parseAuthorityScopeKind(value: string): AuthorityScopeKind {
  return closedValue(AUTHORITY_SCOPE_KINDS, value, "authority scope kind");
}

export function parseAuthorityRefSelector(value: string): AuthorityRefSelector {
  return closedValue(AUTHORITY_REF_SELECTORS, value, "authority ref selector");
}

export function parseAuthorityReasonKey(value: string): AuthorityReasonKey {
  return closedValue(AUTHORITY_REASON_KEYS, value, "authority reason");
}

function safeSegments(value: string, label: string, maximum: number): string {
  if (value.length < 1 || value.length > maximum || value.trim() !== value || value.includes("\\"))
    throw new Error(`${label} is malformed`);
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/u.test(segment),
    )
  )
    throw new Error(`${label} is malformed`);
  return value;
}

export function authorityScopeKey(kind: AuthorityScopeKind, value?: string | null): string {
  if (kind === "PROJECT") {
    if (value !== undefined && value !== null && value !== "/")
      throw new Error("Project authority scope must use /");
    return "/";
  }
  return safeSegments(value ?? "", "Authority path prefix", 1024);
}

export function authorityRefKey(
  selector: AuthorityRefSelector,
  value?: string | null,
): string | null {
  if (selector !== "EXACT_REF") {
    if (value !== undefined && value !== null && value !== "")
      throw new Error("Only an exact-ref authority selector may carry a ref key");
    return null;
  }
  const ref = value ?? "";
  if (!ref.startsWith("refs/heads/")) throw new Error("Authority ref must be a branch ref");
  safeSegments(ref.slice("refs/heads/".length), "Authority branch ref", 1000);
  return ref;
}

export function authorityReasonNote(value?: string | null): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  const note = value.trim();
  if (note.length > 500 || Array.from(note).some((c) => (c.codePointAt(0) ?? 0) < 32))
    throw new Error("Authority reason note must contain at most 500 visible characters");
  return note;
}

export interface AuthorityAssignmentView {
  readonly id: SourceAuthorityAssignmentId;
  readonly scopeId: SourceAuthorityScopeId;
  readonly sourceId: SourceId;
  readonly sourceLabel: string;
  readonly category: AuthorityCategory;
  readonly facet: AuthorityFacet;
  readonly scopeKind: AuthorityScopeKind;
  readonly scopeKey: string;
  readonly refSelector: AuthorityRefSelector;
  readonly refKey: string | null;
  readonly version: number;
  readonly qualification: Exclude<AuthorityQualification, "MISSING" | "AMBIGUOUS">;
  readonly effectiveAt: string;
}

export interface AuthorityResolutionTarget {
  readonly category: AuthorityCategory;
  readonly facet: AuthorityFacet;
  readonly scopeKey: string;
  readonly refKey: string;
  readonly defaultRefKey: string;
}

function applies(assignment: AuthorityAssignmentView, target: AuthorityResolutionTarget): boolean {
  if (assignment.category !== target.category || assignment.facet !== target.facet) return false;
  if (
    assignment.scopeKind === "PATH_PREFIX" &&
    target.scopeKey !== assignment.scopeKey &&
    !target.scopeKey.startsWith(`${assignment.scopeKey}/`)
  )
    return false;
  if (assignment.refSelector === "EXACT_REF") return assignment.refKey === target.refKey;
  if (assignment.refSelector === "DEFAULT_BRANCH") return target.refKey === target.defaultRefKey;
  return true;
}

function specificity(assignment: AuthorityAssignmentView): readonly [number, number] {
  const ref =
    assignment.refSelector === "EXACT_REF"
      ? 2
      : assignment.refSelector === "DEFAULT_BRANCH"
        ? 1
        : 0;
  const scope = assignment.scopeKind === "PROJECT" ? 0 : assignment.scopeKey.split("/").length;
  return [ref, scope];
}

export function resolveAuthority(
  assignments: readonly AuthorityAssignmentView[],
  target: AuthorityResolutionTarget,
):
  | { readonly qualification: "MISSING" | "AMBIGUOUS" }
  | {
      readonly qualification: Exclude<AuthorityQualification, "MISSING" | "AMBIGUOUS">;
      readonly assignment: AuthorityAssignmentView;
    } {
  const candidates = assignments.filter((assignment) => applies(assignment, target));
  if (candidates.length === 0) return { qualification: "MISSING" };
  candidates.sort((left, right) => {
    const [leftRef, leftScope] = specificity(left);
    const [rightRef, rightScope] = specificity(right);
    return rightRef - leftRef || rightScope - leftScope;
  });
  const best = candidates[0]!;
  const [bestRef, bestScope] = specificity(best);
  const tied = candidates.filter((candidate) => {
    const [ref, scope] = specificity(candidate);
    return ref === bestRef && scope === bestScope;
  });
  if (new Set(tied.map((candidate) => candidate.id)).size !== 1)
    return { qualification: "AMBIGUOUS" };
  return { qualification: best.qualification, assignment: best };
}
