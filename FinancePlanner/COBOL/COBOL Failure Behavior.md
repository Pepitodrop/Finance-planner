---
type: component
domain: cobol
status: implemented
---

# COBOL Failure Behavior (fail-closed)

Production is fail-closed by design:

- [[cobol-engine.js]] only falls back to a JS implementation when `ALLOW_JS_FINANCE_FALLBACK=true` **and** `NODE_ENV !== 'production'`; otherwise throws `Authoritative COBOL finance engine unavailable`.
- [[cobol-banking-core.js]] throws `cobol_unavailable` when `COBOL_BANKING_REQUIRED=true` (Compose default) — provider-facing operations always hard-require the binary regardless of that flag.
- **Deliberately not softened:** `TODOS.md` records this as a rejected fix — masking the missing binary would risk hiding a real CI misconfiguration; see [[Rejected Approaches]].

Related: [[COBOL Index]] · [[Architecture Decisions]] · [[Rejected Approaches]]
