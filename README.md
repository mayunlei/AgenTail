# Agentail

[简体中文](README.md) | [English](README_EN.md)

> **Sync sessions across coding agents.**
>
> **跨 Coding Agent，会话自动同步。**

[![Release](https://img.shields.io/github/v/release/mayunlei/AgenTail)](https://github.com/mayunlei/AgenTail/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Agentail 让你在 Codex 中开始工作，切换到 Claude Code、OpenCode 或 Qoder 后，仍能沿着同一条会话继续。它自动发现本机会话、同步新增内容、处理并行修改，并验证目标 Agent 是否真的写入成功。

它不只是导出聊天文本。Agentail 会尽可能保留任务目标、消息、工具调用与结果、文件改动线索、命令与测试、关键决策和下一步，让另一个 Agent 接手时知道“已经做了什么、为什么这样做、接下来做什么”。

> 典型场景：你在 Codex 中完成了一半的功能，因为额度、模型能力或工具差异切换到 Claude Code。Agentail 将这段工作投影为 Claude Code 可读取的本地会话；之后两边继续产生的新内容，也可以同步回其他已选择的 Agent。

## 为什么需要 Agentail

每个 Coding Agent 都有自己的会话目录、事件结构和能力边界。直接复制粘贴通常只能搬走可见文字，却会丢失工具轨迹、因果关系、分支、来源和同步状态；直接改写另一个工具的内部数据库，又容易因为版本变化而损坏会话。

Agentail 在中间增加一层稳定、可审计的会话协议：

| 当你遇到…… | Agentail 提供…… |
| --- | --- |
| 想换一个 Agent 继续当前任务 | 将同一会话投影到目标 Agent 的本地会话格式 |
| 已经有很多历史会话 | 发现并一次性导入已有会话，之后再做增量同步 |
| 两个 Agent 同时继续了同一会话 | 按共同基线做三方合并；可合并内容自动汇合，真正冲突明确标出 |
| 目标 Agent 不支持某种事件 | 按能力自动降级，并显示保真度和丢失项，而不是静默丢数据 |
| 文件写入了，但不确定目标能否读取 | 写入后回读验证；未通过验证不会标成同步成功 |
| 不希望会话上传到第三方服务 | 默认仅在本机运行，控制服务只监听 `127.0.0.1` |

## 核心产品能力

### 跨 Agent 连续工作

- 在 Codex、Claude Code、OpenCode 和 Qoder 之间迁移或持续同步会话。
- 以项目和原生会话 ID 识别同一条工作轨迹，避免反复导入产生重复会话。
- 支持一次性迁移，也支持选中多个 Agent 后自动同步后续新增事件。

### 不只同步聊天记录

Agentail 的公共中间格式 ASIF/2 可以表达：

- 用户与 Assistant 消息；
- 工具调用、工具结果和错误；
- 任务目标、状态与最近工作摘要；
- 涉及的文件、执行过的命令和测试结果；
- 决策、待办、来源、因果父事件、修订版本与分支信息。

目标 Agent 能原生表达的内容会结构化写入；不能表达的内容会转换为明确标记的历史文本、摘要或独立 Handoff Capsule。

### 自动增量同步

- 首次启用采用“先建立基线，再同步新增内容”的策略，避免一开启就把所有旧会话批量复制到每个 Agent。
- 可以选择只同步消息，或同时同步工具轨迹。
- 使用稳定事件身份、修订号、去重和回声抑制，避免 Agentail 自己写入的内容被再次发现并无限循环。
- 单个 Agent 写入失败不会阻塞其他目标，失败原因会留在同步账本中。

### 并行修改与三方合并

同一会话在两个 Agent 中继续后，Agentail 不会简单采用“最后写入覆盖”。它把共同版本视为基线，把两边视为分支：

- 两边各自追加的事件会自动合并；
- 只在一边发生的修改会保留；
- 同一事件被两边改成不同内容时，会生成可见冲突，保留两个版本供确认；
- 合并结果继续保留来源和修订关系，后续同步仍可追踪。

### 能力协商与可解释降级

不同 Agent 并不具备相同的导入接口。Agentail 会按目标能力选择转换路径：

1. **官方导入**：优先使用目标 Agent 提供的 import/export CLI。
2. **结构化原生写入**：保留消息、工具调用和结果等结构。
3. **原生文本记录**：把不支持的结构转换为不可执行的历史文本。
4. **Handoff Capsule**：当目标不可写时，生成通用 JSON 和 Markdown 交接包。

每次转换都会记录精确保留、字段映射、扁平化、摘要和省略数量，并分别评估语义、工具、因果和附件保真度。

### 写入后回读验证

“写入命令成功”不等于“目标 Agent 可以继续”。Agentail 会重新读取目标会话，核对预期事件是否存在。界面只把通过回读的目标标为已验证；能力不足、过期、冲突和失败会分别显示。

### 本地可控、状态可见

- macOS 菜单栏是日常入口：查看运行状态、最近同步、冲突和失败，启停服务或打开详情。
- 本地详情页展示每个会话同步到了哪些 Agent、最后同步时间、验证结果和转换保真度。
- 支持中英文界面。
- “Report Issue” 会打开预填的 GitHub Issue；诊断信息默认不包含会话正文、项目名、文件路径、命令输出或其他敏感内容。

## 工作原理

Agentail 不为每一对 Agent 编写一套两两转换器，而是以 ASIF/2 作为稳定中间层：

```text
Codex ───────┐                              ┌─────── Codex
Claude Code ─┤                              ├─────── Claude Code
OpenCode ────┼─> 原生适配器 ─> ASIF/2 ─> 能力协商 ┼─────── OpenCode
Qoder ───────┘          │        │          └─────── Qoder
                        │        ├─ 修订与三方合并
                        │        ├─ 去重与回声抑制
                        │        └─ 保真度与回读验证
                        └─ 本地同步账本
```

增加一个新 Agent 时，只需要实现“原生格式 ↔ ASIF/2”的适配，而不需要为所有已有 Agent 重新开发转换组合。

## 适合的使用场景

- 因额度、速度、模型能力或工具支持临时切换 Coding Agent。
- 团队成员偏好不同 Agent，但需要交接同一个项目的工作上下文。
- 把历史会话迁移到另一个 Agent，减少重新解释项目和决策的时间。
- 在两个 Agent 中探索不同实现，再把各自追加的工作轨迹合并回来。
- 某个 Agent 暂时不可用时，生成通用交接包继续工作。

## 快速安装（macOS）

要求：macOS 13 或更高版本、Node.js 20 或更高版本。安装包同时支持 Apple Silicon 与 Intel Mac。

```bash
curl -fsSL https://raw.githubusercontent.com/mayunlei/AgenTail/main/install.sh | bash
```

安装器会校验 GitHub Release 的 SHA-256，随后把运行文件安装到 `~/.local/share/agentail`，把菜单栏应用安装到 `~/Applications/Agentail.app`，并启动本地后台服务。会话内容仅保存在本机。

安装完成后：

1. 点击屏幕顶部菜单栏中的 Agentail 图标；
2. 勾选需要保持连续性的 Coding Agent；
3. 打开“实时同步”。首次开启只记录现有会话基线，不会把全部历史突然导入其他工具；
4. 此后在任一已选 Agent 中新建或继续会话，Agentail 会转换、写入并回读验证其他目标端。

升级到最新版本时重新执行同一条安装命令即可。卸载应用与后台服务：

```bash
node ~/.local/share/agentail/current/bin/agent-session-bridge.mjs app uninstall
```

所有版本和校验文件也可以从 [GitHub Releases](https://github.com/mayunlei/AgenTail/releases) 手动下载。

## 界面首先回答什么

面板不把“扫描了多少次”或“执行了多少次写入”当成成功，而是围绕一个黄金指标：**已验证连续性**。

> 已在目标端真实回读的会话投影 ÷ 所有已选 Agent 应拥有的会话投影

用户打开首屏可以直接看到：

- 当前工作是否能在每个已选 Agent 中继续；
- 哪些会话已验证、仅写入、发生降级或失败；
- 每个 Agent 使用哪种转换路径，是否支持结构化工具调用与原生续接；
- 最后一次验证时间，以及唯一需要采取的下一步。

## 当前支持范围

| Agent | 读取已有会话 | 创建 / 更新目标 | 工具轨迹 | 回读验证 | 说明 |
| --- | ---: | ---: | ---: | ---: | --- |
| Codex | ✅ | ✅ | 结构化 | ✅ | 可原生恢复 |
| Claude Code | ✅ | ✅ | 结构化 | ✅ | 可原生恢复；会清理不被 Claude Code 识别的来源模型字段 |
| OpenCode | ✅ | ✅ | 历史文本降级 | ✅ | 需要本机安装 `opencode` CLI；使用官方 export/import，不直接修改 SQLite |
| Qoder | ✅ | ✅ | 结构化 | ✅（文件） | 原生索引由宿主维护，恢复 / 出现在宿主 UI 中仍为实验性能力 |

实际可用能力以本机检测结果为准。Agentail 会在同步前读取适配器能力，而不是假设所有版本都支持同一格式。

## ASIF/2 中间协议

Schema 位于 [`spec/asif-v2.schema.json`](spec/asif-v2.schema.json)。ASIF/1 文件仍可读取，并在保存时自动升级。

```text
Session
├── revision / lineage / origins
├── merge (base revision, branches, conflicts, resolutions)
├── project (logicalId, roots, vcs)
├── events[]
│   ├── type + legacy kind/role/text
│   ├── turnId / branchId / parentIds / sequence
│   ├── content[] / tool / result
│   └── provenance / portability
├── heads[]
└── state
    ├── objective / summary / status
    ├── touchedFiles / commands / tests
    └── decisions / nextActions
```

事件图保留分支与因果关系；目标端只支持线性 transcript 时，分支身份会被显式转换为文本标记并降低保真评分，而不是悄悄丢失。

## 并行修改与三方合并

每次原生投影都会记录它收到的 canonical revision。若两个 Agent 都从同一 revision 继续工作，Bridge 会在写入任何目标前冻结双方快照，再使用共同基线进行三方合并：

- 两边只是追加不同事件：自动形成两个 branch，并创建带两个 parent revision 的 merge revision；
- 同一稳定事件只有一边修改：采用该边修改并保留旧 revision 快照；
- 同一事件两边修改且内容不同：保存 base/current/incoming 三份证据，状态变为“并行冲突”，不会显示 100% 已验证连续性；
- 用户可在详细账本选择“保留两边”“采用当前分支”或“采用另一分支”。解决动作会生成新的 resolution event 和 revision，再写回所有已选 Agent；
- 目标不支持原生分支时，分支会变成带明确标签的惰性历史；无法可靠写入时仍使用 Handoff Capsule。

会话合并不代替源码合并。两个 Agent 同时修改工作树时，仍应使用 Git 三方合并或独立 worktree；Bridge 不会静默覆盖源码。

## 普适转换策略

1. **official-import**：优先使用目标 Agent 的官方 import/export 或协议接口。
2. **structured-native**：目标支持本地 transcript 与结构化 tool call 时，按能力映射。
3. **transcript-native**：目标没有结构化语义时，将工具调用、结果、checkpoint 变成带清晰标记的“历史文本”，保证不会被误执行。
4. **handoff-native / handoff-file**：无法可靠创建原生历史时，只传递目标、状态、文件、测试结果和最近上下文；完整 canonical ledger 仍保留在 Bridge。

每次投影写入 `projections/<canonical-id>--<agent>.json`。发生降级时同时生成：

```text
handoffs/<canonical-id>--<agent>.json
handoffs/<canonical-id>--<agent>.md
```

## 从源码安装与入口

要求 Node.js 20 或更高版本，无第三方运行时依赖。

macOS 的主入口是屏幕顶部的菜单栏图标，不需要记住网址。一次安装会同时注册本地同步服务和菜单栏 App，并在以后登录时自动启动：

```bash
git clone https://github.com/mayunlei/AgenTail.git
cd AgenTail
npm run check
npm run app:install
```

首次启动会出现 Agentail 原生引导窗口；之后点击菜单栏图标即可查看连续性、切换中英文、选择 Agent、开启实时同步或立即检查。也可以从 Finder 的 `~/Applications/Agentail.app` 再次打开。

网页 <http://127.0.0.1:4765> 仅作为“详细账本”，用于查看单条会话的转换路径、保真度和错误明细，不是日常控制入口。实时同步默认关闭。

菜单栏面板和详细账本均提供“报告问题 / Report issue”入口。它会打开 GitHub 的新 Issue 页面，并预填版本、Agent 检测结果和连续性状态；不会附带会话正文、项目名称、文件路径或命令输出，用户确认内容后再提交。

管理原生 App：

```bash
npm run app:open
node ./bin/agent-session-bridge.mjs app status
node ./bin/agent-session-bridge.mjs app uninstall
```

仅在开发网页或调试后台服务时使用 `npm start`。

如果只想使用命令行而不安装菜单栏应用：

```bash
node ./bin/agent-session-bridge.mjs --help
npm start
```

## CLI

```bash
node ./bin/agent-session-bridge.mjs status
node ./bin/agent-session-bridge.mjs scan --agent codex

node ./bin/agent-session-bridge.mjs bridge \
  --from codex \
  --session /path/to/rollout.jsonl \
  --to claude,opencode

node ./bin/agent-session-bridge.mjs export --from claude --session /path/to/chat.jsonl --out chat.asif.json
node ./bin/agent-session-bridge.mjs import --file chat.asif.json --to codex,qoder
```

若旧版本导入的 Claude Code 会话提示 `agent-session-bridge` 不是可识别模型，可先预览再修复。修复只改 Bridge 创建的 assistant 记录，并为每个原文件保留备份：

```bash
node ./bin/agent-session-bridge.mjs repair --agent claude
node ./bin/agent-session-bridge.mjs repair --agent claude --apply
```

若旧版本把 `isError: false`、工具 ID 前缀或目标端角色降级误判为“同一事件出现两个版本”，可先只读预览，再暂停后台同步并应用修复。该命令只把语义相同的冲突标记为已解决，不改事件正文：

```bash
node ./bin/agent-session-bridge.mjs repair conflicts
node ./bin/agent-session-bridge.mjs repair conflicts --apply
```

## 数据目录

默认使用 `~/.agent-session-bridge/`：

```text
config.json       用户选择与同步策略（0600）
state.json        source signature、canonical 映射、验证状态、活动记录
sessions/         ASIF/2 canonical sessions
revisions/        每个 canonical session 的不可变 revision 快照与共同基线
projections/      每个目标的转换清单与保真度
handoffs/         降级或不可写时的通用 JSON / Markdown 交接包
imports/          OpenCode 官方 import 临时 envelope
exports/          手动导出的 ASIF 文件
```

可设置 `ASB_HOME=/custom/path`，或在 CLI 中传入 `--home /custom/path`。

## 安全边界

- Bridge 仅监听 `127.0.0.1`，不联网传输 session 内容。
- 不覆盖任意原生 session；只新建独立导入会话，或向 Bridge 自己创建且带 canonical 标记的会话追加缺失事件。
- 工具调用跨到不支持结构化工具的 Agent 时只作为惰性历史文本，绝不伪造成待执行调用。
- native schema 不是稳定公共 API。回读成功证明“本版本可重新解析”，不等于厂商承诺长期兼容。
- 会话可能包含源码、命令输出或密钥。同步会增加本机副本数量；可选择“仅消息”排除工具轨迹。

## 参考兼容面

- Codex 的 Agent 导入能力：[Import from another agent](https://learn.chatgpt.com/docs/import.md)
- OpenCode 官方 CLI import/export envelope：[OpenCode import implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/import.ts)
- Qoder 文档化 transcript 格式：[Qoder Transcript File Format](https://docs.qoder.com/extensions/hooks#transcript-file-format)

## 构建 Release

维护者可以生成经过测试、带通用架构 macOS App 和 SHA-256 校验文件的发布资产：

```bash
npm run release:build
```

产物位于 `release/Agentail-macos-universal.tar.gz` 和 `release/SHA256SUMS.txt`。

## 下一阶段

下一阶段将 AgenTail 演进为 **Personal Agent 综合控制台**：持续跟踪各 Agent 会话，维护工作上下文、变化 briefing 和待决策事项，并通过经过验证的运行时接口操作具体任务。总管对话成为主要交互，现有会话同步作为底层连续工作能力保留。

产品流程、代码复用边界、数据模型、任务控制和分阶段验收见 [Personal Agent 控制台改造设计](docs/PERSONAL_AGENT_CONSOLE.md)。这是待实施设计，不是 v0.5.4 的现有功能。

后续继续完善：真实安装版本的 reopen/resume 兼容夹具、更多 Agent Adapter、附件 content-addressed blob store、跨设备加密 transport，以及上游版本 capability probe 的 CI matrix。
