"use client";

import { useState, type FormEvent } from "react";
import { earlyAccessInput, teamSizes } from "@hivemind/core";
import { Button, Input, Select, Sprite } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { ErrorPanel } from "./primitives";

export function EarlyAccessForm() {
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const params = new URLSearchParams(window.location.search);
    const source = params.get("utm_source") || params.get("ref") || undefined;
    const parsed = earlyAccessInput.safeParse({ ...data, source });
    if (!parsed.success) {
      setFields(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setFields({});
    setError("");
    setPending(true);
    try {
      await requestJson("/api/early-access", parsed.data);
      setDone(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (done)
    return (
      <div className="thank-you stack" role="status">
        <Sprite name="bee-carry" scale={4} />
        <h3>You're on the list.</h3>
        <p>Thanks for joining. We'll be in touch when your hive is ready.</p>
      </div>
    );
  return (
    <form
      onSubmit={submit}
      className="stack"
      noValidate
      aria-label="Early access"
    >
      {[
        { name: "name", title: "Name", type: "text", autoComplete: "name" },
        { name: "email", title: "Email", type: "email", autoComplete: "email" },
        {
          name: "company",
          title: "Company",
          type: "text",
          autoComplete: "organization",
        },
      ].map((field) => (
        <Input
          key={field.name}
          label={field.title}
          name={field.name}
          type={field.type}
          autoComplete={field.autoComplete}
          required={field.name !== "company"}
          error={fields[field.name]}
        />
      ))}
      <Select
        label="Team size"
        name="teamSize"
        defaultValue=""
        error={fields.teamSize ? "Choose your team size." : undefined}
        options={[
          { value: "", label: "Choose a size", disabled: true },
          ...teamSizes.map((size) => ({
            value: size,
            label: `${size} people`,
          })),
        ]}
      />
      {error ? <ErrorPanel message={error} /> : null}
      <Button type="submit" loading={pending} fullWidth>
        {pending ? "Joining the list" : "Get early access"}
      </Button>
    </form>
  );
}
