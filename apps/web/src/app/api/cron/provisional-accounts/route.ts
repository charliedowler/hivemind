import { authorizedCron } from "../slack-digests/route";
import { expireProvisionalHumans } from "@/server/identity/expire-provisional";
export const runtime = "nodejs";
export async function GET(request: Request) {
  if (!authorizedCron(request)) return Response.json({ error: "Unauthorised." }, { status: 401 });
  return Response.json(await expireProvisionalHumans());
}
