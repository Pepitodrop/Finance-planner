---
type: technology
domain: frontend
status: implemented
---

# React

- **Version:** React 18
- **Where used:** entire `src/` component tree, `App.tsx`/`main.tsx` bootstrap
- **Why:** component-oriented SPA; pairs with [[TypeScript]] and [[Vite]]
- **Subsystems depending on it:** [[Frontend]] entirely, every node under [[Pages Index]]
- **Known interaction pitfall:** native `autoFocus` on commit can race the app's own `MutationObserver`-based focus-management layer (`FrontendExperience.tsx`) — see [[Debugging Learnings]]
- **Tests:** Vitest + Testing Library conventions across every `*.test.tsx`

Related: [[Technology Index]] · [[Frontend]] · [[TypeScript]]
