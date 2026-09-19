import { ClaudeAdapter } from "./claude.mjs";
import { CodexAdapter } from "./codex.mjs";
import { OpenCodeAdapter } from "./opencode.mjs";
import { QoderAdapter } from "./qoder.mjs";

export function createAdapters({ store, home, overrides = {} } = {}) {
  const adapters = [
    new CodexAdapter({ home, ...overrides.codex }),
    new ClaudeAdapter({ home, ...overrides.claude }),
    new OpenCodeAdapter({ home, importsDir: store?.importsDir, ...overrides.opencode }),
    new QoderAdapter({ home, ...overrides.qoder }),
  ];
  return new Map(adapters.map((adapter) => [adapter.id, adapter]));
}
