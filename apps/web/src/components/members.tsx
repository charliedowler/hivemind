"use client";
import { useState } from "react";
import type { MemberView, TeamOverview } from "@hivemind/core";
import { Button, Card, MemberBee, Sprite } from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import { CopyButton, ErrorPanel } from "./primitives";
type Data = {
  members: MemberView[];
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
export function Members({
  baseUrl,
  initial,
}: {
  baseUrl: string;
  initial: Data;
}) {
  const [data, setData] = useState(initial);
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function act(action: string, id?: string) {
    setError("");
    setPending(true);
    try {
      const result = await requestJson<{ inviteCode?: string }>(
        "/api/app/admin",
        { action, id },
      );
      if (result.inviteCode) setInvite(result.inviteCode);
      setData(await requestJson("/api/app/members"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  const { members, overview } = data;
  const admin = overview.role === "admin";
  return (
    <div className="stack members-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">No one learns alone</span>
          <h1>The people behind the hive</h1>
          <p className="muted">
            {overview.teamName}: {overview.memberCount} members,{" "}
            {overview.learningCount} cells, {overview.repos.length} repos.
          </p>
        </div>
        <Sprite name="bee-carry" scale={4} />
      </div>
      {error ? <ErrorPanel message={error} /> : null}
      {admin ? (
        <Card className="stack">
          <h2>Make room for your team.</h2>
          <p className="muted">
            Invites expire after seven days. Rotating an invite keeps existing
            members working. Save the new invite now. The hive cannot show it
            again.
          </p>
          <Button onClick={() => void act("invite")} loading={pending}>
            Rotate invite
          </Button>
          {invite ? (
            <div className="stack">
              <code className="breakable">{invite}</code>
              <CopyButton
                text={`${baseUrl}/app/login?invite=${encodeURIComponent(invite)}`}
                label="Copy join link"
              />
            </div>
          ) : (
            <p className="small">
              Current invite expires{" "}
              {new Date(overview.inviteExpiresAt).toLocaleDateString("en-GB", {
                timeZone: "UTC",
              })}
              . Its code stays private.
            </p>
          )}
          <h2>Work domains</h2>
          <p className="muted">
            Allow your own verified work domain. Public email providers cannot
            join by domain.
          </p>
          <p>
            {overview.domains.length
              ? overview.domains.join(", ")
              : "No domains allowed yet."}
          </p>
          <Button
            variant="secondary"
            onClick={() => void act("domain")}
            loading={pending}
          >
            Allow my verified domain
          </Button>
        </Card>
      ) : null}
      <div className="member-grid">
        {members.map((member) => (
          <Card key={member.id} className="member-card stack">
            <MemberBee
              name={member.name}
              detail={`${member.learningCount} cells · ${member.role === "admin" ? "Team admin" : "Member"}`}
              size="lg"
            />
            <p className="small breakable">
              {member.email ?? "No email yet"} ·{" "}
              {member.emailVerified ? "Verified" : "Not verified"}
            </p>
            <dl className="member-facts">
              <div>
                <dt>Joined</dt>
                <dd>
                  {new Date(member.joinedAt).toLocaleDateString("en-GB", {
                    timeZone: "UTC",
                  })}
                </dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>
                  {member.lastSeenAt
                    ? relativeTime(member.lastSeenAt)
                    : "No visit yet"}
                </dd>
              </div>
            </dl>
            {admin ? (
              <>
                <div className="stack">
                  {data.keys
                    .filter((key) => key.member_id === member.id)
                    .map((key) => (
                      <div className="stack key-row" key={key.id}>
                        <code className="small">
                          {key.label} · {key.prefix}
                        </code>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending || Boolean(key.revoked_at)}
                          onClick={() => void act("revoke", key.id)}
                        >
                          {key.revoked_at ? "Revoked" : "Revoke key"}
                        </Button>
                      </div>
                    ))}
                </div>
                {member.id !== data.memberId ? (
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void act("remove", member.id)}
                  >
                    Remove member
                  </Button>
                ) : null}
              </>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
