import Link from "next/link";
import type { ReactNode } from "react";
import { Card, Sprite } from "@hivemind/design-system";

import "./error-shell.css";

export function ErrorShell({ code, title, children, actions }: { code: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <main className="error-page">
    <header><Link prefetch={false} href="/" className="error-brand"><Sprite name="bee" scale={3} />Hive</Link></header>
    <Card className="error-card">
      <div className="error-scene" aria-hidden="true"><Sprite name="hive-entrance" scale={4} /></div>
      <div className="error-copy">
        <span className="eyebrow">{code}</span>
        <h1>{title}</h1>
        {children}
        {actions ? <div className="error-actions">{actions}</div> : null}
      </div>
    </Card>
  </main>;
}

export function ErrorLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link prefetch={false} className="hm-btn hm-btn-secondary hm-btn-md" href={href}>{children}</Link>;
}
