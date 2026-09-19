import path from "node:path";
import { iso, newCanonicalId, sha256, stableId, titleFromEvents } from "./util.mjs";

export const ASIF_SCHEMA = "asif/2";
export const LEGACY_ASIF_SCHEMA = "asif/1";

const EVENT_TYPES = new Set([
  "message.user", "message.assistant", "message.system", "message.developer",
  "tool.call", "tool.result", "reasoning", "checkpoint", "artifact", "state",
]);

export function createSession({
  id = newCanonicalId(),
  origin,
  origins,
  cwd,
  project,
  title,
  createdAt,
  updatedAt,
  events = [],
  state,
  merge,
  extensions = {},
}) {
  let previousId = null;
  let turn = 0;
  const normalizedEvents = events.map((event, index) => {
    if ((event.role === "user" || event.type === "message.user") && event.kind !== "tool_result") turn += 1;
    const normalized = normalizeEvent(event, index, {
      previousId,
      turnId: event.turnId ?? `turn_${String(Math.max(turn, 1)).padStart(4, "0")}`,
    });
    previousId = normalized.id;
    return normalized;
  });
  const created = createdAt ?? normalizedEvents[0]?.timestamp ?? iso();
  const updated = updatedAt ?? normalizedEvents.at(-1)?.timestamp ?? created;
  const primaryOrigin = normalizeOrigin(origin ?? origins?.[0], id);
  const normalizedOrigins = uniqueOrigins([primaryOrigin, ...(origins ?? []).map((item) => normalizeOrigin(item, id))]);
  const session = {
    $schema: ASIF_SCHEMA,
    id,
    revision: createRevision(id, 1, [], updated),
    lineage: { rootSessionId: id, ancestors: [] },
    title: title || titleFromEvents(normalizedEvents),
    project: normalizeProject(project ?? { cwd }),
    createdAt: iso(created),
    updatedAt: iso(updated),
    origin: primaryOrigin,
    origins: normalizedOrigins,
    heads: eventHeads(normalizedEvents),
    events: normalizedEvents,
    state: state ?? buildPortableState({ events: normalizedEvents }),
    merge: normalizeMerge(merge),
    extensions,
  };
  return session;
}

export function normalizeEvent(event, index = 0, context = {}) {
  const timestamp = iso(event.timestamp ?? Date.now() + index);
  const kind = legacyKind(event);
  const role = event.role ?? roleForType(event.type) ?? (kind === "tool_result" ? "tool" : "assistant");
  const text = typeof event.text === "string"
    ? event.text
    : event.text == null
      ? textFromBlocks(event.content)
      : JSON.stringify(event.text);
  const type = normalizeEventType(event.type, kind, role);
  const id = event.id || `evt_${sha256(`${timestamp}:${type}:${role}:${text}:${index}`).slice(0, 28)}`;
  const content = normalizeContent(event.content, text, type, event);
  const source = event.source ?? event.provenance?.source;
  const callId = event.callId ?? event.tool?.callId ?? event.result?.callId;
  const name = event.name ?? event.tool?.name;
  const input = event.input ?? event.tool?.input;
  const isError = event.isError ?? event.result?.isError;
  return {
    id,
    timestamp,
    type,
    kind,
    role,
    text,
    content,
    actor: event.actor ?? { role, agent: source?.agent },
    turnId: event.turnId ?? context.turnId ?? `turn_${String(index + 1).padStart(4, "0")}`,
    branchId: event.branchId ?? "main",
    parentIds: [...new Set(event.parentIds ?? (context.previousId ? [context.previousId] : []))],
    sequence: {
      ingest: Number(event.sequence?.ingest ?? index),
      native: event.sequence?.native ?? event.source?.nativeSequence ?? index,
    },
    provenance: {
      source: source ?? { agent: "unknown" },
      capturedAt: iso(event.provenance?.capturedAt ?? timestamp),
      transform: event.provenance?.transform ?? "lossless-normalize",
    },
    portability: {
      class: event.portability?.class ?? "portable",
      fidelity: clampScore(event.portability?.fidelity ?? 1),
      warnings: [...(event.portability?.warnings ?? [])],
    },
    ...(name || callId || input !== undefined ? { tool: { name, callId, input } } : {}),
    ...(callId || isError !== undefined || kind === "tool_result" ? { result: { callId, isError: Boolean(isError) } } : {}),
    ...(name ? { name } : {}),
    ...(callId ? { callId } : {}),
    ...(input !== undefined ? { input } : {}),
    ...(isError !== undefined ? { isError: Boolean(isError) } : {}),
    ...(source ? { source } : {}),
    ...(event.supersedes?.length ? { supersedes: [...new Set(event.supersedes)] } : {}),
  };
}

export function upgradeSession(input) {
  if (!input || typeof input !== "object") return input;
  if (input.$schema === ASIF_SCHEMA && input.revision && input.state && Array.isArray(input.origins)) {
    return { ...input, merge: normalizeMerge(input.merge) };
  }
  const upgraded = createSession({
    id: input.id,
    origin: input.origin,
    origins: input.origins,
    project: input.project,
    cwd: input.project?.cwd,
    title: input.title,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    events: input.events ?? [],
    state: input.state,
    merge: input.merge,
    extensions: { ...input.extensions, asifMigration: { from: input.$schema ?? "unknown", at: iso() } },
  });
  upgraded.lineage = input.lineage ?? upgraded.lineage;
  upgraded.revision = input.revision ?? upgraded.revision;
  return upgraded;
}

export function validateSession(session) {
  const errors = [];
  if (!session || typeof session !== "object") errors.push("session must be an object");
  if (![ASIF_SCHEMA, LEGACY_ASIF_SCHEMA].includes(session?.$schema)) errors.push(`$schema must equal ${ASIF_SCHEMA}`);
  if (typeof session?.id !== "string" || !session.id) errors.push("id is required");
  if (typeof session?.project?.cwd !== "string" || !session.project.cwd) errors.push("project.cwd is required");
  if (!Array.isArray(session?.events)) errors.push("events must be an array");
  for (const [index, event] of (session?.events ?? []).entries()) {
    if (!event.id) errors.push(`events[${index}].id is required`);
    if (!event.timestamp || Number.isNaN(new Date(event.timestamp).getTime())) errors.push(`events[${index}].timestamp is invalid`);
    if (!event.kind && !event.type) errors.push(`events[${index}].type is required`);
  }
  for (const [index, conflict] of (session?.merge?.conflicts ?? []).entries()) {
    if (!conflict.id) errors.push(`merge.conflicts[${index}].id is required`);
    if (!['unresolved', 'resolved'].includes(conflict.status)) errors.push(`merge.conflicts[${index}].status is invalid`);
    if (!Array.isArray(conflict.variants) || conflict.variants.length < 2) errors.push(`merge.conflicts[${index}].variants requires two entries`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertSession(session) {
  const result = validateSession(session);
  if (!result.ok) throw new Error(`Invalid ASIF session: ${result.errors.join("; ")}`);
  return session;
}

export function mergeSessions(current, incoming) {
  const next = upgradeSession(incoming);
  if (!current) return next;
  const base = upgradeSession(current);
  if (base.id !== next.id) throw new Error(`Cannot merge different ASIF sessions: ${base.id} != ${next.id}`);
  const eventMap = new Map(base.events.map((event) => [event.id, event]));
  const orderedIds = base.events.map((event) => event.id);
  let addedEvents = 0;
  for (const event of next.events) {
    const existing = eventMap.get(event.id);
    if (existing) {
      const observedSources = uniqueSources([
        ...(existing.provenance?.observedSources ?? []),
        existing.source,
        ...(event.provenance?.observedSources ?? []),
        event.source,
      ]);
      eventMap.set(event.id, {
        ...event,
        // An existing canonical event is immutable semantic history. A lossy
        // target readback may reuse its stable ID but must never flatten the
        // canonical tool/branch/content representation on the next sync loop.
        ...existing,
        provenance: { ...existing.provenance, observedSources },
        portability: {
          ...existing.portability,
          fidelity: Math.min(existing.portability?.fidelity ?? 1, event.portability?.fidelity ?? 1),
          warnings: [...new Set([...(existing.portability?.warnings ?? []), ...(event.portability?.warnings ?? [])])],
        },
      });
    } else {
      addedEvents += 1;
      orderedIds.push(event.id);
      eventMap.set(event.id, event);
    }
  }
  const events = orderedIds.map((id, index) => ({
    ...eventMap.get(id),
    sequence: { ...eventMap.get(id).sequence, ingest: index },
  }));
  const revisionNumber = Math.max(base.revision?.number ?? 1, next.revision?.number ?? 1) + 1;
  const updatedAt = iso(Math.max(new Date(base.updatedAt).getTime(), new Date(next.updatedAt).getTime()));
  if (addedEvents === 0) {
    return {
      ...base,
      updatedAt,
      origins: uniqueOrigins([...(base.origins ?? [base.origin]), ...(next.origins ?? [next.origin])]),
      events,
      extensions: { ...base.extensions, ...next.extensions },
    };
  }
  return {
    ...base,
    $schema: ASIF_SCHEMA,
    revision: createRevision(base.id, revisionNumber, [base.revision?.id, next.revision?.id].filter(Boolean), updatedAt),
    lineage: {
      rootSessionId: base.lineage?.rootSessionId ?? base.id,
      ancestors: [...new Set([...(base.lineage?.ancestors ?? []), ...(next.lineage?.ancestors ?? [])])],
    },
    title: base.title || next.title || titleFromEvents(events),
    project: next.project?.cwd ? { ...base.project, ...next.project } : base.project,
    updatedAt,
    origin: base.origin,
    origins: uniqueOrigins([...(base.origins ?? [base.origin]), ...(next.origins ?? [next.origin])]),
    heads: eventHeads(events),
    events,
    state: buildPortableState({ events, previous: { ...base.state, ...next.state } }),
    extensions: { ...base.extensions, ...next.extensions },
  };
}

export function inferCommonBase(current, incoming, revisionId) {
  const left = upgradeSession(current);
  const right = upgradeSession(incoming);
  const rightMap = new Map(right.events.map((event) => [event.id, event]));
  const events = left.events.filter((event) => {
    const candidate = rightMap.get(event.id);
    return candidate && sameEventSemantics(event, candidate);
  });
  const inferred = createSession({
    id: left.id,
    origin: left.origin,
    origins: left.origins,
    project: left.project,
    title: left.title,
    createdAt: left.createdAt,
    updatedAt: events.at(-1)?.timestamp ?? left.createdAt,
    events,
    extensions: { inferredCommonBase: true },
  });
  inferred.revision = {
    ...inferred.revision,
    id: revisionId ?? inferred.revision.id,
    number: Math.max(1, Math.min(left.revision?.number ?? 1, right.revision?.number ?? 1)),
    parents: [],
  };
  return inferred;
}

export function mergeSessionsThreeWay(baseInput, currentInput, incomingInput, { source = {} } = {}) {
  const base = upgradeSession(baseInput);
  const current = upgradeSession(currentInput);
  const incoming = upgradeSession(incomingInput);
  if (!base || !current) return { session: incoming, branchSession: null, detectedConflicts: 0, concurrent: false };
  if (base.id !== current.id || current.id !== incoming.id) throw new Error("Three-way merge requires the same canonical session id");

  const baseMap = new Map(base.events.map((event) => [event.id, event]));
  const currentMap = new Map(current.events.map((event) => [event.id, event]));
  const orderedIds = current.events.map((event) => event.id);
  const incomingAddedIds = [];
  const conflicts = [...(current.merge?.conflicts ?? [])];
  let changed = false;
  let detectedConflicts = 0;

  for (const incomingEvent of incoming.events) {
    const baseEvent = baseMap.get(incomingEvent.id);
    const currentEvent = currentMap.get(incomingEvent.id);
    if (!baseEvent && !currentEvent) {
      currentMap.set(incomingEvent.id, incomingEvent);
      orderedIds.push(incomingEvent.id);
      incomingAddedIds.push(incomingEvent.id);
      changed = true;
      continue;
    }
    if (!baseEvent && currentEvent) {
      if (sameEventSemantics(currentEvent, incomingEvent) || isSemanticDowngrade(currentEvent, incomingEvent)) {
        currentMap.set(incomingEvent.id, mergeObservedEvent(currentEvent, incomingEvent));
      } else {
        const conflict = createEventConflict({ baseEvent: null, currentEvent, incomingEvent, base, current, incoming, source, kind: "event-id-collision" });
        if (!conflicts.some((item) => item.id === conflict.id)) {
          conflicts.push(conflict);
          detectedConflicts += 1;
        }
      }
      continue;
    }
    if (!currentEvent) {
      // Native coding-agent transcripts are append-only. Absence in one
      // projection is not interpreted as a deletion.
      continue;
    }
    const currentChanged = !sameEventSemantics(currentEvent, baseEvent);
    const incomingChanged = !sameEventSemantics(incomingEvent, baseEvent);
    if (!incomingChanged || sameEventSemantics(currentEvent, incomingEvent) || isSemanticDowngrade(currentEvent, incomingEvent)) {
      currentMap.set(incomingEvent.id, mergeObservedEvent(currentEvent, incomingEvent));
      continue;
    }
    if (!currentChanged) {
      currentMap.set(incomingEvent.id, mergeObservedEvent(incomingEvent, currentEvent));
      changed = true;
      continue;
    }
    const conflict = createEventConflict({ baseEvent, currentEvent, incomingEvent, base, current, incoming, source, kind: "concurrent-event-edit" });
    if (!conflicts.some((item) => item.id === conflict.id)) {
      conflicts.push(conflict);
      detectedConflicts += 1;
    }
  }

  const currentAddedIds = current.events.filter((event) => !baseMap.has(event.id)).map((event) => event.id);
  const concurrent = current.revision.id !== base.revision.id
    && (incomingAddedIds.length > 0 || detectedConflicts > 0)
    && (currentAddedIds.length > 0 || current.events.some((event) => {
      const baseEvent = baseMap.get(event.id);
      return baseEvent && !sameEventSemantics(event, baseEvent);
    }));
  const sourceIdentity = {
    agent: source.agent ?? incoming.origin?.agent ?? "unknown",
    sessionId: source.sessionId ?? incoming.origin?.sessionId ?? "unknown",
  };
  const incomingBranchId = branchIdFor(sourceIdentity);
  if (concurrent) {
    for (const eventId of currentAddedIds) {
      const event = currentMap.get(eventId);
      if (event?.branchId === "main") currentMap.set(eventId, { ...event, branchId: branchIdFor(event.source ?? event.provenance?.source ?? current.origin) });
    }
    for (const eventId of incomingAddedIds) {
      const event = currentMap.get(eventId);
      if (event) currentMap.set(eventId, { ...event, branchId: event.branchId === "main" ? incomingBranchId : event.branchId });
    }
  }

  if (!changed && detectedConflicts === 0) {
    return {
      session: {
        ...current,
        origins: uniqueOrigins([...(current.origins ?? [current.origin]), ...(incoming.origins ?? [incoming.origin])]),
        events: orderedIds.map((id, index) => ({ ...currentMap.get(id), sequence: { ...currentMap.get(id).sequence, ingest: index } })),
      },
      branchSession: null,
      detectedConflicts: 0,
      concurrent: false,
    };
  }

  const updatedAt = iso(Math.max(new Date(current.updatedAt).getTime(), new Date(incoming.updatedAt).getTime()));
  const branchRevision = concurrent
    ? createRevision(current.id, Math.max(base.revision.number + 1, incoming.revision?.number ?? 1), [base.revision.id], updatedAt, {
      kind: "branch",
      agent: sourceIdentity.agent,
      sessionId: sourceIdentity.sessionId,
    })
    : null;
  const revisionParents = concurrent ? [current.revision.id, branchRevision.id] : [current.revision.id];
  const revision = createRevision(current.id, Math.max(current.revision.number, branchRevision?.number ?? 0) + 1, revisionParents, updatedAt, {
    kind: concurrent ? "merge" : "linear",
    baseRevisionId: base.revision.id,
  });
  const events = orderedIds.map((id, index) => ({ ...currentMap.get(id), sequence: { ...currentMap.get(id).sequence, ingest: index } }));
  const branches = [...(current.merge?.branches ?? [])];
  if (concurrent && !branches.some((branch) => branch.revisionId === branchRevision.id)) {
    branches.push({
      id: incomingBranchId,
      agent: sourceIdentity.agent,
      sessionId: sourceIdentity.sessionId,
      baseRevisionId: base.revision.id,
      revisionId: branchRevision.id,
      eventIds: incomingAddedIds,
      createdAt: updatedAt,
    });
  }
  const merge = normalizeMerge({
    ...current.merge,
    status: conflicts.some((conflict) => conflict.status === "unresolved") ? "conflicted" : concurrent ? "merged" : "clean",
    baseRevisionId: base.revision.id,
    branches,
    conflicts,
    lastMergedAt: updatedAt,
  });
  const session = {
    ...current,
    revision,
    updatedAt,
    origins: uniqueOrigins([...(current.origins ?? [current.origin]), ...(incoming.origins ?? [incoming.origin])]),
    heads: eventHeads(events),
    events,
    state: buildPortableState({ events, previous: { ...current.state, ...incoming.state } }),
    merge,
    extensions: { ...current.extensions, ...incoming.extensions },
  };
  const branchSession = branchRevision ? {
    ...incoming,
    revision: branchRevision,
    merge: normalizeMerge({ status: "branch", baseRevisionId: base.revision.id, branches: [], conflicts: [] }),
  } : null;
  return { session, branchSession, detectedConflicts, concurrent };
}

export function resolveSessionConflict(input, conflictId, strategy = "both") {
  const session = upgradeSession(input);
  const conflict = session.merge.conflicts.find((item) => item.id === conflictId);
  if (!conflict) throw new Error(`Conflict not found: ${conflictId}`);
  if (conflict.status === "resolved") return session;
  if (!['both', 'current', 'incoming'].includes(strategy)) throw new Error("Conflict strategy must be both, current, or incoming");
  const currentVariant = conflict.variants.find((variant) => variant.side === "current");
  const incomingVariant = conflict.variants.find((variant) => variant.side === "incoming");
  const selected = strategy === "incoming" ? [incomingVariant] : strategy === "both" ? [currentVariant, incomingVariant] : [currentVariant];
  let retainedEvents = session.events;
  if (strategy === "incoming" && incomingVariant?.event) {
    retainedEvents = session.events.map((event, index) => event.id === conflict.eventId
      ? normalizeEvent({
        ...incomingVariant.event,
        id: conflict.eventId,
        parentIds: event.parentIds,
        branchId: incomingVariant.branchId ?? event.branchId,
        provenance: { ...incomingVariant.event.provenance, transform: "conflict-resolution" },
        portability: {
          ...incomingVariant.event.portability,
          warnings: [...new Set([...(incomingVariant.event.portability?.warnings ?? []), "Selected from a concurrent session variant."])],
        },
      }, index)
      : event);
  }
  const addedEvents = [];
  for (const variant of (strategy === "both" ? selected : []).filter(Boolean)) {
    if (variant.side === "current") continue;
    addedEvents.push(normalizeEvent({
      ...variant.event,
      id: stableId("evt_resolution_", `${session.id}:${conflict.id}:${variant.id}`, 24),
      timestamp: iso(),
      branchId: variant.branchId,
      parentIds: session.heads,
      supersedes: [conflict.eventId].filter(Boolean),
      provenance: { ...variant.event.provenance, transform: "conflict-resolution" },
      portability: { ...variant.event.portability, warnings: [...new Set([...(variant.event.portability?.warnings ?? []), "Selected from a concurrent session variant."])] },
    }, session.events.length + addedEvents.length));
  }
  const resolutionEvent = normalizeEvent({
    id: stableId("evt_resolution_", `${session.id}:${conflict.id}:${strategy}:checkpoint`, 24),
    timestamp: iso(),
    type: "checkpoint",
    kind: "checkpoint",
    role: "system",
    text: `[Bridge merge resolution] ${strategy} selected for ${conflict.kind} ${conflict.eventId ?? conflict.id}.`,
    branchId: "main",
    parentIds: [...new Set([...session.heads, ...addedEvents.map((event) => event.id)])],
    source: { agent: "agent-session-bridge", sessionId: session.id },
    portability: { class: "portable", fidelity: 1, warnings: [] },
  }, session.events.length + addedEvents.length);
  const events = [...retainedEvents, ...addedEvents, resolutionEvent].map((event, index) => ({ ...event, sequence: { ...event.sequence, ingest: index } }));
  const resolvedAt = iso();
  const conflicts = session.merge.conflicts.map((item) => item.id === conflictId ? {
    ...item,
    status: "resolved",
    resolution: { strategy, selectedVariantIds: selected.filter(Boolean).map((variant) => variant.id), eventId: resolutionEvent.id, resolvedAt },
  } : item);
  return {
    ...session,
    revision: createRevision(session.id, session.revision.number + 1, [session.revision.id], resolvedAt, { kind: "resolution", conflictId }),
    updatedAt: resolvedAt,
    heads: eventHeads(events),
    events,
    state: buildPortableState({ events, previous: session.state }),
    merge: normalizeMerge({
      ...session.merge,
      conflicts,
      status: conflicts.some((item) => item.status === "unresolved") ? "conflicted" : "resolved",
      lastMergedAt: resolvedAt,
    }),
  };
}

export function buildPortableState(session = {}) {
  const events = session.events ?? [];
  const messages = events.filter((event) => event.kind === "message" && event.text?.trim());
  const toolCalls = new Map(events.filter((event) => event.kind === "tool_call").map((event) => [event.callId, event]));
  const touchedFiles = new Set(session.previous?.touchedFiles ?? []);
  const commands = [];
  const tests = [];
  for (const event of events) {
    collectPaths(event.input, touchedFiles);
    for (const match of String(event.text ?? "").matchAll(/(?:^|\s)([\w./-]+\.(?:js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|json|ya?ml|toml|md|css|html|sql))(?:\s|$)/g)) touchedFiles.add(match[1]);
    if (event.kind === "tool_call" && /(?:shell|exec|command|terminal|bash)/i.test(event.name ?? "")) {
      const command = typeof event.input === "string" ? event.input : event.input?.cmd ?? event.input?.command;
      if (command) commands.push({ callId: event.callId, command: String(command).slice(0, 1000), status: "unknown" });
    }
    if (event.kind === "tool_result") {
      const call = toolCalls.get(event.callId);
      const command = typeof call?.input === "string" ? call.input : call?.input?.cmd ?? call?.input?.command;
      const outcome = event.isError ? "failed" : "passed";
      const commandItem = commands.find((item) => item.callId && item.callId === event.callId);
      if (commandItem) commandItem.status = outcome;
      if (/\b(?:test|pytest|vitest|jest|cargo test|go test|npm test)\b/i.test(command ?? call?.name ?? "")) {
        tests.push({ command: String(command ?? call?.name), outcome, summary: event.text.slice(0, 600) });
      }
    }
  }
  const objective = session.previous?.objective ?? messages.find((event) => event.role === "user")?.text?.slice(0, 2000) ?? "";
  const last = messages.at(-1);
  return {
    objective,
    status: tests.some((test) => test.outcome === "failed") ? "blocked" : last?.role === "assistant" ? "in_progress" : "needs_response",
    summary: last?.role === "assistant" ? last.text.slice(0, 2000) : session.previous?.summary ?? "",
    touchedFiles: [...touchedFiles].slice(0, 500),
    commands: commands.slice(-100),
    tests: tests.slice(-100),
    decisions: session.previous?.decisions ?? [],
    nextActions: session.previous?.nextActions ?? [],
    recentEventIds: events.slice(-24).map((event) => event.id),
    derivedAt: iso(events.at(-1)?.timestamp ?? Date.now()),
    confidence: messages.length ? 0.72 : 0.35,
  };
}

export function createHandoffCapsule(session, { targetAgent = "another coding agent", recentMessages = 12 } = {}) {
  const normalized = upgradeSession(session);
  const recent = normalized.events.filter((event) => event.kind === "message" && event.text).slice(-recentMessages);
  const state = normalized.state ?? buildPortableState(normalized);
  const lines = [
    `# Coding-agent handoff: ${normalized.title}`,
    "",
    `Canonical session: ${normalized.id}`,
    `Project: ${normalized.project.cwd}`,
    `Target: ${targetAgent}`,
    `Last updated: ${normalized.updatedAt}`,
    "",
    "## Objective",
    state.objective || "Continue the work represented by the transcript.",
    "",
    "## Current state",
    state.summary || "No reliable generated summary is available. Read the recent transcript below.",
    "",
    "## Changed or referenced files",
    ...(state.touchedFiles.length ? state.touchedFiles.map((file) => `- ${file}`) : ["- None detected"]),
    "",
    "## Verification",
    ...(state.tests.length ? state.tests.map((test) => `- ${test.outcome}: \`${test.command}\` — ${singleLine(test.summary, 240)}`) : ["- No test result was detected"]),
    "",
    "## Recent transcript",
    ...recent.flatMap((event) => [`### ${event.role} · ${event.timestamp}`, event.text, ""]),
    "## Continuation instruction",
    "Treat this as imported historical context. Inspect the working tree and rerun relevant checks before changing files. Do not pretend prior tool calls are active in this agent.",
  ];
  return {
    schema: "asif/handoff/1",
    canonicalId: normalized.id,
    targetAgent,
    createdAt: iso(),
    title: normalized.title,
    project: normalized.project,
    state,
    eventCount: normalized.events.length,
    markdown: lines.join("\n"),
  };
}

export function handoffSession(session, capsule) {
  return createSession({
    id: session.id,
    origin: session.origin,
    origins: session.origins,
    project: session.project,
    title: `[Handoff] ${session.title}`,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    events: [{
      id: stableId("evt_handoff_", `${session.id}:${capsule.targetAgent}`, 24),
      timestamp: session.updatedAt,
      kind: "message",
      role: "user",
      text: capsule.markdown,
      portability: { class: "handoff", fidelity: 0.55, warnings: ["History was collapsed into a continuation capsule."] },
      source: { agent: "agent-session-bridge", sessionId: session.id },
    }],
    state: session.state,
    extensions: { ...session.extensions, handoff: { targetAgent: capsule.targetAgent, eventCount: capsule.eventCount } },
  });
}

export function bridgeMarker(session, extra = {}) {
  const origin = session.origin ?? session.origins?.[0] ?? {};
  return {
    schema: ASIF_SCHEMA,
    canonicalId: session.id,
    revisionId: session.revision?.id,
    sourceAgent: origin.agent,
    sourceSessionId: origin.sessionId,
    ...extra,
  };
}

function normalizeOrigin(origin = {}, id) {
  return {
    agent: origin?.agent ?? "unknown",
    sessionId: origin?.sessionId ?? id,
    ...(origin?.sourceKey ? { sourceKey: origin.sourceKey } : {}),
    capturedAt: iso(origin?.capturedAt ?? Date.now()),
  };
}

function uniqueOrigins(origins) {
  const map = new Map();
  for (const origin of origins.filter(Boolean)) map.set(`${origin.agent}:${origin.sessionId}`, origin);
  return [...map.values()];
}

function uniqueSources(sources) {
  const map = new Map();
  for (const source of sources.filter(Boolean)) map.set(`${source.agent ?? "unknown"}:${source.sessionId ?? "unknown"}:${source.nativeId ?? ""}`, source);
  return [...map.values()];
}

function normalizeMerge(merge = {}) {
  const conflicts = Array.isArray(merge?.conflicts) ? merge.conflicts : [];
  return {
    status: merge?.status ?? (conflicts.some((conflict) => conflict.status === "unresolved") ? "conflicted" : "clean"),
    baseRevisionId: merge?.baseRevisionId ?? null,
    branches: Array.isArray(merge?.branches) ? merge.branches : [],
    conflicts,
    lastMergedAt: merge?.lastMergedAt ?? null,
  };
}

function sameEventSemantics(left, right) {
  if (!left || !right) return false;
  return sha256(JSON.stringify(eventSemanticShape(left))) === sha256(JSON.stringify(eventSemanticShape(right)));
}

function eventSemanticShape(event) {
  return {
    type: event.type,
    kind: event.kind,
    role: event.role,
    text: event.text,
    content: event.content,
    tool: event.tool,
    result: event.result,
    name: event.name,
    callId: event.callId,
    input: event.input,
    isError: event.isError,
    parentIds: event.parentIds ?? [],
  };
}

function semanticRank(event) {
  if (!event) return 0;
  let rank = event.kind === "tool_call" || event.kind === "tool_result" ? 4 : event.kind === "message" ? 2 : 3;
  if (event.content?.some((block) => block.type !== "text")) rank += 2;
  rank += Number(event.portability?.fidelity ?? 1);
  return rank;
}

function isSemanticDowngrade(canonical, observed) {
  if (canonical?.id !== observed?.id) return false;
  if (semanticRank(observed) < semanticRank(canonical)) return true;
  const text = String(observed.text ?? "");
  if (/^\[(?:Branch|Imported tool|Imported checkpoint|Imported artifact|Imported state)\b/.test(text) && text.includes(String(canonical.text ?? ""))) return true;
  if ((canonical.branchId ?? "main") !== "main" && (observed.branchId ?? "main") === "main" && text.includes(String(canonical.text ?? ""))) return true;
  return false;
}

function mergeObservedEvent(preferred, observed) {
  const observedSources = uniqueSources([
    ...(preferred.provenance?.observedSources ?? []),
    preferred.source,
    ...(observed.provenance?.observedSources ?? []),
    observed.source,
  ]);
  return {
    ...preferred,
    provenance: { ...preferred.provenance, observedSources },
    portability: {
      ...preferred.portability,
      fidelity: Math.min(preferred.portability?.fidelity ?? 1, observed.portability?.fidelity ?? 1),
      warnings: [...new Set([...(preferred.portability?.warnings ?? []), ...(observed.portability?.warnings ?? [])])],
    },
  };
}

function createEventConflict({ baseEvent, currentEvent, incomingEvent, base, current, incoming, source, kind }) {
  const currentSource = currentEvent.source ?? currentEvent.provenance?.source ?? current.origin;
  const incomingSource = incomingEvent.source ?? incomingEvent.provenance?.source ?? source ?? incoming.origin;
  const currentVariantId = stableId("variant_", `${current.id}:${currentEvent.id}:current:${sha256(JSON.stringify(eventSemanticShape(currentEvent)))}`, 22);
  const incomingVariantId = stableId("variant_", `${current.id}:${incomingEvent.id}:incoming:${sha256(JSON.stringify(eventSemanticShape(incomingEvent)))}`, 22);
  const id = stableId("conflict_", `${current.id}:${base.revision.id}:${kind}:${currentEvent.id}:${currentVariantId}:${incomingVariantId}`, 24);
  return {
    id,
    kind,
    status: "unresolved",
    eventId: currentEvent.id,
    baseRevisionId: base.revision.id,
    detectedAt: iso(),
    variants: [
      {
        id: currentVariantId,
        side: "current",
        agent: currentSource?.agent ?? "unknown",
        sessionId: currentSource?.sessionId ?? current.origin?.sessionId,
        branchId: branchIdFor(currentSource ?? current.origin),
        event: currentEvent,
      },
      {
        id: incomingVariantId,
        side: "incoming",
        agent: incomingSource?.agent ?? source?.agent ?? "unknown",
        sessionId: incomingSource?.sessionId ?? source?.sessionId ?? incoming.origin?.sessionId,
        branchId: branchIdFor(incomingSource ?? source ?? incoming.origin),
        event: incomingEvent,
      },
    ],
    ...(baseEvent ? { baseEvent } : {}),
  };
}

function branchIdFor(source = {}) {
  return `branch:${source.agent ?? "unknown"}:${stableId("", source.sessionId ?? "session", 8)}`;
}

function normalizeProject(project = {}) {
  const cwd = project.cwd || process.cwd();
  return {
    cwd,
    name: project.name ?? path.basename(cwd),
    roots: project.roots?.length ? project.roots : [cwd],
    logicalId: project.logicalId ?? stableId("project_", path.resolve(cwd), 20),
    ...(project.vcs ? { vcs: project.vcs } : {}),
  };
}

function createRevision(sessionId, number, parents, timestamp, metadata = {}) {
  return {
    id: stableId("rev_", `${sessionId}:${number}:${parents.join(":")}:${timestamp}:${JSON.stringify(metadata)}`, 24),
    number,
    parents: [...new Set(parents)],
    createdAt: iso(timestamp),
    ...metadata,
  };
}

function eventHeads(events) {
  const parents = new Set(events.flatMap((event) => event.parentIds ?? []));
  return events.filter((event) => !parents.has(event.id)).map((event) => event.id);
}

function legacyKind(event) {
  if (event.kind) return event.kind;
  if (event.type === "tool.call") return "tool_call";
  if (event.type === "tool.result") return "tool_result";
  if (event.type?.startsWith("message.")) return "message";
  return event.type === "reasoning" ? "reasoning" : "message";
}

function normalizeEventType(type, kind, role) {
  if (EVENT_TYPES.has(type)) return type;
  if (kind === "tool_call") return "tool.call";
  if (kind === "tool_result") return "tool.result";
  if (kind === "reasoning") return "reasoning";
  if (kind === "checkpoint") return "checkpoint";
  if (kind === "artifact") return "artifact";
  return `message.${["user", "assistant", "system", "developer"].includes(role) ? role : "assistant"}`;
}

function roleForType(type) {
  if (type?.startsWith("message.")) return type.slice("message.".length);
  if (type === "tool.result") return "tool";
  return null;
}

function normalizeContent(content, text, type, event) {
  if (Array.isArray(content) && content.length) return content;
  if (type === "tool.call") return [{ type: "tool-input", name: event.name ?? event.tool?.name, value: event.input ?? event.tool?.input ?? {} }];
  if (type === "tool.result") return [{ type: "tool-output", text, isError: Boolean(event.isError ?? event.result?.isError) }];
  return text ? [{ type: "text", text }] : [];
}

function textFromBlocks(content) {
  if (!Array.isArray(content)) return "";
  return content.map((block) => block?.text ?? block?.value ?? "").filter(Boolean).join("\n");
}

function collectPaths(value, output, depth = 0) {
  if (depth > 5 || value == null) return;
  if (Array.isArray(value)) return value.forEach((item) => collectPaths(item, output, depth + 1));
  if (typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:path|file|filePath|filename|workdir)$/i.test(key) && typeof item === "string" && item.length < 2000) output.add(item);
    else collectPaths(item, output, depth + 1);
  }
}

function clampScore(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function singleLine(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}
