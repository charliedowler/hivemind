"use client";
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
export function Account({
  initial,
  hasPassword,
}: {
  initial: AccountData;
  hasPassword: boolean;
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
