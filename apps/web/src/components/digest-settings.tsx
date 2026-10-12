"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, Sprite } from "@hivemind/design-system";
import type { ComposedDigest } from "@hivemind/core";
import type {
  DigestChannel,
  DigestSchedule,
  digestHistory,
} from "@/server/digests/store";
import { requestJson, errorMessage } from "@/lib/client";
import { DigestForm } from "./digest-form";
import { DigestBlocks } from "./digest-blocks";
import { ErrorPanel } from "./primitives";
const historyDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const scheduleDates = new Map<string, Intl.DateTimeFormat>();
function nextDate(schedule: DigestSchedule) {
  let formatter = scheduleDates.get(schedule.timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: schedule.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    scheduleDates.set(schedule.timezone, formatter);
  }
  return formatter.format(new Date(schedule.nextDueAt));
}
export type DigestSettingsData = {
  schedules: DigestSchedule[];
  history: Awaited<ReturnType<typeof digestHistory>>;
  channels: DigestChannel[];
  isAdmin: boolean;
};
export function DigestSettings({ initial }: { initial: DigestSettingsData }) {
  const [data, setData] = useState(initial),
    [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<ComposedDigest | null>(null),
    [error, setError] = useState("");
  const [pending, setPending] = useState(false),
    [notice, setNotice] = useState("");
  async function refresh() {
    setData(await requestJson<DigestSettingsData>("/api/app/digests"));
    setEditing(null);
  }
  async function action(id: string, kind: "preview" | "post") {
    setPending(true);
    setError("");
    setNotice("");
    try {
      if (kind === "preview")
        setPreview(
          await requestJson<ComposedDigest>("/api/app/digests", {
            action: kind,
            id,
          }),
        );
      else {
        const result = await requestJson<{ status: string; error?: string }>(
          "/api/app/digests",
          { action: kind, id },
        );
        setNotice(
          result.error ??
            (result.status === "posted"
              ? "Update posted."
              : "No changes to post. This schedule skips empty updates."),
        );
        await refresh();
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack digest-settings">
      <div className="page-heading">
        <div>
          <h1>Slack digests</h1>
          <p>
            Post learnings, insights and reported friction at a time your team
            chooses.
          </p>
        </div>
        <Sprite name="hive-entrance" scale={3} />
      </div>
      <nav className="digest-tabs" aria-label="Slack settings">
        <Link href="/app/settings/slack">Connection and channels</Link>
        <Link href="/app/settings/digests" aria-current="page">
          Digests
        </Link>
      </nav>
      {!data.isAdmin ? (
        <p>
          Team admins manage schedules. You can preview updates and read their
          history.
        </p>
      ) : null}
      {error ? <ErrorPanel message={error} /> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {editing !== null && data.isAdmin ? (
        <Card>
          <DigestForm
            key={editing}
            schedule={data.schedules.find((s) => s.id === editing)}
            channels={data.channels}
            onSaved={() => {
              void refresh().catch((error: unknown) =>
                setError(errorMessage(error)),
              );
            }}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : null}
      <section className="stack" aria-label="Schedules">
        <div className="digest-section-heading">
          <h2>Schedules</h2>
          {data.isAdmin && editing === null ? (
            <Button iconLeft="icon-plus" onClick={() => setEditing("new")}>
              Add schedule
            </Button>
          ) : null}
        </div>
        {!data.schedules.length ? (
          <Card>
            <p>
              No schedules yet. An admin can add one here or ask @Hive in Slack
              to set one up.
            </p>
          </Card>
        ) : (
          data.schedules.map((schedule) => (
            <Card key={schedule.id} className="digest-schedule-card">
              <div className="digest-section-heading">
                <h3>#{schedule.channelName}</h3>
                <span className="hm-tag">
                  {schedule.enabled ? "Enabled" : "Paused"}
                </span>
              </div>
              <p>
                {schedule.cadence === "weekly" ||
                schedule.cadence === "fortnightly"
                  ? `${schedule.cadence === "weekly" ? "Weekly" : "Fortnightly"} on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][schedule.weekday]}`
                  : schedule.cadence === "monthly"
                    ? `Monthly on day ${schedule.monthDay}`
                    : schedule.cadence === "weekdays"
                      ? "Weekdays"
                      : "Daily"}{" "}
                at {schedule.time} in {schedule.timezone}
              </p>
              <p className="muted">
                {schedule.enabled
                  ? `Next update: ${nextDate(schedule)}`
                  : "No updates while paused."}
              </p>
              <p className="muted">
                {[
                  schedule.learnings && "Learnings",
                  schedule.insights && "Insights",
                  schedule.friction && "Friction",
                  schedule.decisions && "Decisions",
                ]
                  .filter(Boolean)
                  .join(", ")}
                {schedule.skipEmpty
                  ? ". Empty updates are skipped."
                  : ". Empty updates are posted."}
              </p>
              <div className="digest-actions">
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    void action(schedule.id, "preview");
                  }}
                >
                  Preview
                </Button>
                {data.isAdmin ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => setEditing(schedule.id)}
                    >
                      Edit
                    </Button>
                    <Button
                      loading={pending}
                      onClick={() => {
                        void action(schedule.id, "post");
                      }}
                    >
                      Post now
                    </Button>
                  </>
                ) : null}
              </div>
            </Card>
          ))
        )}
      </section>
      {preview ? (
        <Card className="digest-preview">
          <h2>Preview</h2>
          <DigestBlocks blocks={preview.blocks} />
        </Card>
      ) : null}
      <section className="stack">
        <h2>Recent updates</h2>
        <p className="muted">The last ten attempts across your schedules.</p>
        {data.history.length ? (
          <div className="digest-history">
            {data.history.map((post) => (
              <Card key={post.id}>
                <div className="digest-section-heading">
                  <strong>#{post.channelName}</strong>
                  <span>
                    {post.status === "skipped_empty"
                      ? "Skipped: no changes"
                      : post.status === "uncertain"
                        ? "Needs review"
                        : post.status === "running"
                          ? "Posting"
                          : post.status === "posted"
                            ? "Posted"
                            : "Failed"}
                  </span>
                </div>
                <p className="muted">
                  {historyDate.format(new Date(post.at))} UTC
                </p>
                {post.permalink ? (
                  <a href={post.permalink}>Open Slack post</a>
                ) : null}
                {post.error ? <p>{post.error}</p> : null}
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <p>No updates have run yet.</p>
          </Card>
        )}
      </section>
    </div>
  );
}
