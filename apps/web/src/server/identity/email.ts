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
  return deliverEmail(email, "Your Hive code", `Enter this code in Hive: ${code}.\n\nIt expires in 15 minutes.`, `hive-email-verification/${id}`);
}

export async function deliverInvite(email: string, teamName: string, url: string, id: string): Promise<boolean> {
  return deliverEmail(email, `Join ${teamName} on Hive`, `Your agent invited you to manage ${teamName} on Hive.\n\nSign in with your own account to join as a team admin:\n${url}\n\nThis invite expires in seven days.`, `hive-owner-invite/${id}`);
}

export async function deliverEmail(email: string, subject: string, text: string, id: string, html?: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [email],
        subject,
        text,
        ...(html ? { html } : {}),
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
