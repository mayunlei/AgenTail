# Agentail

> **Any agent. Same trail.**
>
> **Agent 随心换，上下文不断。**

[![Release](https://img.shields.io/github/v/release/mayunlei/AgenTail)](https://github.com/mayunlei/AgenTail/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Agentail 是一个本地优先的 coding-agent 会话连续性工具。它把 Codex、Claude Code、OpenCode、Qoder 的本地 session 转成公共的 **ASIF/2**（Agent Session Interchange Format），再根据目标 Agent 的真实能力选择官方导入、结构化写入、文本兼容或通用交接包。

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

## 产品目标

面板不再把“扫描了多少次”当成功，而是围绕一个黄金指标：**已验证连续性**。

> 已在目标端真实回读的会话投影 ÷ 所有已选 Agent 应拥有的会话投影

用户打开首屏可以直接看到：

- 当前工作是否能在每个已选 Agent 中继续；
- 哪些会话已验证、仅写入、发生降级或失败；
- 每个 Agent 使用哪种转换路径，是否支持结构化工具调用与原生续接；
- 最后一次验证时间，以及唯一需要采取的下一步。

## 已实现

- **ASIF/2 事件图**：稳定事件 ID、turn、branch、parent、revision、lineage、provenance 与 portability 元数据。
- **可移植工作状态**：目标、最新状态、涉及文件、命令、测试结果、决策和下一步，可用于恢复而不只用于“看聊天记录”。
- **能力协商**：Adapter 暴露发现、读取、创建、追加、resume、official import、structured tools、branches、attachments、readback 等能力。
- **四级转换规划**：官方导入 → 结构化原生写入 → 惰性文本历史 → Handoff Capsule。
- **转换清单**：记录 exact / mapped / flattened / summarized / omitted 数量，以及 context、semantics、tools、resume、verification 五轴保真度。
- **回读验证**：写入后重新发现和解析目标 session；只有事件 ID 完整返回，才计为“已验证”。
- **故障隔离**：单个目标失败不会阻止同一会话同步到其他目标。
- **通用兜底**：无法完整转换时生成 JSON + Markdown 交接包，明确提醒目标 Agent 检查工作树并重新运行测试，不伪造历史工具状态。
- **双向增量同步**：任何已选 Agent 的新会话或会话更新都可以流向其他已选端。
- **并发三方合并**：从共同 revision 同时继续的会话保留为两个分支；独立追加自动合并，同一事件的不同编辑进入显式冲突，不使用最后写入者覆盖。
- **初次开启只建基线**：默认不会把全部历史会话突然灌入所有工具。
- **中英文界面**：网页详细账本和 macOS 菜单栏共享语言配置，可随时切换中文或 English。
- **源会话唯一身份**：以 `sourceAgent + native sessionId` 建立唯一索引；同一源文件换路径或旧投影回流时仍收敛到同一个 canonical session。
- **低开销守护**：会话列表使用持久化轻量索引，原生 JSONL 发现仅读取有限头部并缓存，活动文件等待短暂稳定后再转换，避免重复解析大型会话。

## 支持矩阵

| Agent | 读取 | 写入 | 转换路径 | 回读验证 |
|---|---:|---:|---|---:|
| Codex | ✅ | ✅ | 独立 rollout JSONL，保留 message/tool 结构 | ✅ |
| Claude Code | ✅ | ✅ | 独立 project transcript，保留 message/tool 结构 | ✅ |
| OpenCode | ✅ | ✅ | 官方 `session list/export/import`；工具轨迹转为惰性历史文本 | ✅ |
| Qoder | ✅ | ✅* | 文档化 transcript JSONL；resume 索引仍是实验性兼容面 | ✅（文件） |

`*` 若某个 Qoder 版本另有私有 session 索引，Bridge 会显示“续接实验性”，不会把文件写入等同于原生 resume 已验证。

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

1. 用每个真实安装版本固定 reopen/resume 端到端兼容夹具。
2. 增加 Cursor、Gemini CLI、Cline、Aider、Roo Code Adapter。
3. 增加附件 content-addressed blob store 与跨设备加密 transport。
4. 把各上游版本的 capability probe 固定到 CI matrix，发生退化时自动切换到 Handoff。
