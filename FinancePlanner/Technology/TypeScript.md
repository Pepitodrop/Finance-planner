---
type: language
domain: frontend
status: implemented
---

# TypeScript

- **Where used:** entire `src/` frontend (`.ts`/`.tsx`), compiled via `tsc -b --noEmit` (typecheck) then bundled by [[Vite]]
- **Why:** static typing across the domain/finance layer, feature modules, and component tree; enforced by `npm run build` (`tsc -b && vite build`) and CI's `web` job
- **Subsystems depending on it:** [[Frontend]] entirely; [[domain/finance/types.ts]] is the framework-independent core type layer
- **Tests covering it:** every `*.test.ts`/`*.test.tsx` (Vitest)
- **Decisions:** dependency-direction rules (`domain` → no React/HTTP/storage imports) are TypeScript-module-boundary conventions, not a lint rule per se

Related: [[Technology Index]] · [[Frontend]] · [[React]]
