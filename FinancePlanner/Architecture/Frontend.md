# Frontend

Layered, feature-oriented structure (`docs/ARCHITECTURE.md`). New code must not add another unrelated module directly to the root of `src/` — root-level modules are temporary compatibility entry points during an incremental extraction, not the target shape.

```
src/
├── app/                    application bootstrap and composition
├── domain/finance/         framework-independent finance types and rules
├── features/sync/          cloud-sync UI and conflict resolution
├── infrastructure/persistence/   local vault + cloud-state adapters
├── App.tsx                 current application shell (extraction target)
├── main.tsx                minimal entrypoint
└── *.ts / *.tsx             compatibility modules awaiting extraction
```

## Dependency direction (enforced convention, not a lint rule per se)

`domain` → no React/HTTP/storage imports. `infrastructure` → may use domain + browser APIs. `features` → domain + infrastructure. `app` → composes everything. Compatibility root modules may temporarily point inward but new inner-layer modules must not import from `app`.

## Notable frontend modules

- `src/vault.ts` — browser-side encrypted vault (PBKDF2-SHA-256, 310,000 iterations, AES-256-GCM), envelope format `finance-planner-encrypted-vault`, version 2, with a one-time legacy v1→v2 migration path.
- `src/VaultGate.tsx`, `src/VaultConflict.tsx` — vault unlock and cross-device conflict UI.
- `src/infrastructure/persistence/cloudState.ts`, `storage.ts` — cloud-sync client.
- `src/aiModels.ts` — local AI model registry (`transformers-js` loader entries), dynamically imports the vendored `/vendor/transformers-3.8.1.min.js`.
- `src/bankProduction.ts` — the domain controls that `docs/bank-connection-production.md` requires be verified in the deployed environment before enabling a bank provider for real users.
- `src/backup.ts` — client-side data export (finance data only; see [[Known Issues and Limitations]] for the server-side export gap).

See [[System Architecture]] for how this fits into the whole product, and [[Data and Persistence]] for the vault/sync details.
