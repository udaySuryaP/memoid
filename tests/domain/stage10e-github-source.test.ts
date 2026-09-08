import {
  githubProviderId,
  providerIdentityKey,
  verifiedGitHubRepository,
} from "../../packages/domain/src/github-source.js";
import { describe, expect, it } from "vitest";

const evidence = (overrides: Partial<Parameters<typeof verifiedGitHubRepository>[0]> = {}) =>
  verifiedGitHubRepository({
    appId: githubProviderId("123"),
    installationId: githubProviderId("456"),
    accountId: githubProviderId("789"),
    repositoryId: githubProviderId("987654321"),
    ownerLogin: "memoid-owner",
    repositoryName: "memoid",
    fullName: "memoid-owner/memoid",
    htmlUrl: "https://github.com/memoid-owner/memoid",
    visibility: "private",
    defaultBranch: "main",
    verifiedAt: "2026-09-08T00:00:00.000Z",
    ...overrides,
  });

describe("Stage 10E GitHub provider identity", () => {
  it("uses stable provider IDs rather than mutable repository metadata", () => {
    const original = evidence();
    const renamed = evidence({
      ownerLogin: "new-owner",
      repositoryName: "renamed",
      fullName: "new-owner/renamed",
      htmlUrl: "https://github.com/new-owner/renamed",
      defaultBranch: "trunk",
    });
    expect(providerIdentityKey(renamed)).toBe(providerIdentityKey(original));
  });

  it("keeps provider integers as canonical decimal strings", () => {
    expect(githubProviderId("9007199254740993")).toBe("9007199254740993");
    expect(() => githubProviderId("01")).toThrow(/canonical decimal/u);
    expect(() => githubProviderId("1e3")).toThrow(/canonical decimal/u);
  });

  it("rejects mutable metadata that could smuggle non-GitHub authority", () => {
    expect(() => evidence({ htmlUrl: "https://example.com/repository" })).toThrow(/github[.]com/u);
    expect(() => evidence({ defaultBranch: " main" })).toThrow(/malformed/u);
  });
});
