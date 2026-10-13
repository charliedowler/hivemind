import { fontVariables } from "./fonts";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@hivemind/design-system/app.css";
import "./globals.css";


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
        {children}
      </body>
    </html>
  );
}
