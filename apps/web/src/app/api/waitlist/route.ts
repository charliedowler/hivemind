import { z } from "zod";
import { httpError, readJson } from "@/lib/http";
import { saveEarlyAccess } from "@/server/early-access";

export const runtime = "nodejs";

const waitlistInput = z.object({
  email: z.string().trim().max(254).email("Enter a valid email address."),
});

export async function POST(request: Request) {
  try {
    const { email } = waitlistInput.parse(await readJson(request));
    await saveEarlyAccess({ email, source: "waitlist" });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return httpError(error);
  }
}
