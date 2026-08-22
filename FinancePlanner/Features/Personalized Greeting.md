---
type: feature
domain: dashboard
status: preserved
---

# Personalized Greeting

Finance-data cleanup does not delete authentication identity. The dashboard continues to receive the signed-in user's display name from the authenticated user object and renders a personalized greeting even when the financial state is completely empty.

This is deliberately separate from accounts, transactions, goals, provider connections, or seeded test data.

Related: [[Authentication]] · [[Empty Production Data]] · [[Dashboard Page]]
