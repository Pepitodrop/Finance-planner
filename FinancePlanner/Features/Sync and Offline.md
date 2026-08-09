# Sync and Offline

See [[Data and Persistence]] for the full storage model — this note is the feature-level (user-facing) view.

## Cross-device acceptance flow (`docs/CLOUD_DATA.md`)

1. Create/unlock the local vault on device A, make an edit, wait for "Cloud gespeichert."
2. Sign in on device B, create/unlock its own local vault, confirm the edit appears before making further edits.
3. Edit on device B, confirm it propagates back to device A on reload.
4. Take device A offline, edit, close/reopen the browser while offline — edit must survive in the encrypted local vault.
5. Reconnect — pending edit syncs.
6. Conflict test: take both devices offline, edit the same record differently on each, reconnect both — the conflict UI must appear, neither device's work silently lost.
7. Signing in with a different account on the same browser must get a separate vault, not the first account's data.

## Legacy migration note

The pre-0.2.0 unbound browser vault format is migrated once, automatically, after a successful password unlock, into the account-bound version-2 format. `docs/CLOUD_DATA.md` recommends keeping a backup until this one-time migration and the first cloud upload are verified — worth remembering if debugging an old-format vault issue.

## Offline behavior

Encrypted local cache persists through PostgreSQL/network outages; app shows a local/offline status and retries with bounded exponential backoff. Local changes are never discarded.

## Connectivity banner root cause (PR #131 fix)

`deploy/nginx.conf` proxied `/health/ready` to the connector but not `/health/live`; a request to `/health/live` fell through to the SPA catch-all and got `index.html` back. The browser then tried to parse that HTML as the health-check JSON, failed, and the frontend's connectivity state machine (`MobileConnectivityStatus.tsx`) permanently reported "Your device has a network connection, but Finance Planner can't reach the app service" even while the connector was actually healthy. Fix: added a matching `location = /health/live { proxy_pass http://connector:8787/health/live; ... }` block. `MobileConnectivityStatus.tsx` now also publishes its resolved status via a `finance-planner:connectivity` window event and a `data-finance-planner-connectivity` attribute on `<html>`, which `FinanceAssistant.tsx` consumes for AI routing — see [[AI System]].

Related: [[Data and Persistence]], [[Frontend]], [[AI System]]
