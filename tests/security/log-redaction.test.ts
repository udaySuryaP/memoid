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
        safe: "visible",
      },
      "fixture",
    );
    expect(output).not.toContain("synthetic-password");
    expect(output).not.toContain("synthetic-token");
    expect(output).not.toContain("synthetic-key");
    expect(output).toContain("[REDACTED]");
    expect(output).toContain("visible");
  });
});
