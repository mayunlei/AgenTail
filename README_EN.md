# AgenTail

[简体中文](README.md) | [English](README_EN.md)

> One chat. Every session.

AgenTail is being redesigned as a session management console. A Personal Agent explains progress across endpoints, dispatches tasks, selects an existing session to continue from the user's request, and provides visual MDP trajectories, verification evidence, and token usage.

**This branch contains a design and interactive prototype. Runtime code is still the legacy v0.5.4 product. The capabilities below are planned and are not connected to real endpoints yet.**

[Full design](docs/PERSONAL_AGENT_CONSOLE.md) (Chinese) · [Interactive prototype source](docs/SESSION_CONSOLE_PREVIEW.html) · [Prototype validation](docs/CONSOLE_PREVIEW_VALIDATION.md) · [Design PR](https://github.com/mayunlei/AgenTail/pull/1)

## One supervisor chat

- Ask what changed in each session while you were away.
- Dispatch a new task to a specific agent, host, and workspace.
- Continue the appropriate existing session based on its objective, project, recent activity, and runtime capabilities.
- Assign independent tasks to multiple endpoints and track each result.

Ambiguous targets produce a short list of candidates. Explicit instructions go through the endpoint's native runtime interface and return delivery receipts linked to the resulting turn.

## Visual session inspection

| View | Contents |
| --- | --- |
| Overview | Endpoint, project, objective, runtime state, recent activity, pending work, and observation coverage |
| Briefing | Background, confirmed decisions, changes since the user's last acknowledgment, and next actions |
| MDP trajectory | State → action → observation → next state, with tools, diffs, tests, and evidence; rewards remain unavailable unless actually provided |
| Usage | Session, turn, and request tokens, input/output, cache and reasoning subsets, waits, and retries, with accounting semantics and missing-data indicators |
| Action receipts | Exact endpoint and native session, create/continue mode, instruction, queue status, acknowledgment, and execution result |

## Remove cross-end session synchronization

The new architecture removes bidirectional synchronization, native-history projections, cross-end transcript copying, three-way merges, fidelity scores, and continuity metrics. Every session keeps its native identity.

The console aggregates observations and routes user instructions. Related work may link multiple sessions without copying, overwriting, or merging their native histories. Legacy sync APIs, loops, adapter writers, and settings will be retired during runtime implementation, not moved into advanced settings.

## Delivery stages

1. Validate actual observation, MDP/usage events, task creation, continuation, and execution ownership.
2. Replace the sync entry point with a session directory, supervisor chat, briefings, MDP, and usage views.
3. Complete content routing → create/continue → native receipt → resulting turn → updated panels.
4. Extend verified control capabilities across endpoints, parallel work, child-agent accounting, and sustained-use validation.

Codex is the first end-to-end control target. Reading an existing session does not establish permission or technical ability to control its running instance.

## Preview

The prototype uses demonstration data. Session selection, MDP drill-down, usage views, and chat routing previews work locally. It does not call a model or send real tasks.

From the repository root:

```bash
python3 -m http.server 4782 --bind 127.0.0.1 --directory docs
```

Open `http://127.0.0.1:4782/SESSION_CONSOLE_PREVIEW.html`.

## Development status

The new console has not shipped. The legacy installer does not install these planned capabilities. The old product remains available in the [v0.5.4 code snapshot](https://github.com/mayunlei/AgenTail/tree/5d2f6d1); it is not a runtime dependency of the new design.

Keep validation programs, compiled executables, and isolated data inside `.validation/` or `.build/validation/`. Reuse the installed native application unless native sources or bundled resources change.

MIT License. See [LICENSE](LICENSE).
