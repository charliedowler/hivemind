"use client";

import type { LearningView, SearchHit } from "@hivemind/core";
import {
  Badge,
  Card,
  LearningCell,
  MemberBee,
  Sprite,
  Tag,
} from "@hivemind/design-system";
import { relativeTime } from "@/lib/client";
import {
  agentKind,
  learnedBy,
  learningStatus,
} from "@/lib/learning-presentation";

export function LearningCard({
  learning,
  highlighted = false,
  onOpen,
}: {
  learning: LearningView;
  highlighted?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <LearningCell
      title={learning.title}
      repo={learning.repo ?? "Across the hive"}
      learnedBy={learnedBy(learning)}
      when={relativeTime(learning.lastPushedAt)}
      votes={learning.votes.up}
      status={learningStatus(learning)}
      filling={highlighted}
      onClick={() => onOpen(learning.id)}
      footer={
        <>
          {learning.lifecycle === "superseded" ||
          learning.lifecycle === "retracted" ? (
            <span>{learning.lifecycle}</span>
          ) : null}
          {learning.verifyBeforeUse ? <span>Verify before use</span> : null}
          {learning.kind === "friction" || learning.kind === "insight" ? (
            <span className={`kind-mark kind-mark-${learning.kind}`}>
              <Sprite
                name={
                  learning.kind === "friction" ? "cell-outdated" : "cell-asked"
                }
                scale={1}
              />
              {learning.kind}
            </span>
          ) : null}
          <Sprite name="thumb" scale={1} />
          {learning.votes.up}
          {learning.pushCount > 1 ? (
            <span>seen {learning.pushCount} times</span>
          ) : null}
        </>
      }
    />
  );
}

export function SearchHitCard({
  hit,
  onOpen,
}: {
  hit: SearchHit;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="search-hit" id={hit.id}>
      <div className="row between wrap">
        <Badge tone={learningStatus(hit)}>
          {hit.lifecycle ?? learningStatus(hit)}
        </Badge>
        {hit.verifyBeforeUse ? (
          <span className="small">Verify before use</span>
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
        <span className="small muted">
          {relativeTime(hit.lastPushedAt)}
          {hit.pushCount > 1 ? ` · seen ${hit.pushCount} times` : ""}
        </span>
      </div>
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
