import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMeasurementConsent } from "./measurement-consent";

const consent = vi.hoisted(() => ({
  permitted: false,
  choice: null as null | {
    version: 3;
    categories: { measurement?: { value: boolean } };
  },
}));

vi.mock("c15t/next", () => ({
  useConsent: () => consent.permitted,
  useExplicitChoice: () => consent.choice,
}));

function MeasurementProbe() {
  return <output>{useMeasurementConsent() ? "allowed" : "denied"}</output>;
}

describe("measurement consent", () => {
  beforeEach(() => {
    consent.permitted = false;
    consent.choice = null;
  });

  it("denies measurement while policy is unresolved", () => {
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("denied");
  });

  it("denies a permissive regional default without an explicit choice", () => {
    consent.permitted = true;
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("denied");
  });

  it("denies a choice that does not include measurement", () => {
    consent.permitted = true;
    consent.choice = { version: 3, categories: {} };
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("denied");
  });

  it("denies a recorded rejection", () => {
    consent.permitted = true;
    consent.choice = {
      version: 3,
      categories: { measurement: { value: false } },
    };
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("denied");
  });

  it("denies a grant that effective policy no longer permits", () => {
    consent.choice = {
      version: 3,
      categories: { measurement: { value: true } },
    };
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("denied");
  });

  it("allows a recorded grant while effective permission allows it", () => {
    consent.permitted = true;
    consent.choice = {
      version: 3,
      categories: { measurement: { value: true } },
    };
    expect(renderToStaticMarkup(<MeasurementProbe />)).toContain("allowed");
  });
});
