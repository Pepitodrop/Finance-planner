---
type: technology
domain: backend
status: implemented
---

# Node.js runtime

- **Where used:** `server/src/server.js` entrypoint, entire connector backend
- **Why:** transport/orchestration only — explicitly not the layer that decides financial-domain correctness (see [[Architecture Decisions]])
- **Interop:** bridges to [[GnuCOBOL (language)]] via `node:child_process.execFile` (subprocess, not FFI) — see [[Node-COBOL Boundary]]
- **Container:** its own service in [[Docker Compose]], reachable only via [[Nginx]] (loopback-bound port)

Related: [[Technology Index]] · [[Backend]] · [[JavaScript (Node.js)]]
