# ADR 0009: Deletion fencing and restore anti-resurrection

Status: Direction accepted by Stages 6 and 8; exact protocol remains proof-gated; repository record added in Stage 8C.

## Decision status

- **LOCKED:** a Project deletion request immediately fences Integrations, Context Pack release, reconciliation, queued work, and future mutations before erasure completes.
- **LOCKED:** backups/restores must reapply post-backup deletion and revocation state before service returns; deleted protected content must not resurrect.
- **LOCKED:** deletion is a recoverable, fail-closed state machine/saga and restoration fails closed when deletion-journal state is ambiguous.
- **PROVISIONAL:** exact external deletion journal/fence store, tombstone fields, grace periods, erasure ordering, retention, and operator recovery procedure.
- **Proof-gated:** the cross-store protocol must prove crash consistency, replay, partial failure, backup restore, and ambiguity handling before public release.
- **Implementation deferred:** archive, deletion, erasure, export, and restore product behavior are not implemented in the foundation.

## Decision

Separate access revocation/fencing from asynchronous content erasure. Keep only the minimum non-content tombstone/security state later justified by operational or legal needs. Immutable history never authorizes indefinite retention of user content. No restored environment may serve traffic until deletion and revocation state has been reconciled against a source newer than the restored backup.
