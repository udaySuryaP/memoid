import { SecondaryLink, SecuritySurface } from "../security-surface";

export default function StepUpPage() {
  return (
    <SecuritySurface
      eyebrow="Sensitive action"
      title="Confirm it’s really you"
      actions={
        <>
          <form action="/auth/step-up" method="post">
            <button className="primary-action" type="submit">
              Continue to fresh authentication
            </button>
          </form>
          <SecondaryLink href="/account/security">Cancel without making changes</SecondaryLink>
        </>
      }
    >
      <p>
        The pending action is bound to this Account and session. It runs once only after AuthKit
        confirms fresh authentication.
      </p>
    </SecuritySurface>
  );
}
