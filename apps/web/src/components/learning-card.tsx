"use client";

import type { LearningStanding, LearningView, SearchHit } from "@hivemind/core";
import { Badge, Card, MemberBee, Sprite, Tag } from "@hivemind/design-system";
import { relativeTime } from "@/lib/client";
import {
  agentKind,
  learnedBy,
  learningStatus,
  kindLabel,
  cellStateLabel,
} from "@/lib/learning-presentation";

export function LearningCard({
  learning,
  highlighted = false,
  includeHistory = false,
  onOpen,
}: {
  learning: LearningStanding;
  highlighted?: boolean;
  includeHistory?: boolean;
  onOpen: (id: string) => void;
}) {
  if (!includeHistory && learning.lifecycle === "retracted") return null;
  const status = learningStatus(learning);
  return (
    <button
      type="button"
      className={`hm-cell hm-cell-${status}`}
      aria-label={learning.title}
      onClick={() => onOpen(learning.id)}
    >
      <div className="hm-cell-edge">
        <div className="hm-cell-wall">
          <div className="hm-cell-face">
            <div className="hm-cell-status">
              <Sprite
                name={
                  highlighted
                    ? "cell-filling"
                    : status === "confirmed"
                      ? "cell-sealed"
                      : status === "outdated"
                        ? "cell-outdated"
                        : "cell-half"
                }
                scale={2}
              />
              <span>{kindLabel(learning.kind)}</span>
            </div>
            <div className="hm-cell-main">
              <h3 className="hm-cell-title">{learning.title}</h3>
              <span className="hm-cell-repo">
                {learning.repo ?? "Across the hive"}
              </span>
            </div>
            <div className="hm-cell-meta">
              {learnedBy(learning)}
              <time>{relativeTime(learning.lastPushedAt)}</time>
            </div>
            <div className="hm-cell-votes">
              <LifecycleBadge learning={learning} />
              {learning.unhelpfulLabel ? (
                <span className="small">{learning.unhelpfulLabel}</span>
              ) : null}
              <Sprite name="thumb" scale={1} title="Useful votes" />
              {learning.votes.up}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function LifecycleBadge({ learning }: { learning: LearningView }) {
  const status = learningStatus(learning);
  const label = cellStateLabel(learning);
  return label ? <Badge tone={status}>{label}</Badge> : null;
}

export function SearchHitCard({
  hit,
  onOpen,
  includeHistory = false,
}: {
  hit: SearchHit & LearningStanding;
  includeHistory?: boolean;
  onOpen: (id: string) => void;
}) {
  if (!includeHistory && hit.lifecycle === "retracted") return null;
  return (
    <Card className="search-hit" id={hit.id}>
      <div className="row between wrap">
        <span className="small">{kindLabel(hit.kind)}</span>
        <LifecycleBadge learning={hit} />
        {hit.unhelpfulLabel ? (
          <span className="small">{hit.unhelpfulLabel}</span>
        ) : null}
        {hit.verifyBeforeUse ? (
          <span className="small">Check this is still true</span>
        ) : null}
        <span className="score">Score {hit.score.toFixed(2)}</span>
      </div>
      <button className="cell-title-link" onClick={() => onOpen(hit.id)}>
        <h3>{hit.title}</h3>
      </button>
      <div className="row wrap">
        <MemberBee
          name={learnedBy(hit)}
          agent={agentKind(hit.source)}
          size="sm"
        />
        <code className="repo">{hit.repo ?? "Across the hive"}</code>
        <span className="small muted">{relativeTime(hit.lastPushedAt)}</span>
      </div>
      {hit.permalink ? (
        <a href={hit.permalink} target="_blank" rel="noreferrer">
          From Slack{hit.slackChannel ? ` in #${hit.slackChannel}` : ""}
        </a>
      ) : null}
      <div className="tags">
        {hit.tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </div>
      <dl className="signals">
        <div>
          <dt>Vector</dt>
          <dd>{hit.signals.vector?.toFixed(2) ?? "n/a"}</dd>
        </div>
        <div>
          <dt>Text</dt>
          <dd>{hit.signals.fts.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Recency</dt>
          <dd>{hit.signals.recency.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Votes</dt>
          <dd>{hit.signals.votes.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Repo</dt>
          <dd>{hit.signals.repoMatch ? "match" : "no match"}</dd>
        </div>
      </dl>
    </Card>
  );
}
