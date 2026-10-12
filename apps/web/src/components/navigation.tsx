"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson, errorMessage } from "@/lib/client";

export function Navigation({ teamName, memberName }: { teamName: string; memberName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true); setError("");
    try { await requestJson("/api/app/session", undefined, undefined, "DELETE"); router.push("/app/login"); router.refresh(); }
    catch (error) { setError(errorMessage(error)); setPending(false); }
  }
  return <header className="app-header"><Link className="brand" href="/"><span className="hive-mark" aria-hidden="true" />Hivemind</Link><span className="team-name">{teamName}</span><nav aria-label="Dashboard">{[["/app", "Feed"], ["/app/members", "Members"], ["/app/install", "Install"]].map(([href, label]) => <Link key={href} href={href!} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}</nav><div className="account"><span>{memberName}</span><button className="text-button" onClick={signOut} disabled={pending}>{pending ? "Signing out…" : "Sign out"}</button>{error && <span role="alert" className="field-error">{error}</span>}</div></header>;
}
