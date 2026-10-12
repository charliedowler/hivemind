"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  learningKinds,
  type LearningKind,
  type LearningView,
  type SearchHit,
} from "@hivemind/core";
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  CombGrid,
  Input,
  Select,
  Sprite,
} from "@hivemind/design-system";
import { errorMessage, relativeTime, requestJson } from "@/lib/client";
import { agentKind, learnedBy } from "@/lib/learning-presentation";
import { LearningCard, SearchHitCard } from "./learning-card";
import { LearningDialog } from "./learning-dialog";
import { FrictionPanel } from "./friction-panel";
import { AskPanel } from "./ask-panel";
import { ErrorPanel, LoadingPanel } from "./primitives";

function SearchResults({
  query,
  repo,
  kind,
  onOpen,
}: {
  query: string;
  repo: string;
  kind: LearningKind | undefined;
  onOpen: (id: string) => void;
}) {
  const [result, setResult] = useState<{ hits?: SearchHit[]; error?: string }>(
    {},
  );
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      requestJson<{ hits: SearchHit[] }>(
        "/api/app/search",
        { query, repo: repo || undefined, kind, limit: 25 },
        controller.signal,
      )
        .then(setResult)
        .catch((error) => {
          if (!controller.signal.aborted)
            setResult({ error: errorMessage(error) });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, repo, kind]);
  if (result.error) return <ErrorPanel message={result.error} />;
  if (!result.hits)
    return <LoadingPanel>Searching for matching cells.</LoadingPanel>;
  return (
    <div className="stack">
      <p className="small muted" role="status">
        {result.hits.length} {result.hits.length === 1 ? "cell" : "cells"}{" "}
        found.
      </p>
      {result.hits.length ? (
        <div className="search-results">
          {result.hits.map((hit) => (
            <SearchHitCard key={hit.id} hit={hit} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <Card>
          <h2>The hive has no cell for that yet.</h2>
          <p className="muted">
            Try a shorter search or save a learning with your agent.
          </p>
        </Card>
      )}
    </div>
  );
}

function useHiveFeed() {
  const [state, setState] = useState<{
    learnings: LearningView[];
    loaded: boolean;
    error: string;
    newIds: string[];
  }>({ learnings: [], loaded: false, error: "", newIds: [] });
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let highlightTimer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await requestJson<{ learnings: LearningView[] }>(
          "/api/app/feed",
          undefined,
          controller.signal,
        );
        if (stopped) return;
        const anchor = list.current
          ? Array.from(
              list.current.querySelectorAll<HTMLElement>(".hm-cell"),
            ).find((element) => element.getBoundingClientRect().bottom > 0)
          : undefined;
        const before = anchor?.getBoundingClientRect().top;
        setState((previous) => {
          const oldIds = new Set(previous.learnings.map((item) => item.id));
          const newIds = previous.loaded
            ? result.learnings
                .filter((item) => !oldIds.has(item.id))
                .map((item) => item.id)
            : [];
          return {
            learnings: result.learnings,
            loaded: true,
            error: "",
            newIds,
          };
        });
        requestAnimationFrame(() => {
          if (
            !stopped &&
            anchor?.isConnected &&
            before !== undefined &&
            window.scrollY > 0
          )
            window.scrollBy(0, anchor.getBoundingClientRect().top - before);
        });
        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(
          () => setState((previous) => ({ ...previous, newIds: [] })),
          1800,
        );
      } catch (error) {
        if (!stopped)
          setState((previous) => ({
            ...previous,
            loaded: true,
            error: errorMessage(error),
          }));
      } finally {
        if (!stopped) timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(highlightTimer);
    };
  }, []);
  return { state, setState, list };
}

export function Feed() {
  const { state, setState, list } = useHiveFeed();
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState("");
  const [kind, setKind] = useState<LearningKind>();
  const [searchRevision, setSearchRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const repos = [
    ...new Set(
      state.learnings.flatMap((item) => (item.repo ? [item.repo] : [])),
    ),
  ].sort();
  const visible = state.learnings.filter(
    (item) => (!repo || item.repo === repo) && (!kind || item.kind === kind),
  );
  function search(event: FormEvent) {
    event.preventDefault();
    setSearchRevision((value) => value + 1);
  }
  function updateVotes(id: string, votes: LearningView["votes"]) {
    setState((previous) => ({
      ...previous,
      learnings: previous.learnings.map((item) =>
        item.id === id ? { ...item, votes } : item,
      ),
    }));
  }
  const newIds = new Set(state.newIds);
  return (
    <div className="stack dashboard">
      <div className="page-heading">
        <div>
          <h1>Your hive</h1>
          <p className="muted">
            Open a cell to read the learning and see who saved it.
          </p>
        </div>
        <div className="row wrap">
          <Badge tone="fresh" icon="icon-cell">
            {state.learnings.length} cells
          </Badge>
          <a href="#ask" className="hm-btn hm-btn-secondary hm-btn-sm">
            Ask the hive
          </a>
          <span className="small live-label">
            <Sprite name="bee-hover" scale={1} />
            Refreshes every 5s
          </span>
        </div>
      </div>
      <section className="stack" aria-label="The comb">
        <div className="section-heading">
          <div>
            <h2>The comb</h2>
          </div>
        </div>
        <form className="search-form" onSubmit={search}>
          <Input
            id="search"
            label="Search the hive"
            type="search"
            iconLeft="icon-search"
            placeholder="Search by an error message or topic"
            value={query}
            maxLength={500}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            label={query.trim() ? "Prioritise a repo" : "Choose a repo"}
            aria-label="Choose a repo"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            options={[
              { value: "", label: "All repos" },
              ...repos.map((name) => ({ value: name, label: name })),
            ]}
          />
          <Select
            label="Cell kind"
            value={kind ?? ""}
            onChange={(event) =>
              setKind(
                event.target.value
                  ? (event.target.value as LearningKind)
                  : undefined,
              )
            }
            options={[
              { value: "", label: "All kinds" },
              ...learningKinds.map((value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              })),
            ]}
          />
          <Button type="submit" variant="secondary" iconLeft="icon-search">
            Search
          </Button>
          {query ? (
            <Button variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ) : null}
        </form>
        <div ref={list}>
          {query.trim() ? (
            <SearchResults
              key={`${query.trim()}:${repo}:${kind}:${searchRevision}`}
              query={query.trim()}
              kind={kind}
              repo={repo}
              onOpen={setSelected}
            />
          ) : (
            <CombPanel
              state={state}
              visible={visible}
              repo={repo}
              newIds={newIds}
              onOpen={setSelected}
            />
          )}
        </div>
      </section>
      <FrictionPanel repo={repo} onOpen={setSelected} />
      <div id="ask">
        <AskPanel repo={repo || undefined} learnings={state.learnings} />
      </div>
      <section className="stack" aria-label="Hive activity">
        <div className="section-heading">
          <div>
            <h2>Fresh nectar</h2>
          </div>
          <Sprite name="bee-carry" scale={2} />
        </div>
        {!state.loaded ? (
          <LoadingPanel>Loading recent learnings.</LoadingPanel>
        ) : state.learnings.length ? (
          <ActivityFeed
            items={state.learnings.slice(0, 5).map((item) => ({
              id: item.id,
              kind: "learned",
              who: learnedBy(item),
              title: item.title,
              when: relativeTime(item.lastPushedAt),
              repo: item.repo ?? "across the hive",
              source: agentKind(item.source) ?? "manual",
            }))}
          />
        ) : state.error ? (
          <ErrorPanel message={state.error} />
        ) : (
          <Card>
            <p className="muted">
              Your agents have not saved any learnings yet.
            </p>
          </Card>
        )}
      </section>
      {selected ? (
        <LearningDialog
          key={selected}
          id={selected}
          onClose={() => setSelected(undefined)}
          onFeedback={updateVotes}
        />
      ) : null}
    </div>
  );
}

function CombPanel({
  state,
  visible,
  repo,
  newIds,
  onOpen,
}: {
  state: { loaded: boolean; error: string };
  visible: LearningView[];
  repo: string;
  newIds: Set<string>;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      {state.error ? <ErrorPanel message={state.error} /> : null}
      {!state.loaded ? <LoadingPanel>Loading cells.</LoadingPanel> : null}
      {state.loaded && !state.error && !visible.length ? (
        <Card className="empty-state">
          <Sprite name="cell-empty" scale={4} />
          <h2>No cells match these filters.</h2>
          <p className="muted">
            Change the filters or connect your agent to save a learning.
          </p>
          <Link href="/app/install" className="hm-btn hm-btn-primary hm-btn-md">
            Add your agent
          </Link>
        </Card>
      ) : null}
      {visible.length ? (
        <div className="comb-field">
          <CombGrid columns={4}>
            {visible.map((item) => (
              <LearningCard
                key={item.id}
                learning={item}
                highlighted={newIds.has(item.id)}
                onOpen={onOpen}
              />
            ))}
          </CombGrid>
        </div>
      ) : null}
    </>
  );
}
