import { appendFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Adapter, contentEvent, descriptorForFile, readJsonLinesPrefix, walkFiles } from "./base.mjs";
import { bridgeMarker, createSession } from "../asif.mjs";
import { atomicWrite, encodeProjectPath, parseJsonLines, stableId, textFromContent, titleFromEvents, uuidFrom } from "../util.mjs";

export class QoderAdapter extends Adapter {
  constructor(options = {}) {
    const home = options.home ?? os.homedir();
    super({ id: "qoder", name: "Qoder", home });
    this.root = options.root ?? path.join(home, ".qoder", "projects");
  }

  async status() {
    const transcripts = await walkFiles(this.root, (target, name) => name.endsWith(".jsonl") && target.includes(`${path.sep}transcript${path.sep}`), 6);
    return {
      id: this.id,
      name: this.name,
      detected: transcripts.length > 0,
      root: this.describePath(this.root),
      read: true,
      write: true,
      compatibility: "documented-transcript-jsonl",
      capabilities: this.capabilities({ structuredTools: true, resumeSession: false }),
      note: "Transcript format is supported; resume indexing is experimental when Qoder CLI is not installed.",
    };
  }

  async discover({ historyDays = 30, projectRoots = [] } = {}) {
    const files = await walkFiles(this.root, (target, name) => name.endsWith(".jsonl") && target.includes(`${path.sep}transcript${path.sep}`), 6);
    const cutoff = Date.now() - historyDays * 86_400_000;
    const descriptors = [];
    for (const file of files) {
      try {
        const descriptor = await descriptorForFile(file, { agent: this.id });
        if (new Date(descriptor.updatedAt).getTime() < cutoff) continue;
        const metadata = await this.cachedDiscoveryMetadata(descriptor, async () => {
          const records = await readJsonLinesPrefix(file);
          const first = records.find((record) => ["user", "assistant"].includes(record.type));
          const meta = records.find((record) => record.type === "session_meta");
          if (!first && !meta) return null;
          const marker = meta?.data?.content?.agent_session_bridge;
          const firstUser = records.find((record) => record.type === "user");
          return {
            sessionId: first?.sessionId || meta?.sessionId || path.basename(file, ".jsonl"),
            canonicalId: marker?.canonicalId,
            sourceAgent: marker?.sourceAgent,
            sourceSessionId: marker?.sourceSessionId,
            cwd: first?.cwd || meta?.cwd || process.cwd(),
            title: textFromContent(firstUser?.message?.content).replace(/\s+/g, " ").slice(0, 88) || "Qoder session",
            createdAt: first?.timestamp || descriptor.createdAt,
          };
        });
        if (!metadata) continue;
        const cwd = metadata.cwd;
        if (projectRoots.length && !projectRoots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`))) continue;
        descriptors.push({
          ...descriptor,
          ...metadata,
        });
      } catch {}
    }
    return descriptors.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async read(descriptor, { canonicalId } = {}) {
    const records = parseJsonLines(await readFile(descriptor.path, "utf8"));
    const meta = records.find((record) => record.type === "session_meta") ?? {};
    const first = records.find((record) => ["user", "assistant"].includes(record.type)) ?? {};
    const marker = meta.data?.content?.agent_session_bridge ?? {};
    const sessionId = first.sessionId || meta.sessionId || descriptor.sessionId;
    const events = [];
    for (const [recordIndex, record] of records.entries()) {
      if (!record.message || !["user", "assistant"].includes(record.type)) continue;
      const blocks = Array.isArray(record.message.content) ? record.message.content : [{ type: "text", text: record.message.content }];
      for (const [blockIndex, block] of blocks.entries()) {
        const id = block.agentSessionBridge?.eventId ?? record.agentSessionBridge?.eventId
          ?? `evt_${stableId("", `${this.id}:${sessionId}:${record.uuid ?? recordIndex}:${blockIndex}`, 28)}`;
        const eventMarker = block.agentSessionBridge ?? record.agentSessionBridge ?? {};
        const source = { agent: this.id, sessionId, nativeId: record.uuid ?? String(recordIndex) };
        if (block.type === "tool_use") events.push(contentEvent({ id, timestamp: record.timestamp, kind: "tool_call", role: "assistant", text: block.name, name: block.name, callId: block.id, input: block.input, source }));
        else if (block.type === "tool_result") events.push(contentEvent({ id, timestamp: record.timestamp, kind: "tool_result", role: "tool", text: textFromContent(block.content), callId: block.tool_use_id, isError: block.is_error, source }));
        else if (block.text) events.push(contentEvent({ id, timestamp: record.timestamp, role: eventMarker.eventRole ?? record.message.role ?? record.type, text: block.text, source }));
      }
    }
    return createSession({
      id: canonicalId ?? marker.canonicalId,
      origin: { agent: marker.sourceAgent ?? this.id, sessionId: marker.sourceSessionId ?? sessionId, sourceKey: descriptor.key },
      cwd: first.cwd ?? meta.cwd ?? descriptor.cwd,
      title: descriptor.title || titleFromEvents(events),
      createdAt: first.timestamp ?? descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
      events,
      extensions: { qoder: { nativeSessionId: sessionId } },
    });
  }

  nativePath(session) {
    return path.join(this.root, encodeProjectPath(session.project.cwd), "transcript", `${session.id}.jsonl`);
  }

  recordForEvent(session, event) {
    const marker = { ...bridgeMarker(session), eventId: event.id, eventRole: event.role };
    const common = {
      sessionId: session.id,
      uuid: uuidFrom(`qoder:${session.id}:${event.id}`),
      timestamp: event.timestamp,
      cwd: session.project.cwd,
      agentSessionBridge: marker,
    };
    if (event.kind === "tool_call") return { ...common, type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: event.callId ?? stableId("call_", event.id, 24), name: event.name ?? event.text ?? "tool", input: event.input ?? {}, agentSessionBridge: marker }] } };
    if (event.kind === "tool_result") return { ...common, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: event.callId ?? stableId("call_", event.id, 24), content: event.text, is_error: Boolean(event.isError), agentSessionBridge: marker }] } };
    return { ...common, type: event.role === "user" ? "user" : "assistant", message: { role: event.role === "user" ? "user" : "assistant", content: event.role === "user" ? event.text : [{ type: "text", text: event.text, agentSessionBridge: marker }] } };
  }

  async write(session, mapping = {}) {
    const file = mapping.path ?? this.nativePath(session);
    let existing = [];
    try { existing = parseJsonLines(await readFile(file, "utf8")); } catch {}
    const known = new Set(existing.flatMap((record) => [
      record.agentSessionBridge?.eventId,
      ...(Array.isArray(record.message?.content) ? record.message.content.map((block) => block.agentSessionBridge?.eventId) : []),
    ]).filter(Boolean));
    const additions = session.events.filter((event) => !known.has(event.id)).map((event) => this.recordForEvent(session, event));
    if (!additions.length) return { path: file, sessionId: session.id, added: 0 };
    if (existing.length === 0) {
      const meta = {
        type: "session_meta",
        sessionId: session.id,
        uuid: uuidFrom(`qoder:${session.id}:meta`),
        timestamp: session.createdAt,
        cwd: session.project.cwd,
        data: { meta_type: "session_info", content: { mode: "agent", session_type: "assistant", agent_session_bridge: bridgeMarker(session) } },
      };
      await atomicWrite(file, `${[meta, ...additions].map((record) => JSON.stringify(record)).join("\n")}\n`);
    } else {
      await appendFile(file, `${additions.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
    }
    return { path: file, sessionId: session.id, added: additions.length };
  }
}
