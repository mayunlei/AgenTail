import { createHandoffCapsule, handoffSession, upgradeSession } from "./asif.mjs";

export const DEFAULT_CAPABILITIES = Object.freeze({
  transport: "local-file",
  listSessions: false,
  readHistory: false,
  createSession: false,
  appendEvents: false,
  resumeSession: false,
  importHistory: false,
  structuredTools: false,
  attachments: false,
  branches: false,
  checkpoints: false,
  officialApi: false,
  nativeWrite: false,
  readback: false,
});

export function normalizeCapabilities(value = {}) {
  return { ...DEFAULT_CAPABILITIES, ...value };
}

export function planProjection(session, targetStatus, { policy = "balanced" } = {}) {
  const capabilities = normalizeCapabilities(targetStatus.capabilities);
  let mode = "handoff-file";
  let risk = "low";
  if (capabilities.officialApi && capabilities.importHistory) {
    mode = "official-import";
  } else if (capabilities.nativeWrite && capabilities.structuredTools) {
    mode = "structured-native";
    risk = "medium";
  } else if (capabilities.nativeWrite || targetStatus.write) {
    mode = "transcript-native";
    risk = "medium";
  } else if (capabilities.createSession) {
    mode = "handoff-native";
  }
  if (policy === "handoff-only") mode = capabilities.createSession || targetStatus.write ? "handoff-native" : "handoff-file";
  const branches = new Set(session.events.map((event) => event.branchId ?? "main"));
  const warnings = [];
  if (branches.size > 1 && !capabilities.branches) warnings.push(`${branches.size} branches will be linearized.`);
  if (session.events.some((event) => event.kind === "tool_call") && !capabilities.structuredTools) warnings.push("Tool calls will be rendered as inert historical text.");
  if (!capabilities.resumeSession) warnings.push("Native reopen/resume is not guaranteed by an official interface.");
  if (!capabilities.readback) warnings.push("The target cannot be read back for end-to-end verification.");
  return {
    target: targetStatus.id,
    mode,
    policy,
    risk,
    capabilities,
    warnings,
    resumable: capabilities.resumeSession,
    verifiable: capabilities.readback,
  };
}

export function projectSession(input, plan) {
  const session = structuredClone(upgradeSession(input));
  const counts = { exact: 0, mapped: 0, flattened: 0, summarized: 0, omitted: 0 };
  const warnings = [...plan.warnings];
  let capsule = null;

  if (["handoff-native", "handoff-file"].includes(plan.mode)) {
    capsule = createHandoffCapsule(session, { targetAgent: plan.target });
    const projectedSession = handoffSession(session, capsule);
    counts.summarized = session.events.length;
    return { projectedSession, capsule, manifest: manifestFor(session, plan, counts, warnings) };
  }

  session.events = session.events.flatMap((event) => {
    if (event.kind === "reasoning") {
      counts.omitted += 1;
      return [];
    }
    if (["tool_call", "tool_result"].includes(event.kind) && !plan.capabilities.structuredTools) {
      counts.flattened += 1;
      return [{
        ...event,
        kind: "message",
        type: "message.assistant",
        role: "assistant",
        text: historicalToolText(event),
        content: [{ type: "text", text: historicalToolText(event) }],
        portability: {
          class: "flattened",
          fidelity: 0.68,
          warnings: ["Structured tool semantics were flattened; this is not an executable tool call."],
        },
        provenance: { ...event.provenance, transform: "flatten-tool-as-history" },
      }];
    }
    if (["checkpoint", "artifact", "state"].includes(event.kind) && !plan.capabilities[event.kind === "checkpoint" ? "checkpoints" : "attachments"]) {
      counts.mapped += 1;
      const mappedText = `[Imported ${event.kind} · historical context]\n${event.text || JSON.stringify(event.content ?? [], null, 2)}`;
      return [{
        ...event,
        kind: "message",
        type: "message.assistant",
        role: "assistant",
        text: mappedText,
        content: [{ type: "text", text: mappedText }],
        portability: { class: "mapped", fidelity: 0.72, warnings: [`${event.kind} has no native target representation.`] },
        provenance: { ...event.provenance, transform: `flatten-${event.kind}-as-history` },
      }];
    }
    if ((event.branchId ?? "main") !== "main" && !plan.capabilities.branches) {
      counts.mapped += 1;
      return [{
        ...event,
        text: `[Branch ${event.branchId}]\n${event.text}`,
        content: [{ type: "text", text: `[Branch ${event.branchId}]\n${event.text}` }],
        branchId: "main",
        portability: { class: "mapped", fidelity: 0.86, warnings: ["Branch identity was converted to a text marker."] },
      }];
    }
    counts.exact += 1;
    return [event];
  });
  session.extensions = {
    ...session.extensions,
    projection: { target: plan.target, mode: plan.mode, generatedAt: new Date().toISOString() },
  };
  return { projectedSession: session, capsule, manifest: manifestFor(input, plan, counts, warnings) };
}

function manifestFor(session, plan, counts, warnings) {
  const total = Math.max(session.events.length, 1);
  const semantic = (counts.exact + counts.mapped * 0.86 + counts.flattened * 0.68 + counts.summarized * 0.55) / total;
  const toolsTotal = session.events.filter((event) => ["tool_call", "tool_result"].includes(event.kind)).length;
  const tools = toolsTotal ? (plan.capabilities.structuredTools ? 1 : plan.mode.startsWith("handoff") ? 0.45 : 0.62) : 1;
  const axes = {
    context: roundScore(plan.mode.startsWith("handoff") ? 0.64 : 0.96),
    semantics: roundScore(semantic),
    tools: roundScore(tools),
    resume: roundScore(plan.resumable ? 1 : plan.mode === "official-import" ? 0.85 : 0.58),
    verification: roundScore(plan.verifiable ? 0.9 : 0.35),
  };
  const fidelity = roundScore(axes.context * 0.28 + axes.semantics * 0.28 + axes.tools * 0.16 + axes.resume * 0.18 + axes.verification * 0.10);
  return {
    schema: "asif/conversion-manifest/1",
    target: plan.target,
    mode: plan.mode,
    policy: plan.policy,
    risk: plan.risk,
    sourceRevision: session.revision?.id,
    eventCount: session.events.length,
    counts,
    axes,
    fidelity,
    grade: fidelity >= 0.9 ? "A" : fidelity >= 0.75 ? "B" : fidelity >= 0.6 ? "C" : "D",
    degraded: counts.flattened > 0 || counts.summarized > 0 || counts.omitted > 0 || fidelity < 0.8,
    warnings: [...new Set(warnings)],
    generatedAt: new Date().toISOString(),
  };
}

function historicalToolText(event) {
  if (event.kind === "tool_call") {
    const input = typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {}, null, 2);
    return `[Imported tool call · historical only]\nTool: ${event.name ?? event.text ?? "unknown"}\n${input}`;
  }
  return `[Imported tool result${event.isError ? " · error" : ""} · historical only]\n${event.text}`;
}

function roundScore(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}
