# Whole-finance reset

Finance Planner keeps encrypted financial state both in the browser vault and in PostgreSQL. Deleting `user_finance_state` rows directly is **not** a safe reset: when a signed-in device still has a valid encrypted local vault, a missing server row is interpreted as “no cloud copy exists yet” and the local vault may be uploaded again.

For an operator-requested clean baseline, use the confirmation-gated maintenance reset instead. It preserves Finance Planner authentication identities, passkeys, schema history, rate-limit state, and session-security infrastructure. For every preserved account it publishes a new encrypted empty cloud finance state with a higher version, then clears local provider/setup/learning records.

The command does not contact external providers and therefore does not claim to revoke provider-side sessions or consents.

## Deployed Docker environment

Create and verify a PostgreSQL backup first. Then run:

```bash
FINANCE_DATA_RESET_CONFIRM=CLEAR_ALL_FINANCE_DATA \
  docker compose --env-file .env exec -T \
  -e FINANCE_DATA_RESET_CONFIRM=CLEAR_ALL_FINANCE_DATA \
  connector node scripts/clear-all-finance-data.mjs
```

After the command succeeds, reload/unlock each device. A device with clean sync metadata will receive the newer encrypted empty server state instead of recreating the deleted cloud row.

Expected financial/provider baseline after devices have reloaded:

- every `user_finance_state` row decrypts to empty `accounts`, `transactions`, and `goals`;
- `connector_connections` has no local connections;
- `oauth_nonces` has no pending connection setup;
- `user_budget_learning_profiles` is empty;
- `webhook_events` is empty.

`auth_store`, `schema_migrations`, `user_session_revocations`, and `request_rate_limits` are infrastructure/security data and are intentionally preserved.
