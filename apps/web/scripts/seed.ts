import { readFile } from "node:fs/promises";
import { hivePushInput } from "@hivemind/core";
import { z } from "zod";

const seedItemsSchema = z.array(hivePushInput.extend({
  repo: z.string().nullish().transform((repo) => repo ?? undefined),
  author: z.string().trim().min(1).max(80),
}));
const joinResponseSchema = z.object({ apiKey: z.string().min(1) });
const rpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.number(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
  result: z.object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  }).optional(),
});

class SeedInputError extends Error {}

export type SeedOptions = {
  file: string;
  url?: string;
  apiKey?: string;
  inviteCode?: string;
  as?: string;
  dryRun?: boolean;
  log?: (line: string) => void;
};

function parseRpcResponse(text: string, contentType: string, id: number): z.infer<typeof rpcResponseSchema> {
  const messages = contentType.includes("text/event-stream")
    ? text.split(/\r?\n\r?\n/).map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")).filter(Boolean)
    : [text];
  for (const message of messages) {
    const parsed = rpcResponseSchema.safeParse(JSON.parse(message));
    if (parsed.success && parsed.data.id === id) return parsed.data;
  }
  throw new Error("No matching JSON-RPC response.");
}

export async function runSeed(options: SeedOptions): Promise<{ pushed: number; failed: number }> {
  const parsed = seedItemsSchema.safeParse(JSON.parse(await readFile(options.file, "utf8")));
  if (!parsed.success) throw new SeedInputError(`Invalid seed data: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.code}`).join("; ")}`);
  const keys = new Map<string, string | null>();
  if (options.apiKey) keys.set(options.as ?? "Charlie", options.apiKey);
  const log = (line: string) => {
    let safe = line;
    for (const key of keys.values()) if (key) safe = safe.split(key).join("[redacted]");
    if (options.inviteCode) safe = safe.split(options.inviteCode).join("[redacted]");
    (options.log ?? console.log)(safe.replace(/[\r\n]+/g, " "));
  };
  if (options.dryRun) {
    for (const item of parsed.data) log(`${item.author}: ${item.title}`);
    return { pushed: 0, failed: 0 };
  }
  if (!options.url || !options.apiKey) throw new SeedInputError("Provide --url and --key or HIVEMIND_URL and HIVEMIND_KEY.");
  const baseUrl = new URL(options.url);
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new SeedInputError("Use an HTTP URL without credentials.");
  const endpoint = (path: string) => new URL(path, baseUrl);
  let pushed = 0;
  let failed = 0;
  for (const [index, item] of parsed.data.entries()) {
    const { author, ...input } = item;
    try {
      if (!keys.has(author)) {
        keys.set(author, null);
        if (!options.inviteCode) throw new Error("Provide --invite or HIVEMIND_INVITE to join additional authors.");
        const response = await fetch(endpoint("/api/app/join"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteCode: options.inviteCode, memberName: author }),
          signal: AbortSignal.timeout(30_000),
        });
        if (response.status !== 201) throw new Error(`Join failed (HTTP ${response.status}).`);
        const joined = joinResponseSchema.safeParse(await response.json());
        if (!joined.success) throw new Error("Invalid join response.");
        keys.set(author, joined.data.apiKey);
      }
      const key = keys.get(author);
      if (!key) throw new Error("The author could not join the team.");
      const id = index + 1;
      const response = await fetch(endpoint("/api/mcp"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-06-18",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "hive_push", arguments: input } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Push failed (HTTP ${response.status}).`);
      const rpc = parseRpcResponse(await response.text(), response.headers.get("content-type") ?? "application/json", id);
      if (rpc.error) throw new Error(`JSON-RPC ${rpc.error.code}: ${rpc.error.message}`);
      const firstText = rpc.result?.content.find((content) => content.type === "text" && typeof content.text === "string")?.text;
      if (rpc.result?.isError) throw new Error(firstText ?? "The hive rejected this learning.");
      if (!rpc.result || !firstText) throw new Error("The hive returned no text result.");
      log(`${author}: ${firstText} | ${item.title}`);
      pushed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      log(`${author}: FAILED ${message} | ${item.title}`);
      failed += 1;
    }
  }
  return { pushed, failed };
}

function cliOptions(args: string[]): SeedOptions {
  const options: SeedOptions = {
    file: "scripts/seed-data.json",
    url: process.env.HIVEMIND_URL,
    apiKey: process.env.HIVEMIND_KEY,
    inviteCode: process.env.HIVEMIND_INVITE,
    as: "Charlie",
  };
  const names = { "--url": "url", "--key": "apiKey", "--invite": "inviteCode", "--file": "file", "--as": "as" } as const;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--") continue;
    if (flag === "--dry-run") { options.dryRun = true; continue; }
    if (!(flag in names)) throw new SeedInputError("Unknown seed option.");
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new SeedInputError("A seed option is missing its value.");
    options[names[flag as keyof typeof names]] = value;
  }
  return options;
}

async function main(): Promise<void> {
  try {
    const result = await runSeed(cliOptions(process.argv.slice(2)));
    if (result.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof SeedInputError ? `Seed failed: ${error.message}` : "Seed failed. Check the options and seed file.");
    process.exitCode = 1;
  }
}

if (typeof require !== "undefined" && require.main === module) void main();
