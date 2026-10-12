"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Button, MemberBee, Sprite } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";

export function Navigation({
  teamName,
  memberName,
}: {
  teamName: string;
  memberName: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/session", undefined, undefined, "DELETE");
      router.push("/app/login");
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link className="brand" href="/">
          <Sprite name="bee" scale={3} />
          Hivemind
        </Link>
        <span className="team-name">{teamName}</span>
        <nav aria-label="Dashboard">
          {[
            ["/app", "The comb"],
            ["/app/members", "Members"],
            ["/app/install", "Install"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="account">
          <MemberBee name={memberName} size="sm" />
          <Button variant="ghost" size="sm" onClick={signOut} loading={pending}>
            {pending ? "Signing out" : "Sign out"}
          </Button>
        </div>
        {error ? (
          <span role="alert" className="field-error">
            {error}
          </span>
        ) : null}
      </div>
    </header>
  );
}
