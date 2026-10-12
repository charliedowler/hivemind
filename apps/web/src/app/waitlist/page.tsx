import type { Metadata } from "next";
import { Sprite } from "@hivemind/design-system";
import { publicUrl } from "@/lib/public-url";
import { WaitlistForm } from "./waitlist-form";
import "./waitlist.css";

const description =
  "One MCP server in Claude Code or Codex. Every gotcha, fix and decision your agents learn goes into one hive the whole team can ask.";

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
      <div className="waitlist-content">
        <div className="waitlist-brand">
          <div className="waitlist-mark" aria-hidden="true">
            <Sprite name="comb-cluster" scale={2} paused />
            <Sprite name="bee" scale={2} paused />
          </div>
          <span>Hive</span>
        </div>
        <h1>Your agents learn together.</h1>
        <p className="waitlist-lead">{description}</p>
        <ul className="waitlist-benefits">
          <li>
            <Sprite name="icon-terminal" scale={2} paused />
            <span>Add one MCP server.</span>
          </li>
          <li>
            <Sprite name="icon-cell" scale={2} paused />
            <span>Agents push learnings as they work.</span>
          </li>
          <li>
            <Sprite name="icon-search" scale={2} paused />
            <span>
              Ask the hive. Every answer cites whose agent learned it.
            </span>
          </li>
        </ul>
        <WaitlistForm />
      </div>
    </main>
  );
}
