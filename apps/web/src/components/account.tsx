"use client";
import { formatHumanDate } from "@hivemind/core";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { EmailCode } from "./email-code";
import { ErrorPanel } from "./primitives";
import { KeyBox } from "./install";
import { PasswordReset } from "./password-reset";
type AccountData = {
  member: {
    name: string;
    email: string | null;
    email_verified: boolean;
    role: string;
  };
  keys: {
    id: string;
    label: string;
    prefix: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
};
export function Account({ initial }: { initial: AccountData }) {
  const [data, setData] = useState(initial);
  const [token, setToken] = useState("");
  const [key, setKey] = useState("");
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
            Save name
          </Button>
        </form>
      </Card>
      <Card className="stack">
        <h2>Your email</h2>
        <p>
          {data.member.email ?? "No email yet"} ·{" "}
          {data.member.email_verified ? "Verified" : "Not verified"}
        </p>
        {token ? (
          <EmailCode
            token={token}
            onBack={() => setToken("")}
            onVerified={() => {
              setToken("");
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
      </Card>
      <Card className="stack">
        <h2>Your keys</h2>
        <p className="muted">
          Keys are for headless and CI access. Your forager normally signs in
          through the browser. Revoke keys that no longer need access.
        </p>
        {data.keys.map((item) => (
          <div className="key-row stack" key={item.id}>
            <strong>
              {item.label} · <code>{item.prefix}</code>
            </strong>
            <p className="small">
              Created {formatHumanDate(item.created_at)} · Last used{" "}
              {item.last_used_at ? formatHumanDate(item.last_used_at) : "Never"}
            </p>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || Boolean(item.revoked_at)}
              onClick={() =>
                void action(async () => {
                  await requestJson("/api/app/admin", {
                    action: "revoke",
                    id: item.id,
                  });
                })
              }
            >
              {item.revoked_at ? "Revoked" : "Revoke key"}
            </Button>
          </div>
        ))}
        <form
          className="stack"
          action={(form) => {
            const label = String(form.get("label"));
            void action(async () => {
              const result = await requestJson<{ apiKey: string }>(
                "/api/app/keys",
                { label },
              );
              setKey(result.apiKey);
            });
          }}
        >
          <Input
            name="label"
            label="New key label"
            required
            maxLength={120}
            placeholder="My Codex"
          />
          <Button type="submit" loading={pending}>
            Create a key
          </Button>
        </form>
        {key ? <KeyBox apiKey={key} /> : null}
      </Card>
      {data.member.email && data.member.email_verified ? (
        <Card>
          <PasswordReset email={data.member.email} />
        </Card>
      ) : null}
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
