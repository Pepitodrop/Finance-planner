---
type: page
domain: ai
status: implemented
---

# Finance Intelligence (page)

Secondary nav, "Intelligence" group (`id: 'ai'`). Automated categorization, budget intelligence, smart briefings — distinct from the conversational [[Finance Assistant Page]].

- **Related components/logic:** `src/AutomaticTransactionAnalysis.tsx`/`.ts`, `src/smartBriefing.ts`, `src/smartness.ts`, `src/graphIntelligence.ts`, `src/IntelligenceBadge.tsx`, `src/budgetPlan.ts`, `src/LearningBudgetPlanner.tsx`
- **Models used:** [[Model semantic-multilingual]] (categorization, startup-loaded), [[Model graph-rag]] (behavior-graph retrieval)
- **Backend:** [[budget-router.js]], [[budget-learning.js]], [[behavior-learning.js]], [[behavior-intelligence.js]]
- **Fixed in PR #131:** its own "Manual entry" button had been hidden by an overly broad CSS rule meant for unrelated pages ([[Debugging Learnings]])
- **Related tests:** `src/smartness.test.ts`, `src/smartnessBank.test.ts`, `src/graphIntelligence.test.ts`, [[Finance Intelligence Acceptance]]

Related: [[AI System]] · [[Finance Assistant Page]] · [[AI Index]]
