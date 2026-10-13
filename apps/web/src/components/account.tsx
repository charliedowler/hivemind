"use client";
import { AgentCredentials } from "./agent-credentials";
import Link from "next/link";
import { ProjectDelegation } from "./project-delegation";
import { ProjectSharing } from "./project-sharing";
import type { projectShareState } from "@/server/web-sharing";
import type { OwnerCapturePolicy, CaptureRule } from "@hivemind/core";
import { CaptureRules } from "./capture-rules";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { EmailCode } from "./email-code";
import { ErrorPanel } from "./primitives";
import { PasswordReset } from "./password-reset";
type AccountData = {
  member: {
    name: string;
    email: string | null;
    email_verified: boolean;
    role: string;
  };
};
const emptyAgents: { id: string; name: string }[] = [];
const emptySharing: Awaited<ReturnType<typeof projectShareState>> = [];
export function Account({
  initial,
  hasPassword,
  rules,
  policy,
  sharing = emptySharing,
  agents = emptyAgents,
}: {
  initial: AccountData;
  hasPassword: boolean;
  agents?: { id: string; name: string }[];
  rules: CaptureRule[];
  policy?: OwnerCapturePolicy;
  sharing?: Awaited<ReturnType<typeof projectShareState>>;
}) {
  const [data, setData] = useState(initial);
  const [token, setToken] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  async function action(task: () => Promise<void>) {
    setError("");
    setPending(true);
    try {
      await task();
      setData(await requestJson("/api/app/account"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name"));
    void action(async () => {
      await requestJson("/api/app/account", { name }, undefined, "PATCH");
      router.refresh();
    });
  }
  function email(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    void action(async () => {
      const sent = await requestJson<{ verificationToken: string }>(
        "/api/app/email",
        { email, memberName: data.member.name, intent: "account" },
      );
      setToken(sent.verificationToken);
    });
  }
  return (
    <div className="stack narrow">
      <div className="page-heading">
        <div>
          <h1>Your account</h1>
        </div>
      </div>
      {error ? <ErrorPanel message={error} /> : null}
      <Card>
        <form className="stack" onSubmit={save}>
          <Input
            name="name"
            label="Your name"
            defaultValue={data.member.name}
            required
            maxLength={80}
          />
          <Button type="submit" loading={pending}>
            Save
          </Button>
        </form>
      </Card>
      <Card className="stack">
        <h2>Your email</h2>
        <p>
          {data.member.email ?? "No email yet"} ·{" "}
          {data.member.email_verified ? "Verified" : "Not verified"}
        </p>
        <button
          type="button"
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: 0,
            padding: 0,
            color: "var(--text-accent)",
            textDecoration: "underline",
            cursor: "pointer",
          }}
          aria-expanded={changingEmail}
          aria-controls="change-email"
          onClick={() => {
            setChangingEmail(!changingEmail);
            setToken("");
          }}
        >
          {changingEmail ? "Cancel email change" : "Change email"}
        </button>
        {changingEmail ? (
          <div id="change-email">
            {token ? (
              <EmailCode
                token={token}
                onBack={() => setToken("")}
                onVerified={() => {
                  setToken("");
                  setChangingEmail(false);
                  void action(async () => {});
                }}
              />
            ) : (
              <form className="stack" onSubmit={email}>
                <Input
                  name="email"
                  label="Work email"
                  type="email"
                  defaultValue={data.member.email ?? ""}
                  required
                  maxLength={200}
                />
                <Button type="submit" loading={pending}>
                  Send verification code
                </Button>
              </form>
            )}
          </div>
        ) : null}
      </Card>
      {hasPassword && data.member.email && data.member.email_verified ? (
        <details className="install-fallback">
          <summary>Change password</summary>
          <Card>
            <PasswordReset email={data.member.email} />
          </Card>
        </details>
      ) : null}
      <AgentCredentials agents={agents} />
      <AccountProjectChoices
        policy={policy}
        rules={rules}
        sharing={sharing}
        agents={agents}
        isAdmin={data.member.role === "admin"}
      />
      <Link href="/app/create-hive">Create a hive for your team</Link>
      <Button
        variant="ghost"
        loading={pending}
        onClick={() =>
          void action(async () => {
            await requestJson(
              "/api/app/session",
              undefined,
              undefined,
              "DELETE",
            );
            router.push("/app/login");
            router.refresh();
          })
        }
      >
        Sign out
      </Button>
    </div>
  );
}

function AccountProjectChoices({
  policy,
  rules,
  sharing,
  agents,
  isAdmin,
}: {
  policy?: OwnerCapturePolicy;
  rules: CaptureRule[];
  sharing: Awaited<ReturnType<typeof projectShareState>>;
  agents: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const [editedPolicy, setEditedPolicy] = useState<OwnerCapturePolicy>();
  const currentPolicy =
    editedPolicy && editedPolicy.revision >= (policy?.revision ?? 0)
      ? editedPolicy
      : policy;
  return (
    <>
      <CaptureRules
        initial={{ rules, policy: currentPolicy, isAdmin }}
        onPolicySaved={setEditedPolicy}
        scope="personal"
      />
      {currentPolicy ? (
        <ProjectSharing policy={currentPolicy} initial={sharing} />
      ) : null}
      {currentPolicy ? (
        <ProjectDelegation
          key={currentPolicy.revision}
          policy={currentPolicy}
          agents={agents}
        />
      ) : null}
    </>
  );
}
