export async function POST() {
  return Response.json({ error: "Join with a verified email account at /app/login." }, { status: 410 });
}
