export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    service: "hivemind",
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
    time: new Date().toISOString(),
  });
}
