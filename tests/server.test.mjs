import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "../src/server.mjs";

test("conflict resolution API validates identifiers and forwards the strategy", async () => {
  const calls = [];
  const engine = {
    async start() {},
    stop() {},
    async resolveConflict(input) {
      calls.push(input);
      return { ...input, unresolved: 0, written: 2, errors: 0 };
    },
  };
  const { server, url } = await startServer({ engine, port: 0 });
  try {
    const invalid = await fetch(`${url}/api/conflicts/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonicalId: "session" }),
    });
    assert.equal(invalid.status, 400);

    const response = await fetch(`${url}/api/conflicts/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canonicalId: "session", conflictId: "conflict", strategy: "both" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { canonicalId: "session", conflictId: "conflict", strategy: "both", unresolved: 0, written: 2, errors: 0 });
    assert.deepEqual(calls, [{ canonicalId: "session", conflictId: "conflict", strategy: "both" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
