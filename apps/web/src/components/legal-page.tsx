import type { ReactNode } from "react";
import { Card, Sprite } from "@hivemind/design-system";
import Link from "next/link";
import { LegalLinks } from "./legal-links";
import styles from "./legal.module.css";
import { brandLine } from "@/lib/site";

export function LegalPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className="brand" aria-label="Hive home">
          <Sprite name="bee" scale={2} paused />
          Hive
        </Link>
        <span className={styles.access}>Early access</span>
      </header>
      <main>
        <Card className={styles.document}>
          <h1>{title}</h1>
          <p className={styles.updated}>Last updated: 12 October 2026</p>
          {children}
        </Card>
      </main>
      <footer className={styles.footer}>
        <span>{brandLine()}</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
