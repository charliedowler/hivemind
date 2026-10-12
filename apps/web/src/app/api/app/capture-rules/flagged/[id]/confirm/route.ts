import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { confirmFlaggedCapture } from "@/server/capture-rules";

const input = z.object({
  confirmed: z.literal(true, {
    error: "Confirm that this cell is safe for the team to read.",
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return authenticated(async (ctx) => {
    input.parse(await readJson(request));
    return Response.json(await confirmFlaggedCapture(ctx, (await params).id));
  });
}
