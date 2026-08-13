---
type: technology
domain: infrastructure
status: implemented
---

# Docker

- **Where used:** `Dockerfile.web` (Nginx + built SPA), `Dockerfile.server` (Node connector)
- **Hardening:** read-only root filesystem, dropped Linux capabilities (only `CHOWN`/`SETGID`/`SETUID`/`NET_BIND_SERVICE` retained), connector bound to loopback only
- **CI evidence:** `containers` CI job builds both images + Trivy HIGH/CRITICAL scan, SHA-pinned action (not a floating tag — see [[Security Decisions]] for why)

Related: [[Technology Index]] · [[Docker Compose]] · [[Deployment]]
