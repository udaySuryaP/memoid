import { GeistMono, GeistSans } from "geist/font";
import type { Metadata } from "next";
import "@memoid/ui/tokens.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Memoid",
  description: "Source-aware context control with secure account access",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
