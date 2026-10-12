"use client";

import { useEffect, useState } from "react";
import type { MemberView, TeamOverview } from "@hivemind/core";
import { Card, MemberBee, Sprite } from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import { CopyButton, ErrorPanel, LoadingPanel } from "./primitives";

export function Members({ baseUrl }: { baseUrl: string }) {
  const [result, setResult] = useState<{
    data?: { members: MemberView[]; overview: TeamOverview };
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ members: MemberView[]; overview: TeamOverview }>(
      "/api/app/members",
      undefined,
      controller.signal,
    )
      .then((data) => setResult({ data }))
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({ error: errorMessage(error) });
      });
    return () => controller.abort();
  }, []);
  if (result.error) return <ErrorPanel message={result.error} />;
  if (!result.data)
    return (
      <LoadingPanel>A forager is finding your hive's members.</LoadingPanel>
    );
  const { members, overview } = result.data;
  const joinUrl = `${baseUrl}/app/login?invite=${encodeURIComponent(overview.inviteCode)}`;
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
      <Card className="invite-card">
        <div>
          <h2>Make room for your team.</h2>
          <p className="muted">
            Share an invite. Their agents bring learnings to the same comb.
          </p>
        </div>
        <div className="stack">
          <div className="row wrap">
            <code className="breakable">{overview.inviteCode}</code>
            <CopyButton text={overview.inviteCode} label="Copy invite code" />
          </div>
          <div className="row wrap">
            <code className="breakable small">{joinUrl}</code>
            <CopyButton text={joinUrl} label="Copy join link" />
          </div>
        </div>
      </Card>
      {members.length ? (
        <div className="member-grid">
          {members.map((member) => (
            <Card key={member.id} className="member-card">
              <MemberBee
                name={member.name}
                detail={`${member.learningCount} cells`}
                size="lg"
              />
              <dl className="member-facts">
                <div>
                  <dt>Joined</dt>
                  <dd>
                    <time dateTime={member.joinedAt}>
                      {new Date(member.joinedAt).toLocaleDateString("en-GB", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      })}
                    </time>
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
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <h2>Room for the first member.</h2>
          <p>Share the invite to bring your team into the hive.</p>
        </Card>
      )}
    </div>
  );
}
