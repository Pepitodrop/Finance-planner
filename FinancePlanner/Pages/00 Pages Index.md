---
type: page
domain: frontend
status: implemented
aliases: [Pages Index]
---

# Pages Index

Hub for every distinct navigable view in Finance Planner. Each page note links to its route/destination, owning React component, feature, APIs, storage, and tests. Discovered from `src/app/navigation.ts` (the 12 authenticated primary/secondary destinations) plus the pre-authentication/vault/error screens that exist outside that navigation model.

## Pre-authentication / bootstrap
[[Login and Registration]] · [[Authentication Loading]] · [[Vault Setup]] · [[Vault Unlock]] · [[Passkey Enrolment Banner]] · [[Vault Conflict Page]] · [[Test Enrollment Page]] · [[Error Boundary Page]]

## Primary navigation (post-login)
[[Dashboard Page]] · [[Transactions Page]] · [[Accounts Page]] · [[Goals Page]] · [[Recurring Payments Page]]

## Secondary navigation ("More" sheet)
[[Connections Page]] · [[Subscriptions Page]] · [[Finance Intelligence Page]] · [[Finance Assistant Page]] · [[Receipt Review Page]] · [[Data and Backup Page]] · [[Account Page]]

## Cross-cutting states
Every page can additionally render an offline/degraded banner ([[Sync and Offline]] / [[MobileConnectivityStatus.tsx]]) and provider-unavailable states inside [[Connections Page]] and [[Subscriptions Page]] rather than as separate routes.

Related: [[00 Project Index]] · [[Flows Index]] · [[Frontend]] · [[App.tsx]]
