import type {
  AuthProvider,
  AuthenticatedIdentity,
  AuthProviderSecurityEvent,
} from "@memoid/application";
import { PostgresAuthSessionStore } from "@memoid/db/auth-runtime";
import type { WorkOS } from "@workos-inc/node";

interface WorkOsTokenClaims {
  readonly sub?: unknown;
  readonly sid?: unknown;
  readonly auth_time?: unknown;
  readonly exp?: unknown;
}

function decodeTrustedTokenResponseClaims(accessToken: string): WorkOsTokenClaims {
  const segments = accessToken.split(".");
  if (segments.length !== 3 || !segments[1]) throw new Error("WorkOS access token is malformed");
  try {
    return JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as WorkOsTokenClaims;
  } catch {
    throw new Error("WorkOS access token claims are malformed");
  }
}

/** WorkOS boundary only. Hosted AuthKit owns authentication/passkey UI. */
export class WorkOsAuthProvider implements AuthProvider {
  public constructor(
    private readonly client: WorkOS,
    private readonly clientId: string,
  ) {}

  public async createAuthorizationRequest(options: {
    redirectUri: string;
    maxAgeSeconds?: number;
    loginHint?: string;
  }): Promise<{ url: string; state: string; codeVerifier: string }> {
    return this.client.userManagement.getAuthorizationUrlWithPKCE({
      provider: "authkit",
      clientId: this.clientId,
      redirectUri: options.redirectUri,
      ...(options.maxAgeSeconds === undefined ? {} : { maxAge: options.maxAgeSeconds }),
      ...(options.loginHint === undefined ? {} : { loginHint: options.loginHint }),
    });
  }

  public async exchangeAuthorizationCode(options: {
    code: string;
    codeVerifier: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuthenticatedIdentity> {
    const response = await this.client.userManagement.authenticateWithCode({
      clientId: this.clientId,
      code: options.code,
      codeVerifier: options.codeVerifier,
      ...(options.ipAddress === undefined ? {} : { ipAddress: options.ipAddress }),
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
    const claims = decodeTrustedTokenResponseClaims(response.accessToken);
    if (
      claims.sub !== response.user.id ||
      typeof claims.sid !== "string" ||
      typeof claims.auth_time !== "number" ||
      typeof claims.exp !== "number"
    )
      throw new Error("WorkOS authentication response is missing required session claims");
    const sessions = await this.client.userManagement.listSessions(response.user.id, {
      limit: 100,
    });
    const providerSession = sessions.data.find((session) => session.id === claims.sid);
    if (!providerSession || providerSession.status !== "active")
      throw new Error("WorkOS session is not active after authentication");
    return {
      providerKey: "workos",
      providerSubject: response.user.id,
      email: response.user.email,
      emailVerified: response.user.emailVerified,
      providerSessionId: claims.sid,
      providerSessionExpiresAt: new Date(providerSession.expiresAt),
      freshAuthenticatedAt: new Date(claims.auth_time * 1000),
      authenticationMethod: response.authenticationMethod ?? providerSession.authMethod,
      impersonated: response.impersonator !== undefined,
    };
  }

  public async isProviderSessionActive(
    providerSubject: string,
    providerSessionId: string,
  ): Promise<boolean> {
    const sessions = await this.client.userManagement.listSessions(providerSubject, { limit: 100 });
    return sessions.data.some(
      (session) => session.id === providerSessionId && session.status === "active",
    );
  }

  public revokeProviderSession(providerSessionId: string): Promise<void> {
    return this.client.userManagement.revokeSession({ sessionId: providerSessionId });
  }

  public getLogoutUrl(providerSessionId: string, returnTo?: string): string {
    return this.client.userManagement.getLogoutUrl({
      sessionId: providerSessionId,
      ...(returnTo === undefined ? {} : { returnTo }),
    });
  }

  public async constructWebhookEvent(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<AuthProviderSecurityEvent> {
    const event = await this.client.webhooks.constructEvent({
      payload,
      sigHeader: signature,
      secret,
    });
    if (event.event === "session.revoked")
      return { type: "SESSION_REVOKED", providerSessionId: event.data.id };
    if (event.event === "password_reset.succeeded")
      return {
        type: "PASSWORD_RESET_SUCCEEDED",
        providerKey: "workos",
        providerSubject: event.data.userId,
      };
    if (event.event === "user.deleted")
      return { type: "USER_DELETED", providerKey: "workos", providerSubject: event.data.id };
    return { type: "IGNORED" };
  }
}

/** Infrastructure boundary used by web authentication routes; callers never receive a database handle. */
export class MemoidAuthSessionStore extends PostgresAuthSessionStore {
  public async applyProviderSecurityEvent(event: AuthProviderSecurityEvent): Promise<void> {
    if (event.type === "IGNORED") return;
    if (event.type === "SESSION_REVOKED") {
      await this.revokeProviderSession(event.providerSessionId, "PROVIDER_SESSION_REVOKED");
      return;
    }
    await this.revokeProviderIdentity(
      event.providerKey,
      event.providerSubject,
      event.type === "PASSWORD_RESET_SUCCEEDED"
        ? "PROVIDER_PASSWORD_RESET"
        : "PROVIDER_USER_DELETED",
    );
  }
}
