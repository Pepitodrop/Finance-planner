---
type: security
domain: security
status: implemented
---

# Security Headers (HSTS, CSP)

`deploy/security-headers.conf` / `deploy/nginx.conf`. Per `CHANGELOG.md`'s `[Unreleased]` section: production nginx now sends `Strict-Transport-Security` and no longer allows `http://localhost:*`/`ws://localhost:*` in its Content-Security-Policy.

- **Not independently re-derived line-by-line during the `/ship` phase's security gate** — carried forward from the CHANGELOG record, not re-verified against the live config file in this pass.
- **`script-src` gained `https://auth.enablebanking.com` (2026-08-22):** the sole allowance needed for Enable Banking's official Auth Flow widget script — see [[Enable Banking Auth Flow Widget]]. `frame-ancestors 'none'`, `object-src 'none'`, and `X-Frame-Options: DENY` are unchanged; `connect-src`'s pre-existing `https:` already covered the widget's runtime network calls. Regression-tested directly against the shipped config text in `server/test/security-headers.test.js` (confirms the addition is exactly this one host, in `script-src` only, and that the unrelated directives weren't touched).

Related: [[Security Index]] · [[Nginx]] · [[Deployment]] · [[Enable Banking Auth Flow Widget]]
