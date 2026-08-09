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

## Graph-first memory design

The vault should evolve primarily as a **connected semantic graph**, not just a folder hierarchy. See [[Knowledge Graph]] for the cross-domain relationship map.

Folders are only for human organization. The real memory structure is the network of meaningful `[[wikilinks]]` between architecture, features, decisions, evidence, risks, provider state, debugging knowledge, and production concerns.

When creating or substantially changing a durable note:

- identify what existing concepts it **depends on**;
- identify what it **constrains, enables, or changes**;
- identify what **evidence, tests, runtime state, or provider status** supports it;
- add meaningful links to those peer concepts, including cross-folder links where appropriate;
- when useful, update an existing related note so the relationship can be traversed in both directions;
- prefer enriching an existing concept node over creating a duplicate node with overlapping meaning.

A durable note should normally have multiple meaningful peer connections. Isolated notes should be rare. A note linked only to `00 Project Index.md` or only to a single hub is not considered well integrated unless that genuinely reflects the domain.

### Relationship semantics

Use prose around links so the graph retains meaning, for example:

- depends on → [[Data and Persistence]]
- constrained by → [[Security Decisions]]
- verified by / evidence tracked in → [[Provider Status]]
- implemented by → [[Frontend]] or [[Backend]]
- deterministic boundary provided by → [[COBOL Domain Core]]
- production implications tracked in → [[Deployment]]
- limitation recorded in → [[Known Issues and Limitations]]
- decision rationale recorded in → [[Architecture Decisions]]

The exact wording can vary; the important part is that future readers can understand **why** two nodes are connected.

### Graph health

When memory changes materially, check the graph quality rather than only whether the new note exists:

- no broken wikilinks;
- no accidental duplicate concept nodes;
- no new durable orphan notes without a justified reason;
- avoid pure hub-and-spoke structure — important feature notes should connect directly to related architecture, decisions, evidence, risks, and production notes;
- avoid artificial link spam or every-to-every linking;
- session/handoff notes should point into permanent concept notes and should not become dead-end islands;
- stale relationships should be corrected when implementation or verification status changes.

The objective is a graph dense enough for Claude to traverse related concepts naturally, while every edge still represents a real semantic relationship.

## How this vault is organized

- `00 Project Index.md` — directory-style entry point
- `Knowledge Graph.md` — relationship-centric graph map and cross-domain navigation
- `Architecture/` — how the system is put together
- `Decisions/` — why it's put together that way, and what was rejected
- `Features/` — subsystem-level knowledge (auth, banking, PayPal, AI, sync, mobile)
- `Engineering/` — commands, known issues, debugging technique
- `Production/` — deployment, security posture, strict provider verification status
- `Sessions/` — handoff notes, created only when genuinely useful (see [[Sessions/README|Sessions README]])

## Bootstrap provenance

This vault was bootstrapped 2026-08-09 from a direct inspection of the repository at that commit (`eb7012a`, `main`) — README, CLAUDE.md, `docs/*.md`, `server/src/*`, `core/cobol/*`, `.github/workflows/*`, `TODOS.md`, and git history. It is a snapshot, not a live feed; treat provider/verification status especially as something to re-check against current code before relying on it for a release decision.
