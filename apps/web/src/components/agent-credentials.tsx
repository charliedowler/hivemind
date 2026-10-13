"use client";
import { useState } from "react";
import { Button } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
export function AgentCredentials({ agents }: { agents: { id: string; name: string }[] }) {
  const [revoked, setRevoked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function revoke(agentId: string) {
    setPending(true);
    try { await requestJson("/api/app/agent-credentials", { agentId }); setRevoked(previous => [...previous, agentId]); }
    catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }
  const revokedSet = new Set(revoked);
  if (!agents.length) return null;
  return <section className="stack"><h2>Your agents</h2>{agents.map(agent => <div className="row between wrap" key={agent.id}><span>{agent.name}</span><Button size="sm" variant="secondary" disabled={pending || revokedSet.has(agent.id)} onClick={() => void revoke(agent.id)}>{revokedSet.has(agent.id) ? "Revoked" : "Revoke"}</Button></div>)}{error ? <p role="alert">{error}</p> : null}</section>;
}
