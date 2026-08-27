import type { AuthProvider, AuthenticatedIdentity } from "@memoid/application";
import type { WorkOS } from "@workos-inc/node";

/** WorkOS boundary only. Hosted AuthKit owns authentication/passkey UI. */
export class WorkOsAuthProvider implements AuthProvider {
  public constructor(private readonly client: WorkOS) {}
  public async verifySession(_token: string): Promise<AuthenticatedIdentity | null> {
    void this.client;
    throw new Error("WorkOS session verification is intentionally not implemented in Stage 8B");
  }
  public async isProviderSessionActive(_providerSessionId: string): Promise<boolean> {
    throw new Error("Provider revocation binding is a Stage 10 implementation concern");
  }
}
