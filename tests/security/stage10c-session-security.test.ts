import {
  AUTH_FLOW_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearHostCookie,
  createOpaqueSessionCredential,
  hashSessionCredential,
  isAllowedMutationOrigin,
  sealAuthFlowState,
  serializeAuthFlowCookie,
  serializeSessionCookie,
  unsealAuthFlowState,
} from "@memoid/security";
import { describe, expect, it } from "vitest";

describe("Stage 10C browser-session security", () => {
  it("stores only an opaque random credential in a hardened host cookie", () => {
    const first = createOpaqueSessionCredential();
    const second = createOpaqueSessionCredential();
    expect(first.token).not.toBe(second.token);
    expect(first.hash).toEqual(hashSessionCredential(first.token));
    expect(first.hash).toHaveLength(32);
    expect(serializeSessionCookie(first.token, 3_600)).toBe(
      `${SESSION_COOKIE_NAME}=${first.token}; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax`,
    );
    expect(clearHostCookie(SESSION_COOKIE_NAME)).toContain("Max-Age=0");
  });

  it("confidentially binds PKCE and return state and rejects tampering or replay after expiry", () => {
    const key = Buffer.alloc(32, 7);
    const now = Date.now();
    const sealed = sealAuthFlowState(
      {
        state: "provider-state",
        codeVerifier: "pkce-verifier",
        returnPath: "/account/security",
        expiresAt: now + 60_000,
      },
      key,
    );
    expect(unsealAuthFlowState(sealed, key, now)?.codeVerifier).toBe("pkce-verifier");
    expect(unsealAuthFlowState(`${sealed.slice(0, -1)}x`, key, now)).toBeNull();
    expect(unsealAuthFlowState(sealed, key, now + 60_001)).toBeNull();
    expect(serializeAuthFlowCookie(sealed)).toContain(`${AUTH_FLOW_COOKIE_NAME}=`);
  });

  it("blocks cross-origin and scheme-confused mutations", () => {
    expect(isAllowedMutationOrigin("https://memoid.example", "https://memoid.example")).toBe(true);
    expect(isAllowedMutationOrigin("http://memoid.example", "https://memoid.example")).toBe(false);
    expect(isAllowedMutationOrigin("https://attacker.example", "https://memoid.example")).toBe(
      false,
    );
    expect(isAllowedMutationOrigin(null, "https://memoid.example")).toBe(false);
  });
});
