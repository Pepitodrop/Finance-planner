# Finance Planner reset modes

Finance Planner keeps encrypted financial state both in the browser vault and in PostgreSQL. Deleting `user_finance_state` rows directly is **not** a safe reset: when a signed-in device still has a valid encrypted local vault, a missing server row is interpreted as “no cloud copy exists yet” and the local vault may be uploaded again.

Two explicit operator reset modes exist. Neither command contacts external financial providers, so neither claims to revoke provider-side sessions or consents.

## Financial reset — keep Finance Planner accounts

Use this when authentication identities/passkeys should remain but all Finance Planner financial/provider state should become empty. The command publishes a newer encrypted empty cloud state for every preserved account rather than deleting the cloud row, then clears local provider/setup/learning records.

Create and verify a PostgreSQL backup first. Then run:

```bash
docker compose --env-file .env exec -T \
  -e FINANCE_DATA_RESET_CONFIRM=CLEAR_ALL_FINANCE_DATA \
  connector node scripts/clear-all-finance-data.mjs
```

After the command succeeds, reload/unlock each device. A device with clean sync metadata will receive the newer encrypted empty server state instead of recreating a deleted cloud row.

Expected baseline:

- every `user_finance_state` row decrypts to empty `accounts`, `transactions`, and `goals`;
- `connector_connections` is empty;
- `oauth_nonces` is empty;
- `user_budget_learning_profiles` is empty;
- `webhook_events` is empty;
- `auth_store`, `schema_migrations`, `user_session_revocations`, and `request_rate_limits` remain available.

## Factory reset — delete every Finance Planner account and all application data

Use this only when the installation should return to a first-run state with **zero Finance Planner user accounts and zero persisted application/user data**. The schema migration ledger is preserved so the database structure remains valid.

The factory reset clears:

- `auth_store`;
- `user_finance_state`;
- `user_budget_learning_profiles`;
- `connector_connections`;
- `oauth_nonces`;
- `webhook_events`;
- `user_session_revocations`;
- `request_rate_limits`;
- obsolete encrypted file-store copies in the connector data volume.

It intentionally preserves only `schema_migrations` and the PostgreSQL schema itself.

Create and verify a PostgreSQL backup first. Close Finance Planner tabs, then run:

```bash
docker compose --env-file .env exec -T \
  -e FACTORY_RESET_CONFIRM=DELETE_ALL_FINANCE_PLANNER_DATA \
  connector node scripts/factory-reset.mjs
```

The command returns `verifiedEmpty: true` only after all application-data tables have been checked to contain zero rows. It also returns `connectorRestartRequired: true` because the running connector keeps authentication data in memory until restart.

Restart the connector immediately afterward:

```bash
docker compose --env-file .env restart connector
```

Then clear the Finance Planner site's browser data on every browser/device used before the factory reset. Browser-local encrypted vaults and cookies are intentionally not remotely deletable by the server. If site data is not cleared and the same identity signs in again later, its account-bound local encrypted vault can still exist on that device.

After the factory reset + connector restart + browser site-data clear, opening Finance Planner must show the sign-in/registration screen, not `Unlock Finance Planner`.

### Important limitations

- The factory reset is refused when `AUTH_MODE=local` because local-auth startup automatically recreates its configured local account.
- External bank/PayPal/provider sessions or consents are not contacted or revoked by this command.
- A factory reset is destructive. Restore requires a verified pre-reset PostgreSQL backup plus any separately backed-up browser-local vault data.
