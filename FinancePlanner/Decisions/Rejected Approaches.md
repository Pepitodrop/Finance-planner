# Rejected / Deliberately Deferred Approaches

Approaches explicitly not taken, and the stated reason, sourced from `TODOS.md` and repo docs. These are deferrals with recorded rationale, not necessarily permanent rejections — check `TODOS.md` for current status before assuming one is still open.

---

**Not done:** Softening `cobol-engine.js` to skip/mark-pending gracefully when the compiled binary is missing, instead of failing loudly.
**Why deferred:** would fix the local-sandbox `ENOENT` annoyance, but risks masking a genuine CI misconfiguration if CI ever stopped compiling the binary — the fail-loud behavior is a deliberate safety property for the one part of the app "explicitly designed to never be probabilistic." (`TODOS.md`)
**Related:** [[COBOL Domain Core]], [[Known Issues and Limitations]]

---

**Not done:** Route-level code splitting for the ~992 kB single JS bundle.
**Why deferred:** real perf issue on constrained mobile connections, but judged a risky wide-reaching refactor not worth doing inside an unrelated hardening pass. (`TODOS.md`, Priority P2)
**Related:** [[Known Issues and Limitations]]

---

**Not done:** Upgrading `vitest` off its bundled vulnerable `esbuild`/`vite` dev toolchain (5 audit findings, dev-only).
**Why deferred:** requires a breaking `vitest@4.x` major-version jump; the vulnerabilities are confined to the local dev server and don't affect `npm audit --omit=dev` (production dependencies) or the built app served to users. Not attempted to avoid destabilizing the test suite. (`TODOS.md`, Priority P3)

---

**Not done:** Server-side full GDPR-style data export (only account *deletion* is complete end-to-end; export is client-side-only, missing session-revocation records and connector metadata).
**Why deferred:** scoped as new feature surface (new authenticated endpoint, full server-side data inventory, tests) rather than a hardening fix to something existing — judged to deserve its own follow-up rather than being bundled in. (`TODOS.md`, Priority P2)
**Related:** [[Known Issues and Limitations]]

---

**Not done:** Wiring a real Alertmanager paging receiver (`ops/monitoring/alertmanager.yml` ships only a stub `default` receiver).
**Why deferred:** genuinely requires an operator-supplied real destination (Slack/PagerDuty/webhook) that doesn't exist in this repository — there's nothing to build here without fabricating a fake destination. Left for whoever owns the actual production deployment. (`TODOS.md`, Priority P1, depends on an external operator input)
**Related:** [[Deployment]]

---

**Not done (yet):** `finapi` as a real GoCardless/PayPal alternative provider.
**Why deferred:** `server/src/providers.js` registers `finapi` as an explicit "unavailable" placeholder specifically so a real adapter can be added later without touching the deterministic banking-domain rules — a deliberate extension point, not an oversight. (`docs/OPEN_BANKING_ARCHITECTURE.md`)
**Related:** [[Bank Connections]], [[Provider Status]]

---

**Not done:** Treating a passing readiness test as equivalent to a `verified` production-readiness gate.
**Why rejected:** `config/production-readiness-evidence.json`'s `distributedRateLimiting` gate was corrected from `pending` to `partial` (not `verified`) on 2026-08-03 specifically because `verified` requires a named, accountable human `approvedBy`/`reviewedAt` that no one had actually recorded — "claiming it here would trade one inaccuracy for another." This is a repo-wide convention worth respecting when writing any future readiness claim, including in this vault. (`TODOS.md`)
**Related:** [[Backend]], [[Provider Status]], [[Memory System]]

---

**Tried, then reverted:** falling back to a same-tab redirect / the Enable Banking embedded widget when a provider-authorization popup is blocked or the browser can't create the tab-local return binding.
**Why rejected:** [[Provider Authorization Popup Bridge]] exists specifically because a same-tab provider redirect unloads the SPA and destroys Finance Planner's memory-only, non-extractable vault decryption key, forcing an unwanted re-unlock. An early version of `startConnector()` (`src/connectors.ts`) caught `beginConnectorPopupAttempt()`'s failure and fell through into exactly that same-tab/embedded-widget path — reasonable-looking as a UX nicety ("don't just fail, degrade gracefully"), but it silently recreated the precise regression the whole bridge was built to prevent, for the one population of users most likely to hit it (anyone with a popup blocker). Caught by a PR #154 review comment before merge, not by a test — none of the existing tests asserted that this path *shouldn't* navigate. Fixed by removing the fallback entirely outside `VITE_ACCEPTANCE_FIXTURES=true`: a blocked popup or failed storage binding is now a fail-closed, retryable start failure (rejects before `/start` is ever called, before any provider nonce exists, before the tab is touched), never a silent degrade. (PR #154, 2026-08-25)
**Related:** [[Provider Authorization Popup Bridge]], [[Bank Connection Flow]], [[Connections Page]], [[Provider Callback Binding]]

Related: [[Architecture Decisions]] · [[Security Decisions]]
