---
type: security
domain: security
status: implemented
---

# Rate Limiting

Distributed sliding-window rate limiting via [[distributed-rate-limiter.js]] + [[request_rate_limits (table)]]. Three independent tiers, one bucket each, same underlying table (`namespace` is a free-text partition key, not a constrained enum): **general** (120/min default), **sensitive** (20/min default — `/api/auth`, `/api/session`, `/api/connectors/*`, `/api/subscriptions`, `/api/finance`, `/api/ai`), **asset** (240/min default — added 2026-08-21, see below). Classification lives in `server/src/runtime-security.js`'s `rateLimitTier(pathname)`, unit-tested directly (`server/src/runtime-security.test.js`) rather than only via source-text inspection of `server.js`.

## Fixed 2026-08-21: the institution-logo proxy was starving sensitive routes

Live production evidence (temporary deployment of PR #144): browsing a real Enable Banking bank directory (592 institutions, [[Institution Logo Proxy]]'s `GET /api/connectors/:provider/logo`) generated enough requests to exhaust the sensitive bucket's default 20/min limit by itself — because `/api/connectors/*/logo` matched the same generic `/api/connectors/` sensitive-prefix pattern as `POST /start`, sync and disconnect. Once exhausted, `POST /api/connectors/enablebanking/start` itself returned 429 "Too many requests," blocking the user from ever reaching consent — a decorative image endpoint was capable of denying a security-sensitive operation entirely, for the same client, in the same window.

Fixed with a dedicated third tier (`assets`, `ASSET_RATE_LIMIT_PER_MINUTE`, default 240/min) checked in `rateLimitTier()` *before* the generic sensitive-prefix match, so the logo route can never fall through to it. GoCardless/PayPal are unaffected (their own `/institutions`/`/start`/sync/disconnect routes remain classified sensitive, unchanged). No schema migration was needed (`assets` is just a new namespace value in the existing table). Verified: `server/src/runtime-security.test.js` (classification correctness, including an end-to-end simulation proving 50 logo requests never touch the sensitive bucket and `/start` remains available), `server/src/distributed-rate-limiter.test.js` (the `assets` limiter is provisioned independently in the Postgres-backed path), `server/test/open-banking-server-boundary.test.js` (server.js dispatches through the shared classifier, not a locally re-implemented pattern).

- **Known limitation:** IP-keyed, not per-account — architectural, pre-existing, deliberately deferred rather than a hardening-pass fix. `config/production-readiness-evidence.json`'s `distributedRateLimiting` gate is `partial`, not `verified` — no named accountable human `approvedBy` recorded (a repo-wide convention: a passing test alone doesn't upgrade a readiness gate to `verified`).
- **Not yet re-verified live**: this fix has not been exercised against another temporary deployment; the starvation was observed live, the fix is code-correctness-verified only so far.
- **Security review finding, fixed (2026-08-21):** the original `LOGO_ROUTE_PATTERN` (`^\/api\/connectors\/[a-z0-9][a-z0-9-]{1,39}\/logo---
type: security
domain: security
status: implemented
---

# Rate Limiting

Distributed sliding-window rate limiting via [[distributed-rate-limiter.js]] + [[request_rate_limits (table)]]. Three independent tiers, one bucket each, same underlying table (`namespace` is a free-text partition key, not a constrained enum): **general** (120/min default), **sensitive** (20/min default — `/api/auth`, `/api/session`, `/api/connectors/*`, `/api/subscriptions`, `/api/finance`, `/api/ai`), **asset** (240/min default — added 2026-08-21, see below). Classification lives in `server/src/runtime-security.js`'s `rateLimitTier(pathname)`, unit-tested directly (`server/src/runtime-security.test.js`) rather than only via source-text inspection of `server.js`.

## Fixed 2026-08-21: the institution-logo proxy was starving sensitive routes

Live production evidence (temporary deployment of PR #144): browsing a real Enable Banking bank directory (592 institutions, [[Institution Logo Proxy]]'s `GET /api/connectors/:provider/logo`) generated enough requests to exhaust the sensitive bucket's default 20/min limit by itself — because `/api/connectors/*/logo` matched the same generic `/api/connectors/` sensitive-prefix pattern as `POST /start`, sync and disconnect. Once exhausted, `POST /api/connectors/enablebanking/start` itself returned 429 "Too many requests," blocking the user from ever reaching consent — a decorative image endpoint was capable of denying a security-sensitive operation entirely, for the same client, in the same window.

Fixed with a dedicated third tier (`assets`, `ASSET_RATE_LIMIT_PER_MINUTE`, default 240/min) checked in `rateLimitTier()` *before* the generic sensitive-prefix match, so the logo route can never fall through to it. GoCardless/PayPal are unaffected (their own `/institutions`/`/start`/sync/disconnect routes remain classified sensitive, unchanged). No schema migration was needed (`assets` is just a new namespace value in the existing table). Verified: `server/src/runtime-security.test.js` (classification correctness, including an end-to-end simulation proving 50 logo requests never touch the sensitive bucket and `/start` remains available), `server/src/distributed-rate-limiter.test.js` (the `assets` limiter is provisioned independently in the Postgres-backed path), `server/test/open-banking-server-boundary.test.js` (server.js dispatches through the shared classifier, not a locally re-implemented pattern).

) also matched the literal path `/api/connectors/webhooks/logo`, colliding with the webhook dispatch route's own `/api/connectors/webhooks/:provider` shape and classifying it into the permissive asset tier. Assessed as inert (no provider is ever registered as `"logo"`, so it 404s before any rate-limit-relevant work happens) but fixed anyway with a negative lookahead excluding `webhooks/` as the provider segment, plus a regression test, so the two route families never overlap regardless of that coincidence. The asset tier's generous default (240/min, a 12x increase over the old shared 20/min bucket) was separately assessed by the same review as acceptable given the bounded/cached/same-origin nature of the underlying fetch — left unchanged, not a real finding.

Related: [[Security Index]] · [[request_rate_limits (table)]] · [[Known Issues and Limitations]] · [[Rejected Approaches]] · [[Institution Logo Proxy]] · [[Enable Banking]]
