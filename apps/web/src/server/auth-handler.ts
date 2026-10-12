import { getAuth } from "./better-auth";
import { HiveError } from "./errors";
import { normalizeOAuthRegistration } from "./oauth-registration";
import { emailConfigured } from "./identity/email";

export async function authHandler(request: Request) {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && ["/sign-up/email", "/email-otp/send-verification-otp", "/email-otp/request-password-reset", "/send-verification-email"].some((endpoint) => path.endsWith(endpoint)) && !emailConfigured())
    return Response.json({ message: "Email verification is not configured yet. Try again later." }, { status: 503 });
  try { return await (await getAuth()).handler(await normalizeOAuthRegistration(request)); }
  catch (error) {
    return Response.json({ error: error instanceof HiveError ? error.message : "Sign-in is temporarily unavailable. Try again later." }, { status: error instanceof HiveError ? error.status : 503 });
  }
}
