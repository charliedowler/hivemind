import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Lilita_One, Nunito, Space_Mono, Silkscreen } from "next/font/google";
import "@hivemind/design-system/app.css";
import "./globals.css";

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
        className={`${display.variable} ${body.variable} ${mono.variable} ${pixel.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
