import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CaptureRuleInput, CaptureRule } from "@hivemind/core";
import {
  CaptureRules,
  RuleForm,
  DescribeRule,
  ApplyRule,
  ApplicationHistory,
  ReverseApplication,
} from "./capture-rules";
import { CaptureCellNote } from "./capture-cell-note";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
const input: CaptureRuleInput = {
  name: "Work repos",
  scope: "member",
  kind: "repo_owner",
  owners: ["team", "another-team"],
  mode: "only_allow",
  action: "drop",
  enabled: true,
  source: "web",
};
const rule: CaptureRule = {
  ...input,
  id: "crule_test",
  teamId: "team_test",
  memberId: "member_test",
  createdBy: "member_test",
  createdAt: "2026-10-13T10:00:00Z",
  updatedAt: "2026-10-13T10:00:00Z",
};

describe("capture settings", () => {
  it("shows reversal only for admins and requires a reason before confirming", () => {
    const application = {
      id: "app_test",
      ruleId: rule.id,
      learningId: "lrn_test",
      createdAt: rule.createdAt,
    };
    const member = renderToStaticMarkup(
      <ApplicationHistory applications={[application]} rules={[rule]} />,
    );
    expect(member).not.toContain("Reverse application");
    expect(
      renderToStaticMarkup(
        <ApplicationHistory
          applications={[application]}
          rules={[rule]}
          isAdmin
        />,
      ),
    ).toContain("Reverse application");
    expect(
      renderToStaticMarkup(
        <ApplicationHistory
          applications={[{ ...application, reversedAt: rule.createdAt }]}
          rules={[rule]}
          isAdmin
        />,
      ),
    ).not.toContain("Reverse application");
    const form = renderToStaticMarkup(
      <ReverseApplication
        application={application}
        onReversed={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(form).toContain("Reason for reversing");
    expect(form).toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm reversal<\/button>/,
    );
  });
  it("gives members their own rules and read-only inherited team rules", () => {
    const html = renderToStaticMarkup(
      <CaptureRules
        initial={{
          rules: [
            rule,
            {
              ...rule,
              id: "crule_team",
              scope: "team",
              memberId: null,
              name: "Team policy",
            },
          ],
          applications: [],
          isAdmin: false,
        }}
      />,
    );
    expect(html).toContain("What Hive keeps");
    expect(html).toContain("Your rules");
    expect(html).toContain("Team policy");
    expect(html).toContain("Ask a team admin to change them.");
    expect(html.match(/>Edit</g)).toHaveLength(1);
    expect(html).toContain("Describe a rule");
  });
  it("lets team admins add team rules", () => {
    const html = renderToStaticMarkup(
      <CaptureRules initial={{ rules: [], applications: [], isAdmin: true }} />,
    );
    expect(html.match(/>Add rule</g)).toHaveLength(2);
  });
  it("renders typed controls for all six rule kinds and comma-separated owners", () => {
    const inputs: CaptureRuleInput[] = [
      input,
      { ...input, kind: "repo_match", pattern: "team/private-*" },
      { ...input, kind: "path_match", pattern: "**/private/**" },
      { ...input, kind: "content_category", category: "customer_data" },
      { ...input, kind: "agent_or_client", agent: "fixture-client" },
      {
        ...input,
        kind: "keyword",
        pattern: "private",
        regex: false,
        caseSensitive: true,
      },
    ];
    const fields = [
      "owners",
      "pattern",
      "pattern",
      "category",
      "agent",
      "caseSensitive",
    ];
    inputs.forEach((initial, index) => {
      const html = renderToStaticMarkup(
        <RuleForm
          initial={initial}
          onSaved={async () => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain(`name="${fields[index]}"`);
      expect(html).toContain('name="action"');
      expect(html).toContain('name="enabled"');
    });
    expect(
      renderToStaticMarkup(
        <RuleForm
          initial={input}
          onSaved={async () => {}}
          onCancel={() => {}}
          confirm
        />,
      ),
    ).toContain('value="team, another-team"');
  });
  it("requires proposal and a later confirmation to save a described rule", () => {
    const html = renderToStaticMarkup(
      <DescribeRule
        isAdmin={false}
        onSaved={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(html).toContain("Propose rule");
    expect(html).not.toContain("Save rule");
    expect(
      renderToStaticMarkup(
        <RuleForm
          initial={input}
          onSaved={async () => {}}
          onCancel={() => {}}
          confirm
        />,
      ),
    ).toContain("Confirm and save rule");
  });
  it("describes the selected retrospective action accurately", () => {
    const redaction = renderToStaticMarkup(
      <ApplyRule
        rule={{ ...rule, action: "redact" }}
        onApplied={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(redaction).toContain(
      "removed from existing cells and their shared history",
    );
    expect(redaction).not.toContain("will be retracted");
    const flagging = renderToStaticMarkup(
      <ApplyRule
        rule={{ ...rule, action: "flag" }}
        onApplied={async () => {}}
        onCancel={() => {}}
      />,
    );
    expect(flagging).toContain("private to the member who saved them");
  });
  it("starts retrospective apply with a bounded preview and no apply control", () => {
    const html = renderToStaticMarkup(
      <ApplyRule rule={rule} onApplied={async () => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("500 current cells");
    expect(html).toContain("Preview matching cells");
    expect(html).not.toContain("Confirm and apply");
    expect(html).toContain("Matching cells will be retracted");
    expect(html).toContain(
      "Your earlier content stays private; an admin can reverse this action.",
    );
  });
  it("shows rule history with a cell link and redaction or owner confirmation notices", () => {
    const html = renderToStaticMarkup(
      <CaptureRules
        initial={{
          rules: [rule],
          applications: [
            {
              id: "app_test",
              ruleId: rule.id,
              learningId: "lrn_test",
              createdAt: rule.createdAt,
            },
          ],
          isAdmin: false,
        }}
      />,
    );
    expect(html).toContain('href="/app/cells/lrn_test"');
    const flagged = renderToStaticMarkup(
      <CaptureCellNote id="lrn_test" flagged redacted={false} canConfirm />,
    );
    expect(flagged).toContain("Only you can read it");
    expect(
      renderToStaticMarkup(
        <CaptureCellNote
          id="lrn_test"
          flagged
          redacted={false}
          canConfirm={false}
        />,
      ),
    ).not.toContain("Confirm and share cell");
    expect(flagged).toMatch(
      /<button[^>]*disabled=""[^>]*>Confirm and share cell<\/button>/,
    );
    expect(
      renderToStaticMarkup(
        <CaptureCellNote id="lrn_test" flagged={false} redacted />,
      ),
    ).toContain("removed content");
    expect(
      renderToStaticMarkup(
        <CaptureCellNote
          id="lrn_test"
          flagged={false}
          redacted={false}
          keptAfterConfirmation
        />,
      ),
    ).toContain("kept after owner confirmation");
    expect(
      renderToStaticMarkup(
        <CaptureCellNote id="lrn_test" flagged={false} redacted={false} />,
      ),
    ).toBe("");
  });
});
