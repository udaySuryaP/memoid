import { describe, expect, it } from "vitest";
import { signReturnIntent, verifyReturnIntent } from "@memoid/security";
const key = new TextEncoder().encode("synthetic-foundation-key-material-only");
describe("signed return intent", () => {
  it("round-trips an unexpired relative route", () => {
    const token = signReturnIntent(
      { nonce: "synthetic", route: "/foundation", expiresAt: 2_000 },
      key,
    );
    expect(verifyReturnIntent(token, key, 1_000)?.route).toBe("/foundation");
  });
  it("rejects tampering, expiry, and protocol-relative routes", () => {
    const valid = signReturnIntent(
      { nonce: "synthetic", route: "/foundation", expiresAt: 2_000 },
      key,
    );
    expect(verifyReturnIntent(`${valid}x`, key, 1_000)).toBeNull();
    expect(verifyReturnIntent(valid, key, 3_000)).toBeNull();
    expect(
      verifyReturnIntent(
        signReturnIntent({ nonce: "synthetic", route: "//example.invalid", expiresAt: 2_000 }, key),
        key,
        1_000,
      ),
    ).toBeNull();
  });
});
