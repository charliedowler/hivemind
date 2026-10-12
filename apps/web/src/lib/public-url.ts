import "server-only";
import { headers } from "next/headers";

export async function publicUrl(): Promise<string> {
  if (process.env.PUBLIC_URL)
    return process.env.PUBLIC_URL.replace(/\/+$/, "");
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${host}`;
}
