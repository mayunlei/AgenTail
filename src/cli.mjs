import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertSession } from "./asif.mjs";
import { createAdapters } from "./adapters/index.mjs";
import { startServer } from "./server.mjs";
import { serviceCommand } from "./service.mjs";
import { appCommand } from "./macos-app.mjs";
import { BridgeStore } from "./store.mjs";
import { SyncEngine } from "./sync-engine.mjs";
import { parseArgs, publicPath } from "./util.mjs";

const execFile = promisify(execFileCallback);

export async function runCli(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] ?? "serve";
  const store = new BridgeStore(flags.home ? path.resolve(String(flags.home)) : undefined);
  const adapters = createAdapters({ store });
  const engine = await new SyncEngine({ store, adapters }).initialize();

  if (["help", "--help", "-h"].includes(command) || flags.help) return printHelp();
  if (command === "serve") {
    const { server, url } = await startServer({ engine, host: String(flags.host ?? "127.0.0.1"), port: Number(flags.port ?? 4765) });
    console.log(`Agentail is running at ${url}`);
    console.log(`State: ${publicPath(store.root)}`);
    if (flags.open) await openBrowser(url);
    const stop = () => server.close(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    return;
  }
  if (command === "status") {
    const status = await engine.status();
    if (flags.json) console.log(JSON.stringify(status, null, 2));
    else printStatus(status);
    return;
  }
  if (command === "service") {
    const action = positional[1] ?? "status";
    console.log(JSON.stringify(await serviceCommand(action, { store, port: Number(flags.port ?? 4765) }), null, 2));
    return;
  }
  if (command === "app") {
    const action = positional[1] ?? "status";
    console.log(JSON.stringify(await appCommand(action, {
      store,
      port: Number(flags.port ?? 4765),
      prebuilt: Boolean(flags.prebuilt),
    }), null, 2));
    return;
  }
  if (command === "scan") {
    const agent = String(flags.agent ?? positional[1] ?? "codex");
    const sessions = await engine.listSessions(agent, Number(flags.limit ?? 50));
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }
  if (command === "repair") {
    const agentId = String(flags.agent ?? positional[1] ?? "claude");
    const adapter = adapters.get(agentId);
    if (!adapter || typeof adapter.repairImportedModels !== "function") throw new Error(`No repair operation is available for ${agentId}`);
    const result = await adapter.repairImportedModels({ apply: Boolean(flags.apply) });
    console.log(JSON.stringify({
      ...result,
      ...(!flags.apply && result.files ? { next: "Re-run with --apply to back up and repair these files." } : {}),
    }, null, 2));
    return;
  }
  if (command === "sync") {
    const result = await engine.syncOnce({ includeExisting: Boolean(flags["include-existing"]) });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "resolve") {
    const canonicalId = String(flags.session ?? flags.canonical ?? "");
    const conflictId = String(flags.conflict ?? "");
    if (!canonicalId || !conflictId) throw new Error("resolve requires --session and --conflict");
    console.log(JSON.stringify(await engine.resolveConflict({ canonicalId, conflictId, strategy: String(flags.strategy ?? "both") }), null, 2));
    return;
  }
  if (command === "bridge") {
    const sourceAgent = String(flags.from ?? "");
    const sourceKey = String(flags.session ?? "");
    const targets = String(flags.to ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (!sourceAgent || !sourceKey || !targets.length) throw new Error("bridge requires --from, --session, and --to");
    console.log(JSON.stringify(await engine.importSession({ sourceAgent, sourceKey, targets }), null, 2));
    return;
  }
  if (command === "export") {
    const sourceAgent = String(flags.from ?? "");
    const sourceKey = String(flags.session ?? "");
    if (!sourceAgent || !sourceKey) throw new Error("export requires --from and --session");
    const result = await engine.exportNativeSession({ sourceAgent, sourceKey, out: flags.out });
    console.log(result.path);
    return;
  }
  if (command === "import") {
    if (!flags.file || !flags.to) throw new Error("import requires --file and --to");
    const session = assertSession(JSON.parse(await readFile(path.resolve(String(flags.file)), "utf8")));
    const targets = String(flags.to).split(",").map((value) => value.trim()).filter(Boolean);
    console.log(JSON.stringify(await engine.importAsif(session, targets), null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Agentail 0.5.2 — Any agent. Same trail.

Usage:
  asb serve [--port 4765] [--open]
  asb status [--json]
  asb service install|status|uninstall [--port 4765]
  asb app build|install|open|status|uninstall [--port 4765] [--prebuilt]
  asb repair --agent claude [--apply]
  asb scan --agent codex [--limit 50]
  asb sync [--include-existing]
  asb resolve --session <canonical-id> --conflict <conflict-id> [--strategy both|current|incoming]
  asb bridge --from codex --session <path-or-id> --to claude,opencode,qoder
  asb export --from claude --session <path-or-id> [--out session.asif.json]
  asb import --file session.asif.json --to codex,claude

Live sync is disabled by default. On macOS, install and control it from the menu bar app.`);
}

function printStatus(status) {
  console.log(`${status.product.name} ${status.product.version} · ${status.product.protocol}`);
  console.log(`Live sync: ${status.config.syncEnabled ? "ON" : "OFF"}`);
  console.log(`Verified continuity: ${status.continuity.verifiedRate == null ? "not measured" : `${status.continuity.verifiedRate}%`} (${status.continuity.status})`);
  console.log(`State: ${status.home}`);
  for (const agent of status.agents) {
    const coverage = agent.coverage.total ? ` · verified ${agent.coverage.verified}/${agent.coverage.total}` : "";
    console.log(`${agent.selected ? "●" : "○"} ${agent.name.padEnd(12)} ${agent.detected ? agent.compatibility : "not detected"}${coverage}`);
  }
  console.log(`Runs ${status.stats.syncRuns} · read ${status.stats.sessionsRead} · written ${status.stats.sessionsWritten} · errors ${status.stats.errors}`);
}

async function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { await execFile(command, args); } catch {}
}
