import { PrimaryLink, SecuritySurface } from "../../security-surface";

export default function AccountAccessPage() {
  return (
    <SecuritySurface
      eyebrow="Account access"
      title="Continue securely to Memoid"
      actions={
        <PrimaryLink href="/auth/login?return=%2Faccount%2Fsecurity">
          Continue with AuthKit
        </PrimaryLink>
      }
    >
      <p>
        Authentication opens on WorkOS AuthKit. Your verified identity returns to Memoid as a
        short-lived, revocable session.
      </p>
      <div className="security-notice" role="note">
        Passkeys and multi-factor authentication stay provider-hosted. Memoid stores only an opaque
        browser-session credential.
      </div>
    </SecuritySurface>
  );
}
