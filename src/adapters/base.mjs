import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileSignature, publicPath } from "../util.mjs";
import { normalizeCapabilities } from "../conversion.mjs";

export class Adapter {
  constructor({ id, name, home }) {
    this.id = id;
    this.name = name;
    this.home = home;
  }

  async status() {
    throw new Error(`${this.id}: status() is not implemented`);
  }

  async discover() {
    throw new Error(`${this.id}: discover() is not implemented`);
  }

  async read() {
    throw new Error(`${this.id}: read() is not implemented`);
  }

  async write() {
    throw new Error(`${this.id}: write() is not implemented`);
  }

  capabilities(overrides = {}) {
    return normalizeCapabilities({
      listSessions: true,
      readHistory: true,
      createSession: true,
      appendEvents: true,
      nativeWrite: true,
      readback: true,
      ...overrides,
    });
  }

  describePath(filePath) {
    return publicPath(filePath, this.home);
  }
}

export async function walkFiles(root, predicate, maxDepth = 8) {
  const results = [];
  async function visit(directory, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return visit(target, depth + 1);
        if (entry.isFile() && predicate(target, entry.name)) results.push(target);
      }),
    );
  }
  await visit(root, 0);
  return results;
}

export async function descriptorForFile(filePath, extra = {}) {
  const info = await stat(filePath);
  return {
    key: filePath,
    path: filePath,
    updatedAt: info.mtime.toISOString(),
    createdAt: info.birthtime.toISOString(),
    signature: await fileSignature(filePath),
    ...extra,
  };
}

export function contentEvent({ id, timestamp, kind = "message", role, text, source, ...extra }) {
  return { id, timestamp, kind, role, text: text ?? "", source, ...extra };
}

export function markerEventId(record, fallback) {
  return record?.agentSessionBridge?.eventId
    ?? record?._agent_session_bridge?.eventId
    ?? record?.metadata?.agentSessionBridge?.eventId
    ?? fallback;
}
