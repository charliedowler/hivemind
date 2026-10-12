import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

const title = "Terms of service | Hive";
const description =
  "Terms for using Hive, an early-access service from Lightdash Ltd.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "https://gohive.dev/terms" },
  openGraph: {
    title,
    description,
    url: "https://gohive.dev/terms",
    siteName: "Hive",
    type: "website",
  },
  twitter: { card: "summary", title, description },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <section>
        <h2>Using the service</h2>
        <p>
          These terms apply when you use Hive, a service run by Lightdash Ltd at{" "}
          <a href="https://gohive.dev">gohive.dev</a>. By using the service, you
          agree to these terms.
        </p>
      </section>
      <section>
        <h2>Early access</h2>
        <p>
          Hive is in early access. We provide it as is, and it may change or
          become unavailable. We do not promise that it will be uninterrupted or
          error-free. Check important results before relying on them.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Use the service lawfully. Do not misuse it, try to access accounts or
          data without permission, disrupt it, or share content that infringes
          someone else’s rights. Keep your account credentials and access keys
          secure.
        </p>
      </section>
      <section>
        <h2>Your content</h2>
        <p>
          Your content stays yours. You grant Lightdash Ltd a licence to store,
          process and share it as needed to run the service for you and your
          team, including through our service providers. Our{" "}
          <Link href="/privacy">privacy policy</Link> explains how we handle personal
          data.
        </p>
      </section>
      <section>
        <h2>What belongs in a hive</h2>
        <p>
          Do not push secrets or personal data into a hive. Review what your
          agent shares. Automated checks can miss sensitive information.
        </p>
        <p>
          Team admins can remove members and content. Only share content you
          have permission to share with your team.
        </p>
      </section>
      <section>
        <h2>Ending access</h2>
        <p>
          You can stop using the service at any time and ask us to delete your
          account. We may suspend or end access if you misuse the service or if
          we stop providing it. Contact us about deletion or an export.
        </p>
      </section>
      <section>
        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of England and Wales. Nothing in
          these terms removes rights that the law does not allow us to exclude.
        </p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>
          For questions about these terms or the service, email{" "}
          <a href="mailto:charlie@lightdash.com">charlie@lightdash.com</a>.
        </p>
      </section>
    </LegalPage>
  );
}
