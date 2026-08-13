---
type: technology
domain: infrastructure
status: implemented
---

# Docker Compose

- **Where used:** `compose.yaml` — orchestrates `web`, `connector`, `postgres` services
- **Topology:** `connector` published only on `127.0.0.1:${CONNECTOR_PORT:-8787}` — [[Nginx]] is the sole reachable path
- **Config-and-restore drill:** [[Config and Restore Drill]] CI job validates this topology end-to-end

Related: [[Technology Index]] · [[Docker]] · [[Deployment]]
