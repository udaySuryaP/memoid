# Stage 10A domain kernel and product schema

Stage 10A establishes representation and database invariants only. It contains no authentication, Project lifecycle, GitHub ingestion, reconciliation/model runtime, proposal review, Context Pack, API/MCP product tool, UI, export, deletion, or production behavior.

The pre-migration challenge and every Class A resolution are recorded in `docs/implementation/stage10a-domain-schema-challenge.md`.

## Pure domain kernel

`packages/domain` provides framework/provider-free:

- opaque UUIDv7 entity identifiers and validation;
- positive policy/revision/sequence values and semantic instants;
- `MANUAL`/`AUTOMATIC` Project review policy with `MANUAL` fallback;
- orthogonal Candidate assertion origin and explicit-user-confirmation basis;
- normalized Project-scoped Context Identity components;
- Source frontier ordering and Candidate contiguous stable-disposition calculations.

## Migration order

1. `001_foundation_rls` retains the accepted Stage 8B synthetic RLS probe unchanged.
2. `002_stage10a_domain_schema` creates the `memoid` product schema, constraints, functions, triggers, indexes, comments, and deny-by-default runtime permissions.
3. `003_stage10b_actor_audit_operation` attaches Actor, Audit, idempotency, Operation, provider-receipt, and lost-wakeup foundations.
4. `004_stage10c_identity_authz_rls` attaches identity/session security state, least-privilege runtime functions, and forced scope-specific RLS.

Both migrations have down paths. Product schema rollback drops only `memoid`; the earlier foundation remains until its own down migration executes.

## Schema inventory

| Table                                 | Integrity role and principal invariant                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`                            | Stable internal Account scope anchor.                                                                                             |
| `workspaces`                          | Exactly one Personal Workspace per Account in V1.                                                                                 |
| `projects`                            | Stable Project identity under one Workspace; no lifecycle behavior.                                                               |
| `project_review_policy_versions`      | Append-oriented, update-guarded sequential effective-time policy history with owning Account attribution.                         |
| `sources`                             | Stable logical Source identity, independent from future provider metadata.                                                        |
| `source_frontier_units`               | Per Source/scope/ref processing unit; never a Project-global SHA.                                                                 |
| `source_observations`                 | Update-guarded Source Observation plane with Memoid observation order and external revision metadata.                             |
| `source_frontier_states`              | Monotonic observed/desired/ingested/reconciled stages with same-unit foreign keys and ordering checks.                            |
| `candidate_frontier_states`           | Per-Project accepted sequence and gap-safe contiguous reconciled watermark.                                                       |
| `candidate_submissions`               | Update-guarded Candidate Submission envelope with Project sequence, times, hashes, and bounded observed basis.                    |
| `candidate_assertions`                | Candidate semantic items with origin separate from explicit confirmation.                                                         |
| `candidate_stable_dispositions`       | Stable processing disposition separated from Candidate intake.                                                                    |
| `context_identities`                  | Semantic question identity by Project + subject/scope/facet/predicate, independent from assertion value.                          |
| `working_context_items`               | Lower-trust Working Context plane, explicitly pending/unreconciled or reconciled/unreviewed.                                      |
| `context_revisions`                   | Minimum Reviewed Durable Context revision foundation with captured review-policy version. Runtime application is deferred to 10M. |
| `context_records`                     | Update-guarded reviewed assertion payload tied to Context Identity and Context Revision.                                          |
| `context_identity_current_records`    | Exactly one current reviewed record pointer per Context Identity without mutating historical record payloads.                     |
| `context_record_candidate_provenance` | Many-to-many Candidate assertion provenance.                                                                                      |
| `context_record_source_provenance`    | Many-to-many Source observation provenance.                                                                                       |
| `context_record_source_coverage`      | Per-record Source/scope/ref observation coverage vector.                                                                          |

All Project-owned rows repeat non-null Workspace and Project scope. Composite foreign keys prevent cross-Project links even when an attacker or bug knows another object's UUID.

## Database-enforced invariants

- Memoid-owned product IDs are UUIDv7.
- Policy values, Candidate origin/confirmation values, Working trust qualification, decision mode, and provenance relations are checked.
- Review-policy versions start at 1, advance exactly by one, and never move effective time backwards; concurrent next-version attempts serialize per Project.
- Source frontier stages are positive, same-unit, ordered, and monotonic.
- Candidate acceptance is contiguous per Project. Stable completion is separate. The reconciled watermark advances only across stable contiguous sequences; direct over-advance is rejected.
- Context Identity is unique per semantic component tuple and Project.
- One current record exists per identity; every current pointer, record, revision, provenance, and coverage link is constrained to the same Project.
- A reviewed Context Record must commit with at least one same-Project Candidate-assertion or Source-observation provenance edge; one revision cannot contain two records for the same Context Identity.
- Durable evidence/history payload rows reject in-place updates. Delete semantics remain deferred to 10S rather than being frozen by 10A.
- Semantic JSON payloads and frontier-basis metadata are bounded; hashes are exactly 32 bytes.
- The `memoid` schema grants no access to `memoid_app` at the 10A/10B boundary. Stage 10C adds forced transaction-scoped RLS and narrowly grants read access plus human-Actor/Audit inserts; later lifecycle writes remain unavailable until their owning verticals.

## Downstream attachments

Stage 10B attaches the provider-neutral Actor, Audit Event, idempotency, Operation, provider-receipt, and lost-wakeup foundations through the stable Workspace/Project identities described in [the Stage 10B architecture inventory](./actor-audit-operation.md). Detailed model-call provenance remains with the engine/review verticals. Evidence Reference identity attaches in 10F. Full Working/Reviewed lifecycle, Conflict/Uncertainty, Proposal/review, and revision-application semantics remain with 10H-10M.
