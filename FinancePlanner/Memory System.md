# Memory System

This vault is the durable, long-term project-memory layer for Finance Planner, maintained across Claude Code sessions via the `obsidian` MCP server. It exists alongside the repository, not instead of it.

## Obsidian IS for

- architectural decisions and the reasoning behind them
- important project constraints
- provider/integration state (implemented vs mocked vs runtime-verified vs production-verified)
- major debugging discoveries with durable technique value
- known pitfalls
- rejected or deliberately deferred approaches and why
- deployment discoveries
- security decisions
- durable testing knowledge
- complex unfinished-work handoffs

## Obsidian IS NOT for

- copies of source code that can simply be read from the repo
- routine implementation details
- full chat transcripts
- every command Claude executed
- temporary thoughts
- generated build output
- dependency documentation already available elsewhere (npm/package docs)
- secrets of any kind

## Source of truth precedence

1. current source code
2. automated tests
3. current repository documentation (`README.md`, `docs/`, `CLAUDE.md`)
4. Obsidian memory (this vault)

If a note here conflicts with current code, tests, or docs, the code/tests/docs win. Investigate and correct the stale note — don't propagate the old claim.

## How this vault is organized

- `00 Project Index.md` — entry point, links to everything
- `Architecture/` — how the system is put together
- `Decisions/` — why it's put together that way, and what was rejected
- `Features/` — subsystem-level knowledge (auth, banking, PayPal, AI, sync, mobile)
- `Engineering/` — commands, known issues, debugging technique
- `Production/` — deployment, security posture, strict provider verification status
- `Sessions/` — handoff notes, created only when genuinely useful (see [[Sessions/README|Sessions README]])

## Bootstrap provenance

This vault was bootstrapped 2026-08-09 from a direct inspection of the repository at that commit (`eb7012a`, `main`) — README, CLAUDE.md, `docs/*.md`, `server/src/*`, `core/cobol/*`, `.github/workflows/*`, `TODOS.md`, and git history. It is a snapshot, not a live feed; treat provider/verification status especially as something to re-check against current code before relying on it for a release decision.
