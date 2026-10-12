import { earlyAccessInput } from "@hivemind/core";
import { submitEarlyAccess } from "@/server/hive";
import { httpError, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await submitEarlyAccess(earlyAccessInput.parse(await readJson(request)));
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return httpError(error);
  }
}
