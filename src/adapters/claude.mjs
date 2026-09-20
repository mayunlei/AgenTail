import { appendFile, copyFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Adapter, contentEvent, descriptorForFile, readJsonLinesPrefix, walkFiles } from "./base.mjs";
import { bridgeMarker, createSession } from "../asif.mjs";
import { atomicWrite, encodeProjectPath, parseJsonLines, stableId, textFromContent, titleFromEvents, uuidFrom } from "../util.mjs";

export const CLAUDE_IMPORTED_MODEL = "<synthetic>";

export class ClaudeAdapter extends Adapter {
  constructor(options = {}) {
    const home = options.home ?? os.homedir();
    super({ id: "claude", name: "Claude Code", home });
    this.root = options.root ?? path.join(home, ".claude", "projects");
  }

  async status() {
    const detected = await walkFiles(this.root, (_, name) => name.endsWith(".jsonl"), 3).then((files) => files.length > 0);
    return {
      id: this.id,
      name: this.name,
      detected,
      root: this.describePath(this.root),
      read: true,
      write: true,
      compatibility: "native-jsonl",
      capabilities: this.capabilities({ structuredTools: true, resumeSession: true }),
      note: "Creates a separate project transcript and only appends bridge events.",
    };
  }

  async discover({ historyDays = 30, projectRoots = [] } = {}) {
    const files = await walkFiles(this.root, (_, name) => name.endsWith(".jsonl"), 3);
    const cutoff = Date.now() - historyDays * 86_400_000;
    const descriptors = [];
    for (const file of files) {
      try {
        const descriptor = await descriptorForFile(file, { agent: this.id });
        if (new Date(descriptor.updatedAt).getTime() < cutoff) continue;
        const metadata = await this.cachedDiscoveryMetadata(descriptor, async () => {
          const records = await readJsonLinesPrefix(file);
          const message = records.find((record) => record.type === "user" || record.type === "assistant");
          if (!message) return null;
          const marker = message.agentSessionBridge ?? {};
          const firstUser = records.find((record) => record.type === "user" && record.message);
          return {
            sessionId: message.sessionId || path.basename(file, ".jsonl"),
            canonicalId: marker.canonicalId,
            sourceAgent: marker.sourceAgent,
            sourceSessionId: marker.sourceSessionId,
            cwd: message.cwd || process.cwd(),
            title: textFromContent(firstUser?.message?.content).replace(/\s+/g, " ").slice(0, 88) || "Claude Code session",
            createdAt: message.timestamp || descriptor.createdAt,
          };
        });
        if (!metadata) continue;
        const cwd = metadata.cwd;
        if (projectRoots.length && !projectRoots.some((root) => cwd === root || cwd.startsWith(`${root}${path.sep}`))) continue;
        descriptors.push({
          ...descriptor,
          ...metadata,
        });
      } catch {
        // Ignore a transcript while a partial line is being appended.
      }
    }
    return descriptors.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async read(descriptor, { canonicalId } = {}) {
    const records = parseJsonLines(await readFile(descriptor.path, "utf8"));
    const first = records.find((record) => record.type === "user" || record.type === "assistant") ?? {};
    const sessionId = first.sessionId ?? descriptor.sessionId;
    const sessionMarker = records.find((record) => record.agentSessionBridge?.canonicalId)?.agentSessionBridge ?? {};
    const events = [];
    for (const [recordIndex, record] of records.entries()) {
      if (!record.message || !["user", "assistant"].includes(record.type)) continue;
      const blocks = Array.isArray(record.message.content) ? record.message.content : [{ type: "text", text: record.message.content }];
      for (const [blockIndex, block] of blocks.entries()) {
        const fallbackId = `evt_${stableId("", `${this.id}:${sessionId}:${record.uuid ?? recordIndex}:${blockIndex}`, 28)}`;
        const id = block.agentSessionBridge?.eventId ?? record.agentSessionBridge?.eventId ?? fallbackId;
        const source = { agent: this.id, sessionId, nativeId: record.uuid ?? String(recordIndex) };
        if (block.type === "tool_use") {
          events.push(contentEvent({ id, timestamp: record.timestamp, kind: "tool_call", role: "assistant", text: block.name, name: block.name, callId: block.id, input: block.input, source }));
        } else if (block.type === "tool_result") {
          events.push(contentEvent({ id, timestamp: record.timestamp, kind: "tool_result", role: "tool", text: textFromContent(block.content), callId: block.tool_use_id, isError: block.is_error, source }));
        } else {
          const text = block.text ?? (typeof block === "string" ? block : "");
          if (text) events.push(contentEvent({ id, timestamp: record.timestamp, role: record.message.role ?? record.type, text, source }));
        }
      }
    }
    return createSession({
      id: canonicalId ?? sessionMarker.canonicalId,
      origin: { agent: sessionMarker.sourceAgent ?? this.id, sessionId: sessionMarker.sourceSessionId ?? sessionId, sourceKey: descriptor.key },
      cwd: first.cwd ?? descriptor.cwd,
      title: descriptor.title || titleFromEvents(events),
      createdAt: first.timestamp ?? descriptor.createdAt,
      updatedAt: descriptor.updatedAt,
      events,
      extensions: { claude: { nativeSessionId: sessionId, version: first.version } },
    });
  }

  nativePath(session) {
    return path.join(this.root, encodeProjectPath(session.project.cwd), `${session.id}.jsonl`);
  }

  recordForEvent(session, event, parentUuid) {
    const uuid = uuidFrom(`claude:${session.id}:${event.id}`);
    const marker = { ...bridgeMarker(session), eventId: event.id };
    const common = {
      parentUuid: parentUuid ?? null,
      isSidechain: false,
      userType: "external",
      cwd: session.project.cwd,
      sessionId: session.id,
      version: "2.1.0",
      gitBranch: "",
      uuid,
      timestamp: event.timestamp,
      agentSessionBridge: marker,
    };
    if (event.kind === "tool_call") {
      return {
        ...common,
        type: "assistant",
        message: assistantMessage([{ type: "tool_use", id: event.callId ?? stableId("toolu_", event.id, 24), name: event.name ?? event.text ?? "tool", input: event.input ?? {}, agentSessionBridge: marker }]),
      };
    }
    if (event.kind === "tool_result") {
      return {
        ...common,
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: event.callId ?? stableId("toolu_", event.id, 24), content: event.text, is_error: Boolean(event.isError), agentSessionBridge: marker }] },
      };
    }
    if (event.role === "user") return { ...common, type: "user", message: { role: "user", content: event.text } };
    return { ...common, type: "assistant", message: assistantMessage([{ type: "text", text: event.text, agentSessionBridge: marker }]) };
  }

  async write(session, mapping = {}) {
    const file = mapping.path ?? this.nativePath(session);
    let existing = [];
    try { existing = parseJsonLines(await readFile(file, "utf8")); } catch {}
    const known = new Set(existing.flatMap((record) => [
      record.agentSessionBridge?.eventId,
      ...(Array.isArray(record.message?.content) ? record.message.content.map((block) => block.agentSessionBridge?.eventId) : []),
    ]).filter(Boolean));
    let parentUuid = existing.filter((record) => record.uuid).at(-1)?.uuid ?? null;
    const additions = [];
    for (const event of session.events) {
      if (known.has(event.id)) continue;
      const record = this.recordForEvent(session, event, parentUuid);
      additions.push(record);
      parentUuid = record.uuid;
    }
    if (!additions.length) return { path: file, sessionId: session.id, added: 0 };
    if (existing.length === 0) {
      await atomicWrite(file, `${additions.map((record) => JSON.stringify(record)).join("\n")}\n`);
    } else {
      await appendFile(file, `${additions.map((record) => JSON.stringify(record)).join("\n")}\n`, { mode: 0o600 });
    }
    return { path: file, sessionId: session.id, added: additions.length };
  }

  async repairImportedModels({ apply = false } = {}) {
    const files = await walkFiles(this.root, (_, name) => name.endsWith(".jsonl"), 3);
    const entries = [];
    const pattern = /(\"model\"\s*:\s*)\"agent-session-bridge\"/g;
    const backupTag = new Date().toISOString().replace(/[:.]/g, "-");
    let messages = 0;
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (!contents.includes('"agentSessionBridge"')) continue;
      const matches = contents.match(pattern);
      if (!matches?.length) continue;
      messages += matches.length;
      const backupPath = `${file}.asb-backup-${backupTag}`;
      if (apply) {
        await copyFile(file, backupPath);
        await atomicWrite(file, contents.replace(pattern, `$1"${CLAUDE_IMPORTED_MODEL}"`));
      }
      entries.push({ file, messages: matches.length, backupPath: apply ? backupPath : null });
    }
    return { apply, scanned: files.length, files: entries.length, messages, entries };
  }
}

function assistantMessage(content) {
  return {
    id: stableId("msg_", JSON.stringify(content), 24),
    type: "message",
    role: "assistant",
    // Claude Code restores a session using the last assistant message's model.
    // Imported history was not generated by a target Claude model, so use
    // Claude Code's own synthetic sentinel instead of inventing a model name.
    model: CLAUDE_IMPORTED_MODEL,
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}
