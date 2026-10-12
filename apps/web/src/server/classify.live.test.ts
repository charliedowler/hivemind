import { expect, it } from "vitest";
import { classifyCapture, classifyPush } from "./classify";

it.skipIf(process.env.TYPESAFE_LIVE_TEST !== "1")(
  "evaluates a real friction report with Jev",
  async () => {
    const result = await classifyPush({
      title: "Usage limits interrupt a coding round",
      body: "During the 12 October build, Claude usage limits interrupted coding work. The build moved coding rounds to Codex. No minutes were measured.",
      repo: "team/build",
      workaround: "Switch to the available coding agent.",
      blocked: true,
      kind: "friction",
    });
    console.info(
      JSON.stringify({
        point: "push",
        latencyMs: result.classification?.latencyMs,
        answers: result.classification?.answers,
      }),
    );
    expect(result.classification).not.toBeNull();
    expect(result.decision).toMatchObject({
      action: "accept",
      kind: "friction",
      worthSharing: true,
    });
    const capture = await classifyCapture({
      changes: 1,
      errors: 1,
      observations: 1,
      text: "Discovered that a forced schema push drops tables. Use reviewed transactional migrations to preserve data.",
    });
    expect(capture.classification).not.toBeNull();
    expect(capture.decision).toBe("capture");
    console.info(
      JSON.stringify({
        point: "capture",
        latencyMs: capture.classification?.latencyMs,
        answers: capture.classification?.answers,
      }),
    );
  },
);
