import "./globals.css";
import type { Metadata } from "next";
import { Providers } from "./providers";
import { AppLogo } from "@/components/AppLogo";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI Use-Case Demos",
  description:
    "AI use-case on synthetic data: Federal Court ruling summarization.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <Providers>
          <header className="border-b border-brand-gray-dark bg-brand-white">
            <div className="mx-auto max-w-6xl flex items-center justify-between px-6 py-4">
              <Link href="/" className="flex items-center gap-3">
                <AppLogo />
              </Link>
              <nav className="flex gap-6 text-sm font-bold">
                <Link href="/case-1" className="hover:text-brand-primary">
                  Ruling Radar
                </Link>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
          <footer className="border-t border-brand-gray-dark mt-12 py-6 text-center text-xs text-brand-gray">
            Synthetic demo data only · Switzerland North · KI-Entwurf — vor
            Verwendung prüfen
          </footer>
        </Providers>
      </body>
    </html>
  );
}
