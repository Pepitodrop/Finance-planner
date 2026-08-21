---
type: test
domain: provider
status: implemented
---

# Connections Acceptance

`scripts/connections-production-acceptance.mjs` — exercises [[Connections Page]] flows against fixtures, part of [[Production Browser Acceptance]].

**Locally re-run 2026-08-21** (`feat/bank-discovery-ux`, [[Bank Family Directory Resolution]]): real `postgres:17-bookworm` container, `AUTH_MODE=local` connector, `vite preview` production build (`VITE_ACCEPTANCE_FIXTURES=true`), headless Chromium via Playwright's bundled `chromium_headless_shell` (`CHROME_BIN` override — no system Chrome/Chromium installed in this sandbox). All 14 fixture modes passed, 74 screenshots, zero browser errors. Confirms the modal/scroll/mobile-nav/touch-target contract still holds after that branch's CSS/DOM changes; does **not** cover the institution-resolution screen itself (none of the 14 modes drive into it) — see [[Bank Family Directory Resolution]] for that verification boundary.

Related: [[Testing and CI Index]] · [[Connections Page]] · [[Provider Tests]] · [[Bank Family Directory Resolution]]
