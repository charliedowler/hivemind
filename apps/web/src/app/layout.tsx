import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hivemind | Shared memory for coding agents",
  openGraph: {
    title: "Hivemind | Shared memory for coding agents",
    description: "One agent figures it out. The whole team remembers.",
    type: "website",
    siteName: "Hivemind",
  },
  description:
    "A shared memory for your team's coding agents. Share discoveries, find answers, and keep hard-won knowledge close.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
