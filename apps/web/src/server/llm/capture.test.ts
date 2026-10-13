import { expect, it } from "vitest";
import { decideCaptureDetails } from "./capture";
const details = {
  title: "Client generation failed",
  blocked: true,
  blockedCitation: "Typecheck blocked progress",
  workaround: "Regenerate the client",
  workaroundCitation: "Regenerated the client",
  cost: 12,
  costCitation: "12 minutes lost",
};
it("requires evidence quotes for friction and leaves unknown fields unknown", () => {
  expect(
    decideCaptureDetails("Client generation failed", "", details),
  ).toMatchObject({ blocked: null, cost: null, workaround: null });
  expect(
    decideCaptureDetails(
      "Client generation failed",
      "Typecheck blocked progress. Regenerated the client. 12 minutes lost",
      details,
    ),
  ).toMatchObject({
    blocked: true,
    cost: 12,
    workaround: "Regenerate the client",
  });
});
it("never treats session duration or command runtime as minutes lost", () => {
  for (const quote of [
    "Session duration: 12 minutes",
    "Build took 12 minutes",
    "Estimated 12 minutes lost",
  ])
    expect(
      decideCaptureDetails("Client generation failed", quote, {
        ...details,
        costCitation: quote,
      }),
    ).toMatchObject({ cost: null });
});
it("does not need an available model to produce a title or retain unknown metrics", () => {
  expect(
    decideCaptureDetails(
      "A title from the observed fact. Some context.",
      "",
      null,
    ),
  ).toEqual({
    title: "A title from the observed fact.",
    cost: null,
    blocked: null,
    workaround: null,
  });
});
