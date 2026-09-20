import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseJsonLines, publicPath } from "../util.mjs";
import { normalizeCapabilities } from "../conversion.mjs";

export class Adapter {
  constructor({ id, name, home }) {
    this.id = id;
    this.name = name;
    this.home = home;
    this.discoveryMetadata = new Map();
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

  async cachedDiscoveryMetadata(descriptor, loader) {
    const cached = this.discoveryMetadata.get(descriptor.key);
    if (cached?.signature === descriptor.signature) return cached.value;
    const value = await loader();
    this.discoveryMetadata.set(descriptor.key, { signature: descriptor.signature, value });
    return value;
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
    signature: `${info.size}:${Math.trunc(info.mtimeMs)}`,
    ...extra,
  };
}

export async function readJsonLinesPrefix(filePath, maxBytes = 256 * 1024) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    let contents = buffer.subarray(0, bytesRead).toString("utf8");
    if (bytesRead === maxBytes && !contents.endsWith("\n")) {
      const lastCompleteLine = contents.lastIndexOf("\n");
      contents = lastCompleteLine >= 0 ? contents.slice(0, lastCompleteLine + 1) : "";
    }
    return contents ? parseJsonLines(contents) : [];
  } finally {
    await handle.close();
  }
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
