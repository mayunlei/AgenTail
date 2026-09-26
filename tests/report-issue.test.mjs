import assert from "node:assert/strict";
import test from "node:test";
import { createIssueReportUrl } from "../public/report-issue.js";

test("report issue URL pre-fills safe diagnostics without session content or paths", () => {
  const url = new URL(createIssueReportUrl({
    product: { version: "0.5.4", protocol: "ASIF/2" },
    config: { language: "zh-CN", syncEnabled: true },
    continuity: { status: "attention", verifiedRate: 92, conflicts: 1, attention: 2 },
    stats: { syncRuns: 9, errors: 1, conflictsDetected: 3, conflictsResolved: 2, lastRunAt: "2026-09-24T00:00:00.000Z" },
    agents: [
      { id: "codex", name: "Codex", selected: true, detected: true },
      { id: "claude", name: "Claude Code", selected: true, detected: false },
    ],
    sessions: [{ title: "private customer project", project: { cwd: "/secret/path" } }],
  }, { platform: "macOS arm64" }));
  assert.equal(`${url.origin}${url.pathname}`, "https://github.com/mayunlei/AgenTail/issues/new");
  assert.equal(url.searchParams.get("title"), "[Bug] Agentail 0.5.4 — ");
  const body = url.searchParams.get("body");
  assert.match(body, /自动诊断/);
  assert.match(body, /Codex, Claude Code/);
  assert.match(body, /macOS arm64/);
  assert.doesNotMatch(body, /private customer project|\/secret\/path/);
});

test("report issue URL follows the selected interface language", () => {
  const url = new URL(createIssueReportUrl({ product: { version: "0.5.4" }, config: { language: "en" } }));
  assert.match(url.searchParams.get("body"), /What happened\?/);
  assert.match(url.searchParams.get("body"), /did not attach session text/);
});
