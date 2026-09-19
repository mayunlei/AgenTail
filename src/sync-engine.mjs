import path from "node:path";
import { createHandoffCapsule, inferCommonBase, mergeSessions, mergeSessionsThreeWay, resolveSessionConflict, upgradeSession } from "./asif.mjs";
import { normalizeCapabilities, planProjection, projectSession } from "./conversion.mjs";
import { fileSignature, iso, newCanonicalId, publicPath, writeJson } from "./util.mjs";

export class SyncEngine {
  constructor({ store, adapters }) {
    this.store = store;
    this.adapters = adapters;
    this.timer = null;
    this.running = false;
    this.stopped = false;
  }

  async initialize() {
    await this.store.initialize();
    await this.rebuildIdentityIndex();
    return this;
  }

  async rebuildIdentityIndex() {
    const state = await this.store.state();
    if ((state.identityVersion ?? 0) >= 1) return state;
    const sessions = await this.store.listSessions(10_000);
    const groups = new Map();
    for (const session of sessions) {
      for (const key of sessionIdentityKeys(session)) {
        const group = groups.get(key) ?? [];
        group.push(session);
        groups.set(key, group);
      }
    }
    let duplicates = 0;
    for (const [key, group] of groups) {
      const unique = [...new Map(group.map((session) => [session.id, session])).values()];
      const keeper = choosePreferredCanonical(unique);
      if (!keeper) continue;
      state.identities[key] = resolveCanonicalAlias(state, keeper.id);
      for (const duplicate of unique) {
        if (duplicate.id === keeper.id) continue;
        state.aliases[duplicate.id] = keeper.id;
        duplicates += 1;
      }
    }
    state.identityVersion = 1;
    state.version = 3;
    state.stats.duplicateSessionsDetected += duplicates;
    if (duplicates) {
      this.store.addActivity(state, {
        level: "warn",
        action: "dedupe",
        message: `${duplicates} duplicate canonical session(s) were aliased by native source identity.`,
      });
    }
    await this.store.saveState(state);
    return state;
  }

  async status() {
    const [config, state, agentStatuses, sessions] = await Promise.all([
      this.store.config(),
      this.store.state(),
      this.agentStatuses(),
      this.store.listSessions(200),
    ]);
    const visibleSessions = sessions.filter((session) => !state.aliases[session.id]);
    const sessionSummaries = summarizeSessions(visibleSessions, state, config, agentStatuses);
    const continuity = continuitySummary(sessionSummaries, config, agentStatuses, state);
    const agents = agentStatuses.map((agent) => {
      const selected = Boolean(config.selectedAgents[agent.id]);
      const cells = sessionSummaries.flatMap((session) => session.targets.filter((target) => target.agent === agent.id));
      return {
        ...agent,
        capabilities: normalizeCapabilities(agent.capabilities),
        selected,
        coverage: {
          total: cells.length,
          available: cells.filter((cell) => ["source", "verified", "synced"].includes(cell.state)).length,
          verified: cells.filter((cell) => ["source", "verified"].includes(cell.state)).length,
          degraded: cells.filter((cell) => cell.degraded).length,
        },
      };
    });
    return {
      product: {
        name: "Agentail",
        version: "0.5.1",
        protocol: "ASIF/2",
        slogan: { en: "Any agent. Same trail.", zh: "Agent 随心换，上下文不断。" },
      },
      home: publicPath(this.store.root),
      config,
      stats: state.stats,
      baselineReady: state.baselineReady,
      continuity,
      sessions: sessionSummaries,
      activity: state.activity,
      agents,
      daemon: { running: !this.stopped, syncing: this.running },
    };
  }

  async agentStatuses() {
    return Promise.all([...this.adapters.values()].map(async (adapter) => {
      try { return await adapter.status(); }
      catch (error) {
        return {
          id: adapter.id,
          name: adapter.name,
          detected: false,
          read: false,
          write: false,
          compatibility: "error",
          capabilities: normalizeCapabilities(),
          note: error.message,
        };
      }
    }));
  }

  async listSessions(agentId, limit = 50) {
    const adapter = this.requireAdapter(agentId);
    const config = await this.store.config();
    const sessions = await adapter.discover(config);
    return sessions.slice(0, Math.max(1, Math.min(200, limit))).map((session) => ({
      agent: agentId,
      key: session.key,
      sessionId: session.sessionId,
      title: session.title,
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      bridged: Boolean(session.canonicalId),
    }));
  }

  async listCanonicalSessions(limit = 100) {
    const [config, state, agentStatuses, sessions] = await Promise.all([
      this.store.config(),
      this.store.state(),
      this.agentStatuses(),
      this.store.listSessions(Math.max(1, Math.min(200, limit))),
    ]);
    return summarizeSessions(sessions.filter((session) => !state.aliases[session.id]), state, config, agentStatuses);
  }

  async baseline({ agentIds } = {}) {
    const [config, state] = await Promise.all([this.store.config(), this.store.state()]);
    const selected = selectedAgentIds(config);
    const requested = new Set(agentIds?.length ? agentIds : selected);
    let count = 0;
    for (const [agentId, adapter] of this.adapters) {
      if (!config.selectedAgents[agentId] || !requested.has(agentId)) continue;
      try {
        const sessions = await adapter.discover(config);
        for (const descriptor of sessions) {
          const key = sourceStateKey(agentId, descriptor.key);
          const identityKey = descriptorIdentityKey(agentId, descriptor);
          const canonicalId = resolveCanonicalAlias(state,
            (identityKey ? state.identities[identityKey] : null)
            ?? descriptor.canonicalId
            ?? state.sources[key]?.canonicalId);
          if (identityKey && canonicalId) state.identities[identityKey] = canonicalId;
          state.sources[key] = {
            agent: agentId,
            key: descriptor.key,
            signature: descriptor.signature,
            canonicalId,
            seenAt: iso(),
          };
          count += 1;
        }
        if (!state.baselinedAgents.includes(agentId)) state.baselinedAgents.push(agentId);
      } catch (error) {
        state.stats.errors += 1;
        this.store.addActivity(state, { level: "error", action: "baseline", agent: agentId, message: error.message });
      }
    }
    state.baselineReady = selected.every((agentId) => state.baselinedAgents.includes(agentId));
    state.stats.lastRunAt = iso();
    this.store.addActivity(state, { level: "info", action: "baseline", message: `Baseline captured for ${count} sessions; future changes will sync.` });
    await this.store.saveState(state);
    return { baseline: count, written: 0, changed: 0 };
  }

  async syncOnce({ includeExisting = false } = {}) {
    if (this.running) return { skipped: true, reason: "sync already running" };
    this.running = true;
    try {
      const [config, state] = await Promise.all([this.store.config(), this.store.state()]);
      const selectedAgents = selectedAgentIds(config);
      const missingBaselines = selectedAgents.filter((agentId) => !state.baselinedAgents.includes(agentId));
      if ((!state.baselineReady || missingBaselines.length) && !includeExisting && config.initialSync === "new-only") {
        return await this.baseline({ agentIds: missingBaselines.length ? missingBaselines : selectedAgents });
      }
      const summary = { scanned: 0, changed: 0, written: 0, errors: 0 };
      const discoveries = [];
      for (const [agentId, adapter] of this.adapters) {
        if (!config.selectedAgents[agentId]) continue;
        let sessions;
        try { sessions = await adapter.discover(config); }
        catch (error) {
          summary.errors += 1;
          state.stats.errors += 1;
          this.store.addActivity(state, { level: "error", action: "discover", agent: agentId, message: error.message });
          continue;
        }
        for (const descriptor of sessions) {
          const previousSource = state.sources[sourceStateKey(agentId, descriptor.key)];
          const identityKey = descriptorIdentityKey(agentId, descriptor);
          const canonicalId = resolveCanonicalAlias(state,
            (identityKey ? state.identities[identityKey] : null)
            ?? descriptor.canonicalId
            ?? previousSource?.canonicalId);
          if (identityKey && canonicalId) state.identities[identityKey] = canonicalId;
          const mapping = canonicalId ? state.mappings[canonicalId]?.[agentId] : null;
          discoveries.push({
            agentId,
            adapter,
            descriptor,
            previousSource,
            identityKey,
            canonicalId,
            baseRevisionId: previousSource?.baseRevisionId ?? mapping?.projection?.sourceRevision ?? null,
          });
        }
      }
      // Freeze both discovery metadata and parsed source sessions before any
      // projection write. Otherwise writing branch A into branch B can erase
      // the evidence that B independently changed from their common base.
      const pending = [];
      for (const discovery of discoveries) {
        const { agentId, adapter, descriptor, previousSource } = discovery;
        summary.scanned += 1;
        if (!includeExisting && previousSource?.signature === descriptor.signature) continue;
        try {
          const canonicalId = resolveCanonicalAlias(state,
            (discovery.identityKey ? state.identities[discovery.identityKey] : null)
            ?? discovery.canonicalId
            ?? newCanonicalId());
          if (discovery.identityKey) state.identities[discovery.identityKey] = canonicalId;
          const incoming = await adapter.read(descriptor, { canonicalId, contentPolicy: config.contentPolicy });
          if (config.contentPolicy === "messages-only") incoming.events = incoming.events.filter((event) => event.kind === "message");
          pending.push({ ...discovery, canonicalId, incoming });
        } catch (error) {
          summary.errors += 1;
          state.stats.errors += 1;
          this.store.addActivity(state, { level: "error", action: "read", agent: agentId, message: `${descriptor.title ?? descriptor.sessionId}: ${error.message}` });
        }
      }
      for (const { agentId, adapter, descriptor, canonicalId, incoming, baseRevisionId } of pending) {
        try {
          const result = await this.processDescriptor({ adapter, descriptor, config, state, canonicalId, incoming, baseRevisionId });
          summary.changed += 1;
          summary.written += result.written;
          summary.errors += result.errors;
        } catch (error) {
          summary.errors += 1;
          state.stats.errors += 1;
          this.store.addActivity(state, { level: "error", action: "sync", agent: agentId, message: `${descriptor.title ?? descriptor.sessionId}: ${error.message}` });
        }
      }
      for (const agentId of selectedAgents) if (!state.baselinedAgents.includes(agentId)) state.baselinedAgents.push(agentId);
      state.baselineReady = selectedAgents.every((agentId) => state.baselinedAgents.includes(agentId));
      state.stats.syncRuns += 1;
      state.stats.lastRunAt = iso();
      await this.store.saveState(state);
      return summary;
    } finally {
      this.running = false;
    }
  }

  async importSession({ sourceAgent, sourceKey, targets }) {
    if (this.running) throw new Error("A sync is already running");
    this.running = true;
    try {
      const [config, state] = await Promise.all([this.store.config(), this.store.state()]);
      const adapter = this.requireAdapter(sourceAgent);
      const sessions = await adapter.discover({ ...config, historyDays: Math.max(config.historyDays, 3650) });
      const descriptor = sessions.find((session) => session.key === sourceKey || session.sessionId === sourceKey);
      if (!descriptor) throw new Error(`Session not found in ${sourceAgent}: ${sourceKey}`);
      const allowedTargets = targets?.length ? targets : selectedAgentIds(config);
      const result = await this.processDescriptor({ adapter, descriptor, config, state, targets: allowedTargets, force: true });
      const selected = selectedAgentIds(config);
      state.baselineReady = selected.every((agentId) => state.baselinedAgents.includes(agentId));
      state.stats.lastRunAt = iso();
      await this.store.saveState(state);
      return { canonicalId: result.session.id, written: result.written, errors: result.errors, targets: result.targets, projections: result.projections };
    } finally {
      this.running = false;
    }
  }

  async processDescriptor({ adapter, descriptor, config, state, targets, force = false, canonicalId: frozenCanonicalId, incoming: frozenIncoming, baseRevisionId: frozenBaseRevisionId }) {
    const sourceKey = sourceStateKey(adapter.id, descriptor.key);
    const prior = state.sources[sourceKey];
    const identityKey = descriptorIdentityKey(adapter.id, descriptor);
    const canonicalId = resolveCanonicalAlias(state,
      frozenCanonicalId
      ?? (identityKey ? state.identities[identityKey] : null)
      ?? descriptor.canonicalId
      ?? prior?.canonicalId
      ?? newCanonicalId());
    const incoming = frozenIncoming ?? await adapter.read(descriptor, { canonicalId, contentPolicy: config.contentPolicy });
    if (config.contentPolicy === "messages-only") incoming.events = incoming.events.filter((event) => event.kind === "message");
    const current = await this.store.loadSession(canonicalId);
    const currentMapping = state.mappings[canonicalId]?.[adapter.id];
    const baseRevisionId = frozenBaseRevisionId ?? prior?.baseRevisionId ?? currentMapping?.projection?.sourceRevision ?? current?.revision?.id;
    if (current) await this.store.saveRevision(current);
    let mergeResult = null;
    if (current && baseRevisionId) {
      let base = baseRevisionId === current.revision.id ? current : await this.store.loadRevision(canonicalId, baseRevisionId);
      if (!base) base = inferCommonBase(current, incoming, baseRevisionId);
      mergeResult = mergeSessionsThreeWay(base, current, incoming, {
        source: { agent: adapter.id, sessionId: descriptor.sessionId ?? incoming.origin?.sessionId },
      });
    }
    const session = mergeResult?.session ?? mergeSessions(current, incoming);
    if (mergeResult?.branchSession) await this.store.saveRevision(mergeResult.branchSession);
    await this.store.saveSession(session);
    if (identityKey) state.identities[identityKey] = canonicalId;
    for (const key of sessionIdentityKeys(session)) state.identities[key] = canonicalId;
    state.stats.sessionsRead += 1;
    state.stats.conflictsDetected += mergeResult?.detectedConflicts ?? 0;
    state.sources[sourceKey] = {
      agent: adapter.id,
      key: descriptor.key,
      signature: descriptor.signature,
      canonicalId,
      baseRevisionId: session.revision.id,
      seenAt: iso(),
    };
    state.mappings[canonicalId] ??= {};
    const currentSourceMapping = state.mappings[canonicalId][adapter.id];
    if (!currentSourceMapping?.path || currentSourceMapping.path === descriptor.key) {
      state.mappings[canonicalId][adapter.id] = {
        ...currentSourceMapping,
        sourceKey: descriptor.key,
        status: "source",
        updatedAt: iso(),
        projection: {
          ...(currentSourceMapping?.projection ?? {}),
          mode: "native-source",
          fidelity: 1,
          grade: "A",
          degraded: false,
          verified: true,
          sourceRevision: session.revision.id,
          verifiedAt: iso(),
          verificationReason: "Observed directly from the source session.",
        },
      };
    }
    const targetIds = (targets ?? selectedAgentIds(config)).filter((id) => {
      if (id !== adapter.id) return true;
      const ownProjection = state.mappings[canonicalId][id];
      return Boolean(ownProjection?.path && ownProjection.path !== descriptor.key);
    });
    const { writtenTargets, projections, written, errors } = await this.projectCanonicalSession({ session, config, state, targetIds, force });
    const degraded = projections.filter((projection) => projection.degraded || projection.error).length;
    const unresolvedConflicts = session.merge?.conflicts?.filter((conflict) => conflict.status === "unresolved").length ?? 0;
    this.store.addActivity(state, {
      level: errors || degraded || unresolvedConflicts ? "warn" : "success",
      action: unresolvedConflicts ? "conflict" : "sync",
      agent: adapter.id,
      canonicalId,
      message: unresolvedConflicts
        ? `${session.title}: ${unresolvedConflicts} concurrent edit conflict(s) require resolution.`
        : writtenTargets.length
        ? `${session.title} → ${writtenTargets.join(", ")}${degraded ? ` (${degraded} degraded)` : ""}`
        : `${session.title}: canonical copy updated`,
    });
    return { session, written, errors, targets: writtenTargets, projections };
  }

  async projectCanonicalSession({ session, config, state, targetIds, force = false }) {
    const canonicalId = session.id;
    state.mappings[canonicalId] ??= {};
    const writtenTargets = [];
    const projections = [];
    let written = 0;
    let errors = 0;
    for (const targetId of targetIds) {
      const target = this.adapters.get(targetId);
      if (!target) continue;
      const mapping = state.mappings[canonicalId][targetId] ?? {};
      state.stats.projectionsAttempted += 1;
      try {
        const targetStatus = await target.status();
        const plan = planProjection(session, targetStatus, { policy: config.conversionPolicy });
        const projection = projectSession(session, plan);
        let handoffPaths = null;
        if (projection.capsule || projection.manifest.degraded) {
          const capsule = projection.capsule ?? createHandoffCapsule(session, { targetAgent: targetId });
          handoffPaths = await this.store.saveHandoff(capsule);
          state.stats.handoffsCreated += 1;
        }
        const projectionPath = await this.store.saveProjection(canonicalId, targetId, projection.manifest);
        if (!targetStatus.write || plan.mode === "handoff-file") {
          const nextMapping = {
            ...mapping,
            status: "handoff",
            updatedAt: iso(),
            handoffPaths,
            projectionPath,
            projection: { ...projection.manifest, verified: false, verificationReason: targetStatus.note ?? "Target is not writable." },
          };
          state.mappings[canonicalId][targetId] = nextMapping;
          state.stats.projectionsDegraded += 1;
          projections.push({ agent: targetId, ...nextMapping.projection });
          this.store.addActivity(state, { level: "warn", action: "handoff", agent: targetId, canonicalId, message: `${session.title}: handoff saved because the target is not writable.` });
          continue;
        }

        const result = await target.write(projection.projectedSession, mapping, { force, manifest: projection.manifest });
        const verification = await this.verifyProjection(target, targetStatus, result, projection.projectedSession, config);
        const projectionState = {
          ...projection.manifest,
          verified: verification.verified,
          verificationReason: verification.reason,
          verifiedAt: verification.verified ? iso() : null,
        };
        state.mappings[canonicalId][targetId] = {
          ...mapping,
          ...result,
          status: verification.verified ? "verified" : projection.manifest.degraded ? "degraded" : "synced",
          updatedAt: iso(),
          projectionPath,
          handoffPaths,
          projection: projectionState,
        };
        projections.push({ agent: targetId, ...projectionState });
        state.stats.eventsPreserved += projection.manifest.eventCount - projection.manifest.counts.omitted;
        state.stats.eventsOmitted += projection.manifest.counts.omitted;
        if (projection.manifest.degraded) state.stats.projectionsDegraded += 1;
        if (verification.verified) {
          state.stats.projectionsVerified += 1;
          state.stats.lastVerifiedAt = iso();
        }
        if (result.added > 0 || force) {
          written += 1;
          writtenTargets.push(targetId);
          state.stats.sessionsWritten += 1;
        }
        const targetSourceKey = result.key ?? result.path;
        if (targetSourceKey) {
          try {
            state.sources[sourceStateKey(targetId, targetSourceKey)] = {
              agent: targetId,
              key: targetSourceKey,
              signature: result.signature ?? await fileSignature(result.path),
              canonicalId,
              baseRevisionId: session.revision.id,
              seenAt: iso(),
            };
          } catch {}
        }
      } catch (error) {
        errors += 1;
        state.stats.errors += 1;
        state.mappings[canonicalId][targetId] = {
          ...mapping,
          status: "failed",
          updatedAt: iso(),
          error: error.message,
          projection: { ...(mapping.projection ?? {}), verified: false, verificationReason: error.message },
        };
        projections.push({ agent: targetId, mode: mapping.projection?.mode ?? "unknown", verified: false, error: error.message });
        this.store.addActivity(state, { level: "error", action: "project", agent: targetId, canonicalId, message: `${session.title}: ${error.message}` });
      }
    }
    return { writtenTargets, projections, written, errors };
  }

  async resolveConflict({ canonicalId, conflictId, strategy = "both" }) {
    if (this.running) throw new Error("Wait for the current sync to finish before resolving a conflict.");
    this.running = true;
    try {
      const [config, state, current] = await Promise.all([
        this.store.config(),
        this.store.state(),
        this.store.loadSession(canonicalId),
      ]);
      canonicalId = resolveCanonicalAlias(state, canonicalId);
      const resolvedCurrent = current?.id === canonicalId ? current : await this.store.loadSession(canonicalId);
      if (!resolvedCurrent) throw new Error(`Canonical session not found: ${canonicalId}`);
      const existing = resolvedCurrent.merge?.conflicts?.find((conflict) => conflict.id === conflictId);
      if (!existing) throw new Error(`Conflict not found: ${conflictId}`);
      if (existing.status !== "unresolved") throw new Error(`Conflict is already resolved: ${conflictId}`);
      const session = resolveSessionConflict(resolvedCurrent, conflictId, strategy);
      await this.store.saveSession(session);
      state.stats.conflictsResolved += 1;
      const result = await this.projectCanonicalSession({
        session,
        config,
        state,
        targetIds: selectedAgentIds(config),
        force: true,
      });
      this.store.addActivity(state, {
        level: result.errors ? "warn" : "success",
        action: "resolve",
        canonicalId,
        message: `${session.title}: conflict ${conflictId} resolved with ${strategy}.`,
      });
      state.stats.lastRunAt = iso();
      await this.store.saveState(state);
      return {
        canonicalId,
        conflictId,
        strategy,
        revision: session.revision,
        unresolved: session.merge.conflicts.filter((conflict) => conflict.status === "unresolved").length,
        written: result.written,
        errors: result.errors,
      };
    } finally {
      this.running = false;
    }
  }

  async verifyProjection(target, targetStatus, result, projectedSession, config) {
    if (!targetStatus.capabilities?.readback) return { verified: false, reason: "Target has no readback capability." };
    try {
      const descriptors = await target.discover({ ...config, historyDays: Math.max(config.historyDays, 3650) });
      const descriptor = descriptors.find((item) => item.key === result.key || item.key === result.path || item.path === result.path || item.sessionId === result.sessionId);
      if (!descriptor) return { verified: false, reason: "Target session was written but not rediscovered." };
      const roundTrip = await target.read(descriptor, { canonicalId: projectedSession.id });
      const actualIds = new Set(roundTrip.events.map((event) => event.id));
      const missing = projectedSession.events.filter((event) => !actualIds.has(event.id));
      if (missing.length) return { verified: false, reason: `${missing.length} of ${projectedSession.events.length} events were missing on readback.` };
      return { verified: true, reason: `Read back ${projectedSession.events.length} projected events.` };
    } catch (error) {
      return { verified: false, reason: `Readback failed: ${error.message}` };
    }
  }

  async exportNativeSession({ sourceAgent, sourceKey, out }) {
    const adapter = this.requireAdapter(sourceAgent);
    const config = await this.store.config();
    const sessions = await adapter.discover({ ...config, historyDays: Math.max(config.historyDays, 3650) });
    const descriptor = sessions.find((session) => session.key === sourceKey || session.sessionId === sourceKey);
    if (!descriptor) throw new Error(`Session not found in ${sourceAgent}: ${sourceKey}`);
    const canonicalId = descriptor.canonicalId ?? newCanonicalId();
    const session = await adapter.read(descriptor, { canonicalId });
    const outputPath = path.resolve(out ?? path.join(this.store.exportsDir, `${session.id}.asif.json`));
    await writeJson(outputPath, upgradeSession(session));
    return { path: outputPath, session };
  }

  async importAsif(input, targetIds) {
    const session = upgradeSession(input);
    await this.store.saveSession(session);
    const config = await this.store.config();
    const results = [];
    for (const targetId of targetIds) {
      const adapter = this.requireAdapter(targetId);
      const status = await adapter.status();
      const plan = planProjection(session, status, { policy: config.conversionPolicy });
      const projection = projectSession(session, plan);
      if (!status.write || plan.mode === "handoff-file") {
        const capsule = projection.capsule ?? createHandoffCapsule(session, { targetAgent: targetId });
        results.push({ agent: targetId, mode: plan.mode, ...(await this.store.saveHandoff(capsule)) });
        continue;
      }
      const result = await adapter.write(projection.projectedSession, {});
      results.push({ agent: targetId, mode: plan.mode, manifest: projection.manifest, ...result });
    }
    return results;
  }

  async updateConfig(patch) {
    const previous = await this.store.config();
    const candidateSelected = { ...previous.selectedAgents, ...(patch.selectedAgents ?? {}) };
    const candidateSyncEnabled = patch.syncEnabled ?? previous.syncEnabled;
    if (candidateSyncEnabled && Object.values(candidateSelected).filter(Boolean).length < 2) {
      throw new Error("Select at least two agents before enabling live sync.");
    }
    if (this.running && candidateSyncEnabled && !previous.syncEnabled) throw new Error("Wait for the current sync to finish before enabling live sync.");
    const next = await this.store.saveConfig(patch);
    const state = await this.store.state();
    const selected = selectedAgentIds(next);
    const missing = selected.filter((agentId) => !state.baselinedAgents.includes(agentId));
    if (next.syncEnabled && next.initialSync === "new-only" && missing.length) {
      this.running = true;
      try { await this.baseline({ agentIds: missing }); }
      finally { this.running = false; }
    } else {
      state.baselineReady = selected.every((agentId) => state.baselinedAgents.includes(agentId));
      await this.store.saveState(state);
    }
    return next;
  }

  async start() {
    this.stopped = false;
    await this.initialize();
    const loop = async () => {
      if (this.stopped) return;
      try {
        const config = await this.store.config();
        if (config.syncEnabled) await this.syncOnce();
        this.timer = setTimeout(loop, config.pollIntervalMs);
      } catch {
        this.timer = setTimeout(loop, 5000);
      }
      this.timer.unref?.();
    };
    // Do not make the HTTP service wait for the first filesystem scan. Large
    // Claude project trees can take a while to discover, but the menu bar and
    // status API should become available immediately and report syncing=true.
    void loop();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  requireAdapter(id) {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`Unknown agent: ${id}`);
    return adapter;
  }
}

function sourceStateKey(agent, key) {
  return `${agent}:${key}`;
}

function sourceIdentityKey(agent, sessionId) {
  if (!agent || !sessionId || sessionId === "unknown") return null;
  return `${agent}:${sessionId}`;
}

function descriptorIdentityKey(agentId, descriptor) {
  return sourceIdentityKey(descriptor.sourceAgent ?? agentId, descriptor.sourceSessionId ?? descriptor.sessionId);
}

function sessionIdentityKeys(session) {
  const origins = [session.origin, ...(session.origins ?? [])].filter(Boolean);
  return [...new Set(origins.map((origin) => sourceIdentityKey(origin.agent, origin.sessionId)).filter(Boolean))];
}

function resolveCanonicalAlias(state, canonicalId) {
  if (!canonicalId) return null;
  const visited = new Set();
  let resolved = canonicalId;
  while (state.aliases?.[resolved] && !visited.has(resolved)) {
    visited.add(resolved);
    resolved = state.aliases[resolved];
  }
  return resolved;
}

function choosePreferredCanonical(sessions) {
  return [...sessions].sort((left, right) => {
    const eventDifference = (right.events?.length ?? 0) - (left.events?.length ?? 0);
    if (eventDifference) return eventDifference;
    const revisionDifference = (right.revision?.number ?? 0) - (left.revision?.number ?? 0);
    if (revisionDifference) return revisionDifference;
    return new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime();
  })[0] ?? null;
}

function selectedAgentIds(config) {
  return Object.entries(config.selectedAgents).filter(([, enabled]) => enabled).map(([id]) => id);
}

function summarizeSessions(sessions, state, config, agentStatuses) {
  const selected = selectedAgentIds(config);
  const statusMap = new Map(agentStatuses.map((agent) => [agent.id, agent]));
  return sessions.map((session) => {
    const sourceAgents = new Set((session.origins ?? [session.origin]).map((origin) => origin.agent));
    const unresolvedConflicts = session.merge?.conflicts?.filter((conflict) => conflict.status === "unresolved") ?? [];
    const targets = selected.map((agent) => {
      const status = statusMap.get(agent);
      const mapping = state.mappings[session.id]?.[agent];
      if (!mapping && sourceAgents.has(agent)) return { agent, name: status?.name ?? agent, state: "source", verified: true, degraded: false, mode: "native-source", fidelity: 1 };
      if (!mapping) return { agent, name: status?.name ?? agent, state: "pending", verified: false, degraded: false, mode: null, fidelity: null };
      const currentRevision = mapping.projection?.sourceRevision === session.revision?.id;
      if (!currentRevision) {
        return {
          agent,
          name: status?.name ?? agent,
          state: "stale",
          verified: false,
          degraded: false,
          mode: mapping.projection?.mode ?? null,
          fidelity: mapping.projection?.fidelity ?? null,
          updatedAt: mapping.updatedAt,
          verificationReason: "A newer canonical revision has not reached this agent yet.",
        };
      }
      return {
        agent,
        name: status?.name ?? agent,
        state: mapping.status ?? (mapping.projection?.verified ? "verified" : "synced"),
        verified: Boolean(mapping.projection?.verified),
        degraded: Boolean(mapping.projection?.degraded || mapping.status === "degraded" || mapping.status === "handoff"),
        mode: mapping.projection?.mode ?? null,
        fidelity: mapping.projection?.fidelity ?? null,
        grade: mapping.projection?.grade ?? null,
        warningCount: mapping.projection?.warnings?.length ?? 0,
        verificationReason: mapping.projection?.verificationReason,
        updatedAt: mapping.updatedAt,
        error: mapping.error,
        handoff: mapping.handoffPaths ? { markdown: publicPath(mapping.handoffPaths.markdownPath), json: publicPath(mapping.handoffPaths.jsonPath) } : null,
      };
    }).map((target) => unresolvedConflicts.length && !["failed", "handoff"].includes(target.state) ? {
      ...target,
      state: "conflict",
      verified: false,
      verificationReason: `${unresolvedConflicts.length} concurrent edit conflict(s) require resolution.`,
    } : target);
    return {
      id: session.id,
      title: session.title,
      project: session.project,
      origin: session.origin,
      origins: session.origins,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      revision: session.revision,
      eventCount: session.events.length,
      merge: {
        status: session.merge?.status ?? "clean",
        baseRevisionId: session.merge?.baseRevisionId ?? null,
        branchCount: session.merge?.branches?.length ?? 0,
        unresolved: unresolvedConflicts.length,
        conflicts: unresolvedConflicts.map((conflict) => ({
          id: conflict.id,
          kind: conflict.kind,
          eventId: conflict.eventId,
          detectedAt: conflict.detectedAt,
          variants: conflict.variants.map((variant) => ({
            id: variant.id,
            side: variant.side,
            agent: variant.agent,
            sessionId: variant.sessionId,
            branchId: variant.branchId,
            role: variant.event?.role,
            kind: variant.event?.kind,
            text: String(variant.event?.text ?? "").slice(0, 4000),
          })),
        })),
      },
      state: {
        objective: session.state?.objective ?? "",
        summary: session.state?.summary ?? "",
        status: session.state?.status ?? "unknown",
        touchedFiles: session.state?.touchedFiles?.slice(0, 30) ?? [],
        testCount: session.state?.tests?.length ?? 0,
      },
      targets,
      coverage: {
        total: targets.length,
        available: targets.filter((target) => ["source", "verified", "synced"].includes(target.state)).length,
        verified: targets.filter((target) => ["source", "verified"].includes(target.state)).length,
        degraded: targets.filter((target) => target.degraded).length,
        failed: targets.filter((target) => target.state === "failed").length,
        conflicts: unresolvedConflicts.length,
      },
    };
  });
}

function continuitySummary(sessions, config, agentStatuses, state) {
  const selected = selectedAgentIds(config);
  const cells = sessions.flatMap((session) => session.targets);
  const verified = cells.filter((cell) => ["source", "verified"].includes(cell.state)).length;
  const available = cells.filter((cell) => ["source", "verified", "synced"].includes(cell.state)).length;
  const degraded = cells.filter((cell) => cell.degraded).length;
  const failed = cells.filter((cell) => cell.state === "failed").length;
  const unresolvedConflicts = sessions.reduce((count, session) => count + (session.merge?.unresolved ?? 0), 0);
  const attention = cells.filter((cell) => cell.degraded || ["failed", "pending", "stale", "handoff"].includes(cell.state)).length + unresolvedConflicts;
  const total = cells.length;
  const verifiedRate = total ? Math.round((verified / total) * 100) : null;
  const availableRate = total ? Math.round((available / total) * 100) : null;
  const connectedAgents = agentStatuses.filter((agent) => selected.includes(agent.id) && agent.detected).length;
  let status = "idle";
  if (unresolvedConflicts || failed || (total && available < total)) status = "attention";
  else if (total && verified === total) status = "healthy";
  else if (total) status = "unverified";
  else if (selected.length >= 2) status = "ready";
  return {
    status,
    verifiedRate,
    availableRate,
    verified,
    available,
    total,
    degraded,
    failed,
    conflicts: unresolvedConflicts,
    attention,
    sessions: sessions.length,
    selectedAgents: selected.length,
    connectedAgents,
    lastRunAt: state.stats.lastRunAt,
    lastVerifiedAt: state.stats.lastVerifiedAt,
    northStar: "verified-continuity-rate",
  };
}
