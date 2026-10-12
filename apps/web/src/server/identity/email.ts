export function emailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim(),
  );
}
export async function deliverCode(
  email: string,
  code: string,
  id: string,
): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `hive-email-verification/${id}`,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email],
        subject: "Your Hive code",
        text: `Your Hive code is ${code}.\n\nIt expires in 15 minutes.`,
      }),
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({ event: "email_delivery", status: response.status }),
      );
      return false;
    }
    const body = await response.json();
    return typeof body.id === "string" && Boolean(body.id);
  } catch {
    return false;
  }
}
