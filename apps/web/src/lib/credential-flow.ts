"use client";

import { authClient } from "./auth-client";
import { hiveRegistration } from "./hive-registration";
import { errorMessage } from "./client";

export type LoginMode = "sign-in" | "create" | "join";
export type AuthFormState = { stage: "credentials" | "verify" | "reset"; error: string; notice: string };
export const initialAuthFormState: AuthFormState = { stage: "credentials", error: "", notice: "" };

export async function submitCredentials(mode: LoginMode, previous: AuthFormState, form: FormData, credentials: { email: string; password: string }, navigate: () => void): Promise<AuthFormState> {
    try {
      const action = String(form.get("action") || "submit");
      if (action === "back") return initialAuthFormState;
      const email = String(form.get("email") || credentials.email).trim().toLowerCase();
      const password = String(form.get("password") || credentials.password);
      if (action === "reset") {
        const result = await authClient.emailOtp.requestPasswordReset({ email });
        if (result.error) throw new Error(result.error.message);
        Object.assign(credentials, { email, password: "" });
        return { stage: "reset", error: "", notice: "If this email has an account, its code is on the way." };
      }
      if (action === "resend") {
        const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
        if (result.error) throw new Error(result.error.message);
        return { ...previous, error: "", notice: "A new email code is on the way." };
      }
      const otp = String(form.get("code") || "");
      if (previous.stage === "reset") {
        const result = await authClient.emailOtp.resetPassword({ email, otp, password });
        if (result.error) throw new Error(result.error.message);
        Object.assign(credentials, { email, password });
      } else if (previous.stage === "verify") {
        const result = await authClient.emailOtp.verifyEmail({ email, otp });
        if (result.error) throw new Error(result.error.message);
      } else if (mode !== "sign-in") {
        const registration = hiveRegistration.parse(mode === "create" ? { intent: "create", teamName: form.get("teamName") } : form.get("inviteCode") ? { intent: "invite", inviteCode: form.get("inviteCode") } : { intent: "domain" });
        Object.assign(credentials, { email, password });
        const result = await authClient.signUp.email({ email, password, name: String(form.get("name") || ""), callbackURL: "/app/join", hiveRegistration: JSON.stringify(registration) } as Parameters<typeof authClient.signUp.email>[0]);
        if (result.error) throw new Error(result.error.message);
        return { stage: "verify", error: "", notice: "Enter the code sent to your email. It expires in 15 minutes." };
      }
      Object.assign(credentials, { email, password });
      const result = await authClient.signIn.email({ ...credentials, callbackURL: "/app/join" });
      if (result.error) {
        if (result.error.code === "EMAIL_NOT_VERIFIED") return { stage: "verify", error: "", notice: "Verify your email with the code we sent." };
        throw new Error(result.error.message);
      }
      credentials.password = "";
      const data = result.data as { url?: string } | null;
      if (data?.url) window.location.assign(data.url);
      else { navigate(); }
      return initialAuthFormState;
    } catch (error) { return { ...previous, error: errorMessage(error) }; }
}
