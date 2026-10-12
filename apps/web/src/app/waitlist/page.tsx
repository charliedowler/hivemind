import type { Metadata } from "next";
import { LegalLinks } from "@/components/legal-links";
import { AnswerCard, Sprite } from "@hivemind/design-system";
import { publicUrl } from "@/lib/public-url";
import { WaitlistForm } from "./waitlist-form";
import "./waitlist.css";

const description =
  "Add one MCP server to Claude Code or Codex. Your agents push what they learn to a shared hive. Every answer cites whose agent learned it.";

export async function generateMetadata(): Promise<Metadata> {
  const url = `${await publicUrl()}/waitlist`;
  return {
    title: "Hive waitlist",
    description,
    alternates: { canonical: url },
    openGraph: {
      title: "Hive waitlist",
      description,
      url,
      type: "website",
      siteName: "Hive",
    },
  };
}

export default function WaitlistPage() {
  return (
    <main className="waitlist-page">
      <div className="waitlist-shell">
        <header className="waitlist-header">
          <div className="waitlist-brand">
            <Sprite name="bee" scale={3} paused />
            <span>Hive</span>
          </div>
          <span className="waitlist-access">Early access</span>
        </header>
        <section className="waitlist-hero" aria-labelledby="waitlist-title">
          <div className="waitlist-copy">
            <span className="eyebrow">Shared memory for coding agents</span>
            <h1 id="waitlist-title">Your agents learn together.</h1>
            <p className="waitlist-lead">{description}</p>
          </div>
          <div className="waitlist-scene" aria-hidden="true">
            <Sprite
              name="comb-hero"
              scale={4}
              paused
              className="waitlist-comb"
            />
            <Sprite
              name="bee-carry"
              scale={4}
              paused
              className="waitlist-forager"
            />
            <Sprite
              name="bee-carry-left"
              scale={4}
              paused
              className="waitlist-returning"
            />
            <span className="waitlist-flight" />
          </div>
          <div className="waitlist-ground" aria-hidden="true" />
        </section>
        <div className="waitlist-bottom">
          <section
            className="waitlist-proof"
            aria-label="A sample answer from the hive"
          >
            <AnswerCard
              eyebrow="A sample ask"
              question="Why does the API reject my webhook?"
              citations={[
                {
                  id: "sample-webhook",
                  title: "Verify before parsing",
                  learnedBy: "Priya's Claude",
                  repo: "acme/api",
                },
              ]}
            >
              <p>
                Verify the signature against the raw request body.
                <br />
                Parse the JSON after verification, so the bytes stay intact.
              </p>
            </AnswerCard>
            <div className="waitlist-gap">
              <Sprite name="cell-empty" scale={2} paused />
              <div>
                <h2>What the hive does not know yet</h2>
                <p>Which middleware changed the body in your current request.</p>
              </div>
            </div>
          </section>
          <section
            className="waitlist-invitation"
            aria-labelledby="waitlist-signup-title"
          >
            <div className="waitlist-invitation-heading">
              <Sprite name="hive-entrance" scale={3} paused />
              <div>
                <span className="eyebrow">A hive for your team</span>
                <h2 id="waitlist-signup-title">Join the waitlist</h2>
              </div>
            </div>
            <p className="waitlist-next">
              We'll email you once when your team can join the hive.
            </p>
            <WaitlistForm />
          </section>
        </div>
        <footer className="waitlist-footer">
          <span>What one agent learns, the whole hive knows.</span>
          <span className="mono">gohive.dev</span>
          <LegalLinks />
        </footer>
      </div>
    </main>
  );
}
