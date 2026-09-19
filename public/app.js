const ui = Object.fromEntries([
  "health", "language", "sync-enabled", "sync-now", "live-title", "live-detail", "agent-grid", "source-agent",
  "session-list", "refresh-sessions", "history-days", "poll-seconds", "content-policy", "activity-list",
  "last-run", "toast", "continuity-score", "continuity-badge", "continuity-title", "continuity-detail",
  "continuity-bar", "signal-agents", "signal-sessions", "signal-verified", "signal-attention",
  "attention-panel", "attention-title", "attention-detail", "canonical-list", "ledger-path",
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

const messages = {
  "zh-CN": {
    slogan: "Agent 随心换，上下文不断。", language: "语言", localOnly: "仅本机", connecting: "连接本地服务",
    goldenMetric: "已验证连续性 · 黄金指标", loading: "正在读取", continuityQuestion: "你的工作是否能在每个 Agent 中继续？",
    checkingContinuity: "Agentail 正在核对会话与目标端。", selectedDetected: "已选 / 已检测", continuousSessions: "连续会话",
    lastVerified: "上次验证", never: "尚未", needsAttention: "需要处理", autoGuard: "自动守护", liveSync: "实时同步",
    syncPaused: "同步已暂停", noSessionChanges: "不会改动 Agent 会话", checkNow: "立即检查新变化",
    baselineNote: "首次开启只建立基线，不会突然复制全部历史。", projectAttention: "有项目需要处理", syncScope: "同步范围",
    chooseAgents: "选择要保持连续的 Agent", agentsHelp: "至少选择两个。每张卡片同时显示安装状态、转换方式和覆盖结果。",
    projectContinuity: "项目连续性", sessionsTitle: "哪些会话已经到达哪些 Agent", verified: "已验证", degraded: "降级可用",
    failed: "失败", loadingLedger: "正在读取连续性账本", oneTimeMigration: "一次性迁移", importExisting: "导入已有会话",
    source: "来源", importHelp: "选一条旧会话，转换到当前勾选的其他 Agent；原文件保持不变。", loadingRecent: "读取最近会话",
    refreshList: "刷新列表", explainableRecord: "可解释记录", recentActivity: "最近发生了什么", notScanned: "尚未扫描",
    noActivity: "暂无同步活动。", advanced: "高级策略", advancedHelp: "扫描范围、转换内容与本地账本", discoveryWindow: "发现窗口",
    discoveryHelp: "扫描最近多少天", days: "天", scanInterval: "扫描间隔", scanHelp: "实时同步轮询频率", seconds: "秒",
    contentScope: "内容范围", contentHelp: "工具调用会按目标能力保留结构或转为惰性历史文本", messagesOnly: "仅消息",
    messagesTools: "消息 + 工具", localLedger: "本地账本", offline: "本地服务未连接", checking: "正在核对会话",
    serviceRunning: "本地服务运行中", guarding: "正在守护新会话", autoPaused: "自动同步已暂停", everySeconds: "每 {count} 秒检查一次",
    manualAvailable: "手动检查仍然可用", lastRun: "上次 {time}", healthyTitle: "工作已连续",
    healthyDetail: "每条已记录会话都已在目标 Agent 中回读验证。", healthyBadge: "稳定", attentionTitle: "有会话尚未安全到达",
    attentionStatusDetail: "查看下方黄色或红色目标；Agentail 已保留交接包作为兜底。", attentionBadge: "需处理",
    unverifiedTitle: "会话已写入，仍需验证", unverifiedDetail: "目标端有内容，但无法确认它能被完整重新打开。", unverifiedBadge: "未验证",
    readyTitle: "同步路径已准备", readyDetail: "产生新会话后，这里会显示它在各 Agent 中的连续性。", readyBadge: "就绪",
    idleTitle: "选择至少两个 Agent", idleDetail: "连续性必须有一个来源和至少一个目标。", idleBadge: "未配置",
    waitingTitle: "等待第一条会话", waitingDetail: "完成一次扫描后开始计算连续性。", waitingBadge: "等待",
    conflictsNeedDecision: "{count} 个并行修改需要决策", targetsNeedReview: "{count} 个目标需要确认",
    conflictAttentionDetail: "Agentail 已保留共同基线和两边的修改；请选择保留两边或采用其中一个版本。",
    failedAttentionDetail: "{failed} 个写入失败，{degraded} 个使用了降级转换。失败不会阻止其他目标继续同步。",
    degradedAttentionDetail: "{count} 个目标丢失了部分原生语义；可继续工作，但建议先查看交接状态。",
    coverage: "{verified}/{total} 条已验证", noContinuousSessions: "还没有连续会话", selectAgent: "选择 {name}", detected: "已检测",
    notDetected: "未检测到会话", noRecords: "还没有连续性记录", noRecordsHelp: "选择至少两个 Agent，然后开启实时同步或导入一条已有会话。",
    fidelity: "保真度 {value}%", currentBranch: "当前分支", otherBranch: "另一分支", twoVersions: "同一事件出现两个版本",
    needsDecision: "需要决策", noText: "无文本内容", keepBoth: "保留两边", useAgent: "采用 {name}", eventCount: "{count} 个事件",
    noSummary: "尚未生成可靠工作摘要", fromAgent: "来自 {name}", loadingLocal: "正在读取本地会话…", update: "更新", import: "导入",
    noRecent: "最近窗口内没有会话", baselineStarted: "基线已建立，开始守护新会话", syncPausedToast: "自动同步已暂停",
    baselineRecorded: "已记录 {count} 条基线，不复制旧会话", scanDone: "检查完成：{changed} 条变化，{written} 个目标写入{errors}",
    errorsSuffix: "，{count} 个失败", selectTarget: "请至少再选择一个目标 Agent", converting: "转换中", processed: "已处理 {count} 个目标{errors}",
    retry: "重试", conflictResolved: "冲突已解决；新版本已写入 {count} 个 Agent{errors}", policyUpdated: "内容策略已更新",
    modeNativeSource: "原生来源", modeOfficialImport: "官方导入", modeStructuredNative: "结构化写入", modeTranscriptNative: "文本兼容",
    modeHandoffNative: "交接会话", modeHandoffFile: "交接文件", stateSource: "原始会话", stateSynced: "已写入", stateHandoff: "交接包",
    statePending: "待同步", stateStale: "有新版本", stateConflict: "并行冲突", capabilityStructuredResume: "结构化 · 可续接",
    capabilityStructuredExperimental: "结构化 · 续接实验性", capabilityTranscript: "文本兼容", capabilityHandoff: "仅生成交接包",
    actionSync: "同步", actionBaseline: "建立基线", actionProject: "转换", actionHandoff: "交接兜底", actionDiscover: "发现失败",
    actionConflict: "并行冲突", actionResolve: "冲突已解决", actionSkip: "已跳过", actionDedupe: "重复会话已收敛", duplicateHuman: "已按原生源会话身份收敛 {count} 个重复 canonical session。", baselineHuman: "已记录 {count} 条现有会话；之后只同步新变化。",
    handoffHuman: "{title}：目标不可写，已保留通用交接包。", unknownTime: "未知时间", justNow: "刚刚", minutesAgo: "{count} 分钟前",
    hoursAgo: "{count} 小时前", daysAgo: "{count} 天前",
  },
  en: {
    slogan: "Any agent. Same trail.", language: "Language", localOnly: "Local only", connecting: "Connecting to local service",
    goldenMetric: "Verified continuity · North-star metric", loading: "Loading", continuityQuestion: "Can your work continue in every agent?",
    checkingContinuity: "Agentail is checking sessions against their targets.", selectedDetected: "Selected / detected", continuousSessions: "Continuous sessions",
    lastVerified: "Last verified", never: "Never", needsAttention: "Needs attention", autoGuard: "Automatic guard", liveSync: "Live sync",
    syncPaused: "Sync paused", noSessionChanges: "No agent sessions will be changed", checkNow: "Check for changes",
    baselineNote: "The first run records a baseline and does not copy all history.", projectAttention: "A project needs attention", syncScope: "Sync scope",
    chooseAgents: "Choose agents to keep continuous", agentsHelp: "Choose at least two. Each card shows detection, conversion route, and coverage.",
    projectContinuity: "Project continuity", sessionsTitle: "Which sessions reached which agents", verified: "Verified", degraded: "Degraded",
    failed: "Failed", loadingLedger: "Loading the continuity ledger", oneTimeMigration: "One-time migration", importExisting: "Import an existing session",
    source: "Source", importHelp: "Choose an old session and convert it to the other selected agents. The source file stays unchanged.", loadingRecent: "Loading recent sessions",
    refreshList: "Refresh list", explainableRecord: "Explainable record", recentActivity: "Recent activity", notScanned: "Not scanned",
    noActivity: "No sync activity yet.", advanced: "Advanced policy", advancedHelp: "Discovery range, content conversion, and local ledger", discoveryWindow: "Discovery window",
    discoveryHelp: "How many recent days to scan", days: "days", scanInterval: "Scan interval", scanHelp: "Live-sync polling frequency", seconds: "sec",
    contentScope: "Content scope", contentHelp: "Tool calls remain structured when supported, otherwise they become inert history.", messagesOnly: "Messages only",
    messagesTools: "Messages + tools", localLedger: "Local ledger", offline: "Local service unavailable", checking: "Checking sessions",
    serviceRunning: "Local service running", guarding: "Watching for new sessions", autoPaused: "Automatic sync paused", everySeconds: "Checks every {count} seconds",
    manualAvailable: "Manual checks remain available", lastRun: "Last {time}", healthyTitle: "Work is continuous",
    healthyDetail: "Every recorded session has been read back and verified in its target agents.", healthyBadge: "Stable", attentionTitle: "Some sessions have not arrived safely",
    attentionStatusDetail: "Review the amber or red targets below. Agentail kept a handoff capsule as a fallback.", attentionBadge: "Review",
    unverifiedTitle: "Written, awaiting verification", unverifiedDetail: "The target has content, but Agentail cannot confirm it reopens completely.", unverifiedBadge: "Unverified",
    readyTitle: "Sync paths are ready", readyDetail: "New sessions will appear here with continuity across agents.", readyBadge: "Ready",
    idleTitle: "Choose at least two agents", idleDetail: "Continuity needs one source and at least one target.", idleBadge: "Not configured",
    waitingTitle: "Waiting for the first session", waitingDetail: "Continuity measurement starts after a scan.", waitingBadge: "Waiting",
    conflictsNeedDecision: "{count} concurrent edits need a decision", targetsNeedReview: "{count} targets need review",
    conflictAttentionDetail: "Agentail preserved the common base and both edits. Keep both or select one version.",
    failedAttentionDetail: "{failed} writes failed and {degraded} used degraded conversion. Other targets continue syncing.",
    degradedAttentionDetail: "{count} targets lost some native semantics. Work can continue, but review the handoff state.",
    coverage: "{verified}/{total} verified", noContinuousSessions: "No continuous sessions yet", selectAgent: "Select {name}", detected: "Detected",
    notDetected: "No sessions detected", noRecords: "No continuity records yet", noRecordsHelp: "Choose at least two agents, enable live sync, or import an existing session.",
    fidelity: "Fidelity {value}%", currentBranch: "Current branch", otherBranch: "Other branch", twoVersions: "Two versions of the same event",
    needsDecision: "Decision required", noText: "No text content", keepBoth: "Keep both", useAgent: "Use {name}", eventCount: "{count} events",
    noSummary: "No reliable work summary yet", fromAgent: "from {name}", loadingLocal: "Loading local sessions…", update: "Update", import: "Import",
    noRecent: "No sessions in the recent window", baselineStarted: "Baseline saved; watching new sessions", syncPausedToast: "Automatic sync paused",
    baselineRecorded: "Recorded {count} baseline sessions without copying history", scanDone: "Check complete: {changed} changes, {written} target writes{errors}",
    errorsSuffix: ", {count} failed", selectTarget: "Select at least one more target agent", converting: "Converting", processed: "Processed {count} targets{errors}",
    retry: "Retry", conflictResolved: "Conflict resolved; wrote the new revision to {count} agents{errors}", policyUpdated: "Content policy updated",
    modeNativeSource: "Native source", modeOfficialImport: "Official import", modeStructuredNative: "Structured native", modeTranscriptNative: "Transcript compatible",
    modeHandoffNative: "Handoff session", modeHandoffFile: "Handoff file", stateSource: "Source session", stateSynced: "Written", stateHandoff: "Handoff",
    statePending: "Pending", stateStale: "New revision", stateConflict: "Concurrent conflict", capabilityStructuredResume: "Structured · resumable",
    capabilityStructuredExperimental: "Structured · experimental resume", capabilityTranscript: "Transcript compatible", capabilityHandoff: "Handoff capsule only",
    actionSync: "Sync", actionBaseline: "Baseline", actionProject: "Convert", actionHandoff: "Handoff fallback", actionDiscover: "Discovery failed",
    actionConflict: "Concurrent conflict", actionResolve: "Conflict resolved", actionSkip: "Skipped", actionDedupe: "Duplicate sessions converged", duplicateHuman: "Converged {count} duplicate canonical sessions by native source identity.", baselineHuman: "Recorded {count} existing sessions; only new changes will sync.",
    handoffHuman: "{title}: target is not writable, so a universal handoff capsule was saved.", unknownTime: "Unknown time", justNow: "just now",
    minutesAgo: "{count} min ago", hoursAgo: "{count} hr ago", daysAgo: "{count} days ago",
  },
};

const agentInitials = { codex: "CX", claude: "CL", opencode: "OC", qoder: "QD" };
const stateKeys = { source: "stateSource", verified: "verified", synced: "stateSynced", degraded: "degraded", handoff: "stateHandoff", failed: "failed", pending: "statePending", stale: "stateStale", conflict: "stateConflict" };
const modeKeys = { "native-source": "modeNativeSource", "official-import": "modeOfficialImport", "structured-native": "modeStructuredNative", "transcript-native": "modeTranscriptNative", "handoff-native": "modeHandoffNative", "handoff-file": "modeHandoffFile" };
let locale = "zh-CN";
let currentStatus = null;
let toastTimer = null;
let loadingSessions = false;

function t(key, values = {}) {
  const template = messages[locale]?.[key] ?? messages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function applyLocale(nextLocale) {
  locale = nextLocale === "en" ? "en" : "zh-CN";
  document.documentElement.lang = locale;
  document.title = `Agentail — ${t("slogan")}`;
  ui.language.value = locale;
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function loadStatus({ quiet = false } = {}) {
  try {
    const status = await api("/api/status");
    currentStatus = status;
    applyLocale(status.config.language);
    renderStatus(status);
    renderCanonicalSessions(status.sessions ?? [], status.agents);
  } catch (error) {
    ui.health.classList.remove("online");
    ui.health.querySelector("span").textContent = t("offline");
    if (!quiet) showToast(humanError(error.message), true);
  }
}

function renderStatus(status) {
  ui.health.classList.add("online");
  ui.health.querySelector("span").textContent = status.daemon.syncing ? t("checking") : t("serviceRunning");
  ui.syncEnabled.checked = status.config.syncEnabled;
  document.querySelector(".live-state").classList.toggle("active", status.config.syncEnabled);
  ui.liveTitle.textContent = status.config.syncEnabled ? t("guarding") : t("autoPaused");
  ui.liveDetail.textContent = status.config.syncEnabled ? t("everySeconds", { count: Math.round(status.config.pollIntervalMs / 1000) }) : t("manualAvailable");
  ui.lastRun.textContent = status.stats.lastRunAt ? t("lastRun", { time: relativeTime(status.stats.lastRunAt) }) : t("notScanned");
  ui.historyDays.value = status.config.historyDays;
  ui.pollSeconds.value = Math.round(status.config.pollIntervalMs / 1000);
  ui.ledgerPath.textContent = status.home;
  renderContinuity(status.continuity);
  renderAgents(status.agents);
  renderPolicy(status.config.contentPolicy);
  renderActivity(status.activity);
}

function renderContinuity(continuity) {
  ui.continuityScore.textContent = continuity.verifiedRate !== null ? `${continuity.verifiedRate}%` : "—";
  ui.continuityBar.style.width = `${continuity.verifiedRate ?? 0}%`;
  const keys = {
    healthy: ["healthyTitle", "healthyDetail", "healthyBadge"], attention: ["attentionTitle", "attentionStatusDetail", "attentionBadge"],
    unverified: ["unverifiedTitle", "unverifiedDetail", "unverifiedBadge"], ready: ["readyTitle", "readyDetail", "readyBadge"],
    idle: ["idleTitle", "idleDetail", "idleBadge"],
  }[continuity.status] ?? ["waitingTitle", "waitingDetail", "waitingBadge"];
  ui.continuityTitle.textContent = t(keys[0]);
  ui.continuityDetail.textContent = t(keys[1]);
  ui.continuityBadge.textContent = t(keys[2]);
  ui.continuityBadge.className = `status-badge ${continuity.status}`;
  ui.signalAgents.textContent = `${continuity.selectedAgents} / ${continuity.connectedAgents}`;
  ui.signalSessions.textContent = String(continuity.sessions);
  ui.signalVerified.textContent = continuity.lastVerifiedAt ? relativeTime(continuity.lastVerifiedAt) : t("never");
  ui.signalAttention.textContent = String(continuity.attention ?? continuity.failed + continuity.degraded);
  const attention = continuity.attention ?? continuity.failed + continuity.degraded;
  ui.attentionPanel.hidden = attention <= 0;
  if (attention > 0) {
    ui.attentionTitle.textContent = continuity.conflicts ? t("conflictsNeedDecision", { count: continuity.conflicts }) : t("targetsNeedReview", { count: attention });
    ui.attentionDetail.textContent = continuity.conflicts ? t("conflictAttentionDetail") : continuity.failed
      ? t("failedAttentionDetail", { failed: continuity.failed, degraded: continuity.degraded })
      : t("degradedAttentionDetail", { count: continuity.degraded });
  }
}

function renderAgents(agents) {
  const selectedSource = ui.sourceAgent.value;
  ui.agentGrid.innerHTML = agents.map((agent) => {
    const coverage = agent.coverage.total ? t("coverage", agent.coverage) : t("noContinuousSessions");
    return `<label class="agent-card ${agent.selected ? "selected" : ""}" data-agent="${escapeHtml(agent.id)}">
      <input type="checkbox" ${agent.selected ? "checked" : ""} aria-label="${escapeHtml(t("selectAgent", { name: agent.name }))}">
      <div class="agent-card-top"><span class="agent-icon">${agentInitials[agent.id] ?? "AG"}</span><span class="check">✓</span></div>
      <div><h3>${escapeHtml(agent.name)}</h3><span class="detection ${agent.detected ? "detected" : ""}"><i></i>${t(agent.detected ? "detected" : "notDetected")}</span></div>
      <div class="agent-route"><span>${escapeHtml(capabilityLabel(agent))}</span><small>${escapeHtml(coverage)}</small></div>
    </label>`;
  }).join("");
  ui.sourceAgent.innerHTML = agents.filter((agent) => agent.read).map((agent) => `<option value="${escapeHtml(agent.id)}">${escapeHtml(agent.name)}</option>`).join("");
  if (agents.some((agent) => agent.id === selectedSource && agent.read)) ui.sourceAgent.value = selectedSource;
}

function renderCanonicalSessions(sessions, agents) {
  if (!sessions.length) {
    ui.canonicalList.innerHTML = `<div class="empty-state"><span>0</span><h3>${t("noRecords")}</h3><p>${t("noRecordsHelp")}</p></div>`;
    return;
  }
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  ui.canonicalList.innerHTML = sessions.map((session) => {
    const objective = session.state?.objective && session.state.objective !== session.title ? session.state.objective : session.state?.summary;
    const targetChips = session.targets.map((target) => {
      const stateClass = target.state === "synced" && target.degraded ? "degraded" : target.state;
      const detail = [t(modeKeys[target.mode] ?? target.mode), target.fidelity != null ? t("fidelity", { value: Math.round(target.fidelity * 100) }) : null, target.verificationReason].filter(Boolean).join(" · ");
      return `<span class="target-chip ${escapeHtml(stateClass)}" title="${escapeHtml(detail)}"><b>${agentInitials[target.agent] ?? "AG"}</b><span>${escapeHtml(agentMap.get(target.agent)?.name ?? target.agent)}</span><small>${escapeHtml(t(stateKeys[stateClass] ?? stateClass))}</small></span>`;
    }).join("");
    const conflictCards = (session.merge?.conflicts ?? []).map((conflict) => {
      const current = conflict.variants.find((variant) => variant.side === "current") ?? conflict.variants[0];
      const incoming = conflict.variants.find((variant) => variant.side === "incoming") ?? conflict.variants[1];
      const currentName = agentMap.get(current?.agent)?.name ?? current?.agent ?? t("currentBranch");
      const incomingName = agentMap.get(incoming?.agent)?.name ?? incoming?.agent ?? t("otherBranch");
      return `<div class="conflict-card" data-conflict="${escapeHtml(conflict.id)}">
        <div class="conflict-heading"><div><strong>${t("twoVersions")}</strong><small>${escapeHtml(conflict.kind)} · ${escapeHtml(conflict.eventId ?? conflict.id)}</small></div><span>${t("needsDecision")}</span></div>
        <div class="variant-grid"><div><b>${escapeHtml(currentName)}</b><p>${escapeHtml(trim(current?.text || t("noText"), 260))}</p></div><div><b>${escapeHtml(incomingName)}</b><p>${escapeHtml(trim(incoming?.text || t("noText"), 260))}</p></div></div>
        <div class="conflict-actions"><button class="recommended" data-session="${escapeHtml(session.id)}" data-conflict="${escapeHtml(conflict.id)}" data-strategy="both">${t("keepBoth")}</button><button data-session="${escapeHtml(session.id)}" data-conflict="${escapeHtml(conflict.id)}" data-strategy="current">${escapeHtml(t("useAgent", { name: currentName }))}</button><button data-session="${escapeHtml(session.id)}" data-conflict="${escapeHtml(conflict.id)}" data-strategy="incoming">${escapeHtml(t("useAgent", { name: incomingName }))}</button></div>
      </div>`;
    }).join("");
    const originName = agentMap.get(session.origin.agent)?.name ?? session.origin.agent;
    return `<article class="canonical-item"><div class="session-main"><div class="session-title-line"><h3>${escapeHtml(session.title)}</h3><span>${t("eventCount", { count: session.eventCount })}</span></div><p>${escapeHtml(trim(objective || t("noSummary"), 180))}</p><small>${escapeHtml(session.project.name)} · ${relativeTime(session.updatedAt)} · ${escapeHtml(t("fromAgent", { name: originName }))}</small></div><div class="target-list">${targetChips}</div>${conflictCards ? `<div class="conflict-list">${conflictCards}</div>` : ""}</article>`;
  }).join("");
}

function renderPolicy(value) {
  for (const button of ui.contentPolicy.querySelectorAll("button")) button.classList.toggle("active", button.dataset.value === value);
}

function renderActivity(activity) {
  if (!activity?.length) {
    ui.activityList.innerHTML = `<p class="supporting">${t("noActivity")}</p>`;
    return;
  }
  ui.activityList.innerHTML = activity.slice(0, 9).map((item) => `<div class="activity-item ${escapeHtml(item.level ?? "info")}"><i></i><div><strong>${escapeHtml(activityLabel(item))}</strong><p>${escapeHtml(humanMessage(item.message ?? ""))}</p></div><time>${relativeTime(item.at)}</time></div>`).join("");
}

async function updateConfig(patch, successMessage) {
  try {
    await api("/api/config", { method: "PUT", body: patch });
    if (successMessage) showToast(successMessage);
    await loadStatus({ quiet: true });
  } catch (error) {
    showToast(humanError(error.message), true);
    await loadStatus({ quiet: true });
  }
}

async function loadSessions() {
  if (loadingSessions || !ui.sourceAgent.value) return;
  loadingSessions = true;
  ui.refreshSessions.disabled = true;
  ui.sessionList.innerHTML = `<div class="empty-state small"><span>↻</span><p>${t("loadingLocal")}</p></div>`;
  try {
    const { sessions } = await api(`/api/sessions?agent=${encodeURIComponent(ui.sourceAgent.value)}&limit=40`);
    ui.sessionList.innerHTML = sessions.length ? sessions.map((session) => `<div class="history-item"><div><strong title="${escapeHtml(session.title)}">${escapeHtml(session.title)}</strong><small>${relativeTime(session.updatedAt)} · ${escapeHtml(session.cwd)}</small></div><button data-session="${escapeHtml(session.key)}">${t(session.bridged ? "update" : "import")}</button></div>`).join("") : `<div class="empty-state small"><span>0</span><p>${t("noRecent")}</p></div>`;
  } catch (error) {
    ui.sessionList.innerHTML = `<div class="empty-state small"><span>!</span><p>${escapeHtml(humanError(error.message))}</p></div>`;
  } finally {
    loadingSessions = false;
    ui.refreshSessions.disabled = false;
  }
}

ui.language.addEventListener("change", async () => {
  applyLocale(ui.language.value);
  await updateConfig({ language: locale });
  await loadSessions();
});
ui.syncEnabled.addEventListener("change", () => updateConfig({ syncEnabled: ui.syncEnabled.checked }, t(ui.syncEnabled.checked ? "baselineStarted" : "syncPausedToast")));
ui.syncNow.addEventListener("click", async () => {
  ui.syncNow.disabled = true;
  try {
    const result = await api("/api/sync", { method: "POST", body: { includeExisting: false } });
    const errors = result.errors ? t("errorsSuffix", { count: result.errors }) : "";
    showToast(result.baseline !== undefined ? t("baselineRecorded", { count: result.baseline }) : t("scanDone", { changed: result.changed, written: result.written, errors }));
    await loadStatus({ quiet: true });
  } catch (error) { showToast(humanError(error.message), true); }
  finally { ui.syncNow.disabled = false; }
});
ui.agentGrid.addEventListener("change", async (event) => {
  const card = event.target.closest(".agent-card");
  if (!card) return;
  card.classList.toggle("selected", event.target.checked);
  await updateConfig({ selectedAgents: { [card.dataset.agent]: event.target.checked } });
  await loadSessions();
});
ui.sourceAgent.addEventListener("change", loadSessions);
ui.refreshSessions.addEventListener("click", loadSessions);
ui.sessionList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-session]");
  if (!button) return;
  const sourceAgent = ui.sourceAgent.value;
  const targets = currentStatus.agents.filter((agent) => agent.selected && agent.id !== sourceAgent).map((agent) => agent.id);
  if (!targets.length) return showToast(t("selectTarget"), true);
  button.disabled = true;
  button.textContent = t("converting");
  try {
    const result = await api("/api/import", { method: "POST", body: { sourceAgent, sourceKey: button.dataset.session, targets } });
    showToast(t("processed", { count: result.targets.length, errors: result.errors ? t("errorsSuffix", { count: result.errors }) : "" }));
    await Promise.all([loadStatus({ quiet: true }), loadSessions()]);
  } catch (error) {
    showToast(humanError(error.message), true);
    button.disabled = false;
    button.textContent = t("retry");
  }
});
ui.canonicalList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-conflict][data-strategy]");
  if (!button) return;
  const buttons = button.closest(".conflict-actions").querySelectorAll("button");
  buttons.forEach((item) => { item.disabled = true; });
  try {
    const result = await api("/api/conflicts/resolve", { method: "POST", body: { canonicalId: button.dataset.session, conflictId: button.dataset.conflict, strategy: button.dataset.strategy } });
    showToast(t("conflictResolved", { count: result.written, errors: result.errors ? t("errorsSuffix", { count: result.errors }) : "" }));
    await loadStatus({ quiet: true });
  } catch (error) {
    showToast(humanError(error.message), true);
    buttons.forEach((item) => { item.disabled = false; });
  }
});
ui.historyDays.addEventListener("change", () => updateConfig({ historyDays: Number(ui.historyDays.value) }));
ui.pollSeconds.addEventListener("change", () => updateConfig({ pollIntervalMs: Number(ui.pollSeconds.value) * 1000 }));
ui.contentPolicy.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-value]");
  if (button) updateConfig({ contentPolicy: button.dataset.value }, t("policyUpdated"));
});

function capabilityLabel(agent) {
  if (agent.capabilities.officialApi && agent.capabilities.importHistory) return t("modeOfficialImport");
  if (agent.capabilities.nativeWrite && agent.capabilities.structuredTools) return t(agent.capabilities.resumeSession ? "capabilityStructuredResume" : "capabilityStructuredExperimental");
  if (agent.write) return t("capabilityTranscript");
  return t("capabilityHandoff");
}

function activityLabel(item) {
  const keys = { sync: "actionSync", baseline: "actionBaseline", project: "actionProject", handoff: "actionHandoff", discover: "actionDiscover", conflict: "actionConflict", resolve: "actionResolve", skip: "actionSkip", dedupe: "actionDedupe" };
  return keys[item.action] ? t(keys[item.action]) : item.action ?? "Agentail";
}

function humanMessage(message) {
  const duplicate = message.match(/^(\d+) duplicate canonical session\(s\) were aliased/);
  if (duplicate) return t("duplicateHuman", { count: duplicate[1] });
  const baseline = message.match(/^Baseline captured for (\d+) sessions/);
  if (baseline) return t("baselineHuman", { count: baseline[1] });
  const handoff = message.match(/^(.*): handoff saved because the target is not writable\.$/);
  if (handoff) return t("handoffHuman", { title: handoff[1] });
  return message.replaceAll("Bridge", "Agentail");
}

function humanError(message) {
  if (locale === "en") return message;
  if (/Select at least two agents/i.test(message)) return "请至少选择两个 Agent";
  if (/sync.*already running|current sync to finish/i.test(message)) return "当前检查完成后再操作";
  return message;
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.toggle("error", error);
  ui.toast.classList.add("show");
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 3400);
}

function relativeTime(value) {
  if (!value) return t("unknownTime");
  const distance = Date.now() - new Date(value).getTime();
  if (distance < 60_000) return t("justNow");
  if (distance < 3_600_000) return t("minutesAgo", { count: Math.floor(distance / 60_000) });
  if (distance < 86_400_000) return t("hoursAgo", { count: Math.floor(distance / 3_600_000) });
  if (distance < 30 * 86_400_000) return t("daysAgo", { count: Math.floor(distance / 86_400_000) });
  return new Date(value).toLocaleDateString(locale);
}

function trim(value, limit) { return String(value).replace(/\s+/g, " ").trim().slice(0, limit); }
function camel(value) { return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

applyLocale("zh-CN");
await loadStatus();
await loadSessions();
setInterval(() => loadStatus({ quiet: true }), 5000);
