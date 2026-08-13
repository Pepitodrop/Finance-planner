---
type: test
domain: provider
status: implemented
---

# Provider Tests

- `src/bankConnection.test.ts`, `src/bankCallbacks.test.ts`, `src/bankProduction.test.ts`, `src/bankWebhook.test.ts`, `src/bankWebhookHttp.test.ts`, `src/bankRuntime.test.ts`, `src/institutions.test.ts`
- `src/googleSubscriptions.test.ts`, `src/googleSubscriptionsClient.test.ts`
- `src/features/connections/connectionsModel.test.ts`
- **Control-plane canary:** `scripts/provider-runtime-canary.mjs` (`npm run test:providers:runtime`) — GoCardless/PayPal control-plane check, credential-gated

Related: [[Testing and CI Index]] · [[Providers Index]] · [[Connections Acceptance]]
