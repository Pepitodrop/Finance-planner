## Health Stack

- typecheck: tsc -b --noEmit
- lint: eslint .
- test: npm test
- deadcode: skipped (no knip)
- shell: skipped (shellcheck not installed; scripts/*.sh present)

## Obsidian Project Memory

The `obsidian` MCP server provides long-term project memory for Finance Planner, stored as Markdown in `FinancePlanner/` (version-controlled in this repo).

- Consult `FinancePlanner/00 Project Index.md`, `FinancePlanner/Knowledge Graph.md`, and the specific linked notes before substantial work where prior project knowledge matters. Don't load the whole vault unnecessarily — traverse relevant graph links.
- Treat **graph quality as a first-class memory requirement**. Durable notes should normally connect to several genuinely related peer concepts (architecture, decisions, evidence, risks, provider state, production implications), including cross-folder links where useful. Avoid isolated notes and pure hub-and-spoke structure, but never add artificial links just to make Graph View denser.
- When adding or substantially changing durable memory, ask what the concept depends on, what it affects, what constrains it, and what evidence verifies it. Add meaningful `[[wikilinks]]` for those relationships and, where useful, update related existing notes so the relationship is traversable from both sides. Follow `FinancePlanner/Memory System.md` and `FinancePlanner/Knowledge Graph.md` for graph-maintenance rules.
- Update memory after substantial work when it produced durable knowledge (a decision, a provider-verification result, a hard-won debugging discovery, an architectural change). Prefer updating an existing note over creating a duplicate.
- Source code, tests and current repo docs are always authoritative over this vault. If a note conflicts with what you observe in code/tests/docs, correct the note.
- Accurately distinguish implemented, mocked, provider-dependent and runtime/production-verified integrations — see `FinancePlanner/Production/Provider Status.md` for the required format. Never upgrade "code exists" to "verified working" without evidence.
- Never write secrets, credentials, tokens, or real user/financial data into the vault.
- Create a session/handoff note under `FinancePlanner/Sessions/` only for genuinely hard-to-reconstruct handoffs (see `FinancePlanner/Sessions/README.md`), not for routine work. Session notes should link into permanent concept notes and should not become dead-end graph islands.
- `FinancePlanner/.obsidian/` (plugin/workspace state) is gitignored and machine-local — never treat it as project memory.
