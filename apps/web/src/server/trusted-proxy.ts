import { isIP } from "node:net";

export function trustedProxyIp(request: Request): string | null {
  if (process.env.VERCEL !== "1") return null;
  const value = request.headers.get("x-vercel-forwarded-for")?.trim();
  return value && isIP(value) ? value : null;
}
