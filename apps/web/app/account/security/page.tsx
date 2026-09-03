import { PrimaryLink, SecondaryLink, SecuritySurface } from "../../security-surface";

export default function AccountSecurityPage() {
  return (
    <SecuritySurface
      eyebrow="Account security"
      title="Security controls"
      actions={
        <>
          <PrimaryLink href="/auth/enroll">Manage passkeys and MFA</PrimaryLink>
          <SecondaryLink href="/account/sessions">Review active sessions</SecondaryLink>
        </>
      }
    >
      <div className="security-grid">
        <article>
          <span className="badge">Provider managed</span>
          <h2>Passkeys</h2>
          <p>Phishing-resistant sign-in stays in AuthKit.</p>
        </article>
        <article>
          <span className="badge">Provider managed</span>
          <h2>Recovery</h2>
          <p>Recovery changes require a fresh provider check.</p>
        </article>
        <article>
          <span className="badge">Memoid enforced</span>
          <h2>Session policy</h2>
          <p>24-hour absolute, 1-hour idle, and 15-minute fresh-auth windows.</p>
        </article>
      </div>
    </SecuritySurface>
  );
}
