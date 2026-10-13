"use client";
import { useEffect, useState } from "react";
import type { FrictionSummary } from "@hivemind/core";
import { Card, Sprite } from "@hivemind/design-system";
import { requestJson, errorMessage } from "@/lib/client";
import { CellCitation } from "./cell-citation";
import { ErrorPanel, LoadingPanel } from "./primitives";
export function FrictionPanel({
  repo,
  onOpen,
}: {
  repo: string;
  onOpen: (id: string) => void;
}) {
  const [state, setState] = useState<{
    data?: FrictionSummary;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    function poll() {
      requestJson<FrictionSummary>(
        `/api/app/friction?repo=${encodeURIComponent(repo)}`,
        undefined,
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted) setState({ data });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ error: errorMessage(error) });
        })
        .finally(() => {
          if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
        });
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [repo]);
  return (
    <section className="stack" aria-label="Friction">
      <div className="section-heading">
        <div>
          <h2>Friction</h2>
        </div>
        <Sprite name="cell-outdated" scale={2} />
      </div>
      {state.error ? (
        <ErrorPanel message={state.error} />
      ) : !state.data ? (
        <LoadingPanel>Loading friction reports.</LoadingPanel>
      ) : (
        <FrictionContent data={state.data} onOpen={onOpen} />
      )}
    </section>
  );
}
export function FrictionContent({
  data,
  onOpen,
}: {
  data: FrictionSummary;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="stack">
      <p className="lead">
        {data.minutes} measured minutes lost this week · {data.count} friction
        reports
      </p>
      <p className="small muted">
        {data.unmeasured} reports have no measured cost and are excluded from
        the minutes total. This week covers the past seven days.
      </p>
      {data.count ? (
        <>
          <h3>Areas by minutes lost</h3>
          <div className="friction-areas">
            {data.areas.map((area) => (
              <div className="stack friction-area" key={area.area}>
                <div className="row between">
                  <strong>{area.area}</strong>
                  <span>
                    {area.minutes} min · {area.count} reports
                  </span>
                </div>
                {area.minutes > 0 ? (
                  <div
                    className="friction-bar"
                    style={{ width: `${(area.minutes / data.minutes) * 100}%` }}
                  />
                ) : null}
                <Cited ids={area.ids} cells={data.cells} onOpen={onOpen} />
              </div>
            ))}
          </div>
          <h3>Recurring friction</h3>
          {data.recurring.length ? (
            data.recurring.map((item) => (
              <div className="stack" key={item.title}>
                <p>
                  {item.title} · {item.count} reports · {item.minutes} min
                </p>
                <Cited ids={item.ids} cells={data.cells} onOpen={onOpen} />
              </div>
            ))
          ) : (
            <p className="muted">
              No repeated friction reports in the past seven days.
            </p>
          )}
        </>
      ) : (
        <p className="muted">
          No friction reports in the past seven days. Ask your agent to save
          what slowed you down and any workaround.
        </p>
      )}
    </Card>
  );
}
function Cited({
  ids,
  cells,
  onOpen,
}: {
  ids: string[];
  cells: FrictionSummary["cells"];
  onOpen: (id: string) => void;
}) {
  const titles = new Map(cells.map((cell) => [cell.id, cell.title]));
  return (
    <div className="row wrap">
      {ids.map((id) => (
        <CellCitation key={id} id={id} title={titles.get(id)} onOpen={onOpen} />
      ))}
    </div>
  );
}
