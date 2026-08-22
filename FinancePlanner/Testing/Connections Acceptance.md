---
type: test
domain: provider
status: implemented
---

# Connections Acceptance

`scripts/connections-production-acceptance.mjs` — exercises [[Connections Page]] flows against fixtures, part of [[Production Browser Acceptance]].

**Locally re-run 2026-08-21** (`feat/bank-discovery-ux`, [[Bank Family Directory Resolution]]): real `postgres:17-bookworm` container, `AUTH_MODE=local` connector, `vite preview` production build (`VITE_ACCEPTANCE_FIXTURES=true`), headless Chromium via Playwright's bundled `chromium_headless_shell` (`CHROME_BIN` override — no system Chrome/Chromium installed in this sandbox). All 14 fixture modes passed, 74 screenshots, zero browser errors. Confirms the modal/scroll/mobile-nav/touch-target contract still holds after that branch's CSS/DOM changes; does **not** cover the institution-resolution screen itself (none of the 14 modes drive into it) — see [[Bank Family Directory Resolution]] for that verification boundary.

**Extended and re-run 2026-08-22** ([[Enable Banking Auth Flow Widget]]): two new fixture modes (`enablebanking-auth-flow-loading`, `enablebanking-auth-flow-error`) added to `MODES`/`CASES` in both the base script and this note's stable wrapper, plus the wrapper's mobile-nav-obscured assertion patch (`modalMode` set) extended to cover them. Run against a fresh throwaway `postgres:17-bookworm` container (isolated from any other local Postgres instance) and Playwright's real `chromium-1234` Chromium build (not the headless-shell fallback this time — a full Chromium binary was available). Both new modes passed at all 5 required viewports (1440×900, 1024×768, 430×932, 390×844, 360×800), 10/10 screenshots, zero browser errors. This covers only the widget's loading/error **shell** states (institution header, "Secure bank authorization" copy, framed widget area, fallback actions, dark/glossy styling) — the real third-party widget script and a live `ready` state are deliberately excluded from this harness (see [[Enable Banking Auth Flow Widget]] for why) and remain unverified until a real temporary deployment.

Related: [[Testing and CI Index]] · [[Connections Page]] · [[Provider Tests]] · [[Bank Family Directory Resolution]] · [[Enable Banking Auth Flow Widget]]
