export interface ContextIdentityComponents {
  readonly subject: string;
  readonly scope: string;
  readonly facet: string;
  readonly predicate: string;
}

const KEY = /^[a-z0-9][a-z0-9._:/-]*$/;

function normalize(value: string, name: string, maximum: number): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > maximum || !KEY.test(normalized))
    throw new Error(`${name} must be a normalized key of at most ${maximum} characters`);
  return normalized;
}

export function contextIdentity(
  input: ContextIdentityComponents,
): Readonly<ContextIdentityComponents> {
  return Object.freeze({
    subject: normalize(input.subject, "subject", 256),
    scope: normalize(input.scope, "scope", 256),
    facet: normalize(input.facet, "facet", 128),
    predicate: normalize(input.predicate, "predicate", 128),
  });
}
