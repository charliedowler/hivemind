import { authHandler } from "@/server/auth-handler";

export const runtime = "nodejs";
export { authHandler as GET, authHandler as HEAD };
