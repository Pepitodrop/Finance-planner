---
type: security
domain: provider
status: implemented
---

# Enable Banking Auth Flow Widget

Embeds Enable Banking's **official** Auth Flow widget (`<enablebanking-auth-flow>`, loaded from `https://auth.enablebanking.com/lib/widgets.umd.min.js`) into the Connections modal's Step 3, so the pre-ASPSP-authorization step happens inside Finance Planner's own dark/glossy UI instead of an abrupt full-page redirect to a generic Enable Banking-hosted page. Added 2026-08-22, immediately after [[Enable Banking]]'s third live pass showed `POST /auth` finally being **accepted** by the real sandbox (the [[Provider Callback Binding]] redirect_uri fix working end to end) and a real bank authentication page being reached — but via that plain hosted page, with the visual discontinuity this widget is meant to remove.

## Why not an iframe

Enable Banking's own documentation states the complete authorization flow cannot run inside a cross-origin iframe — Enable Banking and eventual ASPSPs don't grant the framing permissions (`X-Frame-Options`/`frame-ancestors`) this would require. The official custom element is the only supported embedding mechanism; Finance Planner's own CSP (`frame-ancestors 'none'`, `X-Frame-Options: DENY`) is unchanged and no framing permission was ever requested.

## Architecture

```
POST /api/connectors/enablebanking/start
  -> EnableBankingProvider.start(): real POST /auth to Enable Banking
     (unchanged -- see Enable Banking's own start() doc)
  -> response.url + response.authorization_id (trusted, provider-returned)
  -> validateEnableBankingAuthOrigin(response.url): HTTPS-only, reject
     embedded userinfo, hostname must be exactly `enablebanking.com` or end
     with `.enablebanking.com` (wider than the logo proxy's single-hostname
     allowlist -- confirmed live that the real authorization URL can be on
     `auth.enablebanking.com` in general or a per-environment sandbox host
     such as `tilisy-sandbox.enablebanking.com`), returns bare `.origin`
     only -- path/query are discarded, never forwarded
  -> validEnableBankingAuthorizationId(response.authorization_id): bounded
     safe-charset check
  -> isEnableBankingSandbox(env, hostname): explicit ENABLE_BANKING_SANDBOX
     env wins if set; otherwise inferred from the hostname containing
     "sandbox" -- never silently defaults an unset config to sandbox=true
  -> authFlow = {provider, authorizationId, origin, sandbox} or null
     (never a partially-filled object)

server.js's /start response
  -> { redirectUrl, authFlow? } -- authFlow's 4 fields explicitly
     whitelisted, never the raw provider `result` or its `credential`
     (signed state, institutionId, aspspName/country, accessValidUntil
     stay server-side only)

src/connectors.ts's startConnector()
  -> re-validates authFlow client-side (provider==='enablebanking',
     non-empty authorizationId, https origin) before ever trusting it
  -> returns { mode: 'embedded-auth', ... } instead of navigating away,
     ONLY for Enable Banking with a valid descriptor
  -> every other provider (and Enable Banking without a valid descriptor)
     still calls window.location.assign() immediately, unchanged

ConnectionsPage.tsx
  -> embeddedAuthFlow state holds the result; Step 3 renders
     EnableBankingAuthorizationStep instead of RedirectConfirmationStep
  -> EnableBankingAuthFlow (src/features/connections/EnableBankingAuthFlow.tsx)
     imperatively creates <enablebanking-auth-flow authorization=... origin=...
     locale="EN" [sandbox]>, listens for ready/ais-loaded/error, cleans up
     the element and listeners on unmount or prop change
  -> enableBankingWidgetLoader.ts lazy-loads the fixed script URL once,
     shared Promise for concurrent callers, customElements.whenDefined()
     verification, 10s timeout, never poisons the module permanently on
     failure (a later retry can load again)

when actual bank UI / SCA is required
  -> the widget itself performs a top-level redirect to the provider/bank
     (Finance Planner's own code has no involvement in that hop)
  -> canonical callback (/api/connectors/callback) -- UNCHANGED, still
     server-owned, signed state, nonce/replay protection intact (see
     [[Provider Callback Binding]])
  -> POST /sessions -- UNCHANGED, server-side only
```

## Security properties

- **No arbitrary widget origin**: `origin`/`authorizationId` are derived exclusively from Enable Banking's own trusted `POST /auth` response, re-validated independently on both server and client before ever reaching a DOM attribute. There is no code path from browser input to the widget's `origin`/`authorization` attributes.
- **Hostname allowlist, not a single fixed string**: unlike [[Institution Logo Proxy]]'s exact `enablebanking.com` match (justified there because logo URLs are documented to live on exactly that host), the authorization URL can legitimately be on multiple Enable Banking-owned hosts (confirmed live: `tilisy-sandbox.enablebanking.com` differs from `auth.enablebanking.com`), so this uses an explicit suffix policy (`=== 'enablebanking.com'` or `.endsWith('.enablebanking.com')`) — deliberately narrower than "any HTTPS host the provider claims."
- **No credential collection**: Finance Planner creates no input fields for bank username/PIN/TAN/OTP/password anywhere in this feature. The widget's internal DOM (where real bank-provided authentication fields eventually render) is never inspected, read, or logged by Finance Planner code — `EnableBankingAuthFlow` only listens for `ready`/`ais-loaded`/`error` events and never touches their payloads.
- **No secret leakage**: the `/start` response explicitly whitelists exactly `{provider, authorizationId, origin, sandbox}` from the server-side `authFlow` object — never the signed `state`, JWT, private key, or the `credential` object (institutionId, aspspName/country, accessValidUntil) destined only for server-side pending-setup storage.
- **Sandbox never silently defaults**: `ENABLE_BANKING_SANDBOX` must be set explicitly for a production deployment; an unset config only ever infers `sandbox: true` from a positive hostname signal, never as a bare default.
- **Callback architecture unchanged**: this widget is only a frontend improvement around an authorization Enable Banking's `/auth` already created — [[Provider Callback Binding]]'s canonical callback URI, signed state, nonce/replay protection, and provider-derived-from-verified-state design are completely untouched.
- **CSP**: `deploy/security-headers.conf`'s `script-src` gained exactly `https://auth.enablebanking.com` (the widget script's own host) — `frame-ancestors 'none'`, `object-src 'none'`, and `X-Frame-Options: DENY` are unchanged; no framing permission was added since none is needed. `connect-src`'s pre-existing `https:` allowance already covers the widget's own runtime network calls.
- **Third-party script supply-chain boundary**: `enableBankingWidgetLoader.ts` uses a fixed constant URL only, never provider/user-influenced; lazy-loaded (not on every page load); loaded at most once (concurrent callers share one Promise); verifies `customElements.whenDefined()` after load rather than assuming synchronous registration; bounded by a timeout; a failed load doesn't permanently poison the module (a later retry can attempt again); no `eval`/`innerHTML`/`dangerouslySetInnerHTML` anywhere in the loader or wrapper.

## Widget lifecycle / stale-state handling

`embeddedAuthFlow` (and its acceptance-fixture-only sibling `authFlowFixtureStatus`) is cleared in `openSetup()`, `closeSetup()`, `chooseInstitution()`, and `finalizeInstitutionResolution()` — closing/reopening the setup modal, or picking a different institution mid-attempt, can never leave a previous bank's `authorizationId` attached to a new attempt. The widget component itself keys its effect on `authorizationId`/`origin`/`sandbox`/`locale`, tearing down and recreating the DOM element wholesale on any change rather than mutating one in place. Backing out of the widget view (Back arrow) collapses one level to the plain confirmation view on the same Step 3, rather than leaving Step 3 entirely; Cancel closes the whole setup modal, matching every other step's Cancel semantics. Neither action fabricates authorization success or invents provider-side revocation for an attempt that was never completed — the existing pending-setup lifecycle ([[Provider Callback Binding]]) is unaffected, since this widget only changes what the browser shows before a real callback lands, never what the server does after one.

## Frontend fallback

The widget is an enhancement, not a single point of failure. If the script fails to load, the custom element fails to register, the widget emits its own `error` event, or loading times out, `EnableBankingAuthorizationStep` shows a safe in-modal message with an explicit **"Open secure provider page"** button (navigates to the already-validated `redirectUrl` from the same successful `POST /auth` response — the plain, pre-widget redirect path, unchanged) and a **"Try again"** button that remounts a fresh widget element. Finance Planner never automatically redirects on a widget error without this explicit user action, and never surfaces the widget's raw internal error payload.

## Deterministic browser-QA fixtures

Two acceptance-fixture modes (`enablebanking-auth-flow-loading`, `enablebanking-auth-flow-error`) render the widget's loading/error shell states without ever contacting the real `auth.enablebanking.com` script or using a real `authorizationId` — gated behind `EnableBankingAuthFlow`'s `fixtureStatus` prop, itself only ever wired when `VITE_ACCEPTANCE_FIXTURES=true` (a build-time flag; a normal `npm run build` never bundles this path as reachable production behavior). The widget's actual `ready` state (the real third-party element rendering interactively) is deliberately **not** fixtureable this way — exercising it for real requires the live script and a live authorization id, which the acceptance harness must not depend on for a normal CI run.

**LIVE VERIFIED (2026-08-22, real browser, both fixture modes, all 5 required viewports — 1440×900, 1024×768, 430×932, 390×844, 360×800):** `scripts/run-connections-production-acceptance-stable.mjs` against a real Postgres-backed connector + a real headless Chromium, 10/10 screenshots captured, all layout/touch-target/focus-trap/mobile-nav-inert assertions passed. This confirms the widget *shell* (loading and error states, institution header, Cancel, fallback button, dark/glossy styling, modal geometry, PR #143's scroll fix) renders correctly across real device sizes. It does **not** confirm the real third-party widget script loads or the real Enable Banking widget renders interactively in a live browser — that requires a temporary production deployment against the real sandbox, not yet performed for this feature.

## Verification

- `server/test/enable-banking-auth-flow.test.js` (20 cases): widget descriptor produced only from a valid provider response; `authorizationId` matches exactly; `origin` derived only from `response.url` (never the browser-supplied `redirectUri`); the sandbox/live host difference (`tilisy-sandbox.enablebanking.com` vs `auth.enablebanking.com`) both honored; HTTP, non-Enable-Banking-hostname, embedded-userinfo, malformed-URL, and lookalike-hostname (`notenablebanking.com.evil.example`) authorization URLs all rejected without throwing; missing/oversized/unsafe-charset `authorization_id` rejected; the descriptor never carries more than the 4 whitelisted fields; `redirectUrl` remains valid regardless of whether a descriptor was produced; GoCardless/PayPal `start()` never return an `authFlow` field; sandbox detection precedence (explicit env wins both directions, hostname-inference fallback never defaults to sandbox against a production-looking host).
- `server/test/open-banking-server-boundary.test.js`: the `/start` response whitelists exactly the 4 `authFlow` fields and never spreads the raw provider `result` (which carries `credential`).
- `server/test/security-headers.test.js` (new): `auth.enablebanking.com` allowed only in `script-src`, as an addition not a replacement; `frame-ancestors`/`object-src`/`X-Frame-Options` unchanged; `connect-src` unchanged.
- `src/features/connections/enableBankingWidgetLoader.test.ts` (7 cases): single `<script>` tag for the fixed URL; concurrent callers share one Promise; an existing-but-forgotten script tag is reused, not duplicated; script-load failure and timeout both produce safe errors; a failed attempt doesn't permanently poison the module; already-registered short-circuits with no script tag at all.
- `src/features/connections/EnableBankingAuthFlow.test.tsx` (11 cases): exact `authorization`/`origin`/`locale` attributes; `sandbox` attribute present-with-empty-value only when true; `ready` and `ais-loaded` both resolve the loading state; `error` event and loader rejection both report `'error'` without ever calling `console.log`; element and listeners removed on unmount; a changed `authorizationId` recreates the element rather than mutating it; `fixtureStatus` bypasses the loader entirely; no `<input>` anywhere in the wrapper's own DOM.
- `src/connectors.startConnector.test.ts` (8 cases): Enable Banking with a valid descriptor never navigates and returns the exact `embedded-auth` shape; GoCardless/PayPal still navigate immediately exactly as before; a non-Enable-Banking provider's response ignores an `authFlow`-shaped field even if present; Enable Banking falls back to immediate redirect when `authFlow` is absent, missing `authorizationId`, or non-HTTPS `origin`; a non-secure `redirectUrl` is rejected regardless of provider.
- `src/features/connections/ConnectionsPage.test.tsx` (new `describe('Enable Banking Auth Flow widget', ...)` block, 9 cases): confirming/embedded flow does not navigate and shows the loading state; Cancel stays enabled once busy clears; backing out and reopening/re-choosing never reuses a stale widget; no credential-shaped input anywhere in the setup modal while the widget view is active; the widget frame is a live region (`aria-live="polite"`) with a keyboard-reachable Cancel button; both fixture states render correctly and the error fixture's fallback button redirects only to the fixture's own `redirectUrl`.

Related: [[Enable Banking]] · [[Provider Callback Binding]] · [[Institution Logo Proxy]] · [[Connections Page]] · [[Connections Acceptance]] · [[Rate Limiting]] · [[Provider Status]]
