# Stage 10F ingestion frontier and Evidence Reference challenge

Stage 10F establishes the provider-neutral, deterministic ingestion boundary on
top of the accepted Stage 10A–10E foundations. Repository content is untrusted
evidence. This stage never interprets it semantically, assigns Source Authority,
or promotes it into Working or Reviewed Context. Stage 2 remains **DO NOT BUILD /
KILL** evidence; the founder's **BUILD FULL PRODUCT — LOCKED OVERRIDE** is
execution authority, not validation evidence.

## F1 — Evidence Reference identity

An Evidence Reference is a Memoid-owned UUIDv7 identifying one bounded,
revision-qualified repository object or deletion fact. Its immutable identity
is scoped by `(Workspace, Project, Source, frontier unit, Source Observation)`
and consists of provider-neutral fields: evidence kind, immutable repository
revision, exact repository-relative path, optional previous path, provider
object identifier, and optional bounded structural locator. Byte size and
content SHA-256 must agree on replay; a mismatch for the same natural identity
is rejected as an evidence conflict. The database deduplicates this identity;
two distinct observations may intentionally refer to the same object because
their historical/ref context differs.

Repository/ref names and currentness are mutable observations, not Evidence
Reference identity. GitHub blob/tree identifiers are provider-owned evidence;
the Memoid UUID, scope, deterministic classification, and SHA-256 are
Memoid-owned. Later stages can prove existence by re-fetching the immutable
revision/object with the same installation-scoped provider identity and
verifying the stored SHA-256 and size. Deleted paths use an explicit `DELETION`
kind with no content/object hash; renames retain both new and previous paths.

Rejected: one unbounded JSON reference, owner/name as identity, a global blob
dedupe table, raw content persistence, and path-only identity. Each loses
scope/history, provider replaceability, or privacy bounds.

## F2 — ingestion unit and frontier semantics

The existing Stage 10A `source_frontier_units` remains the unit of Source/ref
progress. GitHub uses a provider-neutral scope key plus a canonical
`refs/heads/...` ref key. Each authoritative refetch creates one immutable
`source_observations` sequence. `observed` means durably refetched,
`desired` means required ingestion, `ingested` means every sequence through the
watermark has an explicit stable ingestion disposition, and `reconciled`
remains untouched.

Stage 10F adds one immutable ingestion disposition per observation:
`INGESTED`, `COALESCED`, or `REF_DELETED`. Frontier advancement recomputes the
highest contiguous disposed sequence; it can never use `max(processed)`.
Coalescing is explicit and must point to the later ingested observation that
subsumed a contiguous range. Thus a later observation cannot conceal a gap.

Rejected: a repository-global SHA, overwriting observations, setting ingested
equal to desired before evidence commits, or treating the Stage 10B processing
cursor as the Source frontier itself.

## F3 — authoritative provider refetch

Webhook bodies are authenticated signals only. The worker mints an ephemeral,
repository-restricted GitHub App installation token with `Metadata: read` and
`Contents: read`, fetches the repository by stable numeric repository ID,
verifies installation/repository identity and availability, then resolves the
ref and immutable commit/tree. No webhook `before`, `after`, branch name,
repository name, or file list becomes authoritative evidence directly.

Official GitHub documentation confirms that Git tree/blob reads require only
Contents read and that installation tokens can be narrowed to explicit
repository IDs and permissions:

- <https://docs.github.com/en/rest/git/trees>
- <https://docs.github.com/en/rest/git/blobs>
- <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app>

Rejected: webhook-to-observation writes, user-token ingestion, unauthenticated
public-repository reads, or persisted installation tokens.

## F4 — incremental change representation

Initial catch-up walks the immutable target tree. Incremental catch-up compares
the last ingested immutable revision to the target, but compare output is only
a bounded change-index optimization. Added, modified, removed, renamed and
copied paths become deterministic candidates; a rename preserves the previous
path. If history was rewritten, the comparison is too large/ambiguous, or
GitHub's compare result reaches its 300-file limit, ingestion falls back to a
bounded immutable tree walk and records the fallback classification.

GitHub documents that compare responses expose rename `previous_filename`, but
only the first page includes at most 300 changed files:
<https://docs.github.com/en/rest/commits/commits#compare-two-commits>.
Each non-deleted compare path is resolved at the immutable target with the
Contents endpoint so its type, size, and object ID are authoritative before
filtering: <https://docs.github.com/en/rest/repos/contents#get-repository-content>.

Rejected: commit count as semantic change count, patch text as durable evidence,
or assuming compare is complete for large/rewritten ranges.

## F5 — branch, rewrite, and delete semantics

Every ref is an independent frontier unit. Default and feature branches are
preserved with identical ingestion mechanics and explicit ref qualification;
10F assigns neither authority nor Project truth. A force push creates a new
observation and may require tree fallback; it never mutates historical Evidence
References. A deleted ref creates a durable `REF_DELETED` observation and no
file contents. Recreation creates a later observation on the same ref unit.
Repository rename/default-branch changes update Stage 10E provider metadata only
after authoritative verification and do not rewrite Evidence Reference identity.

Rejected: deleting branch history, treating all branches as current Project
truth, and creating a new Source for rename/recreation.

## F6 — idempotency and deduplication

Observation registration serializes the frontier unit, compares immutable
revision plus observation kind, and returns the existing observation for an
exact duplicate. A distinct authoritative state receives the next contiguous
sequence. Evidence References have an immutable scoped natural key and
`ON CONFLICT` convergence. Completion is transactional: references,
dispositions, contiguous frontier refresh, sanitized audit, and Stage 10B
processing completion commit together or not at all.

Rejected: a second idempotency table, global content-hash dedupe, and
check-then-insert without database uniqueness.

## F7 — worker, lease, and lost-wakeup behavior

Each Source/ref maps one-to-one to the existing Stage 10B `processing_units`
row (`SOURCE_INGESTION`). Scheduling atomically advances both the Source desired
sequence and processing desired sequence. Workers must be Stage 10C-bound
`MEMOID_WORKER` Actors and acquire the existing lease/fencing token. Completion
must match the leased target; stale/expired workers are rejected. If desired
advances during a lease, Stage 10B completion leaves `follow_up_required=true`
and the next worker resumes. Retry uses the existing bounded, sanitized retry
contract. Stage 10B Operations remain available for user-visible long-running
workflow handles, but 10F does not invent one per ref observation: the accepted
processing unit is the durable Source/ref correctness primitive.

Rejected: an in-memory queue, a second lease table, terminal completion without
post-completion frontier recheck, and worker identity inferred from a hostname.

## F8 — large-repository bounds

The deterministic policy caps a run at 10,000 candidate entries, 2,000 included
evidence references, 512 KiB per fetched text blob, and 32 MiB fetched bytes per
run. Paths are exact provider-returned UTF-8, repository-relative, forward-slash
paths capped at 1,024
characters. Binary, generated, vendored, lockfile, Git LFS pointer, submodule,
symlink, unsupported encoding, oversized and policy-excluded entries receive a
bounded classification/count, not content persistence. Tree traversal stops on
provider truncation and uses paged/non-recursive fallback within the same caps.

GitHub's recursive tree endpoint is capped at 100,000 entries or 7 MB and tells
clients to traverse non-recursively when truncated. Git blob retrieval supports
objects far larger than Memoid's safe bound, so Memoid must reject before fetch
where size is known and enforce decoded-byte bounds after fetch:

- <https://docs.github.com/en/rest/git/trees>
- <https://docs.github.com/en/rest/git/blobs>

Rejected: repository cloning, archive download/decompression, unlimited
pagination, and forwarding an entire repository to a model.

## F9 — security, privacy, and prompt-injection boundary

Repository paths and bytes are untrusted data, never instructions. Path
normalization rejects absolute paths, backslashes, NUL, empty/dot/dot-dot
segments, control characters and traversal. Ingestion does not execute files,
render markup, follow symlinks, initialize submodules, expand archives, or call
a model. Raw contents, patches, provider payloads, authorization headers,
tokens, prompts, secrets and detected secret values are never stored, audited
or logged. Only bounded hashes, sizes, stable IDs and allow-listed counts/codes
cross persistence/audit boundaries.

Rejected: storing excerpts "temporarily" in PostgreSQL, logging rejected text,
and allowing repository text to influence control flow outside deterministic
classification.

## F10 — RLS, authorization, and audit boundary

All new rows carry composite Workspace/Project scope, reference an existing
Source and observation in that exact scope, are owned by `memoid_owner`, use
forced RLS, and fail closed for foreign UUIDs. `memoid_app` receives read-only
RLS access; only reviewed security-definer functions can mutate ingestion state.
`memoid_auth` and `memoid_provider` receive no new privilege. Worker functions
validate the Stage 10C Actor binding and the Stage 10E active provider
connection while holding locks. Audit events record stable IDs, transition,
counts, bounded failure codes, correlation/causation and no repository text.

Rejected: direct worker table writes, owner/BYPASSRLS runtime credentials,
unscoped Evidence Reference lookup, and audit metadata containing paths or
repository names.

## F11 — provider outage and catch-up

Webhook, scheduled integrity scan, reconnect, startup recovery and stale-source
scan are callers of the same server-controlled authoritative observation/scheduling
path; none may supply authoritative revisions. Duplicate/delayed calls converge,
and a periodic caller can recover a missing webhook by refetching every active
Source/ref. Durable dispatch policy, cadence, and queue tuning remain explicitly
provisional under ADR 0008 and later operations hardening. Provider failures do
not infer deletion: they enter the existing sanitized retry path; deletion is
accepted only after an authoritative ref lookup on an otherwise verified active
repository. The current retry boundary uses a conservative one-minute delay and
does not claim adaptive rate-reset scheduling. GitHub documents installation
rate limits, response headers, and 403/429 retry behavior that a later tuning
stage must honor:
<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>.

Rejected: permanent failure on first 404/429, webhook-only correctness, and
advancing desired/ingested while provider verification is unavailable.

## F12 — explicit Stage 10G boundary

10F records branch-qualified historical evidence and whether a ref matched the
then-observed default-branch name. It does not decide authority precedence,
replace a Source, establish Project truth, write Context Records, create Working
Context, detect semantic conflict, call a model, create Change Proposals, expose
a refresh API/UI, or implement 10G–10T behavior. Default-branch qualification is
evidence metadata only; Source Authority policy remains entirely Stage 10G.

## Migration decision

Migration `007_stage10f_ingestion_evidence` is necessary. The accepted schema
has frontier placeholders and generic processing leases, but no bounded Evidence
Reference identity, no explicit per-observation ingestion disposition, and no
atomic gap-safe Source-ingestion completion boundary. The migration is additive,
preserves the four integrity planes and existing 10A–10E data, restores the
session role before Kysely bookkeeping on up/down, and removes only 10F objects
on rollback.
