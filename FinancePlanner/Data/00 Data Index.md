---
type: system
domain: data
status: implemented
aliases: [Data Index]
---

# Data Index

Hub for the persistence/database subgraph. 9 tables confirmed via `grep -rh "CREATE TABLE" server/migrations/*.sql` on PR #131's final HEAD (2026-08-11) — no invented tables.

## Tables
[[user_finance_state (table)]] · [[auth_store (table)]] · [[connector_connections (table)]] · [[oauth_nonces (table)]] · [[webhook_events (table)]] · [[request_rate_limits (table)]] · [[user_session_revocations (table)]] · [[user_budget_learning_profiles (table)]] · [[schema_migrations (table)]]

## Cross-cutting mechanisms
[[Optimistic Concurrency Version Check]] · [[Encryption Boundary (server)]] · [[Migrations System]]

## Correction to prior vault content
An earlier note ([[Data and Persistence]]) named the rate-limiting table `rate_limit_windows`. The actual migration-confirmed name is `request_rate_limits` (`005_request_rate_limits.sql`) — corrected here and in the source note during this graph pass.

Related: [[00 Project Index]] · [[Data and Persistence]] · [[PostgreSQL]] · [[Persistence System]]
