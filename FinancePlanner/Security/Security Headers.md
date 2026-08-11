---
type: security
domain: security
status: implemented
---

# Security Headers (HSTS, CSP)

`deploy/security-headers.conf` / `deploy/nginx.conf`. Per `CHANGELOG.md`'s `[Unreleased]` section: production nginx now sends `Strict-Transport-Security` and no longer allows `http://localhost:*`/`ws://localhost:*` in its Content-Security-Policy.

- **Not independently re-derived line-by-line during the `/ship` phase's security gate** — carried forward from the CHANGELOG record, not re-verified against the live config file in this pass.

Related: [[Security Index]] · [[Nginx]] · [[Deployment]]
