export const AGENTAIL_ISSUES_URL = "https://github.com/mayunlei/AgenTail/issues/new";

export function createIssueReportUrl(status = {}, { platform = "unknown" } = {}) {
  const english = status.config?.language === "en";
  const product = status.product ?? {};
  const continuity = status.continuity ?? {};
  const stats = status.stats ?? {};
  const agents = Array.isArray(status.agents) ? status.agents : [];
  const selected = agents.filter((agent) => agent.selected).map((agent) => agent.name ?? agent.id).join(", ") || "none";
  const detected = agents.filter((agent) => agent.detected).map((agent) => agent.name ?? agent.id).join(", ") || "none";
  const version = product.version ?? "unknown";
  const body = english ? [
    "## What happened?",
    "<!-- Describe the problem. Please do not include secrets or private session content. -->",
    "",
    "## Expected behavior",
    "<!-- What should Agentail have done? -->",
    "",
    "## Steps to reproduce",
    "1. ",
    "",
    "## Automatic diagnostics",
    `- Agentail: ${version}`,
    `- Protocol: ${product.protocol ?? "unknown"}`,
    `- Platform: ${String(platform).slice(0, 180)}`,
    `- Language: ${status.config?.language ?? "unknown"}`,
    `- Live sync: ${status.config?.syncEnabled ? "enabled" : "disabled"}`,
    `- Selected agents: ${selected}`,
    `- Detected agents: ${detected}`,
    `- Continuity: ${continuity.status ?? "unknown"}; verified ${continuity.verifiedRate ?? "n/a"}%; conflicts ${continuity.conflicts ?? 0}; attention ${continuity.attention ?? 0}`,
    `- Counters: runs ${stats.syncRuns ?? 0}; errors ${stats.errors ?? 0}; conflicts detected/resolved ${stats.conflictsDetected ?? 0}/${stats.conflictsResolved ?? 0}`,
    `- Last run: ${stats.lastRunAt ?? "never"}`,
    "",
    "> Privacy: Agentail did not attach session text, project names, file paths, or command output.",
  ] : [
    "## 发生了什么？",
    "<!-- 请描述问题。请勿填写密钥或私有会话内容。 -->",
    "",
    "## 预期行为",
    "<!-- Agentail 原本应该怎样工作？ -->",
    "",
    "## 复现步骤",
    "1. ",
    "",
    "## 自动诊断",
    `- Agentail：${version}`,
    `- 协议：${product.protocol ?? "unknown"}`,
    `- 平台：${String(platform).slice(0, 180)}`,
    `- 语言：${status.config?.language ?? "unknown"}`,
    `- 实时同步：${status.config?.syncEnabled ? "已开启" : "已关闭"}`,
    `- 已选 Agent：${selected}`,
    `- 已检测 Agent：${detected}`,
    `- 连续性：${continuity.status ?? "unknown"}；已验证 ${continuity.verifiedRate ?? "n/a"}%；冲突 ${continuity.conflicts ?? 0}；需处理 ${continuity.attention ?? 0}`,
    `- 计数：运行 ${stats.syncRuns ?? 0}；错误 ${stats.errors ?? 0}；冲突发现/解决 ${stats.conflictsDetected ?? 0}/${stats.conflictsResolved ?? 0}`,
    `- 上次运行：${stats.lastRunAt ?? "从未"}`,
    "",
    "> 隐私说明：Agentail 未附带会话正文、项目名称、文件路径或命令输出。",
  ];
  const url = new URL(AGENTAIL_ISSUES_URL);
  url.searchParams.set("title", `[Bug] Agentail ${version} — `);
  url.searchParams.set("body", body.join("\n"));
  return url.toString();
}
