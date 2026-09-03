import { PrimaryLink, SecondaryLink, SecuritySurface } from "../../security-surface";

export default function SecurityEnrollmentPage() {
  return (
    <SecuritySurface
      eyebrow="Security enrollment"
      title="Strengthen account recovery"
      actions={
        <>
          <PrimaryLink href="/auth/login?return=%2Faccount%2Fsecurity">
            Manage security in AuthKit
          </PrimaryLink>
          <SecondaryLink href="/account/security">Back to security</SecondaryLink>
        </>
      }
    >
      <ul className="security-checklist">
        <li>
          <span className="status-dot" />
          Add a passkey on a device you control.
        </li>
        <li>
          <span className="status-dot" />
          Keep an additional verification method available.
        </li>
        <li>
          <span className="status-dot" />
          Review recovery access before you need it.
        </li>
      </ul>
    </SecuritySurface>
  );
}
