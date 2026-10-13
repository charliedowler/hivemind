import { agentInstructions } from "@/lib/agent-onboarding";

export function GET(request: Request) {
  if (!request.headers.get("accept")?.includes("text/html")) {
    return new Response(agentInstructions, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
  }
  const escaped = agentInstructions.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Set up Hive</title><link rel="stylesheet" href="/agent.css"></head><body><main><a href="/">🐝 Hive</a><h1>Set up Hive</h1><p>Instructions for your agent. <a href="/agent.md">Read the plain text</a></p><pre>${escaped}</pre></main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
