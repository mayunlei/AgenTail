import { execFile as execFileCallback } from "node:child_process";
import { unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { atomicWrite, ensureDir, exists } from "./util.mjs";

const execFile = promisify(execFileCallback);
export const SERVICE_LABEL = "local.agent-session-bridge.daemon";

export function launchAgentPlist({ node = process.execPath, cli, stateRoot, port = 4765 }) {
  const logDir = path.join(stateRoot, "logs");
  const argumentsList = [node, cli, "serve", "--host", "127.0.0.1", "--port", String(port), "--home", stateRoot];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsList.map((value) => `    <string>${xmlEscape(value)}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xmlEscape(path.join(logDir, "daemon.log"))}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(path.join(logDir, "daemon.error.log"))}</string>
</dict>
</plist>
`;
}

export async function serviceCommand(action, { store, port = 4765 } = {}) {
  if (process.platform !== "darwin") throw new Error("Background service management currently supports macOS launchd.");
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  const domain = `gui/${uid}`;
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
  const cli = fileURLToPath(new URL("../bin/agent-session-bridge.mjs", import.meta.url));
  if (action === "install") {
    await ensureDir(path.join(store.root, "logs"));
    await ensureDir(path.dirname(plistPath));
    await atomicWrite(plistPath, launchAgentPlist({ cli, stateRoot: store.root, port }), 0o600);
    await execFile("launchctl", ["bootout", domain, plistPath]).catch(() => {});
    await execFile("launchctl", ["bootstrap", domain, plistPath]);
    await execFile("launchctl", ["enable", `${domain}/${SERVICE_LABEL}`]);
    return { installed: true, running: true, label: SERVICE_LABEL, plistPath, url: `http://127.0.0.1:${port}` };
  }
  if (action === "uninstall") {
    await execFile("launchctl", ["bootout", domain, plistPath]).catch(() => {});
    if (await exists(plistPath)) await unlink(plistPath);
    return { installed: false, running: false, label: SERVICE_LABEL, plistPath };
  }
  if (action === "status") {
    const installed = await exists(plistPath);
    let running = false;
    try {
      await execFile("launchctl", ["print", `${domain}/${SERVICE_LABEL}`]);
      running = true;
    } catch {}
    return { installed, running, label: SERVICE_LABEL, plistPath };
  }
  throw new Error("service requires install, uninstall, or status");
}

function xmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]);
}
