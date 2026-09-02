import { PrimaryLink, SecondaryLink, SecuritySurface } from "../../security-surface";

export default function RecoveryPage() {
  return (
    <SecuritySurface
      eyebrow="Recovery"
      title="Recover access through AuthKit"
      actions={
        <>
          <PrimaryLink href="/auth/login?return=%2Faccount%2Fsecurity">
            Open secure recovery
          </PrimaryLink>
          <SecondaryLink href="/auth/access">Cancel safely</SecondaryLink>
        </>
      }
    >
      <p>
        Recovery and security resets happen in the provider-hosted experience. When recovery
        completes, Memoid revokes stale local sessions before accepting a new one.
      </p>
      <div className="security-warning" role="alert">
        Never share a recovery code. Memoid support cannot request or validate one.
      </div>
    </SecuritySurface>
  );
}
