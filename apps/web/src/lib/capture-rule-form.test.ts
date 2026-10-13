import { describe, expect, it } from "vitest";
import { parseCaptureRuleForm } from "./capture-rule-form";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
const common = {
  name: "Work captures",
  scope: "member",
  action: "drop",
  enabled: "on",
};

describe("capture rule form", () => {
  it("turns comma-separated owners into a structured allow list", () => {
    const result = parseCaptureRuleForm(
      form({
        ...common,
        kind: "repo_owner",
        owners: "team, another-team, ",
        mode: "only_allow",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toMatchObject({
        owners: ["team", "another-team"],
        mode: "only_allow",
      });
  });
  it("allows an empty optional session type and preserves a disabled rule", () => {
    const result = parseCaptureRuleForm(
      form({
        name: "A client",
        scope: "member",
        action: "flag",
        kind: "agent_or_client",
        agent: "fixture-client",
        sessionType: "",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toMatchObject({
        sessionType: undefined,
        enabled: false,
      });
  });
  it("preserves regex and case options, and rejects unbounded patterns", () => {
    const result = parseCaptureRuleForm(
      form({
        ...common,
        kind: "keyword",
        pattern: "[A-Z]{2,4}",
        regex: "on",
        caseSensitive: "on",
      }),
    );
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data).toMatchObject({ regex: true, caseSensitive: true });
    expect(
      parseCaptureRuleForm(
        form({ ...common, kind: "keyword", pattern: "(a+)+", regex: "on" }),
      ).success,
    ).toBe(false);
  });
});
