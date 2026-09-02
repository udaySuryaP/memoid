import Link from "next/link";
export default function Home() {
  return (
    <main>
      <h1>Memoid</h1>
      <p>Source-aware context control, with human decisions kept visible.</p>
      <Link href="/auth/access">Access your account</Link>
    </main>
  );
}
