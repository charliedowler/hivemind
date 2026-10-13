"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { type LearningView, type SearchHit } from "@hivemind/core";
import {
  Badge,
  Button,
  Card,
  CombGrid as CellGrid,
  Input,
  Select,
  Sprite,
} from "@hivemind/design-system";
import { errorMessage, requestJson } from "@/lib/client";
import { LearningCard, SearchHitCard } from "./learning-card";
import { LearningDialog } from "./learning-dialog";
import { ErrorPanel, LoadingPanel } from "./primitives";

function SearchResults({
  query,
  repo,
  onOpen,
}: {
  query: string;
  repo: string;
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
        { query, repo: repo || undefined, limit: 25 },
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
  }, [query, repo]);
  if (result.error) return <ErrorPanel message={result.error} />;
  if (!result.hits)
    return <LoadingPanel>Searching for matching cells.</LoadingPanel>;
  const hits = result.hits.filter((hit) => hit.lifecycle !== "retracted");
  return (
    <div className="stack">
      <p className="small muted" role="status">
        {hits.length} {hits.length === 1 ? "cell" : "cells"} found.
      </p>
      {hits.length ? (
        <div className="search-results">
          {hits.map((hit) => (
            <SearchHitCard key={hit.id} hit={hit} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <Card>
          <p className="muted">No cells match your search.</p>
          <Link href="/app/connect">Connect your agent</Link>
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
  const [searchRevision, setSearchRevision] = useState(0);
  const [selected, setSelected] = useState<string>();
  const cells = state.learnings
    .filter((item) => item.lifecycle !== "retracted")
    .sort((a, b) => Date.parse(b.lastPushedAt) - Date.parse(a.lastPushedAt));
  const repos = [
    ...new Set(cells.flatMap((item) => (item.repo ? [item.repo] : []))),
  ].sort();
  const visible = cells.filter((item) => !repo || item.repo === repo);
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
          <h1>Hive</h1>
          <p className="muted">
            Open a cell to read the learning and see who saved it.
          </p>
        </div>
        <div className="row wrap">
          <Badge tone="fresh" icon="icon-cell">
            {cells.length} {cells.length === 1 ? "cell" : "cells"}
          </Badge>
          <span className="small live-label">
            <Sprite name="bee-hover" scale={1} />
            Refreshes every 5s
          </span>
        </div>
      </div>
      <section className="stack" aria-label="Cells">
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
          <Button type="submit" variant="secondary" iconLeft="icon-search">
            Search
          </Button>
          {query ? (
            <Button variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
          ) : null}
        </form>
        <div className="repo-filter">
          <Select
            size="sm"
            aria-label="Choose a repo"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
            options={[
              { value: "", label: "All repos" },
              ...repos.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
        <div ref={list}>
          {query.trim() ? (
            <SearchResults
              key={`${query.trim()}:${repo}:${searchRevision}`}
              query={query.trim()}
              repo={repo}
              onOpen={setSelected}
            />
          ) : (
            <CellPanel
              state={state}
              visible={visible}
              newIds={newIds}
              onOpen={setSelected}
            />
          )}
        </div>
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

function CellPanel({
  state,
  visible,
  newIds,
  onOpen,
}: {
  state: { loaded: boolean; error: string };
  visible: LearningView[];
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
          <p className="muted">There are no cells here yet.</p>
          <Link href="/app/connect" className="hm-btn hm-btn-primary hm-btn-md">
            Connect your agent
          </Link>
        </Card>
      ) : null}
      {visible.length ? (
        <div className="cell-field">
          <CellGrid columns={4}>
            {visible.map((item) => (
              <LearningCard
                key={item.id}
                learning={item}
                highlighted={newIds.has(item.id)}
                onOpen={onOpen}
              />
            ))}
          </CellGrid>
        </div>
      ) : null}
    </>
  );
}
