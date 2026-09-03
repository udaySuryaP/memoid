import { PrimaryLink, SecondaryLink, SecuritySurface } from "../../security-surface";

export default function VerifyEmailPage() {
  return (
    <SecuritySurface
      eyebrow="Verify email"
      title="Verify your address before continuing"
      actions={
        <>
          <PrimaryLink href="/auth/login?return=%2Faccount%2Fsecurity">
            Return to AuthKit
          </PrimaryLink>
          <SecondaryLink href="/auth/recovery">I need help recovering access</SecondaryLink>
        </>
      }
    >
      <p>
        Memoid does not create or link an Account until WorkOS confirms the address is verified.
      </p>
      <div className="security-notice" role="status">
        If you changed your email, complete verification in AuthKit and sign in again.
      </div>
    </SecuritySurface>
  );
}
