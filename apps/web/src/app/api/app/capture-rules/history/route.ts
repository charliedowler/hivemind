import { authenticated } from "@/lib/http";
import { listCaptureRuleApplications } from "@/server/capture-rules";

export async function GET() {
  return authenticated(async (ctx) =>
    Response.json(
      { applications: await listCaptureRuleApplications(ctx) },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    ),
  );
}
