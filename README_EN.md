# Agentail

[简体中文](README.md) | [English](README_EN.md)

> **Sync sessions across coding agents.**
>
> **Any agent. Same trail.**

[![Release](https://img.shields.io/github/v/release/mayunlei/AgenTail)](https://github.com/mayunlei/AgenTail/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Agentail lets you start work in Codex and continue the same session in Claude Code, OpenCode, or Qoder. It discovers local sessions, synchronizes new activity, handles concurrent changes, and verifies that the destination agent can actually read what was written.

It is more than a chat exporter. Agentail preserves as much portable working context as possible: objectives, messages, tool calls and results, touched files, commands and tests, key decisions, and next actions. The next agent can understand what was done, why it was done, and what remains.

> Typical workflow: you are halfway through a feature in Codex and switch to Claude Code because of quota, model strengths, or tool availability. Agentail projects the work into a local Claude Code session. New activity on either side can then be synchronized to the other selected agents.

## Why Agentail?

Every coding agent has its own session directory, event model, and capability boundary. Copy and paste usually transfers only visible text while losing tool traces, causality, branches, provenance, and synchronization state. Directly modifying another product's internal database is also fragile because private formats change between versions.

Agentail adds a stable, auditable interchange layer:

| When you need to... | Agentail will... |
| --- | --- |
| Switch agents without restarting the task | Project the same session into the destination agent's local format |
| Migrate existing sessions | Discover and import session history, then continue with incremental synchronization |
| Continue the same session in two agents | Perform a three-way merge from their common baseline, merging independent work and surfacing real conflicts |
| Target an agent that lacks an event type | Degrade according to capability and report fidelity loss instead of silently dropping data |
| Know whether a write really worked | Read the destination back; an unverified write is never reported as successful continuity |
| Keep session content off third-party services | Run locally and bind the control service to `127.0.0.1` only |

## Core capabilities

### Continue across agents

- Migrate or continuously synchronize sessions among Codex, Claude Code, OpenCode, and Qoder.
- Identify one trail by project and native session ID so repeated discovery does not create duplicate sessions.
- Support both one-time migration and ongoing synchronization of new events among selected agents.

### Preserve more than chat

Agentail's shared ASIF/2 format can represent:

- User and assistant messages;
- Tool calls, results, and errors;
- Task objectives, current status, and recent work summaries;
- Touched files, executed commands, and test results;
- Decisions, next actions, provenance, causal parents, revisions, and branches.

Content that the destination supports is written structurally. Unsupported content becomes clearly labeled historical text, a summary, or a separate Handoff Capsule.

### Incremental synchronization

- The first live-sync run establishes a baseline before copying new activity, so enabling synchronization does not suddenly import every historical session everywhere.
- You can synchronize messages only or include tool traces.
- Stable event identity, revisions, deduplication, and echo suppression prevent Agentail's own output from being rediscovered in a loop.
- One failing destination does not block the others; the synchronization ledger records the failure and its cause.

### Three-way merge for concurrent work

When two agents continue the same session, Agentail does not use last-writer-wins. It treats their shared revision as the base and both continuations as branches:

- Events independently appended on each side are merged automatically;
- Changes made on only one side are preserved;
- Different edits to the same event create a visible conflict with both versions retained for resolution;
- The merged session keeps its provenance and revision relationships for future synchronization.

### Capability negotiation and explicit fallback

Coding agents do not expose equivalent import interfaces. Agentail selects the best available projection for each destination:

1. **Official import**: prefer an import/export CLI supplied by the destination.
2. **Structured native write**: preserve messages, tool calls, results, and other supported structure.
3. **Native text transcript**: flatten unsupported structure into inert historical text.
4. **Handoff Capsule**: when native writing is unavailable, create portable JSON and Markdown handoff files.

Every conversion records exact, mapped, flattened, summarized, and omitted items, with separate fidelity assessments for semantics, tools, causality, and attachments.

### Read-back verification

A successful write command does not prove that an agent can continue the session. Agentail reads the destination session back and checks for the expected events. The UI marks a destination as verified only after this check; degraded, stale, conflicting, and failed states remain distinct.

### Local control and visible status

- The macOS menu bar is the everyday entry point for service status, recent synchronization, conflicts, failures, and controls.
- The local detail page shows which agents received each session, when they were last synchronized, whether verification passed, and what fidelity was achieved.
- The interface is available in English and Chinese.
- **Report Issue** opens a prefilled GitHub issue without including session text, project names, file paths, command output, or other sensitive content by default.

## How it works

Agentail does not build a separate converter for every pair of agents. ASIF/2 is the stable intermediate layer:

```text
Codex ───────┐                                ┌─────── Codex
Claude Code ─┤                                ├─────── Claude Code
OpenCode ────┼─> Native adapters ─> ASIF/2 ─> Capabilities ┼─────── OpenCode
Qoder ───────┘           │          │         └─────── Qoder
                         │          ├─ Revision and three-way merge
                         │          ├─ Deduplication and echo suppression
                         │          └─ Fidelity and read-back verification
                         └─ Local synchronization ledger
```

Adding another agent requires one adapter between its native format and ASIF/2, rather than a new conversion path for every existing agent.

## Use cases

- Switch agents because of quotas, speed, model capabilities, or tool support.
- Hand off project context between teammates who prefer different coding agents.
- Migrate historical sessions without explaining the project and its decisions again.
- Explore two implementations in parallel and merge both trails afterward.
- Generate a universal handoff package when a destination agent is temporarily unavailable.

## Quick install on macOS

Requirements: macOS 13 or later and Node.js 20 or later. The package supports both Apple Silicon and Intel Macs.

```bash
curl -fsSL https://raw.githubusercontent.com/mayunlei/AgenTail/main/install.sh | bash
```

The installer verifies the GitHub Release SHA-256 checksum, installs the runtime under `~/.local/share/agentail`, installs the menu bar app at `~/Applications/Agentail.app`, and starts the local background service. Session content remains on your machine.

After installation:

1. Click the Agentail icon in the macOS menu bar.
2. Select the coding agents that should share continuity.
3. Enable **Live Sync**. The first run records a baseline and does not import all historical sessions into every agent.
4. Create or continue a session in any selected agent. Agentail converts it, writes it to the other destinations, and verifies it by reading it back.

Run the same install command again to upgrade. To remove the app and background service:

```bash
node ~/.local/share/agentail/current/bin/agent-session-bridge.mjs app uninstall
```

Release packages and checksum files are also available from [GitHub Releases](https://github.com/mayunlei/AgenTail/releases).

## What the interface answers first

The dashboard does not count scans or write attempts as success. It centers on one golden metric: **verified continuity**.

> Session projections successfully read back from their destinations / all projections expected by the selected agents

At a glance, you can see:

- Whether current work can continue in every selected agent;
- Which sessions are verified, merely written, degraded, conflicting, or failed;
- Which conversion path each agent used and whether structured tools and native resume are supported;
- The last verification time and the one next action that requires attention.

## Current support

| Agent | Read existing sessions | Create / update destination | Tool traces | Read-back | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Codex | ✅ | ✅ | Structured | ✅ | Native resume supported |
| Claude Code | ✅ | ✅ | Structured | ✅ | Native resume supported; source model fields unknown to Claude Code are sanitized |
| OpenCode | ✅ | ✅ | Flattened historical text | ✅ | Requires the local `opencode` CLI; uses official export/import and never edits SQLite directly |
| Qoder | ✅ | ✅ | Structured | ✅ (file) | Native indexing is host-managed; resume and visibility in the host UI remain experimental |

Effective capabilities are detected from the local installation before synchronization. Agentail does not assume that every upstream version supports the same format.

## ASIF/2 interchange format

The schema is in [`spec/asif-v2.schema.json`](spec/asif-v2.schema.json). ASIF/1 files remain readable and are upgraded when saved.

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

The event graph preserves branches and causality. If a destination only supports a linear transcript, branch identity is converted into explicit text markers and the fidelity score is reduced rather than silently discarding the structure.

## Concurrent changes and three-way merge

Each native projection records the canonical revision it received. If two agents continue from the same revision, Agentail freezes both snapshots before writing to any destination and performs a three-way merge from the shared baseline:

- Independent appended events form two branches and a merge revision with two parent revisions;
- If only one side changes a stable event, that change is accepted and the prior revision remains preserved;
- If both sides change the same event differently, the base, current, and incoming evidence is retained and the session enters an explicit concurrent-conflict state instead of claiming 100% continuity;
- The detail page can resolve the conflict by keeping both versions, the current branch, or the incoming branch. Resolution creates a new event and revision before synchronization resumes;
- Destinations without native branch support receive clearly labeled inert history; unreliable native targets fall back to a Handoff Capsule.

Session merging does not replace source-code merging. If two agents edit the working tree concurrently, use Git three-way merge or separate worktrees. Agentail never silently overwrites source code.

## Universal conversion strategy

1. **official-import**: use an official import/export or protocol interface when available.
2. **structured-native**: map structured messages and tool calls into a supported native transcript.
3. **transcript-native**: turn tool calls, results, and checkpoints into clearly labeled inert historical text when structured semantics are unavailable.
4. **handoff-native / handoff-file**: when native history cannot be created reliably, transfer only the objective, status, files, test results, and recent context while retaining the complete canonical ledger in Agentail.

Every projection writes a conversion manifest to `projections/<canonical-id>--<agent>.json`. A degraded conversion also creates:

```text
handoffs/<canonical-id>--<agent>.json
handoffs/<canonical-id>--<agent>.md
```

## Install from source and open the app

Requirements: Node.js 20 or later. There are no third-party runtime dependencies.

On macOS, the main entry point is the menu bar icon, not a URL. One installation registers both the local synchronization service and the menu bar app and starts them automatically at login:

```bash
git clone https://github.com/mayunlei/AgenTail.git
cd AgenTail
npm run check
npm run app:install
```

The first launch shows the native Agentail onboarding window. After that, use the menu bar icon to inspect continuity, switch languages, choose agents, enable live synchronization, or run a check. You can also reopen `~/Applications/Agentail.app` from Finder.

The page at <http://127.0.0.1:4765> is a detailed ledger for inspecting conversion paths, fidelity, and errors. It is not the everyday control entry point. Live synchronization is disabled by default.

Both the menu bar app and the detail page provide a **Report Issue** action. It opens a new GitHub issue with the version, detected agents, and continuity state prefilled. It excludes session text, project names, file paths, and command output, and you review the issue before submitting it.

Manage the native app:

```bash
npm run app:open
node ./bin/agent-session-bridge.mjs app status
node ./bin/agent-session-bridge.mjs app uninstall
```

Use `npm start` only when developing the web UI or debugging the background service.

To use only the CLI without installing the menu bar app:

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

If an older Agentail import makes Claude Code report that `agent-session-bridge` is not a recognized model, preview and then apply the repair. It modifies only assistant records created by Agentail and keeps a backup of every original file:

```bash
node ./bin/agent-session-bridge.mjs repair --agent claude
node ./bin/agent-session-bridge.mjs repair --agent claude --apply
```

If an older version incorrectly reported “two versions of the same event” because of `isError: false`, tool ID prefixes, or destination role degradation, preview the repair first. Then pause background synchronization and apply it. The command only marks semantically equivalent conflicts as resolved and does not alter event content:

```bash
node ./bin/agent-session-bridge.mjs repair conflicts
node ./bin/agent-session-bridge.mjs repair conflicts --apply
```

## Data directory

The default directory is `~/.agent-session-bridge/`:

```text
config.json       User selection and synchronization policy (0600)
state.json        Source signatures, canonical mappings, verification, and activity
sessions/         Canonical ASIF/2 sessions
revisions/        Immutable revision snapshots and shared merge baselines
projections/      Conversion manifests and fidelity reports for every destination
handoffs/         Portable JSON / Markdown packages for degraded or unavailable targets
imports/          Temporary envelopes for official OpenCode imports
exports/          Manually exported ASIF files
```

Set `ASB_HOME=/custom/path` or pass `--home /custom/path` to the CLI to use another location.

## Safety boundaries

- Agentail listens on `127.0.0.1` only and does not transmit session content over the network.
- It does not overwrite arbitrary native sessions. It creates separate imported sessions or appends missing events only to projections that it created and marked with a canonical identity.
- Tool calls sent to agents without structured tool support remain inert historical text and are never presented as pending executable calls.
- Native schemas are not stable public APIs. Successful read-back proves that the current version can parse the projection, not that a vendor guarantees long-term compatibility.
- Sessions may contain source code, command output, or secrets. Synchronization creates additional local copies; choose **messages only** to exclude tool traces.

## Compatibility references

- Codex agent import capability: [Import from another agent](https://learn.chatgpt.com/docs/import.md)
- Official OpenCode CLI import/export envelope: [OpenCode import implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/cli/cmd/import.ts)
- Documented Qoder transcript format: [Qoder Transcript File Format](https://docs.qoder.com/extensions/hooks#transcript-file-format)

## Build a release

Maintainers can produce tested release assets containing a universal macOS app and SHA-256 checksums:

```bash
npm run release:build
```

The output is written to `release/Agentail-macos-universal.tar.gz` and `release/SHA256SUMS.txt`.

## Roadmap

The next phase evolves AgenTail into a **Personal Agent console**: continuously follow agent sessions, preserve working context, produce change briefings, surface decisions, and operate specific tasks through verified runtime interfaces. A supervisor conversation becomes the main interaction, while session synchronization remains the underlying continuity capability.

See the [Personal Agent console design](docs/PERSONAL_AGENT_CONSOLE.md) (Chinese) for user flows, implementation boundaries, data models, task control, milestones, and acceptance criteria. This is a proposed design, not functionality already shipped in v0.5.4.

Further work includes real-version reopen/resume compatibility fixtures, additional agent adapters, a content-addressed attachment store, encrypted cross-device transport, and a CI matrix for upstream capability probes.
