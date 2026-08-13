---
type: technology
domain: frontend
status: implemented
---

# Service Worker / PWA

- **Where used:** `public/sw.js` (`SHELL_CACHE_NAME: finance-planner-shell-v7`, `RUNTIME_CACHE_NAME: finance-planner-runtime-v3`), `public/manifest.webmanifest`
- **Why:** installable offline-capable app shell on iOS/Android/desktop
- **Behavior:** precaches shell on install, prunes stale `finance-planner-*` caches on activate, bounded/trimmed runtime cache, navigation timeout fallback
- **Not touched by PR #131:** zero diff against `origin/main` at PR #131's final HEAD — verified during `/ship`
- **Related component:** `src/serviceWorkerUpdateOwnership.test.tsx`

Related: [[Technology Index]] · [[Mobile PWA Android]]
