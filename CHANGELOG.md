# Changelog

## 0.5.4 — 2026-09-24

- Replaced the abstract slogan with the direct product promise: “Sync sessions across coding agents.” / “跨 Coding Agent，会话自动同步。”
- Added Report issue entry points to the menu bar panel and detailed ledger.
- GitHub issue drafts now include safe runtime and continuity diagnostics without session content, project names, paths, or command output.

## 0.5.3 — 2026-09-21

- Normalized harmless cross-agent differences in error flags and generated tool-call ID prefixes before merge comparison.
- Preserved developer and system message roles in bridge markers for lossy native transcript formats.
- Treated target-side role flattening and causal-link rewrites as transport metadata instead of concurrent content edits.
- Added a reversible `asb repair conflicts [--apply]` migration for existing false-positive conflicts.

## 0.5.2 — 2026-09-20

- Replaced repeated full canonical-session reads with a compact persistent summary index.
- Bounded and cached Codex, Claude Code, and Qoder discovery metadata reads.
- Cached expensive OpenCode CLI discovery and agent capability probes.
- Raised the live-sync polling floor to 10 seconds and deferred active files until briefly stable.
- Stopped the menu bar status timer when its popover is closed.

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
