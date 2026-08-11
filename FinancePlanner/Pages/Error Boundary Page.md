---
type: page
domain: frontend
status: implemented
---

# Error Boundary (page)

Fatal-error fallback page rendered when a React render error escapes normal handling.

- **Component:** `src/ErrorBoundary.tsx`
- **Behavior:** shows a truthful, English fatal-error message; deliberately does **not** leak the raw error message or a stack trace to the user (`src/ErrorBoundary.test.tsx`)
- **Related component:** `src/AcceptanceCrashTrigger.tsx` — acceptance-fixture-only trigger to exercise this page in tests, never reachable in production (`src/AcceptanceCrashTrigger.test.tsx`)

Related: [[Frontend]] · [[Production Browser Acceptance]]
