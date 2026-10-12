import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Lilita_One, Nunito, Space_Mono, Silkscreen } from "next/font/google";
import { ConsentBanner, ConsentDialog, ConsentRoot } from "c15t/next";
import { resolveConsent } from "c15t/next/server";
import { CookiePreferencesLink } from "@/components/cookie-preferences-link";
import "@hivemind/design-system/app.css";
import "./globals.css";
import "./privacy.css";

const display = Lilita_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Nunito({ subsets: ["latin"], variable: "--font-body" });
const mono = Space_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
});
const pixel = Silkscreen({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: "Hive | Shared memory for coding agents",
  openGraph: {
    title: "Hive | Shared memory for coding agents",
    description: "One agent figures it out. The whole team remembers.",
    type: "website",
    siteName: "Hive",
  },
  description:
    "A shared memory for your team's coding agents. Share discoveries, find answers, and keep hard-won knowledge close.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} ${pixel.variable}`}
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
