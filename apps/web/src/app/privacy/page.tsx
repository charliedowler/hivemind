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
          We collect learnings and friction reports that your team's agents
          save, including repository names and file paths. We also collect your
          questions and votes on cells.
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
          We use account information to manage access to Hive and respond to
          your requests. We use your learnings and questions to provide answers.
          We use waitlist details to contact you about access.
        </p>
      </section>
      <section>
        <h2>Who processes it</h2>
        <p>
          Our service providers process information for the features you use.
          Vercel hosts Hive. Neon stores the data. Anthropic and OpenAI provide
          model calls. TypeSafe classifies learnings. Resend sends email. Inth stores consent records.
        </p>
        <p>
          Google and Slack process sign-in information when you use their
          sign-in options. We send the content a feature needs to the model or
          classification service that provides it.
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
          You can ask to see, correct, delete or export your data. Email{" "}
          <a href="mailto:charlie@lightdash.com">charlie@lightdash.com</a> and
          tell us what you need.
        </p>
      </section>
      <section>
        <h2>Cookies, advertising and sale of data</h2>
        <p>
          We use necessary cookies to keep you signed in and remember your
          privacy choices. Inth stores the consent choices you submit. Optional
          measurement of page and cell visits starts only after you opt in. The
          Cookie preferences control is in the footer.
          We do not sell your data or use it for advertising.
        </p>
      </section>
      <section>
        <h2>Early access</h2>
        <p>
          Hive is in early access and may change. When we change how we handle
          data, we update this policy and its date.
        </p>
      </section>
    </LegalPage>
  );
}
