import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSession } from "../src/asif.mjs";
import { ClaudeAdapter } from "../src/adapters/claude.mjs";
import { CodexAdapter } from "../src/adapters/codex.mjs";
import { OpenCodeAdapter } from "../src/adapters/opencode.mjs";
import { QoderAdapter } from "../src/adapters/qoder.mjs";

function fixtureSession(cwd) {
  return createSession({
    id: "22222222-2222-4222-8222-222222222222",
    origin: { agent: "codex", sessionId: "native-source" },
    cwd,
    title: "Cross-agent fixture",
    createdAt: "2026-08-25T02:00:00.000Z",
    updatedAt: "2026-08-25T02:03:00.000Z",
    events: [
      { id: "evt_user", timestamp: "2026-08-25T02:00:00.000Z", kind: "message", role: "user", text: "Create a parser" },
      { id: "evt_tool", timestamp: "2026-08-25T02:01:00.000Z", kind: "tool_call", role: "assistant", text: "read_file", name: "read_file", callId: "call_fixture", input: { path: "src/a.js" } },
      { id: "evt_result", timestamp: "2026-08-25T02:02:00.000Z", kind: "tool_result", role: "tool", text: "file contents", callId: "call_fixture" },
      { id: "evt_assistant", timestamp: "2026-08-25T02:03:00.000Z", kind: "message", role: "assistant", text: "Parser created" },
    ],
  });
}

for (const [name, makeAdapter] of [
  ["Codex", (root) => new CodexAdapter({ root: path.join(root, "codex") })],
  ["Claude Code", (root) => new ClaudeAdapter({ root: path.join(root, "claude") })],
  ["Qoder", (root) => new QoderAdapter({ root: path.join(root, "qoder") })],
]) {
  test(`${name} adapter round-trips messages and tool events`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "asb-adapter-"));
    const project = path.join(root, "project");
    const session = fixtureSession(project);
    const adapter = makeAdapter(root);
    const written = await adapter.write(session);
    assert.equal(written.added, 4);
    const discovered = await adapter.discover({ historyDays: 3650 });
    assert.equal(discovered.length, 1);
    const parsed = await adapter.read(discovered[0]);
    assert.equal(parsed.id, session.id);
    assert.deepEqual(parsed.events.map((event) => event.id), session.events.map((event) => event.id));
    assert.deepEqual(parsed.events.map((event) => event.kind), session.events.map((event) => event.kind));
    const noOp = await adapter.write(session, written);
    assert.equal(noOp.added, 0);
  });
}

test("OpenCode export uses the official import envelope", async () => {
  const session = fixtureSession("/tmp/project");
  const adapter = new OpenCodeAdapter({ importsDir: "/tmp" });
  const data = adapter.exportData(session, "ses_1234567890abcdef");
  assert.equal(data.info.metadata.agentSessionBridge.canonicalId, session.id);
  assert.equal(data.messages[0].info.role, "user");
  assert.ok(data.messages.some((message) => message.info.role === "assistant"));
  assert.ok(data.messages.every((message) => message.parts.every((part) => part.sessionID === data.info.id)));
});

test("Claude marks imported assistant history synthetic and repairs the obsolete bridge model", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-claude-model-"));
  const adapter = new ClaudeAdapter({ root: path.join(root, "claude") });
  const written = await adapter.write(fixtureSession(path.join(root, "project")));
  const valid = await readFile(written.path, "utf8");
  assert.match(valid, /"model":"<synthetic>"/);
  const obsolete = valid.replaceAll('"model":"<synthetic>"', '"model":"agent-session-bridge"');
  await writeFile(written.path, obsolete);

  const preview = await adapter.repairImportedModels();
  assert.equal(preview.files, 1);
  assert.equal(preview.messages, 2);
  assert.match(await readFile(written.path, "utf8"), /"model":"agent-session-bridge"/);

  const repaired = await adapter.repairImportedModels({ apply: true });
  assert.equal(repaired.files, 1);
  assert.match(await readFile(written.path, "utf8"), /"model":"<synthetic>"/);
  assert.match(await readFile(repaired.entries[0].backupPath, "utf8"), /"model":"agent-session-bridge"/);
});

test("Codex ignores injected prompt envelopes when visible user events exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-codex-visible-"));
  const sessionsRoot = path.join(root, "sessions");
  const file = path.join(sessionsRoot, "2026", "08", "25", "rollout-visible.jsonl");
  await mkdir(path.dirname(file), { recursive: true });
  const records = [
    { timestamp: "2026-08-25T05:00:00.000Z", type: "session_meta", payload: { id: "77777777-7777-4777-8777-777777777777", timestamp: "2026-08-25T05:00:00.000Z", cwd: "/tmp/project" } },
    { timestamp: "2026-08-25T05:00:01.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>internal wrapper</environment_context>" }] } },
    { timestamp: "2026-08-25T05:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Build the real feature" }] } },
    { timestamp: "2026-08-25T05:00:02.000Z", type: "event_msg", payload: { type: "user_message", client_id: "client-visible", message: "Build the real feature" } },
    { timestamp: "2026-08-25T05:00:03.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Feature built" }] } },
  ];
  await writeFile(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const adapter = new CodexAdapter({ root: sessionsRoot });
  const [descriptor] = await adapter.discover({ historyDays: 3650 });
  assert.equal(descriptor.title, "Build the real feature");
  const parsed = await adapter.read(descriptor);
  assert.deepEqual(parsed.events.map((event) => event.text), ["Build the real feature", "Feature built"]);
});
