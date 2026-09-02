import Link from "next/link";
import type { ReactNode } from "react";

export function SecuritySurface({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <main className="security-shell">
      <section className="security-panel" aria-labelledby="security-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="security-title">{title}</h1>
        <div className="security-content">{children}</div>
        {actions ? <div className="security-actions">{actions}</div> : null}
      </section>
      <p className="security-footnote">
        Memoid never asks for your passkey, recovery code, or provider password on this site.
      </p>
    </main>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="primary-action" href={href} prefetch={false}>
      {children}
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className="secondary-action" href={href} prefetch={false}>
      {children}
    </Link>
  );
}
