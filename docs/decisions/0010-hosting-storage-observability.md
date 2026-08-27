# ADR 0010: Hosting, storage, KMS, and observability topology

Status: Direction accepted by Stage 8; repository record added in Stage 8C.

## Decision status

- **LOCKED:** Render is the initial V1 direction for web/API, worker, and managed PostgreSQL roles.
- **LOCKED:** S3 + KMS is the direction for temporary protected artifacts, backups, and envelope-encryption support.
- **LOCKED:** prefer Render-managed workload OIDC over long-lived AWS/model credentials where supported.
- **LOCKED:** use structured payload-minimized logs, OpenTelemetry traces/metrics, and Grafana operational telemetry; observability must not become a shadow repository.
- **LOCKED:** Context Pack bodies remain ephemeral by default and do not become durable telemetry.
- **PROVISIONAL:** production region, Render/AWS plan details, bucket/key topology, PostHog as analytics vendor, exact retention, sampling, RPO, and RTO.
- **Proof-gated:** workload identity, envelope encryption, backup isolation/restore, redaction, telemetry cardinality/privacy, and recovery targets require deployment and drill evidence.
- **Implementation deferred:** no production infrastructure, customer storage, KMS wiring, deployment, or product observability is created in the foundation.

## Decision

Keep the initial topology operationally simple while separating application hosting, protected object storage/key authority, and content-minimized telemetry. Development, test, staging, and production receive separate credentials, storage, keys, OAuth/GitHub registrations, and telemetry boundaries. Static credentials are used only where workload identity is unavailable and then must be narrowly scoped and rotatable.
