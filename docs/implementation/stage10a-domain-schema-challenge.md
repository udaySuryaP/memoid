# Stage 10A domain and schema challenge

Status: **Class A gates resolved before the first Stage 10A schema migration**.

This record is the read-only challenge required before product schema implementation. It is subordinate to the canonical Notion hierarchy and the repository Stage 9C/9D contract. It does not authorize later Stage 10 verticals or implement runtime behavior.

## Scope boundary

10A establishes only the durable representations that later verticals cannot safely retrofit without redesign:

- stable Account, personal Workspace, and Project scope anchors, without lifecycle/authentication behavior;
- the four distinct persistence planes: Source Observation, Candidate Submission, Working Context, and Reviewed Durable Context;
- Project review-policy history/effectivity basis;
- Candidate assertion origin and explicit confirmation basis;
- Source and Candidate frontier foundations, including gap-safe Candidate reconciliation;
- Context Identity, immutable-compatible reviewed records, current-record uniqueness, and record-level Source coverage/provenance foundations;
- bounded policy/model-reasoning basis fields where they affect durable records.

Deferred to their owning verticals are Actor/Audit/Operation/idempotency receipts and worker leases (10B), authentication/RLS/grants (10C), Workspace/Project lifecycle (10D), GitHub installation identity/runtime (10E), ingestion/Evidence Reference runtime (10F), Authority Assignments (10G), full Working/Reviewed Context behavior (10H), Conflict/Uncertainty (10I), model/reconciliation runtime and detailed model provenance (10J), proposals/review/history runtime (10K-10M), search/packs/API/integrations/operations/deletion/hardening (10N-10T).

## Class A resolutions

### A1. Stable identifiers

- **Question:** Which identifier representation and generation boundary can remain stable across all foundational entities?
- **Alternatives:** database integers; unrestricted UUIDs; application-generated UUIDv4; time-ordered UUIDv7.
- **Evidence:** PostgreSQL 18 is locked; opaque stable internal identity is locked; identifiers never authorize access; mutable provider IDs are attributes, not Memoid entity IDs.
- **Decision:** use RFC 9562 UUIDv7 in PostgreSQL `uuid` columns for Memoid-owned entity IDs. PostgreSQL owns the default generator at persistence boundaries; the pure domain layer validates UUIDv7 without importing PostgreSQL. IDs are immutable and consistently branded by entity type. They may be exposed as opaque public identifiers but disclose approximate creation time and are never secrets or authorization proof.
- **Rejected:** integers expose allocation/order and complicate distributed creation; UUIDv4 gives no locality benefit; unrestricted UUIDs weaken cross-entity consistency.
- **Migration/reversibility:** UUID columns are durable. Reversal would require an explicit data migration, so database checks and real PostgreSQL generation proof are required now.
- **Proof:** domain parser tests; PostgreSQL `uuidv7()`/version checks; constraint tests rejecting non-v7 product IDs.
- **Resolution:** **RESOLVED**.

### A2. Time and version semantics

- **Question:** Which times and versions are semantically distinct?
- **Alternatives:** one generic `created_at`/`updated_at`; generic version on every row; named event times and versions only where behavior requires them.
- **Evidence:** the canonical contract distinguishes observed, accepted, effective, reconciled, reviewed, and revision time; generic versions have no defined meaning.
- **Decision:** use `timestamptz` and explicit names: persistence `created_at`, Source `observed_at`/optional provider `effective_at`, Candidate `submitted_at` and server `accepted_at`, Working `recorded_at`/optional `reconciled_at`, policy `effective_at`/`recorded_at`, and reviewed revision `applied_at`. Policy version and per-Project revision/sequence values are positive monotonic integers with defined scope. No generic `updated_at` or meaningless row version is added.
- **Rejected:** collapsing times loses ordering/audit meaning; generic versions invite incompatible interpretations.
- **Migration/reversibility:** adding later optional semantic times is safe; renaming/collapsing already populated times would be lossy.
- **Proof:** domain instant/version tests and database checks for positive versions plus policy ordering.
- **Resolution:** **RESOLVED**.

### A3. Workspace and Project scope

- **Question:** How can 10A prevent cross-Project references without implementing 10C/10D behavior?
- **Alternatives:** globally keyed children only; nullable tenant columns; repeat Workspace/Project scope and enforce composite foreign keys.
- **Evidence:** every Project-owned object must resolve through Workspace → Project; unsafe nullable ownership and cross-Project foreign keys are forbidden.
- **Decision:** create minimal Account → one Personal Workspace → Project anchors. Every Project-owned table carries non-null `workspace_id` and `project_id`; composite foreign keys prove the Project belongs to that Workspace and downstream links remain within the same Project. IDs still remain globally unique. No membership, authentication, lifecycle, archive, or RLS behavior is added.
- **Rejected:** globally keyed-only references allow accidental cross-Project joins; nullable scope creates future isolation gaps.
- **Migration/reversibility:** composite scope is intentionally durable. Team collaboration can later add membership without changing Project ownership identity.
- **Proof:** real PostgreSQL cross-Workspace/Project FK rejection tests.
- **Resolution:** **RESOLVED**.

### A4. Four integrity planes

- **Question:** What minimum decomposition prevents Candidate, Working, Source, and Reviewed state from becoming one generic memory table?
- **Alternatives:** one polymorphic memory table; payload table plus type flag; distinct plane tables with explicit bridges.
- **Evidence:** Stage 9C locks four separate trust planes and forbids silent promotion/override.
- **Decision:** use separate `source_observations`, `candidate_submissions`/`candidate_assertions`, `working_context_items`, and `context_records`/`context_revisions` tables. Bridges retain provenance without changing trust class. No table or trigger promotes between planes automatically.
- **Rejected:** discriminator/polymorphic tables make trust-specific constraints and privileges fragile and encourage last-writer-wins semantics.
- **Migration/reversibility:** new plane-specific attributes remain additive; splitting a populated generic table later would be ambiguous and is therefore rejected now.
- **Proof:** schema inventory/foreign keys and tests that independently persist all four planes.
- **Resolution:** **RESOLVED**.

### A5. Candidate assertion origin and confirmation

- **Question:** How can checkpoint consent remain distinct from assertion confirmation?
- **Alternatives:** one `is_user_confirmed` flag; one combined origin enum; orthogonal origin and confirmation fields.
- **Evidence:** checkpoint means submit, not blanket confirmation; AI-inferred, user-authored/confirmed, and Source/system-derived assertions must remain distinguishable.
- **Decision:** every Candidate assertion stores an origin (`USER_AUTHORED`, `AI_INFERRED`, `SOURCE_DERIVED`, or `SYSTEM_DERIVED`) separately from confirmation (`NONE` or `EXPLICIT_USER`). Explicit confirmation requires both a confirming Account and timestamp. Default confirmation is `NONE`, including checkpoint intake. Physical values use constrained text rather than a PostgreSQL enum so later host-proof refinements remain migratable.
- **Rejected:** a boolean loses origin; a combined enum produces combinatorial states and cannot express later confirmation of an AI inference cleanly.
- **Migration/reversibility:** constrained text can be expanded transactionally; no current value falsely claims host confirmation.
- **Proof:** domain constructor tests and PostgreSQL paired-field/check-constraint tests.
- **Resolution:** **RESOLVED**.

### A6. Project review policy

- **Question:** How are `MANUAL`/`AUTOMATIC`, default safety, prospective changes, versions, effectivity, and future attribution represented without implementing review runtime?
- **Alternatives:** mutable policy column on Project; current-row flag; append-only version rows selected by effective time.
- **Evidence:** one effective policy, `MANUAL` fallback, prospective monotonic versions, effective timestamp, human attribution, and policy snapshot at decisions are locked.
- **Decision:** append-only `project_review_policy_versions` rows contain Project-scoped positive sequential version, constrained policy value, `effective_at`, `recorded_at`, and changing Account. Effective policy is the latest row effective at the query time; absence means `MANUAL`. A database trigger serializes per Project and requires version 1 then exact +1 with nondecreasing effective time. Durable Working/Revision rows may capture the governing policy version. Policy mutation authorization, step-up, Audit Event, and transition behavior remain 10C/10D/10L.
- **Rejected:** mutable Project column erases history; `is_current` requires historical-row mutation and mishandles future effectivity.
- **Migration/reversibility:** append-only rows are additive. New policy values require an explicit checked migration and canonical approval.
- **Proof:** domain policy/version tests; PostgreSQL invalid-value, gap, ordering, and concurrent-next-version tests.
- **Resolution:** **RESOLVED**.

### A7. Source frontier and reviewed coverage

- **Question:** How can Source currentness avoid one global commit SHA and survive branches/force pushes?
- **Alternatives:** Project global SHA; mutable string cursors; per Source/scope/ref Memoid observation sequence plus external revision metadata.
- **Evidence:** Source frontier is per Source and relevant ref/scope; reviewed coverage is a vector/relationship; provider revision order may be non-linear.
- **Decision:** a stable `source_frontier_units` row identifies Source + semantic scope + ref. Immutable Source observations receive a positive Memoid observation sequence and bounded external revision. Frontier state tracks observed, desired, ingested, and reconciled observation sequences with `reconciled <= ingested <= desired <= observed`. Record-level coverage links each reviewed Context Record to one or more frontier units/observation sequences. External revisions remain metadata and are never compared numerically.
- **Rejected:** a Project-global SHA cannot represent multiple Sources/refs; ordering commit strings assumes ancestry and fails under force push.
- **Migration/reversibility:** new frontier dimensions/scopes remain additive. Observation sequences are Memoid intake order, not truth/revision versions.
- **Proof:** database frontier ordering, same-Project FK, multi-Source coverage, and non-linear external-revision tests.
- **Resolution:** **RESOLVED**.

### A8. Candidate frontier and gap safety

- **Question:** How can later stable completion never hide an earlier unfinished accepted Candidate?
- **Alternatives:** `max(processed sequence)`; mutable status only; per-Project accepted sequence plus separate stable-disposition rows and contiguous watermark.
- **Evidence:** Stage 9C explicitly requires a contiguous completion watermark or gap-preserving equivalent.
- **Decision:** Candidate intake is assigned a Project-scoped positive accepted sequence under a per-Project frontier row. Stable dispositions are separate from immutable submissions. The stored reconciled watermark may advance only through a database function/guard that proves every accepted sequence through the proposed value has a stable disposition. Later stable rows beyond a gap remain visible but cannot advance the watermark. The exact Operation/worker lease protocol remains 10B.
- **Rejected:** `max(sequence)` hides gaps; a status column on the immutable envelope conflates intake with processing.
- **Migration/reversibility:** outcome vocabulary remains bounded but extensible; a lagging watermark is safe and refreshable, while an overstated watermark is forbidden.
- **Proof:** real PostgreSQL N+1-before-N test, direct-overadvance rejection, and concurrent out-of-order completion test.
- **Resolution:** **RESOLVED**.

### A9. Context Identity and currentness

- **Question:** What identifies one semantic question through immutable revisions, and how is one current record enforced?
- **Alternatives:** identity equals current value hash; free-form global key; Project-scoped normalized subject/scope/facet/predicate components.
- **Evidence:** Context Identity is independent of value; accepted assertion payloads are immutable; currentness and history are distinct.
- **Decision:** Context Identity is unique within Project by normalized bounded `(subject_key, scope_key, facet_key, predicate_key)` and never includes assertion value. Multiple immutable Context Records may reference one identity through time. A separate current-record pointer table has one primary-key row per identity and same-Project composite foreign keys; switching currentness does not mutate old assertion payloads.
- **Rejected:** value-derived identity creates a new question for every answer; global keys weaken tenant scope; mutating a current record destroys history.
- **Migration/reversibility:** the component model can gain additive classification metadata; changing semantic key rules later requires an explicit identity merge/split migration.
- **Proof:** domain normalization tests, PostgreSQL duplicate-identity rejection, cross-Project link rejection, update guards, and concurrent current-pointer uniqueness test.
- **Resolution:** **RESOLVED**.

### A10. Provenance and model/policy basis

- **Question:** What must 10A persist now without prematurely implementing Evidence References, Actor/Audit, Operations, or the model engine?
- **Alternatives:** generic unbounded JSON provenance; full future tables now; bounded explicit bridges plus deferred later-owned metadata.
- **Evidence:** reviewed Context provenance is mandatory and cumulative; model metadata is provenance not Actor; raw prompts/private payloads should not be retained unnecessarily.
- **Decision:** add explicit many-to-many bridges from reviewed records to Candidate assertions and Source observations, plus record-level Source coverage. A deferred database constraint requires every reviewed Context Record to commit with at least one Candidate or Source provenance edge. Store payload hashes and bounded semantic payloads, not raw transcripts/repository mirrors. Working/Revision rows can capture policy version and Candidate/Source basis. Full Evidence Reference identity (10F), Actor/Audit/Operation (10B), and detailed model-call provenance/usage (10J) remain deferred and can attach by stable Project-scoped IDs without changing the four planes or Context Identity.
- **Rejected:** generic provenance JSON cannot enforce Project scope or referential integrity; implementing future entities now would leak later verticals and freeze unresolved vocabularies.
- **Migration/reversibility:** additive evidence/model/audit tables can reference existing stable rows. Payload-size checks prevent an accidental shadow data store.
- **Proof:** many-to-many same-Project FK tests, bounded-payload checks, and schema review confirming no raw transcript/model prompt column.
- **Resolution:** **RESOLVED**.

## Security and future-compatibility challenge

- All Project-owned relationships are composite-scoped; object IDs alone never confer access.
- Product tables are owned by `memoid_owner`. 10A does not grant product data paths to `memoid_app`; authorization/RLS grants and policies remain 10C, preventing premature privileged runtime access.
- Bounded text/JSON sizes, hashes, and no raw transcript/repository mirror/model prompt fields reduce secret and private-data risk.
- Source and Candidate content remains untrusted evidence. No schema default claims confirmation, authority, review, or automatic eligibility.
- Reviewed assertion rows and policy versions reject in-place updates; ordinary later application privileges will be insert/select only for immutable history tables. Delete semantics, privacy erasure, and audited repair remain 10S/10T concerns rather than being frozen by 10A.
- No GitHub, MCP, WorkOS, model-provider, Fastify, Next.js, ingestion, reconciliation, review, search, Pack, export, deletion, or UI runtime is introduced.

## Final pre-migration conclusion

All Class A decisions named by the Stage 10 entry map are resolved at the representation level required to prevent irreversible 10A mistakes. Later Class B/C/D mechanisms remain explicitly deferred to their owning verticals. Schema implementation may now begin on `stage10/10a-domain-schema`.
