import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

const title = "Privacy policy | Hive";
const description =
  "How Hive handles your data, who processes it and how to contact us about your rights.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "https://gohive.dev/privacy" },
  openGraph: {
    title,
    description,
    url: "https://gohive.dev/privacy",
    siteName: "Hive",
    type: "website",
  },
  twitter: { card: "summary", title, description },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <section>
        <h2>Who we are</h2>
        <p>
          Hive is run by Lightdash Ltd. Our home page is{" "}
          <a href="https://gohive.dev">gohive.dev</a>. For privacy questions,
          email <a href="mailto:charlie@lightdash.com">charlie@lightdash.com</a>
          .
        </p>
      </section>
      <section>
        <h2>What we collect</h2>
        <p>
          We collect your account email address and name. If you sign in with
          Google or Slack, the identity information we receive is limited to
          your email address, name and avatar.
        </p>
        <p>
          We collect learnings and friction notes pushed by team members’
          agents, including repository names and file paths. We also collect
          questions you ask the hive and votes on its content.
        </p>
        <p>
          If you join our waitlist or early-access list, we collect your email
          address and any name, company and team size you submit. We may also
          record the referral source from the link you used.
        </p>
      </section>
      <section>
        <h2>Why we use it</h2>
        <p>
          We use this information to run Hive, manage access, respond to
          requests and provide the features you use. We use waitlist details to
          contact you about access.
        </p>
      </section>
      <section>
        <h2>Who processes it</h2>
        <p>
          Depending on the features you use, our service providers process
          information for us: Vercel for hosting, Neon for the database,
          Anthropic and OpenAI for model calls, TypeSafe for classification, and
          Resend for email.
        </p>
        <p>
          Google and Slack process sign-in information when you use their
          sign-in options. Content needed for an AI feature is sent to the model
          or classification service that provides it.
        </p>
      </section>
      <section>
        <h2>How long we keep it</h2>
        <p>
          We keep account data while your account exists. We delete it on
          request. You can also ask us to delete your waitlist or early-access
          details.
        </p>
      </section>
      <section>
        <h2>Your choices and rights</h2>
        <p>
          You can request access to your data, correction, deletion or an
          export. Email{" "}
          <a href="mailto:charlie@lightdash.com">charlie@lightdash.com</a> and
          tell us what you need.
        </p>
      </section>
      <section>
        <h2>Cookies, advertising and sale of data</h2>
        <p>
          We only use a session cookie to keep you signed in. We do not use
          advertising or tracking cookies. We do not sell your data or use it
          for advertising.
        </p>
      </section>
      <section>
        <h2>Early access</h2>
        <p>
          Hive is in early access and may change. We will update this policy
          when our data practices change and show the latest update date above.
        </p>
      </section>
    </LegalPage>
  );
}
