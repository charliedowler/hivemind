import { authenticated } from "@/lib/http";
import { learningVersions } from "@/server/lifecycle";
import {feedbackHistory} from "@/server/feedback";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return authenticated(async ctx => {
    const {id} = await params;
    const [versions, feedback] = await Promise.all([learningVersions(ctx, id), feedbackHistory(ctx, id)]);
    return Response.json({versions, feedback});
  });
}
