import { describe, expect, it } from "vitest";
import { StructuredJsonModelAdapter } from "../../packages/adapters/src/reconciliation-model.js";
import type { ReconciliationProviderError } from "../../packages/application/src/reconciliation.js";

const request = {
  modelId: "proof-model",
  configurationVersion: "v1",
  outputSchemaVersion: "reconciliation-output.v1",
  packet: {
    contract: {
      schemaVersion: "v1",
      promptVersion: "v1",
      compactionVersion: "v1",
      normalizationVersion: "v1",
      untrustedContentPolicy: "DATA_ONLY_NO_INSTRUCTIONS" as const,
    },
    semanticIdentity: "identity",
    candidateAssertion: { value: 1 },
    reviewedContext: null,
    workingContext: [],
    evidence: [],
    omitted: [],
    basis: {} as never,
  },
};

describe("Stage 10J provider adapter", () => {
  it("maps a valid provider response and keeps untrusted data separate", async () => {
    let transportRequest: unknown;
    const adapter = new StructuredJsonModelAdapter("provider-a", async (input) => {
      transportRequest = input;
      return { body: { classification: "NEW" }, inputUnits: 10, outputUnits: 2, latencyMs: 5 };
    });
    expect(await adapter.invoke(request)).toMatchObject({
      usage: { inputUnits: 10, outputUnits: 2, totalUnits: 12 },
      refusal: false,
    });
    expect(transportRequest).toMatchObject({
      model: "proof-model",
      schemaVersion: "reconciliation-output.v1",
      untrustedData: request.packet,
    });
  });

  it("preserves explicit refusal", async () => {
    const adapter = new StructuredJsonModelAdapter("provider-a", async () => ({
      body: null,
      inputUnits: 1,
      outputUnits: 0,
      latencyMs: 1,
      refused: true,
    }));
    expect((await adapter.invoke(request)).refusal).toBe(true);
  });

  it("preserves classified timeout/rate-limit errors", async () => {
    for (const code of ["TIMEOUT", "RATE_LIMITED"] as const) {
      const adapter = new StructuredJsonModelAdapter("provider-a", async () => {
        throw { code, retryable: true, message: code };
      });
      await expect(adapter.invoke(request)).rejects.toMatchObject({ code, retryable: true });
    }
  });

  it("classifies unknown transport failures as retryable transport errors", async () => {
    const adapter = new StructuredJsonModelAdapter("provider-a", async () => {
      throw new Error("offline");
    });
    await expect(adapter.invoke(request)).rejects.toEqual(
      expect.objectContaining<Partial<ReconciliationProviderError>>({
        code: "TRANSPORT",
        retryable: true,
      }),
    );
  });
});
