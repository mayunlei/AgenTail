# Changelog

## 0.5.1 — 2026-09-19

First public release of Agentail.

### Highlights

- Bidirectional local session continuity for Codex, Claude Code, OpenCode, and Qoder.
- ASIF/2 canonical event graph with revisions, lineage, branches, and portable work state.
- Capability-aware projection with structured native history, inert transcript fallback, and universal handoff capsules.
- Three-way merge for concurrent continuation from a shared session revision.
- Read-back verification and a continuity-focused Chinese/English menu bar interface.
- Native source identity deduplication prevents the same session from being imported repeatedly.
- One-command macOS installer with a universal Apple Silicon/Intel menu bar binary and SHA-256 verification.

### Safety defaults

- Sync is disabled until the user explicitly selects at least two agents and enables it.
- The first run records a baseline instead of copying all historical sessions.
- Agentail listens only on `127.0.0.1`; session data stays on the local machine.
