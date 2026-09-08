import {
  createOpaqueProviderState,
  sealGitHubFlowState,
  unsealGitHubFlowState,
} from "@memoid/security";
import { describe, expect, it } from "vitest";

describe("Stage 10E provider state", () => {
  it("seals the one-time intent binding and rejects tampering or expiry", () => {
    const key = Buffer.alloc(32, 7);
    const providerState = createOpaqueProviderState();
    const flow = {
      state: providerState.state,
      intentId: "0199c4ca-39a2-7000-8000-000000000001",
      projectId: "0199c4ca-39a2-7000-8000-000000000002",
      installationId: "456",
      idempotencyKey: createOpaqueProviderState().state,
      expiresAt: Date.now() + 60_000,
    };
    const sealed = sealGitHubFlowState(flow, key);
    expect(unsealGitHubFlowState(sealed, key)).toEqual(flow);
    expect(unsealGitHubFlowState(`${sealed}x`, key)).toBeNull();
    expect(unsealGitHubFlowState(sealed, key, flow.expiresAt)).toBeNull();
  });
});
