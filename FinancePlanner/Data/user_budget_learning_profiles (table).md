---
type: database
domain: data
status: implemented
---

# user_budget_learning_profiles (table)

- **Migration:** `007_budget_learning_profiles.sql`
- **Contains:** per-user budget-learning profile state (behavior-learning consent-gated feature)
- **Store/repository:** [[budget-profile-store.js]]
- **Consumed by:** [[budget-learning.js]], [[budget-router.js]], [[Finance Intelligence Page]]
- **Deletion:** `DELETE FROM user_budget_learning_profiles WHERE user_id=$1` — cascaded in [[Account Deletion Flow]]

Related: [[Data Index]] · [[Finance Intelligence Page]] · [[AI Consent Gate]]
