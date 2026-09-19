import { appendFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Adapter, contentEvent, descriptorForFile, walkFiles } from "./base.mjs";
import { bridgeMarker, createSession } from "../asif.mjs";
import { atomicWrite, ensureDir, iso, parseJsonLines, stableId, textFromContent, titleFromEvents } from "../util.mjs";

export class CodexAdapter extends Adapter {
  constructor(options = {}) {
    const home = options.home ?? os.homedir();
    super({ id: "codex", name: "Codex", home });
    this.root = options.root ?? path.join(home, ".codex", "sessions");
  }

  async status() {
    const detected = await walkFiles(this.root, (_, name) => name.endsWith(".jsonl"), 5).then((files) => files.length > 0);
    return {
      id: this.id,
      name: this.name,
      detected,
      root: this.describePath(this.root),
      read: true,
      write: true,
      compatibility: "native-jsonl",
      capabilities: this.capabilities({ structuredTools: true, resumeSession: true }),
      note: "Writes a new rollout file; existing native files are never overwritten.",
    };
  }

  async discover({ historyDays = 30, projectRoots = [] } = {}) {
    const files = await walkFiles(this.root, (_, name) => name.endsWith(".jsonl"), 5);
    const cutoff = Date.now() - historyDays * 86_400_000;
    const descriptors = [];
    for (const file of files) {
      try {
        const descriptor = await descriptorForFile(file, { agent: this.id });
        if (new Date(descriptor.updatedAt).getTime() < cutoff) continue;
        const records = parseJsonLines(await readFile(file, "utf8"));
        const meta = records.find((record) => record.type === "session_meta")?.payload ?? {};
        const marker = meta.agent_session_bridge ?? {};
        const cwd = meta.cwd || process.cwd();
        if (projectRoots.length && !projectRoots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`))) continue;
        const firstVisibleUser = records.find((record) => record.type === "event_msg" && record.payload?.type === "user_message" && record.payload?.message)
          ?? records.find((record) => record.type === "response_item" && record.payload?.type === "message" && record.payload?.role === "user" && record.payload?._agent_session_bridge);
        const title = textFromContent(firstVisibleUser?.payload?.message ?? firstVisibleUser?.payload?.content).replace(/\s+/g, " ").slice(0, 88) || "Codex session";
        descriptors.push({
          ...descriptor,
          sessionId: meta.id || path.basename(file, ".jsonl"),
          canonicalId: marker.canonicalId,
          sourceAgent: marker.sourceAgent,
          sourceSessionId: marker.sourceSessionId,
          cwd,
          title,
          createdAt: meta.timestamp || descriptor.createdAt,
        });
      } catch {
        // Ignore a file while Codex is in the middle of appending an incomplete line.
      }
    }
    return descriptors.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async read(descriptor, { canonicalId } = {}) {
    const records = parseJsonLines(await readFile(descriptor.path, "utf8"));
    const meta = records.find((record) => record.type === "session_meta")?.payload ?? {};
    const marker = meta.agent_session_bridge ?? {};
    const events = [];
    const hasVisibleUserEvents = records.some((record) => record.type === "event_msg" && record.payload?.type === "user_message");
    for (const [index, record] of records.entries()) {
      if (record.type === "event_msg" && record.payload?.type === "user_message" && record.payload?.message) {
        events.push(contentEvent({
          id: `evt_${stableId("", `${this.id}:${meta.id}:${record.payload.client_id ?? index}:user_message`, 28)}`,
          timestamp: record.timestamp,
          role: "user",
          text: textFromContent(record.payload.message),
          source: { agent: this.id, sessionId: meta.id, nativeId: record.payload.client_id ?? String(index) },
        }));
        continue;
      }
      if (record.type !== "response_item" || !record.payload) continue;
      const payload = record.payload;
      const eventId = payload._agent_session_bridge?.eventId
        ?? `evt_${stableId("", `${this.id}:${meta.id}:${payload.id ?? index}:${payload.type}`, 28)}`;
      const source = { agent: this.id, sessionId: meta.id, nativeId: payload.id ?? String(index) };
      if (payload.type === "message") {
        if (payload.role === "user" && hasVisibleUserEvents && !payload._agent_session_bridge) continue;
        const text = textFromContent(payload.content);
        if (!text) continue;
        events.push(contentEvent({ id: eventId, timestamp: record.timestamp, role: payload.role ?? "assistant", text, source }));
      } else if (payload.type === "function_call") {
        let input = payload.arguments;
        try { input = JSON.parse(payload.arguments); } catch {}
        events.push(contentEvent({
          id: eventId,
          timestamp: record.timestamp,
          kind: "tool_call",
          role: "assistant",
          text: payload.name ?? "tool",
          name: payload.name,
          callId: payload.call_id,
          input,
          source,
        }));
      } else if (payload.type === "function_call_output") {
        events.push(contentEvent({
          id: eventId,
          timestamp: record.timestamp,
          kind: "tool_result",
          role: "tool",
          text: textFromContent(payload.output),
          callId: payload.call_id,
          source,
        }));
      }
    }
    events.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    return createSession({
      id: canonicalId ?? marker.canonicalId,
      origin: { agent: marker.sourceAgent ?? this.id, sessionId: marker.sourceSessionId ?? meta.id, sourceKey: descriptor.key },
      cwd: meta.cwd ?? descriptor.cwd,
      title: descriptor.title || titleFromEvents(events),
      createdAt: meta.timestamp ?? descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
      events,
      extensions: { codex: { cliVersion: meta.cli_version, nativeSessionId: meta.id } },
    });
  }

  nativePath(session) {
    const created = new Date(session.createdAt);
    const year = String(created.getFullYear());
    const month = String(created.getMonth() + 1).padStart(2, "0");
    const day = String(created.getDate()).padStart(2, "0");
    const stamp = iso(created).slice(0, 19).replaceAll(":", "-");
    return path.join(this.root, year, month, day, `rollout-${stamp}-${session.id}.jsonl`);
  }

  recordForEvent(session, event) {
    const marker = { eventId: event.id, canonicalId: session.id };
    if (event.kind === "tool_call") {
      return {
        timestamp: event.timestamp,
        type: "response_item",
        payload: {
          type: "function_call",
          name: event.name ?? event.text ?? "tool",
          arguments: typeof event.input === "string" ? event.input : JSON.stringify(event.input ?? {}),
          call_id: event.callId ?? stableId("call_", event.id, 24),
          _agent_session_bridge: marker,
        },
      };
    }
    if (event.kind === "tool_result") {
      return {
        timestamp: event.timestamp,
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: event.callId ?? stableId("call_", event.id, 24),
          output: event.text,
          _agent_session_bridge: marker,
        },
      };
    }
    const role = ["user", "assistant", "system", "developer"].includes(event.role) ? event.role : "assistant";
    return {
      timestamp: event.timestamp,
      type: "response_item",
      payload: {
        type: "message",
        role,
        content: [{ type: role === "assistant" ? "output_text" : "input_text", text: event.text }],
        _agent_session_bridge: marker,
      },
    };
  }

  async write(session, mapping = {}) {
    const file = mapping.path ?? this.nativePath(session);
    let existing = [];
    try { existing = parseJsonLines(await readFile(file, "utf8")); } catch {}
    const known = new Set(existing.map((record) => record.payload?._agent_session_bridge?.eventId).filter(Boolean));
    const additions = session.events.filter((event) => !known.has(event.id)).map((event) => this.recordForEvent(session, event));
    if (existing.length === 0) {
      await ensureDir(path.dirname(file));
      const meta = {
        timestamp: session.createdAt,
        type: "session_meta",
        payload: {
          id: session.id,
          timestamp: session.createdAt,
          cwd: session.project.cwd,
          originator: "agent-session-bridge",
          cli_version: "0.5.1",
          source: "cli",
          model_provider: "openai",
          base_instructions: null,
          agent_session_bridge: bridgeMarker(session),
        },
      };
      await atomicWrite(file, `${[meta, ...additions].map((record) => JSON.stringify(record)).join("\n")}\n`);
    } else if (additions.length) {
      await appendFile(file, `${additions.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
    }
    return { path: file, sessionId: session.id, added: additions.length };
  }
}
