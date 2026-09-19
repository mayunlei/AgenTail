import os from "node:os";
import path from "node:path";
import { readdir, stat, unlink } from "node:fs/promises";
import { assertSession, upgradeSession } from "./asif.mjs";
import { atomicWrite, ensureDir, exists, readJson, writeJson } from "./util.mjs";

export const DEFAULT_CONFIG = Object.freeze({
  version: 2,
  language: "zh-CN",
  syncEnabled: false,
  pollIntervalMs: 2500,
  historyDays: 30,
  revisionHistoryLimit: 10,
  initialSync: "new-only",
  contentPolicy: "messages-and-tools",
  conversionPolicy: "balanced",
  selectedAgents: {
    codex: false,
    claude: false,
    opencode: false,
    qoder: false
  },
  projectRoots: []
});

export const DEFAULT_STATE = Object.freeze({
  version: 3,
  identityVersion: 0,
  baselineReady: false,
  baselinedAgents: [],
  identities: {},
  aliases: {},
  sources: {},
  mappings: {},
  stats: {
    syncRuns: 0,
    sessionsRead: 0,
    sessionsWritten: 0,
    projectionsAttempted: 0,
    projectionsVerified: 0,
    projectionsDegraded: 0,
    conflictsDetected: 0,
    conflictsResolved: 0,
    duplicateSessionsDetected: 0,
    handoffsCreated: 0,
    eventsPreserved: 0,
    eventsOmitted: 0,
    errors: 0,
    lastRunAt: null,
    lastVerifiedAt: null
  },
  activity: []
});

export class BridgeStore {
  constructor(root = process.env.ASB_HOME || path.join(os.homedir(), ".agent-session-bridge")) {
    this.root = path.resolve(root);
    this.configPath = path.join(this.root, "config.json");
    this.statePath = path.join(this.root, "state.json");
    this.sessionsDir = path.join(this.root, "sessions");
    this.revisionsDir = path.join(this.root, "revisions");
    this.importsDir = path.join(this.root, "imports");
    this.exportsDir = path.join(this.root, "exports");
    this.handoffsDir = path.join(this.root, "handoffs");
    this.projectionsDir = path.join(this.root, "projections");
  }

  async initialize() {
    await Promise.all([
      ensureDir(this.root),
      ensureDir(this.sessionsDir),
      ensureDir(this.revisionsDir),
      ensureDir(this.importsDir),
      ensureDir(this.exportsDir),
      ensureDir(this.handoffsDir),
      ensureDir(this.projectionsDir),
    ]);
    if (!(await exists(this.configPath))) await writeJson(this.configPath, DEFAULT_CONFIG);
    if (!(await exists(this.statePath))) await writeJson(this.statePath, DEFAULT_STATE);
    return this;
  }

  async config() {
    const value = await readJson(this.configPath, DEFAULT_CONFIG);
    return {
      ...structuredClone(DEFAULT_CONFIG),
      ...value,
      selectedAgents: { ...DEFAULT_CONFIG.selectedAgents, ...value.selectedAgents },
    };
  }

  async saveConfig(patch) {
    const current = await this.config();
    const next = {
      ...current,
      ...patch,
      selectedAgents: { ...current.selectedAgents, ...(patch.selectedAgents ?? {}) },
    };
    next.pollIntervalMs = Math.max(1000, Math.min(60_000, Number(next.pollIntervalMs) || 2500));
    next.historyDays = Math.max(1, Math.min(3650, Number(next.historyDays) || 30));
    next.revisionHistoryLimit = Math.max(2, Math.min(100, Number(next.revisionHistoryLimit) || 10));
    next.language = ["zh-CN", "en"].includes(next.language) ? next.language : "zh-CN";
    await writeJson(this.configPath, next);
    return next;
  }

  async state() {
    const value = await readJson(this.statePath, DEFAULT_STATE);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...value,
      stats: { ...DEFAULT_STATE.stats, ...value.stats },
      identities: value.identities ?? {},
      aliases: value.aliases ?? {},
      sources: value.sources ?? {},
      mappings: value.mappings ?? {},
      baselinedAgents: value.baselinedAgents ?? [],
      activity: value.activity ?? [],
    };
  }

  async saveState(state) {
    state.activity = (state.activity ?? []).slice(0, 100);
    await writeJson(this.statePath, state);
  }

  sessionPath(id) {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  async loadSession(id) {
    const session = await readJson(this.sessionPath(id), null);
    return session ? upgradeSession(session) : null;
  }

  async saveSession(session) {
    assertSession(session);
    const upgraded = upgradeSession(session);
    await Promise.all([
      writeJson(this.sessionPath(upgraded.id), upgraded),
      this.saveRevision(upgraded),
    ]);
    return this.sessionPath(upgraded.id);
  }

  revisionPath(canonicalId, revisionId) {
    return path.join(this.revisionsDir, canonicalId, `${revisionId}.json`);
  }

  async loadRevision(canonicalId, revisionId) {
    if (!revisionId) return null;
    const session = await readJson(this.revisionPath(canonicalId, revisionId), null);
    return session ? upgradeSession(session) : null;
  }

  async saveRevision(session) {
    const upgraded = upgradeSession(session);
    if (!upgraded.revision?.id) return null;
    const file = this.revisionPath(upgraded.id, upgraded.revision.id);
    await writeJson(file, upgraded);
    await this.pruneRevisions(upgraded.id, [upgraded.revision.id, ...(upgraded.revision.parents ?? [])]);
    return file;
  }

  async pruneRevisions(canonicalId, protectedRevisionIds = []) {
    const directory = path.join(this.revisionsDir, canonicalId);
    let files;
    try {
      files = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(directory, entry.name));
    } catch (error) {
      if (error?.code === "ENOENT") return 0;
      throw error;
    }

    const { revisionHistoryLimit } = await this.config();
    if (files.length <= revisionHistoryLimit) return 0;
    const revisions = await Promise.all(files.map(async (file) => ({ file, info: await stat(file) })));
    revisions.sort((left, right) => right.info.mtimeMs - left.info.mtimeMs);

    const keep = new Set(revisions.slice(0, revisionHistoryLimit).map(({ file }) => path.basename(file, ".json")));
    for (const revisionId of protectedRevisionIds) if (revisionId) keep.add(revisionId);
    const removable = revisions.filter(({ file }) => !keep.has(path.basename(file, ".json")));
    await Promise.all(removable.map(async ({ file }) => {
      try {
        await unlink(file);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }));
    return removable.length;
  }

  async listSessions(limit = 100) {
    const files = (await readdir(this.sessionsDir)).filter((file) => file.endsWith(".json")).sort();
    const sessions = [];
    for (const file of files) {
      try { sessions.push(upgradeSession(await readJson(path.join(this.sessionsDir, file)))); } catch {}
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
  }

  async saveProjection(canonicalId, targetId, manifest) {
    const file = path.join(this.projectionsDir, `${canonicalId}--${targetId}.json`);
    await writeJson(file, manifest);
    return file;
  }

  async saveHandoff(capsule) {
    const base = `${capsule.canonicalId}--${capsule.targetAgent}`;
    const jsonPath = path.join(this.handoffsDir, `${base}.json`);
    const markdownPath = path.join(this.handoffsDir, `${base}.md`);
    await Promise.all([writeJson(jsonPath, capsule), atomicWrite(markdownPath, `${capsule.markdown}\n`)]);
    return { jsonPath, markdownPath };
  }

  addActivity(state, entry) {
    state.activity.unshift({ at: new Date().toISOString(), ...entry });
    state.activity = state.activity.slice(0, 100);
  }
}
