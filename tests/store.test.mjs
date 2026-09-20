import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSession } from "../src/asif.mjs";
import { BridgeStore } from "../src/store.mjs";

test("revision storage keeps only the configured recent history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-store-"));
  const store = await new BridgeStore(root).initialize();
  await store.saveConfig({ revisionHistoryLimit: 3 });
  const session = createSession({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    origin: { agent: "codex", sessionId: "source" },
    cwd: root,
    events: [{ id: "evt_start", timestamp: "2026-09-08T00:00:00.000Z", kind: "message", role: "user", text: "Start" }],
  });

  for (let number = 1; number <= 6; number += 1) {
    session.revision = {
      ...session.revision,
      id: `rev_${String(number).padStart(24, "0")}`,
      number,
      parents: number === 1 ? [] : [`rev_${String(number - 1).padStart(24, "0")}`],
    };
    await store.saveRevision(session);
  }

  const files = (await readdir(path.join(root, "revisions", session.id))).sort();
  assert.deepEqual(files, [
    "rev_000000000000000000000004.json",
    "rev_000000000000000000000005.json",
    "rev_000000000000000000000006.json",
  ]);
});

test("session summaries use a compact persistent index", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-session-index-"));
  const store = await new BridgeStore(root).initialize();
  const session = createSession({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    origin: { agent: "codex", sessionId: "indexed-source" },
    cwd: root,
    title: "Indexed session",
    events: [
      { id: "evt_one", timestamp: "2026-09-20T00:00:00.000Z", kind: "message", role: "user", text: "One" },
      { id: "evt_two", timestamp: "2026-09-20T00:01:00.000Z", kind: "message", role: "assistant", text: "Two" },
    ],
  });
  await store.saveSession(session);
  const summaries = await store.listSessionSummaries();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].eventCount, 2);
  assert.equal(summaries[0].events, undefined);
  const index = JSON.parse(await readFile(path.join(root, "session-index.json"), "utf8"));
  assert.equal(index.sessions[session.id].summary.title, "Indexed session");
  assert.equal(index.sessions[session.id].summary.events, undefined);
});

test("polling is clamped to a CPU-safe interval", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "asb-poll-clamp-"));
  const store = await new BridgeStore(root).initialize();
  const config = await store.saveConfig({ pollIntervalMs: 1_000 });
  assert.equal(config.pollIntervalMs, 10_000);
  assert.equal((await store.config()).pollIntervalMs, 10_000);
});
