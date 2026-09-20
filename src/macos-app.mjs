import { chmod, copyFile, cp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { atomicWrite, ensureDir, exists } from "./util.mjs";
import { serviceCommand } from "./service.mjs";

const execFile = promisify(execFileCallback);
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDirectory, "..");
export const MENU_APP_LABEL = "local.agent-session-bridge.menubar";
export const MENU_APP_NAME = "Agentail.app";
export const LEGACY_MENU_APP_NAME = "Agent Session Bridge.app";

export function menuAppLaunchAgentPlist({ executable }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MENU_APP_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xmlEscape(executable)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
`;
}

export async function appCommand(action, { store, port = 4765, prebuilt = false } = {}) {
  if (process.platform !== "darwin") throw new Error("The native menu bar app currently supports macOS.");
  const distApp = path.join(projectRoot, "dist", MENU_APP_NAME);
  const installedApp = path.join(os.homedir(), "Applications", MENU_APP_NAME);
  const legacyInstalledApp = path.join(os.homedir(), "Applications", LEGACY_MENU_APP_NAME);
  const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
  const domain = `gui/${uid}`;
  const loginPlist = path.join(os.homedir(), "Library", "LaunchAgents", `${MENU_APP_LABEL}.plist`);

  if (action === "build") return buildMenuApp({ destination: distApp, port });
  if (action === "install") {
    const built = prebuilt
      ? await usePrebuiltMenuApp({ destination: distApp, port })
      : await buildMenuApp({ destination: distApp, port });
    await ensureDir(path.dirname(installedApp));
    await rm(legacyInstalledApp, { recursive: true, force: true });
    await rm(installedApp, { recursive: true, force: true });
    await cp(distApp, installedApp, { recursive: true });
    await serviceCommand("install", { store, port });
    const executable = path.join(installedApp, "Contents", "MacOS", "Agentail");
    await ensureDir(path.dirname(loginPlist));
    await atomicWrite(loginPlist, menuAppLaunchAgentPlist({ executable }), 0o600);
    await execFile("launchctl", ["bootout", domain, loginPlist]).catch(() => {});
    await execFile("launchctl", ["bootstrap", domain, loginPlist]);
    await execFile("launchctl", ["enable", `${domain}/${MENU_APP_LABEL}`]);
    return { ...built, installed: true, running: true, appPath: installedApp, executable, loginPlist };
  }
  if (action === "open") {
    if (!(await exists(installedApp))) throw new Error("Menu bar app is not installed. Run `asb app install` first.");
    await execFile("open", [installedApp]);
    return { opened: true, appPath: installedApp };
  }
  if (action === "status") {
    const installed = await exists(installedApp);
    let running = false;
    try { await execFile("launchctl", ["print", `${domain}/${MENU_APP_LABEL}`]); running = true; } catch {}
    return { installed, running, appPath: installedApp, loginPlist, backend: await serviceCommand("status", { store, port }) };
  }
  if (action === "uninstall") {
    await execFile("launchctl", ["bootout", domain, loginPlist]).catch(() => {});
    if (await exists(loginPlist)) await unlink(loginPlist);
    await rm(installedApp, { recursive: true, force: true });
    await rm(legacyInstalledApp, { recursive: true, force: true });
    await serviceCommand("uninstall", { store, port });
    return { installed: false, running: false, appPath: installedApp, loginPlist };
  }
  throw new Error("app requires build, install, open, status, or uninstall");
}

async function usePrebuiltMenuApp({ destination, port }) {
  const executable = path.join(destination, "Contents", "MacOS", "Agentail");
  if (!(await exists(executable))) {
    throw new Error("The release does not contain a prebuilt Agentail.app. Re-run without --prebuilt to build it locally.");
  }
  await chmod(executable, 0o755);
  await execFile("codesign", ["--verify", "--deep", "--strict", destination]);
  return { built: false, prebuilt: true, appPath: destination, executable, port };
}

export async function buildMenuApp({ destination, port = 4765 }) {
  const source = path.join(projectRoot, "macos", "AgentSessionBridgeMenu.m");
  const contents = path.join(destination, "Contents");
  const executableDirectory = path.join(contents, "MacOS");
  const resourcesDirectory = path.join(contents, "Resources");
  const executable = path.join(executableDirectory, "Agentail");
  await rm(destination, { recursive: true, force: true });
  await Promise.all([ensureDir(executableDirectory), ensureDir(resourcesDirectory)]);
  await execFile("xcrun", [
    "clang",
    "-arch", "arm64",
    "-arch", "x86_64",
    "-fobjc-arc",
    "-fmodules",
    "-mmacosx-version-min=13.0",
    "-framework", "Cocoa",
    "-o", executable,
    source,
  ], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
  await chmod(executable, 0o755);
  await atomicWrite(path.join(contents, "Info.plist"), appInfoPlist({ port }), 0o644);
  await copyFile(path.join(projectRoot, "README.md"), path.join(resourcesDirectory, "README.md"));
  await execFile("codesign", ["--force", "--deep", "--sign", "-", destination]);
  return { built: true, appPath: destination, executable, port };
}

function appInfoPlist({ port }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>Agentail</string>
  <key>CFBundleExecutable</key><string>Agentail</string>
  <key>CFBundleIdentifier</key><string>local.agentail.menu</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>Agentail</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.5.2</string>
  <key>CFBundleVersion</key><string>8</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>ASBPort</key><integer>${Number(port)}</integer>
</dict>
</plist>
`;
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
