# Provider boundaries

Provider implementations are replaceable adapters, not domain concepts.

- WorkOS: session verification, organization membership, and step-up challenge ports.
- MCP v2: separate server and Fastify transport packages, with only synthetic contract tools.
- GitHub App: installation authentication and Octokit REST access, without synchronization behavior.
- Reconciliation model: typed structured-output port, without prompts or domain reconciliation logic.
- Object storage/KMS: blob and envelope-key ports; AWS adapters are wiring-only.
- Analytics: allow-listed event names and metadata; no product event taxonomy exists yet.

Credentials stay in server/worker configuration. Browser bundles receive only explicitly public values.
