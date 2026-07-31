# Cloud data and cross-device access

## Canonical data stores

| Data | Canonical persistence | Encryption |
|---|---|---|
| Accounts, balances, transactions and savings goals | PostgreSQL `user_finance_state` | AES-256-GCM application envelope using `CONNECTOR_MASTER_KEY` |
| Behavior graph, assistant memory and secure client preferences | Included in the same per-user vault document | AES-256-GCM application envelope |
| Google user profile, passkeys and temporary WebAuthn challenges | PostgreSQL `auth_store` | AES-256-GCM application envelope using `AUTH_MASTER_KEY` or the connector-key fallback |
| Bank and PayPal provider credentials | PostgreSQL `connector_connections` | Existing encrypted provider payload |
| Webhook idempotency and distributed rate limits | PostgreSQL operational tables | Database access controls; no financial descriptions stored |
| Browser copy | Local encrypted vault | PBKDF2-SHA-256 + AES-256-GCM with the device vault password |

PostgreSQL is the canonical cross-device store. Browser storage is an encrypted offline cache, not the only copy.

## Synchronization lifecycle

1. The user authenticates with Google or a registered passkey.
2. The user unlocks or creates the local encrypted vault.
3. The client requests `GET /api/finance/state` with the authenticated session cookie.
4. If a server document exists, it replaces the local cache before the main application mounts.
5. If no server document exists, the current local vault is uploaded as version 1.
6. Later state and secure-data changes are debounced and sent to `POST /api/finance/state`.
7. Every write includes `expectedVersion`. PostgreSQL updates only when it matches the current version.
8. A version conflict is shown to the user and never silently overwrites either copy.

## API contract

```http
GET /api/finance/state
```

```json
{
  "payload": {
    "state": {
      "accounts": [],
      "transactions": [],
      "goals": []
    },
    "secureData": {}
  },
  "version": 4,
  "updatedAt": "2026-07-31T10:00:00.000Z"
}
```

```http
POST /api/finance/state
Content-Type: application/json
```

```json
{
  "payload": {
    "state": {
      "accounts": [],
      "transactions": [],
      "goals": []
    },
    "secureData": {}
  },
  "expectedVersion": 4
}
```

The endpoint rejects unknown fields, malformed IDs, invalid dates, non-integer money, duplicate IDs, transactions referencing missing accounts, excessive payloads and non-JSON secure values.

## Production configuration

Required:

```dotenv
CONNECTOR_STORE_DRIVER=postgres
DATABASE_URL=postgresql://...
CONNECTOR_MASTER_KEY=<independent high-entropy secret>
AUTH_MASTER_KEY=<another independent high-entropy secret>
```

`compose.yaml` constructs `DATABASE_URL` and runs migrations during connector startup. Migration `006_cloud_user_data.sql` creates the cross-device tables.

## Verification

After deployment:

```bash
docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT version FROM schema_migrations ORDER BY version;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT user_id, version, updated_at FROM user_finance_state;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT id, updated_at FROM auth_store;"
```

The encrypted payload columns must not contain readable merchant descriptions or passkey public data when inspected as text.

## Cross-device acceptance test

1. On device A, create a clearly named temporary transaction.
2. Wait for the **Cloud gespeichert** indicator.
3. Sign in with the same account on device B.
4. Create or unlock its local vault.
5. Confirm the transaction appears before making edits.
6. Edit the transaction on device B and wait for synchronization.
7. Reload device A and confirm the edit appears.
8. Make authentication data. The edits on both devices and confirm the conflict UI appears instead of silent data loss.

## Backups

The PostgreSQL dump is now the primary user-data backup. It must be backed up and restored together with both encryption keys. Losing `CONNECTOR_MASTER_KEY` makes finance and provider payloads unrecoverable. Losing `AUTH_MASTER_KEY` makes the authentication store unrecoverable.
