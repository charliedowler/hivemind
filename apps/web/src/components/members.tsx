"use client";
import { useEffect, useState } from "react";
import type { MemberView, TeamOverview } from "@hivemind/core";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import { CopyButton, ErrorPanel } from "./primitives";

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
      <p className="panel muted" role="status">
        Loading your team…
      </p>
    );
  const { members, overview } = result.data;
  const joinUrl = `${baseUrl}/app/login?invite=${encodeURIComponent(overview.inviteCode)}`;
  return (
    <div className="stack">
      <div>
        <h1>The people behind the hive</h1>
        <p className="muted">
          {overview.teamName} has {overview.memberCount} members,{" "}
          {overview.learningCount} learnings and {overview.repos.length}{" "}
          repositories.
        </p>
      </div>
      <section className="invite-card panel">
        <div>
          <h2>Better with your team</h2>
          <p className="muted">
            Share this link with a teammate to bring them into your hive.
          </p>
        </div>
        <div className="stack">
          <div className="row wrap">
            <code className="breakable">{overview.inviteCode}</code>
            <CopyButton text={overview.inviteCode} label="Copy invite code" />
          </div>
          <div className="row wrap">
            <code className="breakable">{joinUrl}</code>
            <CopyButton text={joinUrl} label="Copy join link" />
          </div>
        </div>
      </section>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">Team members</caption>
          <thead>
            <tr>
              <th>Name</th>
              <th>Joined</th>
              <th>Last seen</th>
              <th>Learnings</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.name}</td>
                <td>
                  <time dateTime={member.joinedAt}>
                    {new Date(member.joinedAt).toLocaleDateString("en-GB", {
                      dateStyle: "medium",
                    })}
                  </time>
                </td>
                <td>
                  {member.lastSeenAt
                    ? relativeTime(member.lastSeenAt)
                    : "Not yet"}
                </td>
                <td>{member.learningCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
