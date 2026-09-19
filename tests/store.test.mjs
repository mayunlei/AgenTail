import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
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
