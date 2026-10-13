"use client";
import { useState, type FormEvent } from "react";
import { Button, Input, Select } from "@hivemind/design-system";
import type { OwnerCapturePolicy } from "@hivemind/core";
import { requestJson, errorMessage } from "@/lib/client";
type Agent = { id: string; name: string };

export function ProjectDelegation({
  policy,
  agents,
}: {
  policy: OwnerCapturePolicy;
  agents: Agent[];
}) {
  const [agentId, setAgentId] = useState("");
  const [include, setInclude] = useState(() => policy.include.join(", "));
  const [exclude, setExclude] = useState(() => policy.exclude.join(", "));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    setError("");
    const patterns = (value: string) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    try {
      await requestJson("/api/app/project-selection/delegate", {
        agentId,
        selection: {
          include: patterns(include),
          exclude: patterns(exclude),
          revision: policy.revision,
        },
      });
      setMessage(
        `Allowed ${agents.find((agent) => agent.id === agentId)?.name} to save these projects once within 15 minutes.`,
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPending(false);
    }
  }
  if (!agents.length) return null;
  return (
    <details className="install-fallback">
      <summary>Let an agent update projects</summary>
      <form className="stack" onSubmit={(event) => void grant(event)}>
        <p>
          Allow one of your agents to save this exact project selection. The
          choice stays private; it does not share cells with a team.
        </p>
        <Select
          label="Agent"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
          options={[
            { value: "", label: "Choose an agent" },
            ...agents.map((agent) => ({ value: agent.id, label: agent.name })),
          ]}
          required
        />
        <Input
          label="Projects the agent may learn from"
          value={include}
          onChange={(event) => setInclude(event.target.value)}
          maxLength={25700}
        />
        <Input
          label="Projects to exclude"
          value={exclude}
          onChange={(event) => setExclude(event.target.value)}
          maxLength={25700}
        />
        <p className="small muted">
          Use comma-separated projects. Permission expires in 15 minutes and can
          be used once.
        </p>
        <Button type="submit" disabled={!agentId} loading={pending}>
          Allow this selection
        </Button>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </details>
  );
}
