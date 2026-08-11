---
type: technology
domain: frontend
status: implemented
---

# Vite

- **Where used:** dev server (`npm run dev`) and production build (`vite build`, chained after `tsc -b` in `npm run build`)
- **Why:** fast dev server + production bundler for the [[React]]/[[TypeScript]] frontend
- **Build output:** served by [[Nginx]] in production (`Dockerfile.web`)
- **Test runner:** Vitest (same Vite toolchain) powers the frontend `*.test.ts`/`*.test.tsx` suite (432/432 passing as of PR #131's final HEAD)
- **Known limitation:** `vitest@2.1.9`'s bundled dev toolchain has known CVEs — dev-server only, `npm audit --omit=dev` is clean; deferred, needs a `vitest@4.x` major bump ([[Known Issues and Limitations]])

Related: [[Technology Index]] · [[Frontend]] · [[React]]
