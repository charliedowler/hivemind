import { sendEmailCode } from "@/server/identity/email-verification";
import { httpError, readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    return Response.json(
      await sendEmailCode(
        { ...(body as object), intent: "join" },
        request.headers.get("x-vercel-forwarded-for") ?? "unknown",
      ),
      { status: 202 },
    );
  } catch (error) {
    return httpError(error);
  }
}
