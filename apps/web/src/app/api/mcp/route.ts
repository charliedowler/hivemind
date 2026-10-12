import { createMcpHandler } from "mcp-handler";
import { registerHiveTools } from "@/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(registerHiveTools, {
  serverInfo: { name: "hivemind", version: "0.1.0" },
});

export { handler as GET, handler as POST, handler as DELETE };
