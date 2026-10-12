import type { ReactNode } from "react";
import { cx } from "../cx";
import { Sprite } from "../sprites/Sprite";

export interface Citation {
  id: string;
  title: string;
  learnedBy: string;
  repo?: string;
  href?: string;
  outdated?: boolean;
  onClick?: () => void;
}

export interface AnswerCardProps {
  question: string;
  citations: Citation[];
  eyebrow?: string;
  children?: ReactNode;
  className?: string;
}

export function CiteRef({
  n,
  href,
  onClick,
}: {
  n: number;
  href?: string;
  onClick?: () => void;
}) {
  return onClick ? (
    <button
      type="button"
      className="hm-cite-ref"
      aria-label={`Cited cell ${n}`}
      onClick={onClick}
    >
      {n}
    </button>
  ) : href ? (
    <a className="hm-cite-ref" href={href} aria-label={`Cited cell ${n}`}>
      {n}
    </a>
  ) : (
    <span className="hm-cite-ref">{n}</span>
  );
}

export function CitationChip({
  n,
  citation,
}: {
  n: number;
  citation: Citation;
}) {
  const content = (
    <>
      <span className="hm-cite-n">{n}</span>
      <Sprite
        name={citation.outdated ? "cell-outdated" : "cell-full"}
        scale={1}
      />
      <span className="hm-cite-text">
        <span className="hm-cite-title">{citation.title}</span>
        <span className="hm-cite-who">
          {citation.repo
            ? `${citation.learnedBy} · ${citation.repo}`
            : citation.learnedBy}
        </span>
      </span>
    </>
  );

  return citation.onClick ? (
    <button type="button" className="hm-cite" onClick={citation.onClick}>
      {content}
    </button>
  ) : citation.href ? (
    <a className="hm-cite" href={citation.href}>
      {content}
    </a>
  ) : (
    <span className="hm-cite">{content}</span>
  );
}

export function AnswerCard({
  question,
  citations,
  eyebrow = "The hive knows",
  children,
  className,
}: AnswerCardProps) {
  return (
    <article className={cx("hm-answer", className)}>
      <header className="hm-answer-head">
        <Sprite name="jar" scale={4} />
        <div>
          <div className="eyebrow hm-answer-eyebrow">{eyebrow}</div>
          <h3 className="hm-answer-question">{question}</h3>
        </div>
      </header>
      <div className="hm-answer-body">{children}</div>
      {citations.length > 0 && (
        <footer className="hm-answer-cites">
          <div className="eyebrow hm-answer-cites-label">Cited cells</div>
          <div className="hm-cite-list">
            {citations.map((citation, index) => (
              <CitationChip
                key={citation.id}
                n={index + 1}
                citation={citation}
              />
            ))}
          </div>
        </footer>
      )}
    </article>
  );
}
