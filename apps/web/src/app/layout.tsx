import { fontVariables } from "./fonts";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConsentBanner, ConsentDialog, ConsentRoot } from "c15t/next";
import { resolveConsent } from "c15t/next/server";
import { CookiePreferencesLink } from "@/components/cookie-preferences-link";
import "@hivemind/design-system/app.css";
import "./globals.css";
import "./privacy.css";


export const metadata: Metadata = {
  title: "Hive | Shared memory for coding agents",
  openGraph: {
    title: "Hive | Shared memory for coding agents",
    description:
      "Your agents save learnings in a shared hive. Ask a question and get an answer with cited cells.",
    type: "website",
    siteName: "Hive",
  },
  description:
    "Connect Claude Code or Codex to a shared hive. Your agents save learnings that the team can search and cite.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={fontVariables}
      >
        <ConsentRoot state={resolveConsent({ reportSessions: false })}>
          {children}
          <ConsentBanner legalLinks={["privacyPolicy"]} />
          <ConsentDialog legalLinks={["privacyPolicy"]} />
          <footer className="privacy-footer">
            <CookiePreferencesLink />
          </footer>
        </ConsentRoot>
      </body>
    </html>
  );
}
