import { authenticateGitHubLifecycleSignals } from "../../packages/adapters/src/github-source.js";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const secret = Buffer.from("synthetic-github-webhook-secret-32-bytes", "utf8");

function signed(payload: Buffer) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

describe("Stage 10E GitHub webhook authentication", () => {
  it("authenticates raw bytes and maps a suspension to an availability signal", () => {
    const payload = Buffer.from(
      JSON.stringify({
        action: "suspend",
        installation: { id: 456, app_id: 123 },
      }),
    );
    expect(
      authenticateGitHubLifecycleSignals({
        payload,
        signature: signed(payload),
        deliveryId: "00000000-0000-4000-8000-000000000001",
        event: "installation",
        expectedAppId: "123",
        secrets: [secret],
      }),
    ).toMatchObject([{ installationId: "456", repositoryId: null, state: "SUSPENDED" }]);
  });

  it("fans repository-removal signals out by stable repository ID", () => {
    const payload = Buffer.from(
      JSON.stringify({
        action: "removed",
        installation: { id: 456, app_id: 123 },
        repositories_removed: [{ id: 11 }, { id: 12 }],
      }),
    );
    expect(
      authenticateGitHubLifecycleSignals({
        payload,
        signature: signed(payload),
        deliveryId: "00000000-0000-4000-8000-000000000002",
        event: "installation_repositories",
        expectedAppId: "123",
        secrets: [secret],
      }).map((signal) => signal.repositoryId),
    ).toEqual(["11", "12"]);
  });

  it("rejects forged, unsupported, malformed, and oversized deliveries", () => {
    const payload = Buffer.from(
      JSON.stringify({ action: "suspend", installation: { id: 456, app_id: 123 } }),
    );
    expect(() =>
      authenticateGitHubLifecycleSignals({
        payload,
        signature: "sha256=" + "00".repeat(32),
        deliveryId: "delivery",
        event: "installation",
        expectedAppId: "123",
        secrets: [secret],
      }),
    ).toThrow(/signature/u);
    expect(() =>
      authenticateGitHubLifecycleSignals({
        payload,
        signature: signed(payload),
        deliveryId: "delivery",
        event: "installation",
        expectedAppId: "124",
        secrets: [secret],
      }),
    ).toThrow(/App ID/u);
    expect(() =>
      authenticateGitHubLifecycleSignals({
        payload,
        signature: signed(payload),
        deliveryId: "delivery with spaces",
        event: "installation",
        expectedAppId: "123",
        secrets: [secret],
      }),
    ).toThrow(/delivery ID/u);
    expect(() =>
      authenticateGitHubLifecycleSignals({
        payload,
        signature: signed(payload),
        deliveryId: "delivery",
        event: "push",
        expectedAppId: "123",
        secrets: [secret],
      }),
    ).toThrow(/Unsupported/u);
    expect(() =>
      authenticateGitHubLifecycleSignals({
        payload: Buffer.alloc(10),
        signature: signed(Buffer.alloc(10)),
        deliveryId: "delivery",
        event: "installation",
        expectedAppId: "123",
        secrets: [secret],
        maximumBytes: 9,
      }),
    ).toThrow(/too large/u);
  });
});
