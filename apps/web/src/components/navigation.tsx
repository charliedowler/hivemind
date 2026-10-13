"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button, MemberBee, Sprite } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";

import styles from "./navigation.module.css";

export function Navigation({
  teamName,
  memberName,
  teamCount = 1,
  hives = [],
  selectedTeamId,
  personal = false,
}: {
  teamName: string;
  memberName: string;
  teamCount?: number;
  hives?: { teamId: string; teamName: string; personal: boolean }[];
  selectedTeamId?: string;
  personal?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const accountRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!accountRef.current?.contains(event.target as Node)) setOpen(false);
      },
      { signal: controller.signal },
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") {
          setOpen(false);
          buttonRef.current?.focus();
        }
      },
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [open]);
  async function switchHive(teamId: string) {
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/switch-hive", { teamId });
      setOpen(false);
      router.push("/app");
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
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
    <header className={styles.header}>
      <div className={styles.inner}>
        <nav className={styles.nav} aria-label="Dashboard">
          {[
            ["/app", "Hive"],
            ...(!personal ? [["/app/team", "Team"]] : []),
            ["/app/connect", "Connect"],
          ].map(([href, label]) => (
            <Link
              key={href}
              className={styles.link}
              href={href!}
              aria-current={pathname === href ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {href === "/app" ? <Sprite name="bee" scale={2} /> : null}
              {label}
            </Link>
          ))}
        </nav>
        <div
          className={styles.account}
          ref={accountRef}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget))
              setOpen(false);
          }}
        >
          <button
            type="button"
            className={styles.avatar}
            ref={buttonRef}
            aria-label="Account menu"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen(!open)}
          >
            <MemberBee name={memberName} size="sm" showName={false} />
          </button>
          {open ? (
            <div className={styles.menu} id={menuId}>
              <div className={styles.identity}>
                <strong>{memberName}</strong>
                <span className="small muted">{teamName}</span>
              </div>
              {hives.length > 1 ? (
                <div className="stack" aria-label="Switch hive">
                  <span className="small muted">Switch hive</span>
                  {hives.map((hive) => (
                    <button
                      key={hive.teamId}
                      className={styles.item}
                      disabled={pending || hive.teamId === selectedTeamId}
                      aria-current={
                        hive.teamId === selectedTeamId ? "true" : undefined
                      }
                      onClick={() => void switchHive(hive.teamId)}
                    >
                      {hive.personal
                        ? `Personal · ${hive.teamName}`
                        : hive.teamName}
                    </button>
                  ))}
                </div>
              ) : teamCount > 1 ? (
                <Link className={styles.item} href="/app/account">
                  Switch team
                </Link>
              ) : null}
              <Link
                className={styles.item}
                href="/app/account"
                onClick={() => setOpen(false)}
              >
                Account
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={signOut}
                loading={pending}
              >
                {pending ? "Signing out" : "Sign out"}
              </Button>
              {error ? (
                <p role="alert" className="field-error">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
