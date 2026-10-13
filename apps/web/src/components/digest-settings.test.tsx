import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { DigestSettings } from "./digest-settings";
import { digestScheduleInput } from "@hivemind/core";
const schedule = {
  ...digestScheduleInput.parse({
    channelId: "C123456",
    cadence: "weekly",
    time: "09:00",
    timezone: "UTC",
  }),
  id: "dgs_aaaaaaaaaaaa",
  teamId: "team_aaaaaaaaaaaa",
  channelName: "team-learnings",
  createdBy: "mem_aaaaaaaaaaaa",
  anchor: "2026-10-13T00:00:00Z",
  lastCursor: "2026-10-06T00:00:00Z",
  coverageStart: "2026-10-06T00:00:00Z",
  nextDueAt: "2026-10-19T09:00:00Z",
  lastPostedAt: null,
};
it("offers members previews and history without schedule mutations", () => {
  const html = renderToStaticMarkup(
    <DigestSettings
      initial={{
        schedules: [schedule],
        history: [],
        channels: [],
        isAdmin: false,
      }}
    />,
  );
  expect(html).toContain("Preview");
  expect(html).toContain("Recent updates");
  expect(html).not.toContain("Post now");
  expect(html).not.toContain("Add schedule");
  expect(html).not.toContain(">Edit<");
});
