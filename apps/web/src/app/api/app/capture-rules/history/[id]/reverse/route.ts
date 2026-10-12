import { z } from "zod";
import { authenticated, readJson } from "@/lib/http";
import { reverseCaptureRuleApplication } from "@/server/capture-rules";

const input = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Enter a reason for reversing this application.")
    .max(1000, "Keep the reason to 1000 characters or fewer."),
  confirmed: z.literal(true, {
    error: "Confirm the reversal before applying it.",
  }),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return authenticated(async (ctx) => {
    const { reason } = input.parse(await readJson(request));
    return Response.json(
      await reverseCaptureRuleApplication(ctx, (await params).id, reason),
    );
  });
}
