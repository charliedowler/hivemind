import Link from "next/link";
import styles from "./legal.module.css";

export function LegalLinks() {
  return (
    <nav className={styles.links} aria-label="Legal">
      <Link href="/privacy">Privacy</Link>
      <Link href="/terms">Terms</Link>
    </nav>
  );
}
