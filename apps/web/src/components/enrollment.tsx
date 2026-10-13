"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Input, Tabs } from "@hivemind/design-system";
import { authClient } from "@/lib/auth-client";
import { hiveRegistration } from "@/lib/hive-registration";
import { requestJson, errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function Enrollment({ email, invite, oauthQuery, agent = false }: { email: string; invite: string; oauthQuery: string; agent?: boolean }) {
  const [mode, setMode] = useState("join");
  const router = useRouter();
  const [error, submit, pending] = useActionState(async (_previous: string, form: FormData) => {
    try {
      const registration = hiveRegistration.parse(mode === "create" ? { intent: "create", teamName: form.get("teamName") } : form.get("inviteCode") ? { intent: "invite", inviteCode: form.get("inviteCode") } : { intent: "domain" });
      await requestJson("/api/app/enroll", registration);
      if (oauthQuery) {
        const result = await authClient.oauth2.continue({ postLogin: true, oauth_query: oauthQuery });
        if (result.error) throw new Error(result.error.message);
        if (result.data?.url) window.location.assign(result.data.url);
      } else { router.push(agent ? "/app?agent_joined=1" : "/app"); router.refresh(); }
      return "";
    } catch (error) { return errorMessage(error); }
  }, "");
  return <Card className="stack">
    <h1>Find your hive</h1>
    <p>You are signed in as {email}. {agent ? "Use an invite or create a team. Your owner will be invited when their email is known." : "Use an invite or your allowed work domain, or create a team."}</p>
    <Tabs label="Your hive" tabs={[{ id: "join", label: "Join" }, { id: "create", label: "Create a team" }]} value={mode} onChange={setMode} />
    <form key={mode} className="stack" action={submit}>
      {mode === "create" ? <Input label="Team name" name="teamName" required maxLength={80} autoComplete="organization" /> : <Input label="Invite link or code" name="inviteCode" defaultValue={invite} maxLength={200} required={agent} hint={agent ? "Ask your team admin for an invite." : "Leave empty to use your verified work domain."} />}
      {error ? <ErrorPanel message={error} /> : null}
      <Button type="submit" loading={pending}>{mode === "create" ? "Create a team" : "Join the hive"}</Button>
    </form>
  </Card>;
}
