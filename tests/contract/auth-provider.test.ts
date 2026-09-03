import { WorkOsAuthProvider } from "../../packages/auth/src/index.js";
import { describe, expect, it, vi } from "vitest";

function token(claims: object): string {
  return [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "trusted-direct-response",
  ].join(".");
}

describe("WorkOS provider-neutral authentication boundary", () => {
  it("uses hosted AuthKit PKCE and maps stable User/session evidence", async () => {
    const getAuthorizationUrlWithPKCE = vi.fn().mockResolvedValue({
      url: "https://example.authkit.app/authorize",
      state: "provider-state",
      codeVerifier: "provider-pkce",
    });
    const authenticateWithCode = vi.fn().mockResolvedValue({
      accessToken: token({
        sub: "user_01",
        sid: "session_01",
        auth_time: 1_900_000_000,
        exp: 1_900_003_600,
      }),
      user: { id: "user_01", email: "owner@example.test", emailVerified: true },
      authenticationMethod: "Passkey",
    });
    const listSessions = vi.fn().mockResolvedValue({
      data: [
        {
          id: "session_01",
          status: "active",
          expiresAt: "2030-03-17T18:46:40.000Z",
          authMethod: "Passkey",
        },
      ],
    });
    const client = {
      userManagement: {
        getAuthorizationUrlWithPKCE,
        authenticateWithCode,
        listSessions,
        revokeSession: vi.fn(),
        getLogoutUrl: vi.fn().mockReturnValue("https://example.authkit.app/logout"),
      },
    } as never;
    const provider = new WorkOsAuthProvider(client, "client_01");

    await expect(
      provider.createAuthorizationRequest({
        redirectUri: "https://memoid.example/auth/callback",
        maxAgeSeconds: 0,
      }),
    ).resolves.toMatchObject({ state: "provider-state", codeVerifier: "provider-pkce" });
    expect(getAuthorizationUrlWithPKCE).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "authkit", maxAge: 0 }),
    );
    await expect(
      provider.exchangeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "provider-pkce",
      }),
    ).resolves.toMatchObject({
      providerKey: "workos",
      providerSubject: "user_01",
      providerSessionId: "session_01",
      emailVerified: true,
      authenticationMethod: "Passkey",
      impersonated: false,
    });
  });

  it("fails closed when the token subject or active provider session does not match", async () => {
    const client = {
      userManagement: {
        authenticateWithCode: vi.fn().mockResolvedValue({
          accessToken: token({ sub: "user_attacker", sid: "session_01", auth_time: 1, exp: 2 }),
          user: { id: "user_01", email: "owner@example.test", emailVerified: true },
        }),
        listSessions: vi.fn().mockResolvedValue({ data: [] }),
      },
    } as never;
    await expect(
      new WorkOsAuthProvider(client, "client_01").exchangeAuthorizationCode({
        code: "authorization-code",
        codeVerifier: "provider-pkce",
      }),
    ).rejects.toThrow("required session claims");
  });

  it("verifies and normalizes only security-relevant provider webhooks", async () => {
    const constructEvent = vi
      .fn()
      .mockResolvedValueOnce({ event: "session.revoked", data: { id: "session_01" } })
      .mockResolvedValueOnce({
        event: "password_reset.succeeded",
        data: { userId: "user_01" },
      })
      .mockResolvedValueOnce({ event: "organization.created", data: { id: "org_01" } });
    const provider = new WorkOsAuthProvider({ webhooks: { constructEvent } } as never, "client_01");
    await expect(provider.constructWebhookEvent("body", "signature", "secret")).resolves.toEqual({
      type: "SESSION_REVOKED",
      providerSessionId: "session_01",
    });
    await expect(provider.constructWebhookEvent("body", "signature", "secret")).resolves.toEqual({
      type: "PASSWORD_RESET_SUCCEEDED",
      providerKey: "workos",
      providerSubject: "user_01",
    });
    await expect(provider.constructWebhookEvent("body", "signature", "secret")).resolves.toEqual({
      type: "IGNORED",
    });
    expect(constructEvent).toHaveBeenCalledWith({
      payload: "body",
      sigHeader: "signature",
      secret: "secret",
    });
  });
});
