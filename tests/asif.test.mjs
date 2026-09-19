import assert from "node:assert/strict";
import test from "node:test";
import { ASIF_SCHEMA, createHandoffCapsule, createSession, mergeSessions, mergeSessionsThreeWay, resolveSessionConflict, validateSession } from "../src/asif.mjs";

test("ASIF validates and merges by stable event id", () => {
  const base = createSession({
    id: "11111111-1111-4111-8111-111111111111",
    origin: { agent: "codex", sessionId: "source" },
    cwd: "/tmp/project",
    events: [{ id: "evt_1", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "user", text: "Build it" }],
  });
  const next = createSession({
    id: base.id,
    origin: { agent: "claude", sessionId: "target" },
    cwd: "/tmp/project",
    events: [
      { id: "evt_1", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "user", text: "Build it" },
      { id: "evt_2", timestamp: "2026-08-25T01:01:00.000Z", kind: "message", role: "assistant", text: "Done" },
    ],
  });
  const merged = mergeSessions(base, next);
  assert.equal(merged.events.length, 2);
  assert.deepEqual(validateSession(merged), { ok: true, errors: [] });
});

test("ASIF/2 preserves causal order and derives portable work state", () => {
  const session = createSession({
    id: "11111111-1111-4111-8111-222222222222",
    origin: { agent: "codex", sessionId: "work-state" },
    cwd: "/tmp/project",
    events: [
      { id: "evt_user", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "user", text: "Fix the parser" },
      { id: "evt_call", timestamp: "2026-08-25T01:01:00.000Z", kind: "tool_call", role: "assistant", name: "exec_command", callId: "call_test", input: { cmd: "npm test", path: "src/parser.mjs" } },
      { id: "evt_result", timestamp: "2026-08-25T01:02:00.000Z", kind: "tool_result", role: "tool", callId: "call_test", text: "12 tests passed" },
    ],
  });
  assert.equal(session.$schema, ASIF_SCHEMA);
  assert.deepEqual(session.events[1].parentIds, ["evt_user"]);
  assert.deepEqual(session.events[2].parentIds, ["evt_call"]);
  assert.deepEqual(session.heads, ["evt_result"]);
  assert.ok(session.state.touchedFiles.includes("src/parser.mjs"));
  assert.equal(session.state.tests[0].outcome, "passed");
  const capsule = createHandoffCapsule(session, { targetAgent: "unknown-agent" });
  assert.match(capsule.markdown, /Inspect the working tree and rerun relevant checks/i);
  assert.match(capsule.markdown, /src\/parser\.mjs/);
});

test("lossy target readback cannot downgrade a canonical event", () => {
  const base = createSession({
    id: "11111111-1111-4111-8111-333333333333",
    origin: { agent: "codex", sessionId: "source" },
    cwd: "/tmp/project",
    events: [{ id: "evt_tool", timestamp: "2026-08-25T01:00:00.000Z", kind: "tool_call", role: "assistant", name: "exec", input: { cmd: "npm test" }, source: { agent: "codex", sessionId: "source" } }],
  });
  const lossy = createSession({
    id: base.id,
    origin: { agent: "text-agent", sessionId: "target" },
    cwd: "/tmp/project",
    events: [{ id: "evt_tool", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "assistant", text: "[Imported tool call]", source: { agent: "text-agent", sessionId: "target" } }],
  });
  const merged = mergeSessions(base, lossy);
  assert.equal(merged.events[0].kind, "tool_call");
  assert.equal(merged.events[0].name, "exec");
  assert.equal(merged.events[0].provenance.observedSources.length, 2);
  assert.equal(merged.revision.id, base.revision.id);
});

test("three-way merge preserves concurrent append branches with a two-parent revision", () => {
  const id = "11111111-1111-4111-8111-444444444444";
  const base = createSession({
    id,
    origin: { agent: "codex", sessionId: "codex-source" },
    cwd: "/tmp/project",
    events: [{ id: "evt_base", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "user", text: "Start" }],
  });
  const codexSide = createSession({
    id,
    origin: { agent: "codex", sessionId: "codex-source" },
    cwd: "/tmp/project",
    events: [...base.events, { id: "evt_codex", timestamp: "2026-08-25T01:01:00.000Z", kind: "message", role: "assistant", text: "Codex change", source: { agent: "codex", sessionId: "codex-source" } }],
  });
  const claudeSide = createSession({
    id,
    origin: { agent: "claude", sessionId: "claude-target" },
    cwd: "/tmp/project",
    events: [...base.events, { id: "evt_claude", timestamp: "2026-08-25T01:02:00.000Z", kind: "message", role: "assistant", text: "Claude change", source: { agent: "claude", sessionId: "claude-target" } }],
  });
  const first = mergeSessionsThreeWay(base, base, codexSide, { source: { agent: "codex", sessionId: "codex-source" } });
  const merged = mergeSessionsThreeWay(base, first.session, claudeSide, { source: { agent: "claude", sessionId: "claude-target" } });
  assert.equal(merged.concurrent, true);
  assert.equal(merged.session.revision.parents.length, 2);
  assert.deepEqual(new Set(merged.session.events.map((event) => event.id)), new Set(["evt_base", "evt_codex", "evt_claude"]));
  assert.match(merged.session.events.find((event) => event.id === "evt_codex").branchId, /^branch:codex:/);
  assert.match(merged.session.events.find((event) => event.id === "evt_claude").branchId, /^branch:claude:/);
  assert.equal(merged.session.merge.status, "merged");
  assert.equal(merged.session.merge.conflicts.length, 0);
  assert.equal(merged.branchSession.revision.parents[0], base.revision.id);
});

test("three-way merge records conflicting edits and resolution keeps an audit event", () => {
  const id = "11111111-1111-4111-8111-555555555555";
  const base = createSession({
    id,
    origin: { agent: "codex", sessionId: "codex-source" },
    cwd: "/tmp/project",
    events: [{ id: "evt_shared", timestamp: "2026-08-25T01:00:00.000Z", kind: "message", role: "assistant", text: "Base answer", source: { agent: "codex", sessionId: "codex-source" } }],
  });
  const codexEdit = createSession({ id, origin: base.origin, cwd: "/tmp/project", events: [{ ...base.events[0], text: "Codex answer" }] });
  const claudeEdit = createSession({ id, origin: { agent: "claude", sessionId: "claude-target" }, cwd: "/tmp/project", events: [{ ...base.events[0], text: "Claude answer", source: { agent: "claude", sessionId: "claude-target" } }] });
  const current = mergeSessionsThreeWay(base, base, codexEdit, { source: base.origin }).session;
  const result = mergeSessionsThreeWay(base, current, claudeEdit, { source: claudeEdit.origin });
  assert.equal(result.detectedConflicts, 1);
  assert.equal(result.session.merge.status, "conflicted");
  assert.equal(result.session.events[0].text, "Codex answer");
  const conflict = result.session.merge.conflicts[0];
  assert.deepEqual(new Set(conflict.variants.map((variant) => variant.event.text)), new Set(["Codex answer", "Claude answer"]));

  const resolved = resolveSessionConflict(result.session, conflict.id, "both");
  assert.equal(resolved.merge.status, "resolved");
  assert.equal(resolved.merge.conflicts[0].status, "resolved");
  assert.ok(resolved.events.some((event) => event.text === "Claude answer" && event.supersedes?.includes("evt_shared")));
  assert.ok(resolved.events.some((event) => event.kind === "checkpoint" && /merge resolution/i.test(event.text)));
  assert.deepEqual(resolved.revision.parents, [result.session.revision.id]);

  const incomingSelected = resolveSessionConflict(result.session, conflict.id, "incoming");
  assert.equal(incomingSelected.events.find((event) => event.id === "evt_shared").text, "Claude answer");
  assert.equal(incomingSelected.events.filter((event) => event.kind === "message").length, 1);
  assert.equal(incomingSelected.merge.conflicts[0].resolution.strategy, "incoming");
});
