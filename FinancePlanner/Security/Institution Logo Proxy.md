---
type: security
domain: provider
status: implemented
---

# Institution Logo Proxy

Renders real bank logos (Enable Banking's `ASPSP.logo`/`ASPSPGroup.logo`) in the Connections picker without ever letting the browser load an image directly from a provider-controlled URL, and without weakening the app's CSP. Added 2026-08-21 alongside [[Bank Family Directory Resolution]], after live deployment showed the picker falling back to Finance Planner lettermarks (AB/BV/VK/VR) for every real bank.

## Why not just render the URL directly

Enable Banking's `/aspsps` response already carries a real, provider-hosted logo URL for many institutions, and the server already sanitizes it through (`sanitizeEnableBankingAspsp()`, see [[Enable Banking]]). Rendering it as `<img src={institution.logo}>` would have required widening the CSP's `img-src` (`deploy/security-headers.conf`: `'self' data: blob: https://cdn.simpleicons.org`) to accept an arbitrary provider-controlled host, and would make the browser fetch third-party image URLs directly — a referrer/tracking exposure and a departure from [[Connections Page]]'s existing "reviewed logos only" institution-branding policy (`src/institution-logos.ts`'s hand-reviewed Simple Icons allowlist).

## Architecture

```
browser (<img src="/api/connectors/enablebanking/logo?institutionId=...">)
  -> same-origin Finance Planner route (GET /api/connectors/:provider/logo)
  -> EnableBankingProvider.resolveAspsp(institutionId): re-decodes + re-validates
     against the live, cached /aspsps directory -- the exact same anti-guessing
     lookup start() already uses (see [[Provider Institution Selection Contract]])
  -> validateEnableBankingLogoUrl(match.logo || match.group.logo): HTTPS-only,
     exact hostname allowlist (`enablebanking.com` -- confirmed as the real
     hostname for both ASPSP.logo and ASPSPGroup.logo against the current
     official API reference), no embedded userinfo
  -> fetchBoundedImage(): bounded fetch -- explicit shared deadline across the
     whole call (not reset per redirect hop), re-validates hostname/protocol
     on every redirect, raster-image-only Content-Type allowlist (no SVG --
     see below), byte-stream-enforced size cap regardless of what
     Content-Length claims or whether the response was transparently
     decompressed, no cookies/credentials/app-JWT forwarded upstream
  -> bounded in-memory cache (500 entries, 24h TTL, keyed by the validated URL)
  -> served back from Finance Planner's own origin, Cache-Control: public
```

The browser only ever supplies an `institutionId` (already-authenticated, length-capped) — never a URL. There is no code path from client input to an arbitrary fetch target. **Rate-limited under its own dedicated `assets` tier** (`ASSET_RATE_LIMIT_PER_MINUTE`, default 240/min), not the sensitive bucket `POST /start`/sync/disconnect share — see [[Rate Limiting]]'s 2026-08-21 entry for why that separation exists (a live production defect where ordinary logo browsing exhausted the sensitive bucket and starved `/start`, found the same day this feature was first deployed).

## Why raster-only, no SVG

`image/svg+xml` is deliberately excluded from the Content-Type allowlist. An `<img>` tag never executes an SVG's embedded script, but if the logo endpoint's URL is ever navigated to directly as a top-level document, a browser renders SVG as a live document and does execute embedded `<script>`/event-handler markup — a real, well-known behavior distinct from `<img>` rendering. Sanitizing SVG correctly (stripping `<script>`, `on*` handlers, `<foreignObject>`, external references) is its own nontrivial project; excluding the format entirely is the safe-by-default choice. A bank whose only logo is SVG-only just falls through to the frontend's next fallback.

## Frontend fallback order (never a broken-image icon)

1. The bank's own exact logo, or its cooperative-network group logo (both handled server-side, transparent to the client) — via the proxy above.
2. Finance Planner's existing reviewed/static logo (`src/institution-logos.ts`'s small Simple Icons allowlist).
3. An original Finance Planner lettermark.

Implemented in `InstitutionMark` (`src/features/connections/ConnectionsPage.tsx`) as a 3-stage `useState`, each stage's `<img onError>` advancing to the next. Appears on: concrete bank rows in the resolution step (`InstitutionResolutionStep`), and the Step 3 redirect-confirmation header (`RedirectConfirmationStep`, keyed on the resolved institution id so a prior bank's failed-image state can never carry over onto a newly resolved bank).

## Independent security review (2026-08-21)

A dedicated adversarial security-specialist pass found **one real, confirmed, exploitable issue**, since fixed:

- **CRITICAL (fixed):** `fetchBoundedImage()`'s timeout only bounded time-to-response-headers. The original code cleared its `AbortController` timer as soon as `fetch()` resolved, leaving the subsequent body-read loop (`reader.read()`) completely unbounded — a response that returns valid 200 + headers, sends a few bytes, then stalls the connection without closing it hung the function, and the request thread serving it, indefinitely. **Reproduced empirically** by the reviewer against a real stalled TCP connection, and independently reproduced again with a stalled `ReadableStream` while implementing the fix. Fixed by racing every `fetch()`/`reader.read()` call against one explicit deadline shared across the whole redirect chain (`withDeadline()`), rather than relying on an `AbortSignal` alone propagating correctly through a runtime's internal body-stream plumbing — the race is now the authoritative bound regardless of fetch-implementation specifics. This also fixed a related, lower-severity maintainability finding from the same review round (the original per-hop timer meant a redirect chain could take `maxRedirects × timeoutMs` total, not one bounded `timeoutMs`).
- Verified clean (informational, confidence 10, explicitly confirmed with evidence rather than assumed): the endpoint cannot be made to fetch anything but a validated `enablebanking.com` URL derived from a real, live ASPSP; redirect-following re-validates hostname/protocol on every hop (confirmed against Node's real `redirect: 'manual'` fetch behavior); size bounds hold even against a response that expands after transparent decompression; the cache/response carry no per-user data (pure public bank-logo bytes, keyed by URL); the `access.balances`/`transactions`/`maximum_consent_validity` changes on the unrelated `/auth` fix (see [[Enable Banking]]) introduce no path to request more than AIS-only access; `providerCode`/`providerMessage` (the new server-log-only diagnostic fields) never reach the client-facing error response.
- A separate, lower-confidence maintainability/testing pass additionally flagged (also since addressed): duplicated ASPSP-resolution logic between `start()` and `institutionLogoUrl()` (extracted into a shared `resolveAspsp()` helper), and test-coverage gaps for negative/non-numeric `Content-Length`, a response with no body, and the cache's eviction/TTL behavior (all now covered in `server/test/enable-banking-logo.test.js`, 33 cases total).

## Verification

`server/test/enable-banking-logo.test.js` (33 cases: URL resolution/validation including group-logo fallback and userinfo rejection, bounded-fetch mechanics including the redirect/SSRF/size/content-type/timeout/overall-deadline/no-body cases, end-to-end caching including TTL expiry and bounded eviction) plus `ConnectionsPage.test.tsx` cases for the resolution-step rows (asserting the exact same-origin proxy URL and the image-error-to-lettermark fallback) and the Step 3 confirmation header (asserting the resolved bank's own logo, and that it updates correctly across a back-and-re-resolve).

**LIVE VERIFIED (2026-08-21):** a temporary production deployment (`finance.luisbenedikt.de`) against the real Enable Banking sandbox confirmed real cooperative-bank logos actually rendering in the picker, and server logs showed `GET /api/connectors/enablebanking/logo -> 200`. This is the first live-traffic evidence this feature has had. The same deployment also surfaced a real, live production defect in an adjacent system — see [[Rate Limiting]]'s 2026-08-21 entry: the logo proxy's own request volume briefly shared Finance Planner's sensitive rate-limit bucket with `POST /start`/sync/disconnect, and a normal user browsing a real bank directory could exhaust it and 429 those genuinely sensitive routes. Fixed with a dedicated tier; **not yet re-verified live**. The logo proxy's own SSRF/CSP/hostname-allowlist/bounded-fetch properties are unaffected by that fix and remain as verified above.

Related: [[Enable Banking]] · [[Bank Family Directory Resolution]] · [[Provider Institution Selection Contract]] · [[Connections Page]] · [[Provider Status]] · [[Rate Limiting]]
