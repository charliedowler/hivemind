"use client";
import { useState } from "react";
import { Badge, Button, Card, Sprite } from "@hivemind/design-system";
import type { SlackSettingsData } from "@/server/slack/store";
import { errorMessage, requestJson, relativeTime } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function SlackSettings({
  initial,
  debug = false,
}: {
  initial: SlackSettingsData;
  debug?: boolean;
}) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [purging, setPurging] = useState<string>();
  async function change(action: string, channel?: string) {
    setPending(channel ?? action);
    setError("");
    try {
      setData(
        await requestJson<SlackSettingsData>("/api/app/slack", {
          action,
          channel,
        }),
      );
      setPurging(undefined);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending("");
    }
  }
  async function refreshLog() {
    setPending("log");
    setError("");
    try {
      setData(await requestJson<SlackSettingsData>("/api/app/slack"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending("");
    }
  }
  return (
    <div className="stack slack-settings">
      {error ? <ErrorPanel message={error} /> : null}
      <Card className="stack">
        <div className="row between wrap">
          <div className="row">
            <Sprite name="jar" scale={2} />
            <h3>Connection</h3>
          </div>
          {data.installation?.active ? (
            <Badge tone="confirmed">Connected</Badge>
          ) : null}
        </div>
        {data.installation?.active ? (
          <>
            <p>
              Connected to <strong>{data.installation.workspaceName}</strong>.
            </p>
            <div className="row wrap">
              <Button
                variant="ghost"
                disabled={Boolean(pending)}
                onClick={() => change("disconnect")}
              >
                Disconnect Slack
              </Button>
            </div>
            <p className="small muted">
              Disconnect stops replies and ingestion. Existing messages become
              unavailable until the workspace reconnects.
            </p>
          </>
        ) : (
          <>
            <p>
              Connect a workspace, then invite Hive to the channels where you
              want to chat.
            </p>
            <Button
              onClick={() => window.location.assign("/api/slack/oauth/start")}
            >
              Connect Slack
            </Button>
          </>
        )}
      </Card>
      {data.installation?.active ? (
        <Card className="stack">
          <h3>Channels</h3>
          <p>
            Only channels where Hive is invited appear here. Selected private
            channels become searchable by your Hive team. Hive never indexes
            direct messages.
          </p>
          {data.channels.length ? (
            data.channels.map((channel) => (
              <div className="slack-channel stack" key={channel.id}>
                <div className="row between wrap">
                  <div>
                    <h4>#{channel.name}</h4>
                    <p className="small muted">
                      {channel.private ? "Private" : "Public"} · {channel.count}{" "}
                      indexed messages ·{" "}
                      {!channel.botMember
                        ? "Hive is no longer invited"
                        : channel.state === "enabled"
                          ? "Indexing on"
                          : channel.state === "paused"
                            ? "Indexing stopped"
                            : "Not indexed"}
                    </p>
                    {channel.state === "enabled" ? (
                      <p className="small">
                        {channel.backfillDone
                          ? "History is up to date."
                          : "Hive is still adding older messages."}
                      </p>
                    ) : null}
                    {channel.error && channel.error !== "history_complete" ? (
                      <p role="status" className="small">
                        {channel.error}
                      </p>
                    ) : null}
                  </div>
                  <div className="row wrap">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={Boolean(pending) || !channel.botMember}
                      loading={pending === channel.id}
                      onClick={() =>
                        change(
                          channel.state === "enabled" ? "stop" : "enable",
                          channel.id,
                        )
                      }
                    >
                      {channel.state === "enabled"
                        ? "Stop indexing"
                        : "Enable indexing"}
                    </Button>
                    {channel.state !== "purged" ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={Boolean(pending)}
                        onClick={() => setPurging(channel.id)}
                      >
                        Purge messages
                      </Button>
                    ) : null}
                  </div>
                </div>
                {purging === channel.id ? (
                  <div role="alert" className="slack-purge">
                    <p>
                      Remove all indexed messages and Slack ask history from #
                      {channel.name}? Saved cells remain in Hive.
                    </p>
                    <div className="row wrap">
                      <Button
                        disabled={Boolean(pending)}
                        onClick={() => change("purge", channel.id)}
                      >
                        Purge this channel
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setPurging(undefined)}
                      >
                        Keep messages
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p>
              Invite Hive to a channel in Slack. It appears here within 15
              minutes.
            </p>
          )}
          <p className="small muted">
            Ask @Hive in a channel for a weekly update.
          </p>
          <p className="small muted">
            Stop indexing keeps existing messages searchable. Purge removes them
            and prevents pending work from restoring them.
          </p>
        </Card>
      ) : null}
      {debug ? (
        <Card className="stack" id="decisions">
          <div className="row between wrap">
            <h3>When Hive speaks</h3>
            <Button
              variant="secondary"
              size="sm"
              disabled={Boolean(pending)}
              loading={pending === "log"}
              onClick={refreshLog}
            >
              Refresh decisions
            </Button>
          </div>
          <p className="muted">
            Hive stays quiet by default. An unprompted reply needs confirmed
            evidence, and each channel gets at most two per hour.
          </p>
          {data.decisions.length ? (
            data.decisions.map((decision) => (
              <div className="slack-decision stack" key={decision.id}>
                <div className="row between wrap">
                  <a
                    href={`https://app.slack.com/archives/${decision.channelId}/p${decision.threadTs.replace(".", "")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    #{decision.channelName}
                  </a>
                  <span className="small muted">
                    {relativeTime(decision.createdAt)}
                  </span>
                </div>
                <div className="row wrap">
                  <Badge
                    tone={
                      decision.decision === "stay_silent" ? "outdated" : "asked"
                    }
                  >
                    {decision.decision.replaceAll("_", " ")}
                  </Badge>
                  <span className="small">
                    {decision.delivery} · {decision.latencyMs} ms
                    {decision.model ? ` · ${decision.model}` : ""}
                  </span>
                </div>
                <p>{decision.reason}</p>
                {decision.signals ? (
                  <details>
                    <summary>Jev judgments</summary>
                    <dl className="slack-signals">
                      {Object.entries(decision.signals).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value.toFixed(2)}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
                {decision.evidenceIds.length ? (
                  <div className="row wrap">
                    {decision.evidenceIds.map((id) => (
                      <a
                        className="cell-citation"
                        key={id}
                        href={`/app/cells/${id}`}
                      >
                        Confirmed source
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p>
              No decisions yet. Mention Hive in an invited channel to ask your
              first question.
            </p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
