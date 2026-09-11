import {
  authorityReasonNote,
  authorityRefKey,
  authorityScopeKey,
  parseAuthorityCategoryFacet,
  parseUuidV7,
  resolveAuthority,
  type AuthorityAssignmentView,
  type SourceAuthorityAssignmentId,
  type SourceAuthorityScopeId,
  type SourceId,
} from "../../packages/domain/src/index.js";
import { describe, expect, it } from "vitest";

const id = (suffix: string, kind: string) =>
  parseUuidV7(`01900000-0000-7000-8000-${suffix.padStart(12, "0")}`, kind);

function assignment(
  suffix: string,
  input: Partial<AuthorityAssignmentView> = {},
): AuthorityAssignmentView {
  return {
    id: id(suffix, "SourceAuthorityAssignmentId") as SourceAuthorityAssignmentId,
    scopeId: id(`1${suffix}`, "SourceAuthorityScopeId") as SourceAuthorityScopeId,
    sourceId: id(`2${suffix}`, "SourceId") as SourceId,
    sourceLabel: "owner/repository",
    category: "IMPLEMENTATION_STATE",
    facet: "CODE",
    scopeKind: "PROJECT",
    scopeKey: "/",
    refSelector: "ANY_REF",
    refKey: null,
    version: 1,
    qualification: "EFFECTIVE",
    effectiveAt: "2026-09-11T00:00:00.000Z",
    ...input,
  };
}

const target = {
  category: "IMPLEMENTATION_STATE" as const,
  facet: "CODE" as const,
  scopeKey: "packages/domain/src",
  refKey: "refs/heads/main",
  defaultRefKey: "refs/heads/main",
};

describe("Stage 10G Source Authority domain", () => {
  it("accepts only reviewed category/facet pairs and bounded scope/ref values", () => {
    expect(parseAuthorityCategoryFacet("IMPLEMENTATION_STATE:CODE")).toEqual({
      category: "IMPLEMENTATION_STATE",
      facet: "CODE",
    });
    expect(authorityScopeKey("PROJECT", null)).toBe("/");
    expect(authorityScopeKey("PATH_PREFIX", "packages/domain")).toBe("packages/domain");
    expect(authorityRefKey("EXACT_REF", "refs/heads/release/v1")).toBe("refs/heads/release/v1");
    expect(authorityReasonNote("  reviewed decision  ")).toBe("reviewed decision");
    expect(() => parseAuthorityCategoryFacet("GLOBAL:TRUTH")).toThrow("Unsupported");
    expect(() => authorityScopeKey("PATH_PREFIX", "../foreign")).toThrow("malformed");
    expect(() => authorityRefKey("DEFAULT_BRANCH", "refs/heads/main")).toThrow("Only");
  });

  it("chooses exact-ref and narrower scope assignments deterministically", () => {
    const project = assignment("1");
    const prefix = assignment("2", {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
    });
    const exactRef = assignment("3", {
      refSelector: "EXACT_REF",
      refKey: "refs/heads/main",
    });
    expect(resolveAuthority([project, prefix], target)).toMatchObject({ assignment: prefix });
    expect(resolveAuthority([project, prefix, exactRef], target)).toMatchObject({
      assignment: exactRef,
    });
  });

  it("fails closed without an assignment or when equal-best candidates are ambiguous", () => {
    expect(resolveAuthority([], target)).toEqual({ qualification: "MISSING" });
    const first = assignment("4", {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
    });
    const competing = assignment("5", {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
    });
    expect(resolveAuthority([first, competing], target)).toEqual({
      qualification: "AMBIGUOUS",
    });
  });

  it("does not fall back when the most-specific authority is degraded", () => {
    const broad = assignment("6");
    const unavailable = assignment("7", {
      scopeKind: "PATH_PREFIX",
      scopeKey: "packages/domain",
      qualification: "SOURCE_UNAVAILABLE",
    });
    expect(resolveAuthority([broad, unavailable], target)).toMatchObject({
      qualification: "SOURCE_UNAVAILABLE",
      assignment: unavailable,
    });
  });
});
