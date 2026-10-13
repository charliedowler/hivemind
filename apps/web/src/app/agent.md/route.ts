import { agentInstructions } from "@/lib/agent-onboarding";
export function GET() {
  return new Response(agentInstructions, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
