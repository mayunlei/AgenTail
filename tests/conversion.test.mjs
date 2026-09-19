import assert from "node:assert/strict";
import test from "node:test";
import { createSession } from "../src/asif.mjs";
import { planProjection, projectSession } from "../src/conversion.mjs";

function toolSession() {
  return createSession({
    id: "99999999-9999-4999-8999-999999999999",
    origin: { agent: "codex", sessionId: "source" },
    cwd: "/tmp/project",
    events: [
      { id: "evt_user", timestamp: "2026-08-25T09:00:00.000Z", kind: "message", role: "user", text: "Run the checks" },
      { id: "evt_call", timestamp: "2026-08-25T09:01:00.000Z", kind: "tool_call", role: "assistant", name: "exec", callId: "call_1", input: { cmd: "npm test" } },
      { id: "evt_result", timestamp: "2026-08-25T09:02:00.000Z", kind: "tool_result", role: "tool", callId: "call_1", text: "passed" },
    ],
  });
}

test("capability planner flattens unsupported tools into inert history with a manifest", () => {
  const session = toolSession();
  const plan = planProjection(session, {
    id: "text-agent",
    write: true,
    capabilities: { nativeWrite: true, structuredTools: false, resumeSession: true, readback: true },
  });
  const projected = projectSession(session, plan);
  assert.equal(plan.mode, "transcript-native");
  assert.equal(projected.projectedSession.events[1].kind, "message");
  assert.match(projected.projectedSession.events[1].text, /historical only/i);
  assert.equal(projected.manifest.counts.flattened, 2);
  assert.equal(projected.manifest.degraded, true);
  assert.ok(projected.manifest.fidelity > 0.5 && projected.manifest.fidelity < 1);
});

test("unwritable target receives a universal handoff capsule", () => {
  const session = toolSession();
  const plan = planProjection(session, { id: "unknown", write: false, capabilities: {} });
  const projected = projectSession(session, plan);
  assert.equal(plan.mode, "handoff-file");
  assert.equal(projected.projectedSession.events.length, 1);
  assert.match(projected.capsule.markdown, /Current state/);
  assert.equal(projected.manifest.counts.summarized, session.events.length);
});
