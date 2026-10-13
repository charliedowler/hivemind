export async function POST() {
  return Response.json({ error: "Create your team with a verified email account at /app/login." }, { status: 410 });
}
