"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { LearningView, SearchHit } from "@hivemind/core";
import { errorMessage, requestJson } from "@/lib/client";
import { LearningCard } from "./learning-card";
import { AskPanel } from "./ask-panel";
import { ErrorPanel } from "./primitives";

function SearchResults({ query, repo }: { query: string; repo: string }) {
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
    return (
      <p className="panel muted" role="status">
        Searching the hive…
      </p>
    );
  const hits = repo
    ? result.hits.filter((hit) => hit.repo === repo)
    : result.hits;
  return (
    <>
      <p className="muted small" role="status">
        {hits.length} results
      </p>
      {hits.length ? (
        hits.map((hit) => <LearningCard key={hit.id} learning={hit} />)
      ) : (
        <div className="panel">
          <h2>No matching learnings.</h2>
          <p className="muted">Try a shorter query or another repository.</p>
        </div>
      )}
    </>
  );
}

export function Feed() {
  const [state, setState] = useState<{
    learnings: LearningView[];
    loaded: boolean;
    error: string;
    newIds: string[];
  }>({ learnings: [], loaded: false, error: "", newIds: [] });
  const [query, setQuery] = useState("");
  const [repo, setRepo] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
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
              list.current.querySelectorAll<HTMLElement>("article"),
            ).find((element) => element.getBoundingClientRect().bottom > 0)
          : undefined;
        const before = anchor?.getBoundingClientRect().top;
        setState((previous) => ({
          learnings: result.learnings,
          loaded: true,
          error: "",
          newIds: previous.loaded
            ? result.learnings
                .filter(
                  (item) =>
                    !previous.learnings.some((old) => old.id === item.id),
                )
                .map((item) => item.id)
            : [],
        }));
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
          2400,
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
  const repos = [
    ...new Set(
      state.learnings.flatMap((item) => (item.repo ? [item.repo] : [])),
    ),
  ].sort();
  const visible = repo
    ? state.learnings.filter((item) => item.repo === repo)
    : state.learnings;
  function search(event: FormEvent) {
    event.preventDefault();
    setSearchRevision((value) => value + 1);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Your team’s memory</h1>
          <p className="muted">Small discoveries. Shared understanding.</p>
        </div>
        <span className="live-label">
          <span />
          Live · refreshes every 5s
        </span>
      </div>
      <div className="feed-grid">
        <section className="feed-column">
          <form className="search-form" onSubmit={search}>
            <label className="sr-only" htmlFor="search">
              Search learnings
            </label>
            <input
              id="search"
              type="search"
              placeholder="Search a task, an error, a decision…"
              value={query}
              maxLength={500}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button className="secondary">Search</button>
          </form>
          <div className="repo-filters" aria-label="Filter repository">
            <button aria-pressed={!repo} onClick={() => setRepo("")}>
              All repos
            </button>
            {repos.map((name) => (
              <button
                key={name}
                aria-pressed={repo === name}
                onClick={() => setRepo(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <div ref={list} className="feed-list">
            {query.trim() ? (
              <SearchResults
                key={`${query.trim()}:${repo}:${searchRevision}`}
                query={query.trim()}
                repo={repo}
              />
            ) : (
              <>
                {state.error && <ErrorPanel message={state.error} />}
                {!state.loaded && (
                  <p className="panel muted" role="status">
                    Loading your team’s memory…
                  </p>
                )}
                {state.loaded && !state.error && !visible.length && (
                  <div className="panel empty-state">
                    <span className="hive-mark" aria-hidden="true" />
                    <h2>
                      {repo
                        ? "No learnings in this repo yet."
                        : "Your hive starts here."}
                    </h2>
                    <p className="muted">
                      Connect an agent and share the first thing your team
                      should remember.
                    </p>
                    <Link href="/app/install" className="primary">
                      Connect your agent
                    </Link>
                  </div>
                )}
                {visible.map((item) => (
                  <LearningCard
                    key={item.id}
                    learning={item}
                    highlighted={state.newIds.includes(item.id)}
                  />
                ))}
              </>
            )}
          </div>
        </section>
        <AskPanel repo={repo || undefined} />
      </div>
    </>
  );
}
