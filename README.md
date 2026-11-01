# AgenTail

[简体中文](README.md) | [English](README_EN.md)

> 一个 Chat，管理每个 Session。

AgenTail 的新方向是综合 Session 管理控制台：通过 Personal Agent 了解不同端的工作进展、分发任务、根据内容选择已有会话续接，并在可视化面板查看 MDP 轨迹、验证结果与 Token 消耗。

**本分支处于设计与交互原型阶段。运行代码仍为旧 v0.5.4；下文是新产品的目标能力，尚未接入真实端。**

[完整产品与技术设计](docs/PERSONAL_AGENT_CONSOLE.md) · [交互原型源文件](docs/SESSION_CONSOLE_PREVIEW.html) · [原型验证](docs/CONSOLE_PREVIEW_VALIDATION.md) · [设计 PR](https://github.com/mayunlei/AgenTail/pull/1)

## 一个总管 Chat

- “我离开后，每个 Session 有什么进展？”——给出有来源的 briefing 与待决策事项。
- “让本机 Codex 实现 Token 面板。”——向明确的端分发新任务。
- “继续修搜索的失败样例。”——结合工作内容、项目、最近状态和端能力，选择已有 Session 续接。
- “让两个端分别探索这个问题。”——创建彼此独立的任务，分别跟踪结果与消耗。

目标有歧义时展示候选；明确选择后通过原生端接口交付，并跟踪回执与对应新轮次。

## 一个可视化面板

| 视图 | 内容 |
| --- | --- |
| Session 总览 | 项目、端、目标、运行状态、最后活动、待处理和来源覆盖 |
| Briefing | 背景、已确认决策、离开后的变化、需要用户处理的下一步 |
| MDP 轨迹 | 状态 → 动作 → 观察 → 新状态，展开步骤、工具、diff、测试与来源；奖励缺失时保持未提供 |
| Token 与资源 | Session / Turn / Request 用量、输入输出、缓存与 reasoning 子项、等待与重试；明确计量口径和缺失 |
| 操作记录 | 创建或续接哪个端的哪条原生会话、指令、排队、交付和结果回执 |

## 移除跨端同步方案

新架构不提供 Session 双向同步、历史投影、跨端复制、三方合并、保真度评分和连续性指标。每个 Session 保持自己的原生身份。

控制台汇集观察，向具体端发送用户指令。工作之间可以有关联，原生历史不互相覆盖或合并。旧同步入口、后台循环、适配器写入路径和配置将在运行代码改造阶段退役，不迁入高级设置。

## 实施顺序

1. 验证端的真实读取、MDP/usage 事件、任务创建、原会话续接及执行归属。
2. 替换旧同步入口，实现 Session 目录、总管 Chat、briefing、MDP 和 Token 面板。
3. 完成内容路由 → 新建/续接 → 原生回执 → 新轮次 → 面板更新闭环。
4. 逐端扩展多端控制、并行工作、父子 Agent 用量和连续使用验收。

第一条完整控制路径以 Codex 为目标；其他端的实时能力须按实际版本验证。能读取会话不等于能控制正在运行的会话。

## 预览设计

原型使用演示数据，可切换 Session、MDP 步骤和 Token 视图，并预览 Chat 的查询、创建/续接路由。路由预览不调用模型，也不发送真实任务。

从项目根目录启动只用于预览的静态服务：

```bash
python3 -m http.server 4782 --bind 127.0.0.1 --directory docs
```

在浏览器打开 `http://127.0.0.1:4782/SESSION_CONSOLE_PREVIEW.html`。

## 开发状态与验证

新控制台尚未上线，不应运行旧安装脚本并期待获得上述功能。历史同步实现可以在 [v0.5.4 代码快照](https://github.com/mayunlei/AgenTail/tree/5d2f6d1) 查看；新系统不把它作为运行依赖。

新增验证程序、编译产物和隔离数据放在项目 `.validation/` 或 `.build/validation/`。原生源代码和打包资源没有变化时，复用现有原生应用。

MIT License，见 [LICENSE](LICENSE)。
