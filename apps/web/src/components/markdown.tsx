"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({
  text,
  onCitation,
}: {
  text: string;
  onCitation?: (id: string) => void;
}) {
  const content = onCitation
    ? text.replace(/\[(lrn_[a-z0-9]+)\](?!\()/g, "[$1](#hive-citation-$1)")
    : text;
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (onCitation && href?.startsWith("#hive-citation-"))
              return (
                <button
                  className="citation"
                  onClick={() => onCitation(href.slice(15))}
                >
                  {children}
                </button>
              );
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
