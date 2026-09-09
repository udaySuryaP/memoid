import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@memoid/observability";
describe("central log redaction", () => {
  it("redacts credential-shaped fields", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, done) {
        output += chunk.toString();
        done();
      },
    });
    const logger = createLogger("redaction-test", "info", destination);
    logger.info(
      {
        password: "synthetic-password",
        token: "synthetic-token",
        apiKey: "synthetic-key",
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        code: "synthetic-oauth-code",
        state: "synthetic-oauth-state",
        signature: "synthetic-webhook-signature",
        safe: "visible",
      },
      "fixture",
    );
    expect(output).not.toContain("synthetic-password");
    expect(output).not.toContain("synthetic-token");
    expect(output).not.toContain("synthetic-key");
    expect(output).not.toContain("synthetic-access-token");
    expect(output).not.toContain("synthetic-refresh-token");
    expect(output).not.toContain("synthetic-oauth-code");
    expect(output).not.toContain("synthetic-oauth-state");
    expect(output).not.toContain("synthetic-webhook-signature");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("visible");
  });
});
