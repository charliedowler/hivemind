import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { POST } from "../api/waitlist/route";
import { POST as earlyAccessPost } from "../api/early-access/route";
import { getSql } from "@/server/db/client";
import WaitlistPage, { generateMetadata } from "./page";

vi.mock("@/lib/public-url", () => ({
  publicUrl: async () => "https://gohive.dev",
}));

function request(body: unknown) {
  return new Request("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("waitlist page", () => {
  it("renders the pitch with only a required email field and no app navigation", () => {
    const html = renderToStaticMarkup(<WaitlistPage />);
    expect(html).toContain("Your agents learn together.");
    expect(html).toContain("Every answer cites whose agent learned it.");
    expect(html.match(/<input\b/g)).toHaveLength(1);
    expect(html).toContain('type="email"');
    expect(html).toContain('required=""');
    expect(html).toContain("Join the waitlist");
    expect(html).not.toContain("<nav");
  });

  it("publishes the canonical waitlist URL and Open Graph metadata", async () => {
    expect(await generateMetadata()).toMatchObject({
      title: "Hivemind waitlist",
      alternates: { canonical: "https://gohive.dev/waitlist" },
      openGraph: {
        title: "Hivemind waitlist",
        url: "https://gohive.dev/waitlist",
      },
    });
  });

  it.each([
    {},
    { email: "not-an-email" },
    { email: "" },
    { email: 123 },
    { email: `${"a".repeat(250)}@example.com` },
  ])("rejects invalid input %j before accessing the database", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/waitlist", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe.skipIf(!process.env.DATABASE_URL)(
  "waitlist route database integration",
  () => {
    const email = `waitlist-${randomUUID()}@example.com`;
    const landingEmail = `landing-${randomUUID()}@example.com`;

    afterAll(async () => {
      await getSql()`DELETE FROM early_access WHERE email IN (${email}, ${landingEmail})`;
      await getSql().end();
    });

    it("stores an email-only signup and dedupes concurrent normalized submissions", async () => {
      const responses = await Promise.all([
        POST(request({ email })),
        POST(
          request({ email: `  ${email.toUpperCase()}  `, source: "untrusted" }),
        ),
        POST(request({ email })),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(201);
        expect(await response.json()).toEqual({ ok: true });
      }
      const rows =
        await getSql()`SELECT * FROM early_access WHERE email = ${email}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        email,
        name: null,
        company: null,
        team_size: null,
        source: "waitlist",
      });
    });

    it("keeps the landing form working and preserves an existing signup on repeat", async () => {
      const landing = await earlyAccessPost(
        request({
          name: "Test forager",
          email: landingEmail,
          company: "Test hive",
          teamSize: "1-5",
        }),
      );
      expect(landing.status).toBe(201);
      expect(
        (await POST(request({ email: landingEmail.toUpperCase() }))).status,
      ).toBe(201);
      const rows =
        await getSql()`SELECT * FROM early_access WHERE email = ${landingEmail}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        name: "Test forager",
        company: "Test hive",
        team_size: "1-5",
        source: "landing",
      });
    });
  },
);
