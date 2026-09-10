export const INGESTION_LIMITS = Object.freeze({
  maximumCandidateEntries: 10_000,
  maximumEvidenceReferences: 2_000,
  maximumFileBytes: 512 * 1024,
  maximumFetchedBytes: 32 * 1024 * 1024,
  maximumPathCharacters: 1_024,
  maximumStructuralLocatorCharacters: 512,
});

export const EVIDENCE_KINDS = ["FILE", "RENAMED_FILE", "DELETION"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const INGESTION_DISPOSITIONS = ["INGESTED", "COALESCED", "REF_DELETED"] as const;
export type IngestionDisposition = (typeof INGESTION_DISPOSITIONS)[number];

export const FILTER_REASONS = [
  "BINARY",
  "GENERATED",
  "VENDORED",
  "LOCKFILE",
  "GIT_LFS_POINTER",
  "OVERSIZED",
  "UNSUPPORTED_ENCODING",
  "SYMLINK",
  "SUBMODULE",
  "SECRET",
  "POLICY_EXCLUDED",
] as const;
export type FilterReason = (typeof FILTER_REASONS)[number];

const HEX_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.codePointAt(0)!;
    return code <= 0x1f || code === 0x7f;
  });
const BINARY_EXTENSIONS = new Set([
  "7z",
  "avi",
  "bmp",
  "class",
  "dll",
  "dmg",
  "doc",
  "docx",
  "eot",
  "exe",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "mov",
  "mp3",
  "mp4",
  "otf",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "rar",
  "so",
  "tar",
  "tif",
  "tiff",
  "ttf",
  "wav",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "zip",
]);
const LOCKFILES = new Set([
  "bun.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);
const EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
]);
const GENERATED_SUFFIXES = [".generated.ts", ".generated.js", ".min.js", ".min.css", ".map"];

export function repositoryRevision(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HEX_REVISION.test(normalized))
    throw new Error("Repository revision must be a 40 or 64 character hexadecimal object ID");
  return normalized;
}

export function sourceRefKey(value: string): string {
  const normalized = value.trim();
  if (
    !normalized.startsWith("refs/heads/") ||
    normalized.length > 512 ||
    hasControlCharacter(normalized) ||
    normalized.includes("\\") ||
    normalized.includes("..") ||
    normalized.endsWith("/")
  )
    throw new Error("Source ref must be a canonical refs/heads/... key");
  return normalized;
}

export function repositoryPath(value: string): string {
  if (
    value !== value.trim() ||
    value.length === 0 ||
    value.length > INGESTION_LIMITS.maximumPathCharacters
  )
    throw new Error("Repository path is empty, padded, or too long");
  if (value.startsWith("/") || value.includes("\\") || hasControlCharacter(value))
    throw new Error("Repository path must be relative UTF-8 text using forward slashes");
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".."))
    throw new Error("Repository path contains an unsafe segment");
  return value;
}

export function structuralLocator(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > INGESTION_LIMITS.maximumStructuralLocatorCharacters ||
    hasControlCharacter(normalized)
  )
    throw new Error("Structural locator is malformed");
  return normalized;
}

export function classifyRepositoryEntry(input: {
  readonly path: string;
  readonly byteSize: number | null;
  readonly mode?: string;
}): FilterReason | null {
  const path = repositoryPath(input.path);
  if (input.mode === "120000") return "SYMLINK";
  if (input.mode === "160000") return "SUBMODULE";
  if (input.byteSize === null || !Number.isSafeInteger(input.byteSize) || input.byteSize < 0)
    return "POLICY_EXCLUDED";
  if (input.byteSize > INGESTION_LIMITS.maximumFileBytes) return "OVERSIZED";
  const lower = path.toLowerCase();
  const segments = lower.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment)))
    return segments.includes("vendor") || segments.includes("node_modules")
      ? "VENDORED"
      : "GENERATED";
  const name = segments.at(-1)!;
  if (LOCKFILES.has(name)) return "LOCKFILE";
  if (GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return "GENERATED";
  const extension = name.includes(".") ? name.split(".").at(-1)! : "";
  return BINARY_EXTENSIONS.has(extension) ? "BINARY" : null;
}

export function decodeBoundedUtf8(base64: string, declaredSize: number): Uint8Array {
  if (
    !Number.isSafeInteger(declaredSize) ||
    declaredSize < 0 ||
    declaredSize > INGESTION_LIMITS.maximumFileBytes
  )
    throw new Error("Repository blob exceeds the file bound");
  if (!/^[A-Za-z0-9+/=\r\n]*$/u.test(base64))
    throw new Error("Repository blob encoding is malformed");
  const bytes = Buffer.from(base64.replace(/[\r\n]/gu, ""), "base64");
  if (bytes.byteLength > INGESTION_LIMITS.maximumFileBytes || bytes.byteLength !== declaredSize)
    throw new Error("Repository blob size is inconsistent or oversized");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Repository blob is not valid UTF-8");
  }
  if (bytes.includes(0)) throw new Error("Repository blob is binary");
  return bytes;
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9])gh[opsu]_[A-Za-z0-9_]{20,}/u,
  /(?:api[_-]?key|client[_-]?secret|password|token)\s*[:=]\s*["']?[A-Za-z0-9_+/.=-]{16,}/iu,
];

export function containsLikelySecret(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function isGitLfsPointer(bytes: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return (
    text.startsWith("version https://git-lfs.github.com/spec/v1\n") &&
    /^oid sha256:[0-9a-f]{64}$/mu.test(text) &&
    /^size [0-9]+$/mu.test(text)
  );
}

export interface EvidenceReferenceDraft {
  readonly kind: EvidenceKind;
  readonly repositoryRevision: string;
  readonly path: string;
  readonly previousPath: string | null;
  readonly providerObjectId: string | null;
  readonly byteSize: number | null;
  readonly contentSha256: Uint8Array | null;
  readonly structuralLocator: string | null;
}

export function evidenceReferenceDraft(
  input: EvidenceReferenceDraft,
): Readonly<EvidenceReferenceDraft> {
  const kind = input.kind;
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind))
    throw new Error("Unsupported evidence kind");
  const path = repositoryPath(input.path);
  const previousPath = input.previousPath === null ? null : repositoryPath(input.previousPath);
  const revision = repositoryRevision(input.repositoryRevision);
  const objectId = input.providerObjectId?.trim().toLowerCase() ?? null;
  if (kind === "DELETION") {
    if (objectId !== null || input.byteSize !== null || input.contentSha256 !== null)
      throw new Error("Deletion evidence cannot claim content identity");
  } else {
    if (!objectId || !HEX_REVISION.test(objectId))
      throw new Error("File evidence requires an immutable object ID");
    if (
      input.byteSize === null ||
      input.byteSize < 0 ||
      input.byteSize > INGESTION_LIMITS.maximumFileBytes
    )
      throw new Error("File evidence requires a bounded byte size");
    if (input.contentSha256?.byteLength !== 32)
      throw new Error("File evidence requires SHA-256 content identity");
  }
  if ((kind === "RENAMED_FILE") !== (previousPath !== null))
    throw new Error("Only renamed evidence carries a previous path");
  return Object.freeze({
    ...input,
    repositoryRevision: revision,
    path,
    previousPath,
    providerObjectId: objectId,
    structuralLocator: structuralLocator(input.structuralLocator),
  });
}
