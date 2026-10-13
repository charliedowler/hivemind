import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { composeDigest } from "@hivemind/core";
import { expect, it } from "vitest";
import { cellStateLabel, kindLabel } from "@/lib/learning-presentation";

const banned =
  /\b(?:comb|nectar|forager|digest|conflict|rule|matcher|preview|application|tree|snapshot|lifecycle|fresh|confirmed|superseded|retracted|insight|gotcha|snippet|incident)s?\b/i;
const technicalAttributes =
  /^(?:className|id|key|href|src|name|value|type|tone|variant|data-.*|aria-controls|aria-labelledby)$/;

function rendered(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isJsxExpression(parent) || ts.isJsxAttribute(parent)) return true;
  if (ts.isConditionalExpression(parent) && parent.condition !== node)
    return rendered(parent);
  if (
    ts.isTemplateExpression(parent) ||
    ts.isTemplateSpan(parent) ||
    ts.isParenthesizedExpression(parent)
  )
    return rendered(parent);
  return false;
}

function catalogue(file: string, errorsOnly = false) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const strings: { file: string; line: number; text: string }[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isJsxAttribute(node) &&
      technicalAttributes.test(node.name.getText(source))
    )
      return;
    if (
      ts.isImportDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isTypeNode(node)
    )
      return;
    if (ts.isTaggedTemplateExpression(node)) return;
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (
      errorsOnly &&
      ts.isNewExpression(node) &&
      /^Hive.*Error$/.test(node.expression.getText(source))
    ) {
      for (const argument of node.arguments ?? []) {
        if (ts.isStringLiteral(argument))
          strings.push({
            file,
            line:
              source.getLineAndCharacterOfPosition(argument.getStart(source))
                .line + 1,
            text: argument.text,
          });
      }
    }
    if (!errorsOnly && (ts.isJsxText(node) || literal)) {
      const text = (node as ts.StringLiteral).text.trim();
      const parent = node.parent;
      const internal =
        (ts.isBinaryExpression(parent) &&
          [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
          ].includes(parent.operatorToken.kind)) ||
        ts.isCaseClause(parent) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      const visible =
        ts.isJsxText(node) ||
        rendered(node) ||
        /\s/.test(text) ||
        /^[A-Z][a-z]+$/.test(text);
      if (
        !internal &&
        visible &&
        text &&
        !text.startsWith("/") &&
        !text.startsWith("@/")
      ) {
        strings.push({
          file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          text,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return strings;
}

it("keeps signed-in labels, replies and cell badges in Hive's vocabulary", () => {
  const sourceFiles = (directories: string[]) =>
    directories.flatMap((directory) =>
      readdirSync(directory, { recursive: true, encoding: "utf8" })
        .map((file) => join(directory, file))
        .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test.")),
    );
  const files = sourceFiles([
    "src/components",
    "src/app",
    "src/lib",
    "src/server/identity",
  ]).filter(
    (file) =>
      file !== "src/app/page.tsx" &&
      !file.startsWith("src/app/privacy/") &&
      !file.startsWith("src/app/terms/") &&
      !file.endsWith("/stop-hook.ts"),
  );
  const serverFiles = sourceFiles(["src/server", "src/mcp"]);
  const strings = [
    ...files.flatMap((file) => catalogue(resolve(file))),
    ...serverFiles.flatMap((file) => catalogue(resolve(file), true)),
  ];
  expect(strings.length).toBeGreaterThan(300);
  expect(strings.filter((entry) => banned.test(entry.text))).toEqual([]);
  const update = composeDigest(
    {
      since: "2026-10-06T00:00:00Z",
      until: "2026-10-13T00:00:00Z",
      learnings: [
        {
          id: "lrn_a",
          title: "Use the pool",
          author: { name: "Alex" },
          state: "confirmed",
        },
      ],
      insights: [
        { id: "lrn_b", title: "Share the connection", author: { name: "Sam" } },
      ],
      friction: [],
      decisions: [],
    },
    { learnings: true, insights: true, friction: true, decisions: true },
    "UTC",
  );
  expect(banned.test(update.text)).toBe(false);
  expect(update.text).toContain("2 learnings");
  expect(update.text).toContain("Share the connection");
  for (const kind of [
    "learning",
    "decision",
    "friction",
    "gotcha",
    "snippet",
    "incident",
    "insight",
  ] as const) {
    expect(banned.test(kindLabel(kind))).toBe(false);
  }
  for (const lifecycle of [
    "fresh",
    "confirmed",
    "superseded",
    "retracted",
    "outdated",
  ] as const) {
    const label = cellStateLabel({
      lifecycle,
      pushCount: 3,
      votes: { up: 1, down: 0, outdated: 0 },
      adminOutdated: false,
    });
    expect(banned.test(label ?? "")).toBe(false);
    if (lifecycle === "fresh") expect(label).toBeUndefined();
    if (lifecycle === "confirmed") expect(label).toBe("Seen 3 times");
  }
});
