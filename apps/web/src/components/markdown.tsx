"use client";
import { CiteRef } from "@hivemind/design-system";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({
  text,
  onCitation,
  citations,
}: {
  text: string;
  onCitation?: (id: string) => void;
  citations?: { id: string }[];
}) {
  const numbers = new Map(
    citations?.map((citation, index) => [citation.id, index + 1]),
  );
  const content = onCitation
    ? text.replace(/\[(lrn_[a-z0-9]+)\](?!\()/g, "[$1](#hive-citation-$1)")
    : text;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
          a: ({ href, children }) => {
            if (onCitation && href?.startsWith("#hive-citation-")) {
              const id = href.slice(15);
              const n = numbers.get(id);
              if (n) return <CiteRef n={n} onClick={() => onCitation(id)} />;
              return (
                <button
                  type="button"
                  className="citation"
                  onClick={() => onCitation(href.slice(15))}
                >
                  {children}
                </button>
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
