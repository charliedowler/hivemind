import { ZodError } from "zod";
import type { HiveContext } from "@hivemind/core";
import { getWebContext } from "@/server/auth";

export function httpError(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return Response.json({ error: "message" in error ? String(error.message) : "Request failed." }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong." }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw Object.assign(new Error("Send a valid JSON body."), { status: 400 }); }
}

export async function authenticated(action: (ctx: HiveContext) => Promise<Response>): Promise<Response> {
  try {
    const ctx = await getWebContext();
    if (!ctx) return Response.json({ error: "Sign in first." }, { status: 401 });
    return await action(ctx);
  } catch (error) { return httpError(error); }
}

export function identity(ctx: HiveContext) {
  return { team: { id: ctx.teamId, name: ctx.teamName }, member: { id: ctx.memberId, name: ctx.memberName } };
}
