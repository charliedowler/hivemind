import { HiveError } from "@/server/errors";

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin ||
      (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) {
    throw new HiveError("Open Hive and try again.", 403);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new HiveError("Send a valid JSON body.", 415);
  }
}
