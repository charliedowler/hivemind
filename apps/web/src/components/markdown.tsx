"use client";
import { CellCitation } from "./cell-citation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({
  text,
  onCitation,
  citations,
}: {
  text: string;
  onCitation?: (id: string) => void;
  citations?: { id: string; title?: string; permalink?: string }[];
}) {
  const titles = new Map(
    citations?.map((citation) => [citation.id, citation.title]),
  );
  const links = new Map(
    citations?.filter((c) => c.permalink).map((c) => [c.id, c.permalink!]),
  );
  const content = text.replace(
    /\[((?:lrn|slk)_[a-z0-9]+)\](?!\()/g,
    "[$1](#hive-citation-$1)",
  );
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          a: ({ href, children }) => {
            if (href?.startsWith("#hive-citation-")) {
              const id = href.slice(15);
              if (links.has(id))
                return (
                  <a
                    className="cell-citation"
                    href={links.get(id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    From Slack: {titles.get(id) ?? "message"}
                  </a>
                );
              return (
                <CellCitation
                  id={id}
                  title={titles.get(id)}
                  onOpen={onCitation}
                />
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
