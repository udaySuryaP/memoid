import { MemoidAuthSessionStore, WorkOsAuthProvider } from "@memoid/auth";
import { WorkOS } from "@workos-inc/node";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name}`);
  return value;
}

export function authRuntime() {
  return {
    provider: new WorkOsAuthProvider(
      new WorkOS(requiredEnvironment("WORKOS_API_KEY")),
      requiredEnvironment("WORKOS_CLIENT_ID"),
    ),
    sessions: new MemoidAuthSessionStore(requiredEnvironment("DATABASE_URL"), 2),
    origin: requiredEnvironment("MEMOID_APP_ORIGIN"),
    flowSecret: Buffer.from(requiredEnvironment("MEMOID_AUTH_FLOW_SECRET"), "base64url"),
    webhookSecret: requiredEnvironment("WORKOS_WEBHOOK_SECRET"),
  };
}

export function localReturnPath(value: string | null, fallback = "/account/security"): string {
  return value?.startsWith("/") && !value.startsWith("//") && value.length <= 512
    ? value
    : fallback;
}

export function requestCookie(request: Request, name: string): string | null {
  const pair = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : null;
}
