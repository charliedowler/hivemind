import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { account } from "@/server/identity/access";
import { getSql } from "@/server/db/client";
export async function GET() {
  return authenticated(async (ctx) => Response.json(await account(ctx)));
}
export async function PATCH(request: Request) {
  return authenticated(async (ctx) => {
    const { name } = z
      .object({
        name: z
          .string()
          .trim()
          .min(1, "Enter your name.")
          .max(80, "Keep your name to 80 characters or fewer."),
      })
      .parse(await readJson(request));
    await getSql()`UPDATE members SET name = ${name} WHERE id = ${ctx.memberId} AND team_id = ${ctx.teamId} AND removed_at IS NULL`;
    return Response.json({ ok: true });
  });
}
