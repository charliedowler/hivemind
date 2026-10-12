"use client";
import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "@hivemind/design-system";
import type { DigestScheduleInput, ComposedDigest } from "@hivemind/core";
import type { DigestChannel, DigestSchedule } from "@/server/digests/store";
import { requestJson, errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";
import { DigestBlocks } from "./digest-blocks";
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function IncludeOptions({ schedule }: { schedule?: DigestSchedule }) {
  return (
    <>
      <fieldset className="digest-includes">
        <legend>Include in each update</legend>
        {(["learnings", "insights", "friction", "decisions"] as const).map(
          (key) => (
            <label key={key}>
              <input
                type="checkbox"
                name={key}
                defaultChecked={schedule?.[key] ?? true}
              />
              {
                {
                  learnings: "Learnings",
                  insights: "Insights",
                  friction: "Friction and pain points",
                  decisions: "Conflict decisions",
                }[key]
              }
            </label>
          ),
        )}
      </fieldset>
      <div className="digest-options">
        <label>
          <input
            type="checkbox"
            name="skipEmpty"
            defaultChecked={schedule?.skipEmpty ?? true}
          />
          Skip empty updates
        </label>
        <label>
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={schedule?.enabled ?? true}
          />
          Schedule enabled
        </label>
      </div>
    </>
  );
}
export function DigestForm({
  schedule,
  channels,
  onSaved,
  onCancel,
}: {
  schedule?: DigestSchedule;
  channels: DigestChannel[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [cadence, setCadence] = useState(schedule?.cadence ?? "weekly");
  const [timezone, setTimezone] = useState(schedule?.timezone ?? "");
  const [preview, setPreview] = useState<ComposedDigest | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  function input(form: HTMLFormElement): DigestScheduleInput {
    const f = new FormData(form);
    return {
      channelId: String(f.get("channel")),
      cadence,
      weekday: Number(f.get("weekday") ?? 1),
      monthDay: Number(f.get("monthDay") ?? 1),
      time: String(f.get("time")),
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      learnings: f.has("learnings"),
      insights: f.has("insights"),
      friction: f.has("friction"),
      decisions: f.has("decisions"),
      enabled: f.has("enabled"),
      skipEmpty: f.has("skipEmpty"),
    };
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const action =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ??
      "save";
    setPending(true);
    setError("");
    try {
      const data = input(form);
      if (action === "preview")
        setPreview(
          await requestJson<ComposedDigest>("/api/app/digests", {
            action,
            schedule: data,
          }),
        );
      else {
        await requestJson("/api/app/digests", {
          action,
          schedule: data,
          id: schedule?.id,
        });
        onSaved();
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h2>{schedule ? "Edit schedule" : "Add schedule"}</h2>
      <div className="digest-form-grid">
        {channels.length ? (
          <Select
            label="Channel"
            name="channel"
            required
            defaultValue={schedule?.channelId ?? channels[0]?.id}
            options={channels.map((c) => ({
              value: c.id,
              label: `#${c.name}`,
            }))}
          />
        ) : (
          <Input
            label="Channel ID"
            name="channel"
            required
            defaultValue={schedule?.channelId}
            hint="Connect Slack and refresh its channels to choose where Hive posts."
          />
        )}
        <Select
          label="Frequency"
          value={cadence}
          onChange={(e) =>
            setCadence(e.target.value as DigestScheduleInput["cadence"])
          }
          options={[
            { value: "daily", label: "Daily" },
            { value: "weekdays", label: "Weekdays" },
            { value: "weekly", label: "Weekly" },
            { value: "fortnightly", label: "Fortnightly" },
            { value: "monthly", label: "Monthly" },
          ]}
        />
        {cadence === "weekly" || cadence === "fortnightly" ? (
          <Select
            label="Day"
            name="weekday"
            defaultValue={schedule?.weekday ?? 1}
            options={days.map((label, i) => ({ label, value: String(i) }))}
          />
        ) : null}
        {cadence === "monthly" ? (
          <Input
            label="Day of month"
            name="monthDay"
            type="number"
            min={1}
            max={31}
            defaultValue={schedule?.monthDay ?? 1}
            hint="Short months use their last day."
          />
        ) : null}
        <Input
          label="Local time"
          name="time"
          type="time"
          required
          defaultValue={schedule?.time ?? "09:00"}
        />
        <Input
          label="Timezone"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Your browser timezone"
          hint="Leave blank to use your browser timezone, or enter an IANA timezone such as Europe/London."
        />
      </div>
      <IncludeOptions schedule={schedule} />
      <p className="muted">
        Updates run within 15 minutes of your chosen time. The first update
        covers the last seven days.
      </p>
      {error ? <ErrorPanel message={error} /> : null}
      <div className="digest-actions">
        <Button type="submit" value="save" loading={pending}>
          Save schedule
        </Button>
        <Button
          type="submit"
          value="preview"
          variant="secondary"
          disabled={pending}
        >
          Preview
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {preview ? (
        <section className="digest-preview" aria-label="Digest preview">
          <h2>Preview</h2>
          <DigestBlocks blocks={preview.blocks} />
        </section>
      ) : null}
    </form>
  );
}
