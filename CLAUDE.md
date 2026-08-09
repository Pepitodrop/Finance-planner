## Health Stack

- typecheck: tsc -b --noEmit
- lint: eslint .
- test: npm test
- deadcode: skipped (no knip)
- shell: skipped (shellcheck not installed; scripts/*.sh present)

## Obsidian Project Memory

The `obsidian` MCP server provides long-term project memory for Finance Planner, stored as Markdown in `FinancePlanner/` (version-controlled in this repo).

- Consult `FinancePlanner/00 Project Index.md` and the specific linked notes before substantial work where prior project knowledge matters (architecture, decisions, provider status, known issues). Don't load the whole vault unnecessarily — follow links to what's relevant.
- Update memory after substantial work when it produced durable knowledge (a decision, a provider-verification result, a hard-won debugging discovery, an architectural change). Prefer updating an existing note over creating a duplicate.
- Source code, tests and current repo docs are always authoritative over this vault. If a note conflicts with what you observe in code/tests/docs, correct the note.
- Accurately distinguish implemented, mocked, provider-dependent and runtime/production-verified integrations — see `FinancePlanner/Production/Provider Status.md` for the required format. Never upgrade "code exists" to "verified working" without evidence.
- Never write secrets, credentials, tokens, or real user/financial data into the vault.
- Create a session/handoff note under `FinancePlanner/Sessions/` only for genuinely hard-to-reconstruct handoffs (see `FinancePlanner/Sessions/README.md`), not for routine work.
- `FinancePlanner/.obsidian/` (plugin/workspace state) is gitignored and machine-local — never treat it as project memory.
