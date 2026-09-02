export const ACTOR_KINDS = [
  "HUMAN",
  "MEMOID_SYSTEM",
  "MEMOID_WORKER",
  "INTEGRATION",
  "DEVELOPER_CLIENT",
  "SOURCE_SYSTEM",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export const EXTERNALLY_ATTRIBUTABLE_ACTOR_KINDS = [
  "HUMAN",
  "INTEGRATION",
  "DEVELOPER_CLIENT",
] as const;

export type ExternallyAttributableActorKind = (typeof EXTERNALLY_ATTRIBUTABLE_ACTOR_KINDS)[number];

const ACTOR_REFERENCE = /^[a-z0-9][a-z0-9._:/-]*$/;

export function parseActorKind(value: string): ActorKind {
  if (!(ACTOR_KINDS as readonly string[]).includes(value))
    throw new Error(`Unsupported Actor kind: ${value}`);
  return value as ActorKind;
}

export function parseUntrustedActorKind(value: string): ExternallyAttributableActorKind {
  if (!(EXTERNALLY_ATTRIBUTABLE_ACTOR_KINDS as readonly string[]).includes(value))
    throw new Error(`Untrusted input cannot claim Actor kind: ${value}`);
  return value as ExternallyAttributableActorKind;
}

export function actorReference(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 256 || !ACTOR_REFERENCE.test(normalized))
    throw new Error("Actor reference must be a normalized key of at most 256 characters");
  return normalized;
}

export function actorDisplayLabel(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 256)
    throw new Error("Actor display label must contain at most 256 characters");
  return normalized;
}
