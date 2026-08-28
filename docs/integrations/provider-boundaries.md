# Provider boundaries

Provider implementations are replaceable adapters, not domain concepts.

- WorkOS: session verification, organization membership, and step-up challenge ports.
- MCP v2: separate server and Fastify transport packages, with only synthetic contract tools.
- GitHub App: installation authentication and Octokit REST access, without synchronization behavior.
- Reconciliation model: provider-neutral typed structured-output port, without prompts or domain reconciliation logic. Provider SDK types never define domain/application semantics.
- Object storage/KMS: blob and envelope-key ports; AWS adapters are wiring-only.
- Analytics: allow-listed event names and metadata; no product event taxonomy exists yet.

Ordinary external MCP/API machine clients cannot trigger Source refresh or synchronization in V1. Source synchronization is first-party/system-controlled. External clients may inspect authorized Source status and use permitted read/candidate-evidence/reconciliation capabilities, but no ordinary machine-client refresh/sync trigger belongs in the V1 adapter surface.

GitHub webhook deliveries are authenticated, deduplicatable, auditable signals. They trigger authoritative provider refetch and desired Source-frontier advancement; webhook payloads do not directly become authoritative semantic mutations. Provider-stable repository ID is Source identity while owner/name/URL are mutable metadata. Server-controlled scheduled/reconnect/retry catch-up must converge when webhooks are missing or delayed.

Model selection is configuration-driven and replaceable. Fallback is explicit, allowlisted, privacy-compatible, and auditable; private Project data is never silently sent to an arbitrary provider. Model metadata is provenance, not Actor identity. Primary/verifier disagreement, when verification is enabled, is protected and cannot auto-accept.

Source/event/candidate intake and frontier persistence do not depend on live model availability. Provider outage, quota exhaustion, 429, timeout, malformed output, or invalid evidence references may delay reconciliation but cannot discard an accepted checkpoint or make safe recent continuity disappear. Deterministically qualified pending/unreconciled material remains explicitly lower trust until reconciliation succeeds.

Credentials stay in server/worker configuration. Browser bundles receive only explicitly public values.
