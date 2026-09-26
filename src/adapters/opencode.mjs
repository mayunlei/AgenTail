import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Adapter, contentEvent, walkFiles } from "./base.mjs";
import { bridgeMarker, createSession } from "../asif.mjs";
import { epoch, exists, stableId, textFromContent, titleFromEvents, writeJson } from "../util.mjs";

const execFile = promisify(execFileCallback);

export class OpenCodeAdapter extends Adapter {
  constructor(options = {}) {
    const home = options.home ?? os.homedir();
    super({ id: "opencode", name: "OpenCode", home });
    this.binary = options.binary ?? "opencode";
    this.dataRoot = options.dataRoot ?? path.join(home, ".local", "share", "opencode");
    this.importsDir = options.importsDir;
    this.env = options.env ?? process.env;
    this.discoverCache = null;
  }

  async command(args, options = {}) {
    return execFile(this.binary, args, {
      cwd: options.cwd ?? process.cwd(),
      env: this.env,
      timeout: options.timeout ?? 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  async status() {
    let version = null;
    try { version = (await this.command(["--version"])).stdout.trim(); } catch {}
    return {
      id: this.id,
      name: this.name,
      detected: Boolean(version) || await exists(this.dataRoot),
      root: this.describePath(this.dataRoot),
      read: Boolean(version),
      write: Boolean(version),
      compatibility: version ? "official-cli-import-export" : "cli-required",
      capabilities: this.capabilities({
        transport: "official-cli",
        listSessions: Boolean(version),
        readHistory: Boolean(version),
        createSession: Boolean(version),
        appendEvents: false,
        resumeSession: Boolean(version),
        importHistory: Boolean(version),
        structuredTools: false,
        officialApi: Boolean(version),
        nativeWrite: false,
        readback: Boolean(version),
      }),
      version,
      note: "Uses OpenCode's official export/import commands; no SQLite files are edited directly.",
    };
  }

  async discover({ historyDays = 30, projectRoots = [] } = {}) {
    const cacheKey = JSON.stringify({ historyDays, projectRoots });
    if (this.discoverCache?.key === cacheKey && Date.now() - this.discoverCache.at < 30_000) {
      return this.discoverCache.sessions;
    }
    let output;
    try { output = (await this.command(["session", "list", "--format", "json", "--max-count", "200"])).stdout.trim(); }
    catch {
      this.discoverCache = { key: cacheKey, at: Date.now(), sessions: [] };
      return [];
    }
    if (!output) {
      this.discoverCache = { key: cacheKey, at: Date.now(), sessions: [] };
      return [];
    }
    const sessions = parseJsonOutput(output);
    if (!Array.isArray(sessions)) return [];
    const legacyMetadata = new Map();
    const legacyFiles = await walkFiles(path.join(this.dataRoot, "storage", "session"), (_, name) => name.endsWith(".json"), 4);
    for (const file of legacyFiles) {
      try {
        const info = JSON.parse(await readFile(file, "utf8"));
        if (info.id && info.metadata) legacyMetadata.set(info.id, info.metadata);
      } catch {}
    }
    const cutoff = Date.now() - historyDays * 86_400_000;
    const discovered = sessions
      .map((item) => {
        const updated = item.time?.updated ?? item.updatedAt ?? item.updated ?? Date.now();
        const marker = (item.metadata ?? legacyMetadata.get(item.id))?.agentSessionBridge ?? {};
        return {
          agent: this.id,
          key: item.id,
          sessionId: item.id,
          cwd: item.directory ?? item.project?.worktree ?? process.cwd(),
          title: item.title ?? "OpenCode session",
          createdAt: new Date(item.time?.created ?? item.createdAt ?? updated).toISOString(),
          updatedAt: new Date(updated).toISOString(),
          signature: `${item.id}:${updated}`,
          canonicalId: marker.canonicalId,
          sourceAgent: marker.sourceAgent,
          sourceSessionId: marker.sourceSessionId,
        };
      })
      .filter((item) => new Date(item.updatedAt).getTime() >= cutoff)
      .filter((item) => !projectRoots.length || projectRoots.some((root) => item.cwd === root || item.cwd.startsWith(`${root}${path.sep}`)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    this.discoverCache = { key: cacheKey, at: Date.now(), sessions: discovered };
    return discovered;
  }

  async read(descriptor, { canonicalId } = {}) {
    const { stdout } = await this.command(["export", descriptor.sessionId], { cwd: descriptor.cwd });
    const data = parseJsonOutput(stdout);
    const marker = data.info?.metadata?.agentSessionBridge ?? {};
    const events = [];
    for (const [messageIndex, message] of (data.messages ?? []).entries()) {
      const info = message.info ?? {};
      for (const [partIndex, part] of (message.parts ?? []).entries()) {
        const eventMarker = part.metadata?.agentSessionBridge ?? {};
        const id = eventMarker.eventId
          ?? `evt_${stableId("", `${this.id}:${descriptor.sessionId}:${info.id ?? messageIndex}:${part.id ?? partIndex}`, 28)}`;
        const source = { agent: this.id, sessionId: descriptor.sessionId, nativeId: part.id ?? info.id };
        if (part.type === "text" && part.text) events.push(contentEvent({ id, timestamp: new Date(info.time?.created ?? Date.now()).toISOString(), role: eventMarker.eventRole ?? info.role, text: part.text, source }));
        else if (part.type === "tool") {
          events.push(contentEvent({ id, timestamp: new Date(info.time?.created ?? Date.now()).toISOString(), kind: "tool_call", role: "assistant", text: part.tool, name: part.tool, callId: part.callID, input: part.state?.input, source }));
          if (["completed", "error"].includes(part.state?.status)) events.push(contentEvent({
            id: `${id}_result`,
            timestamp: new Date(part.state.time?.end ?? info.time?.completed ?? info.time?.created ?? Date.now()).toISOString(),
            kind: "tool_result",
            role: "tool",
            text: part.state.output ?? part.state.error ?? "",
            callId: part.callID,
            isError: part.state.status === "error",
            source,
          }));
        }
      }
    }
    return createSession({
      id: canonicalId ?? marker.canonicalId,
      origin: { agent: marker.sourceAgent ?? this.id, sessionId: marker.sourceSessionId ?? descriptor.sessionId, sourceKey: descriptor.key },
      cwd: data.info?.directory ?? descriptor.cwd,
      title: data.info?.title ?? descriptor.title ?? titleFromEvents(events),
      createdAt: new Date(data.info?.time?.created ?? descriptor.createdAt).toISOString(),
      updatedAt: new Date(data.info?.time?.updated ?? descriptor.updatedAt).toISOString(),
      events,
      extensions: { opencode: { nativeSessionId: descriptor.sessionId, version: data.info?.version } },
    });
  }

  exportData(session, sessionId) {
    const created = epoch(session.createdAt);
    const updated = epoch(session.updatedAt);
    const messages = [];
    let lastUserId = null;
    const events = [...session.events];
    if (!events.some((event) => event.role === "user")) {
      events.unshift({ id: stableId("evt_", `${session.id}:synthetic-user`, 28), timestamp: session.createdAt, kind: "message", role: "user", text: `Imported session: ${session.title}` });
    }
    for (const event of events) {
      const messageId = stableId("msg_", `${session.id}:${event.id}`, 26);
      const partId = stableId("prt_", `${session.id}:${event.id}`, 26);
      const timestamp = epoch(event.timestamp);
      const marker = { ...bridgeMarker(session), eventId: event.id, eventRole: event.role };
      const text = portableText(event);
      if (event.role === "user" && event.kind === "message") {
        lastUserId = messageId;
        messages.push({
          info: {
            id: messageId,
            sessionID: sessionId,
            role: "user",
            time: { created: timestamp },
            agent: "build",
            model: { providerID: "agent-session-bridge", modelID: "imported" },
          },
          parts: [{ id: partId, sessionID: sessionId, messageID: messageId, type: "text", text, synthetic: event.kind !== "message", metadata: { agentSessionBridge: marker } }],
        });
      } else {
        if (!lastUserId) {
          lastUserId = stableId("msg_", `${session.id}:anchor`, 26);
          messages.push({
            info: { id: lastUserId, sessionID: sessionId, role: "user", time: { created: timestamp }, agent: "build", model: { providerID: "agent-session-bridge", modelID: "imported" } },
            parts: [{ id: stableId("prt_", `${session.id}:anchor`, 26), sessionID: sessionId, messageID: lastUserId, type: "text", text: `Imported session: ${session.title}`, synthetic: true }],
          });
        }
        messages.push({
          info: {
            id: messageId,
            sessionID: sessionId,
            role: "assistant",
            time: { created: timestamp, completed: timestamp },
            parentID: lastUserId,
            modelID: "imported",
            providerID: "agent-session-bridge",
            mode: "build",
            agent: "build",
            path: { cwd: session.project.cwd, root: session.project.cwd },
            cost: 0,
            tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
          },
          parts: [{ id: partId, sessionID: sessionId, messageID: messageId, type: "text", text, synthetic: event.kind !== "message", metadata: { agentSessionBridge: marker } }],
        });
      }
    }
    return {
      info: {
        id: sessionId,
        slug: stableId("bridge-", session.id, 12),
        projectID: "global",
        directory: session.project.cwd,
        title: session.title,
        version: "1.1.34",
        metadata: { agentSessionBridge: bridgeMarker(session) },
        time: { created, updated },
      },
      messages,
    };
  }

  async write(session, mapping = {}) {
    const sessionId = mapping.sessionId ?? stableId("ses_", session.id, 26);
    const directory = this.importsDir ?? path.join(os.homedir(), ".agent-session-bridge", "imports");
    const file = mapping.path ?? path.join(directory, `opencode-${sessionId}.json`);
    await writeJson(file, this.exportData(session, sessionId));
    const cwd = await exists(session.project.cwd) ? session.project.cwd : process.cwd();
    const { stdout } = await this.command(["import", file], { cwd, timeout: 60_000 });
    if (!stdout.includes("Imported session")) throw new Error(`OpenCode import did not confirm success: ${stdout.trim()}`);
    this.discoverCache = null;
    return {
      path: file,
      key: sessionId,
      signature: `${sessionId}:${epoch(session.updatedAt)}`,
      sessionId,
      added: session.events.length,
      result: stdout.trim(),
    };
  }
}

function portableText(event) {
  if (event.kind === "tool_call") return `[Tool call: ${event.name ?? event.text ?? "tool"}]\n${typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {}, null, 2)}`;
  if (event.kind === "tool_result") return `[Tool result${event.isError ? " (error)" : ""}]\n${event.text}`;
  return event.text;
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  try { return JSON.parse(trimmed); } catch {}
  const firstObject = Math.min(...[trimmed.indexOf("{"), trimmed.indexOf("[")].filter((value) => value >= 0));
  if (!Number.isFinite(firstObject)) throw new Error("Command did not return JSON");
  return JSON.parse(trimmed.slice(firstObject));
}
