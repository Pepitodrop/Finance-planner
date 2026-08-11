---
type: provider
domain: provider
status: unverified
---

# GoCardless (provider)

- **Implemented:** yes — real GoCardless Bank Account Data API client, `server/src/providers.js` `GoCardlessProvider`
- **Configured:** optional (`GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`)
- **Mocked:** no
- **Server adapter:** [[providers.js]]
- **UI:** [[Connections Page]]
- **Security controls:** server-only credentials, [[Consent-State Classification]], [[Read-Only Scope Enforcement]]
- **Test coverage:** `src/bankConnection.test.ts`, `src/bankCallbacks.test.ts`, `src/bankProduction.test.ts`
- **Live verified:** no dated successful canary artifact pinned — `runtime-canaries.yml` checks control-plane access only, credential-gated
- **Provider/device verified:** no · **Production verified:** no
- **Known blocker:** no completed end-to-end consent→sync→disconnect cycle evidenced in-repo; `docs/issue-105-live-verification.md` requires a manual human step

Related: [[Providers Index]] · [[Bank Connections]] · [[Bank Connection Flow]] · [[Banking Core Module]]
