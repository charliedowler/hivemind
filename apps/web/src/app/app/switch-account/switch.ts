"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/better-auth";
import { endWebSession } from "@/server/auth";

export async function switchAccount() {
  await endWebSession();
  await (await getAuth()).api.signOut({ headers: await headers() });
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.delete("better-auth.session_token");
  jar.delete("__Secure-better-auth.session_token");
  redirect("/app/login");
}
