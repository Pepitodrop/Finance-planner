---
type: language
domain: frontend
status: implemented
---

# HTML

- **Where used:** React-rendered markup throughout [[Frontend]]; `public/manifest.webmanifest` and the static shell served by [[Nginx]]
- **Why:** standard rendering target for the React SPA; semantic structure specifically matters for the accessibility tests (`src/appAccessibility.test.tsx` — skip links, landmark regions, focus trapping)
- **Tests covering it:** `src/appAccessibility.test.tsx` (axe violations, landmark structure)

Related: [[Technology Index]] · [[React]] · [[CSS]]
