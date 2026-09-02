import { SecondaryLink, SecuritySurface } from "../../security-surface";

export default function SessionsPage() {
  return (
    <SecuritySurface
      eyebrow="Account sessions"
      title="Active sessions"
      actions={<SecondaryLink href="/account/security">Back to security</SecondaryLink>}
    >
      <div className="session-card">
        <div>
          <span className="badge">Current</span>
          <h2>This browser</h2>
          <p>Exact device and location details are intentionally not exposed.</p>
        </div>
        <form action="/auth/logout" method="post">
          <button className="danger-action" type="submit">
            Sign out this session
          </button>
        </form>
      </div>
      <p className="muted">
        Provider revocation and account-wide security resets invalidate Memoid sessions
        independently of the browser cookie.
      </p>
    </SecuritySurface>
  );
}
