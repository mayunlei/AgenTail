import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(value, home = os.homedir()) {
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

export function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function epoch(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime();
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function stableId(prefix, value, length = 26) {
  return `${prefix}${sha256(value).slice(0, length)}`;
}

export function uuidFrom(value) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function newCanonicalId() {
  return randomUUID();
}

export async function exists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(directory, mode = 0o700) {
  await mkdir(directory, { recursive: true, mode });
  try {
    await chmod(directory, mode);
  } catch {
    // Some mounted filesystems do not implement chmod.
  }
  return directory;
}

export async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && (error?.code === "ENOENT" || error instanceof SyntaxError)) return structuredClone(fallback);
    throw error;
  }
}

export async function atomicWrite(filePath, contents, mode = 0o600) {
  await ensureDir(path.dirname(filePath));
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, contents, { encoding: "utf8", mode });
  await rename(temp, filePath);
  try {
    await chmod(filePath, mode);
  } catch {
    // Best effort on non-POSIX filesystems.
  }
}

export async function writeJson(filePath, value) {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function fileSignature(filePath) {
  const info = await stat(filePath);
  return `${info.size}:${Math.trunc(info.mtimeMs)}`;
}

export function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
      if (part.type === "tool_use") return `[Tool call: ${part.name ?? "unknown"}]\n${JSON.stringify(part.input ?? {})}`;
      if (part.type === "tool_result") return `[Tool result${part.is_error ? " (error)" : ""}]\n${textFromContent(part.content)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function titleFromEvents(events, fallback = "Imported coding-agent session") {
  const first = events.find((event) => event.kind === "message" && event.role === "user" && event.text?.trim());
  if (!first) return fallback;
  return first.text.replace(/\s+/g, " ").trim().slice(0, 88);
}

export function safeProjectDirectory(candidate, fallback = process.cwd()) {
  if (typeof candidate !== "string" || !candidate.trim()) return fallback;
  return path.resolve(expandHome(candidate));
}

export function isWithinDays(timestamp, days) {
  if (!days || days <= 0) return true;
  return epoch(timestamp) >= Date.now() - days * 86_400_000;
}

export function parseJsonLines(contents) {
  const records = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      error.message = `Invalid JSONL at line ${index + 1}: ${error.message}`;
      throw error;
    }
  }
  return records;
}

export function encodeProjectPath(directory) {
  return path.resolve(directory).replaceAll(/[\\/:]/g, "-");
}

export function publicPath(filePath, home = os.homedir()) {
  if (filePath.startsWith(home + path.sep)) return `~/${path.relative(home, filePath)}`;
  return filePath;
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      positional.push(item);
      continue;
    }
    const [name, inline] = item.slice(2).split("=", 2);
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[name] = next;
      index += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positional, flags };
}
