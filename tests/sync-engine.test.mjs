import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSession } from "../src/asif.mjs";
import { ClaudeAdapter } from "../src/adapters/claude.mjs";
import { CodexAdapter } from "../src/adapters/codex.mjs";
import { QoderAdapter } from "../src/adapters/qoder.mjs";
import { BridgeStore } from "../src/store.mjs";
import { SyncEngine } from "../src/sync-engine.mjs";

test("manual bridge imports one native session into selected targets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-engine-"));
  const project = path.join(root, "project");
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  const claude = new ClaudeAdapter({ root: path.join(root, "claude") });
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex], ["claude", claude]]) }).initialize();
  await store.saveConfig({ selectedAgents: { codex: true, claude: true, opencode: false, qoder: false } });
  const source = createSession({
    id: "33333333-3333-4333-8333-333333333333",
    origin: { agent: "codex", sessionId: "source" },
    cwd: project,
    title: "Bridge engine fixture",
    events: [
      { id: "evt_a", timestamp: "2026-08-25T03:00:00.000Z", kind: "message", role: "user", text: "Continue this task" },
      { id: "evt_b", timestamp: "2026-08-25T03:01:00.000Z", kind: "message", role: "assistant", text: "Context restored" },
    ],
  });
  const native = await codex.write(source);
  const result = await engine.importSession({ sourceAgent: "codex", sourceKey: native.path, targets: ["claude"] });
  assert.equal(result.written, 1);
  assert.deepEqual(result.targets, ["claude"]);
  const targetDescriptors = await claude.discover({ historyDays: 3650 });
  assert.equal(targetDescriptors.length, 1);
  const target = await claude.read(targetDescriptors[0]);
  assert.deepEqual(target.events.map((event) => event.text), ["Continue this task", "Context restored"]);
  const status = await engine.status();
  assert.equal(status.continuity.verifiedRate, 100);
  assert.equal(status.sessions[0].targets.find((item) => item.agent === "claude").state, "verified");
});

test("a full sync freezes discovery and does not reprocess targets it just wrote", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-frozen-discovery-"));
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  const claude = new ClaudeAdapter({ root: path.join(root, "claude") });
  const qoder = new QoderAdapter({ root: path.join(root, "qoder") });
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex], ["claude", claude], ["qoder", qoder]]) }).initialize();
  await store.saveConfig({ selectedAgents: { codex: true, claude: true, opencode: false, qoder: true } });
  const source = createSession({
    id: "88888888-8888-4888-8888-888888888888",
    origin: { agent: "codex", sessionId: "source" },
    cwd: path.join(root, "project"),
    events: [{ id: "evt_loop", timestamp: "2026-08-25T06:00:00.000Z", kind: "message", role: "user", text: "Do not loop" }],
  });
  await codex.write(source);
  const first = await engine.syncOnce({ includeExisting: true });
  const second = await engine.syncOnce({ includeExisting: false });
  assert.deepEqual(first, { scanned: 1, changed: 1, written: 2, errors: 0 });
  assert.deepEqual(second, { scanned: 3, changed: 0, written: 0, errors: 0 });
  assert.ok((await store.state()).stats.lastRunAt);
});

test("work continued in a target agent reaches a source-side bridge projection at the new revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-cross-revision-"));
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  const claude = new ClaudeAdapter({ root: path.join(root, "claude") });
  const qoder = new QoderAdapter({ root: path.join(root, "qoder") });
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex], ["claude", claude], ["qoder", qoder]]) }).initialize();
  await store.saveConfig({ selectedAgents: { codex: true, claude: true, opencode: false, qoder: true } });
  const source = createSession({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    origin: { agent: "codex", sessionId: "source" },
    cwd: path.join(root, "project"),
    events: [{ id: "evt_start", timestamp: "2026-08-25T07:00:00.000Z", kind: "message", role: "user", text: "Start in Codex" }],
  });
  await codex.write(source);
  await engine.syncOnce({ includeExisting: true });

  const [claudeDescriptor] = await claude.discover({ historyDays: 3650 });
  const claudeSession = await claude.read(claudeDescriptor);
  const continued = createSession({
    id: claudeSession.id,
    origin: claudeSession.origin,
    cwd: claudeSession.project.cwd,
    events: [
      ...claudeSession.events,
      { id: "evt_continue", timestamp: "2026-08-25T07:05:00.000Z", kind: "message", role: "assistant", text: "Continued in Claude" },
    ],
  });
  await claude.write(continued, { path: claudeDescriptor.path });
  const next = await engine.syncOnce({ includeExisting: false });
  assert.equal(next.changed, 1);
  assert.equal(next.written, 2);
  const codexSessions = await codex.discover({ historyDays: 3650 });
  assert.ok(codexSessions.length >= 1);
  assert.ok((await codex.read(codexSessions[0])).events.some((event) => event.id === "evt_continue"));
  const status = await engine.status();
  assert.equal(status.continuity.verifiedRate, 100);
  assert.ok(status.sessions[0].targets.every((target) => ["source", "verified"].includes(target.state)));
});

test("simultaneous continuations are frozen, forked from one base, and merged back to both agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-concurrent-branches-"));
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  const claude = new ClaudeAdapter({ root: path.join(root, "claude") });
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex], ["claude", claude]]) }).initialize();
  await store.saveConfig({ selectedAgents: { codex: true, claude: true, opencode: false, qoder: false } });
  const source = createSession({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    origin: { agent: "codex", sessionId: "source" },
    cwd: path.join(root, "project"),
    events: [{ id: "evt_base", timestamp: "2026-08-25T08:00:00.000Z", kind: "message", role: "user", text: "Shared base" }],
  });
  await codex.write(source);
  await engine.syncOnce({ includeExisting: true });
  const base = await store.loadSession(source.id);

  const [codexDescriptor] = await codex.discover({ historyDays: 3650 });
  const [claudeDescriptor] = await claude.discover({ historyDays: 3650 });
  const codexSession = await codex.read(codexDescriptor, { canonicalId: source.id });
  const claudeSession = await claude.read(claudeDescriptor, { canonicalId: source.id });
  await codex.write(createSession({
    id: source.id,
    origin: codexSession.origin,
    cwd: source.project.cwd,
    events: [...codexSession.events, { id: "evt_codex_parallel", timestamp: "2026-08-25T08:01:00.000Z", kind: "message", role: "assistant", text: "Codex parallel work", source: { agent: "codex", sessionId: "source" } }],
  }), { path: codexDescriptor.path });
  await claude.write(createSession({
    id: source.id,
    origin: claudeSession.origin,
    cwd: source.project.cwd,
    events: [...claudeSession.events, { id: "evt_claude_parallel", timestamp: "2026-08-25T08:02:00.000Z", kind: "message", role: "assistant", text: "Claude parallel work", source: { agent: "claude", sessionId: claudeDescriptor.sessionId } }],
  }), { path: claudeDescriptor.path });

  const result = await engine.syncOnce({ includeExisting: false });
  assert.equal(result.changed, 2);
  const merged = await store.loadSession(source.id);
  assert.equal(merged.revision.parents.length, 2, JSON.stringify({ revision: merged.revision, merge: merged.merge, events: merged.events.map((event) => ({ id: event.id, branchId: event.branchId })) }));
  assert.equal(merged.merge.status, "merged");
  assert.equal(merged.merge.conflicts.length, 0);
  assert.deepEqual(new Set(merged.events.map((event) => event.id)), new Set(["evt_base", "evt_codex_parallel", "evt_claude_parallel"]));
  assert.ok(await store.loadRevision(source.id, base.revision.id));
  assert.ok(await store.loadRevision(source.id, merged.revision.parents[1]));
  for (const adapter of [codex, claude]) {
    const descriptors = await adapter.discover({ historyDays: 3650 });
    const native = await adapter.read(descriptors[0], { canonicalId: source.id });
    assert.ok(native.events.some((event) => event.id === "evt_codex_parallel"));
    assert.ok(native.events.some((event) => event.id === "evt_claude_parallel"));
  }
  const status = await engine.status();
  assert.equal(status.continuity.conflicts, 0);
  assert.equal(status.continuity.verifiedRate, 100);
});

test("live sync requires two explicitly selected agents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-safe-defaults-"));
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  const claude = new ClaudeAdapter({ root: path.join(root, "claude") });
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex], ["claude", claude]]) }).initialize();
  await assert.rejects(() => engine.updateConfig({ syncEnabled: true }), /at least two agents/i);
  await engine.updateConfig({ selectedAgents: { codex: true, claude: true } });
  const config = await engine.updateConfig({ syncEnabled: true });
  assert.equal(config.syncEnabled, true);
  const state = await store.state();
  assert.equal(state.baselineReady, true);
  assert.deepEqual(new Set(state.baselinedAgents), new Set(["codex", "claude"]));
});

test("Agentail persists a shared Chinese or English interface language", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentail-language-"));
  const store = await new BridgeStore(path.join(root, "state")).initialize();
  assert.equal((await store.config()).language, "zh-CN");
  assert.equal((await store.saveConfig({ language: "en" })).language, "en");
  assert.equal((await store.config()).language, "en");
  assert.equal((await store.saveConfig({ language: "unsupported" })).language, "zh-CN");
});

test("equivalent conflict repair previews and applies without adding session events", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentail-conflict-repair-"));
  const store = await new BridgeStore(path.join(root, "state")).initialize();
  const base = createSession({
    id: "55555555-eeee-4eee-8eee-555555555555",
    origin: { agent: "codex", sessionId: "source" },
    cwd: path.join(root, "project"),
    events: [{ id: "evt_shared", kind: "tool_result", role: "tool", text: "done", callId: "call_same_identifier", isError: false, source: { agent: "codex", sessionId: "source" } }],
  });
  const incoming = createSession({
    id: base.id,
    origin: { agent: "claude", sessionId: "target" },
    cwd: base.project.cwd,
    events: [{ id: "evt_shared", kind: "tool_result", role: "tool", text: "done", callId: "call_same_identifier", source: { agent: "claude", sessionId: "target" } }],
  }).events[0];
  base.merge = {
    ...base.merge,
    status: "conflicted",
    conflicts: [{
      id: "conflict_equivalent",
      kind: "event-id-collision",
      status: "unresolved",
      eventId: "evt_shared",
      variants: [
        { id: "variant_current", side: "current", agent: "codex", event: base.events[0] },
        { id: "variant_incoming", side: "incoming", agent: "claude", event: incoming },
      ],
    }],
  };
  await store.saveSession(base);
  const engine = await new SyncEngine({ store, adapters: new Map() }).initialize();
  const preview = await engine.repairEquivalentConflicts();
  assert.equal(preview.apply, false);
  assert.equal(preview.conflictsResolved, 1);
  assert.equal((await store.loadSession(base.id)).merge.conflicts[0].status, "unresolved");
  const applied = await engine.repairEquivalentConflicts({ apply: true });
  assert.equal(applied.conflictsResolved, 1);
  const repaired = await store.loadSession(base.id);
  assert.equal(repaired.events.length, 1);
  assert.equal(repaired.merge.conflicts[0].status, "resolved");
  assert.equal((await store.state()).stats.conflictsResolved, 1);
});

test("two native paths with the same source session id converge on one canonical session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentail-source-identity-"));
  const store = new BridgeStore(path.join(root, "state"));
  const codex = new CodexAdapter({ root: path.join(root, "codex") });
  await codex.write(createSession({
    id: "11111111-aaaa-4aaa-8aaa-111111111111",
    origin: { agent: "codex", sessionId: "same-native-session" },
    cwd: path.join(root, "project"),
    events: [{ id: "evt_shared", timestamp: "2026-08-28T01:00:00.000Z", kind: "message", role: "user", text: "Shared source" }],
  }));
  await codex.write(createSession({
    id: "22222222-bbbb-4bbb-8bbb-222222222222",
    origin: { agent: "codex", sessionId: "same-native-session" },
    cwd: path.join(root, "project"),
    events: [
      { id: "evt_shared", timestamp: "2026-08-28T01:00:00.000Z", kind: "message", role: "user", text: "Shared source" },
      { id: "evt_more", timestamp: "2026-08-28T01:01:00.000Z", kind: "message", role: "assistant", text: "More work" },
    ],
  }));
  const engine = await new SyncEngine({ store, adapters: new Map([["codex", codex]]) }).initialize();
  await store.saveConfig({ selectedAgents: { codex: true, claude: false, opencode: false, qoder: false } });
  const result = await engine.syncOnce({ includeExisting: true });
  assert.equal(result.scanned, 2);
  assert.equal((await store.listSessions()).length, 1);
  const state = await store.state();
  assert.equal(Object.keys(state.identities).filter((key) => key === "codex:same-native-session").length, 1);
});

test("identity migration aliases an older subset duplicate to its superset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentail-identity-migration-"));
  const store = await new BridgeStore(path.join(root, "state")).initialize();
  const shared = { id: "evt_shared", timestamp: "2026-08-28T02:00:00.000Z", kind: "message", role: "user", text: "Shared source" };
  await store.saveSession(createSession({
    id: "33333333-cccc-4ccc-8ccc-333333333333",
    origin: { agent: "codex", sessionId: "duplicated-native-session" },
    cwd: path.join(root, "project"),
    events: [shared],
  }));
  await store.saveSession(createSession({
    id: "44444444-dddd-4ddd-8ddd-444444444444",
    origin: { agent: "codex", sessionId: "duplicated-native-session" },
    cwd: path.join(root, "project"),
    events: [shared, { id: "evt_more", timestamp: "2026-08-28T02:01:00.000Z", kind: "message", role: "assistant", text: "Superset" }],
  }));
  const engine = await new SyncEngine({ store, adapters: new Map() }).initialize();
  const state = await store.state();
  assert.equal(state.identities["codex:duplicated-native-session"], "44444444-dddd-4ddd-8ddd-444444444444");
  assert.equal(state.aliases["33333333-cccc-4ccc-8ccc-333333333333"], "44444444-dddd-4ddd-8ddd-444444444444");
  assert.equal(state.stats.duplicateSessionsDetected, 1);
  assert.equal((await engine.status()).sessions.length, 1);
});
