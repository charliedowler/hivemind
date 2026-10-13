"use client";
import { memberGroups } from "@/lib/member-groups";
import { useState } from "react";
import type { MemberView, TeamOverview } from "@hivemind/core";
import { Button, Card, MemberBee } from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
type Member = MemberView & {
  actorType?: string;
  ownerId?: string | null;
  ownerName?: string | null;
};
type Data = {
  members: Member[];
  overview: TeamOverview;
  memberId: string;
  keys: {
    id: string;
    label: string;
    prefix: string;
    member_id: string;
    revoked_at: string | null;
  }[];
};
export function Members({ initial }: { baseUrl: string; initial: Data }) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const admin = data.overview.role === "admin";
  const groups = memberGroups(data.members);
  async function remove(id: string) {
    setPending(true);
    setError("");
    try {
      await requestJson("/api/app/admin", { action: "remove", id });
      setData(await requestJson("/api/app/members"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack members-page">
      <p className="muted">
        {data.overview.teamName}: {groups.owners.length}{" "}
        {groups.owners.length === 1 ? "person" : "people"},{" "}
        {data.members.length - groups.owners.length} agents,{" "}
        {data.overview.learningCount} cells.
      </p>
      <div className="member-grid">
        {groups.owners.map(({ human, agents }) => {
          const count = agents.reduce(
            (total, agent) => total + agent.learningCount,
            human.learningCount,
          );
          const seen = [human, ...agents]
            .flatMap((member) => (member.lastSeenAt ? [member.lastSeenAt] : []))
            .sort()
            .at(-1);
          return (
            <Card key={human.id} className="member-card stack">
              <MemberBee
                name={human.name}
                detail={`${count} cells · ${human.role === "admin" ? "Team admin" : "Member"}`}
                size="lg"
              />
              <p className="small breakable">{human.email ?? "No email yet"}</p>
              <p className="small">
                Last seen {seen ? relativeTime(seen) : "no visit yet"}
              </p>
              {agents.map((agent) => (
                <div className="row between wrap member-agent" key={agent.id}>
                  <div>
                    <p>
                      {agent.name} · last seen{" "}
                      {agent.lastSeenAt
                        ? relativeTime(agent.lastSeenAt)
                        : "no visit yet"}
                    </p>
                    <p className="small muted">{agent.learningCount} cells</p>
                  </div>
                  {admin ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void remove(agent.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
              {admin && human.id !== data.memberId ? (
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void remove(human.id)}
                >
                  Remove member
                </Button>
              ) : null}
            </Card>
          );
        })}
      </div>
      {groups.ownerless.length ? (
        <section className="stack">
          <h3>Agents without an owner</h3>
          {groups.ownerless.map((agent) => (
            <Card key={agent.id} className="row between wrap">
              <p>
                {agent.name} · last seen{" "}
                {agent.lastSeenAt
                  ? relativeTime(agent.lastSeenAt)
                  : "no visit yet"}
              </p>
              {admin ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void remove(agent.id)}
                >
                  Remove
                </Button>
              ) : null}
            </Card>
          ))}
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
