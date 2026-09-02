import { PrimaryLink, SecuritySurface } from "../security-surface";

export default function ProtectedErrorPage() {
  return (
    <SecuritySurface
      eyebrow="Protected resource"
      title="That location isn’t available"
      actions={<PrimaryLink href="/account/security">Return to a safe page</PrimaryLink>}
    >
      <p>
        It may not exist, or your current Account may not have access. Memoid does not reveal
        protected object details across security boundaries.
      </p>
    </SecuritySurface>
  );
}
