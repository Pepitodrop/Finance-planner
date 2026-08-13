---
type: language
domain: backend
status: implemented
---

# JavaScript (server)

- **Where used:** entire `server/src/` connector backend (plain JS, not TypeScript)
- **Why:** deliberately limited scope — transport, OAuth redirects, bounded JSON parsing, encrypted persistence, sessions, retries, authorization. **Not** financial decision logic — that's [[GnuCOBOL (language)]]'s job (see [[Architecture Decisions]])
- **Subsystems depending on it:** [[Backend]] entirely
- **Tests covering it:** `server/test/*.test.js`, `server/src/*.test.js` (Node's built-in `node --test`)

Related: [[Technology Index]] · [[Backend]] · [[Node.js runtime]]
