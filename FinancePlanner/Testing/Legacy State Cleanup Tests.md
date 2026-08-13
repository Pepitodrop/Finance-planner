---
type: test
domain: data
status: implemented
---

# Legacy State Cleanup Tests

`src/data.test.ts` (11 tests, fresh-confirmed 2026-08-11 `/ship`) — regression coverage for [[isLegacyDemoState]]/[[removeLegacyDemoState]]: edited/removed/replaced/extra-transaction cases, edited/extra-account cases. Any deviation from the exact canonical starter dataset must block automatic cleanup.

- **Why this test class exists:** a real data-loss bug was found and fixed here (PR #131 final review) — see [[Debugging Learnings]]

Related: [[Testing and CI Index]] · [[Legacy-Demo-State Cleanup]] · [[data.ts]]
