# Bank connection production gate

This document is the deployment contract for PSD2/open-banking and PayPal connectors. A provider must not be enabled for real users until every critical control in `src/bankProduction.ts` is verified in the deployed environment.

## Security and consent

- Store access and refresh tokens only in a server-side encrypted secret store. Use envelope encryption with a managed KMS key; never return provider tokens to the browser or logs.
- Separate encryption-key permissions from application database permissions and test key rotation without forcing users to reconnect.
- Validate OAuth `state`, bind it to the authenticated session, expire it after ten minutes, and allow only registered HTTPS redirect URIs.
- Request only account, balance, and transaction scopes needed by the product. Record consent creation, renewal, expiry, and revocation.
- Stop synchronization immediately after revocation or expiry. Notify the user before renewal is required.

## Synchronization correctness

- Persist the provider cursor and imported records in one transaction. Advance the cursor only after every page is durably stored.
- Reject a cursor that does not advance, a completed response that still exposes a continuation cursor, or a sync exceeding the page safety limit.
- Use provider transaction identifiers as the primary idempotency key and a content fingerprint as a secondary duplicate defense.
- Reconcile opening balance plus signed movements against the provider closing balance. Quarantine mismatched batches instead of silently importing them.
- Treat pending transactions separately and reconcile them when they become booked.

## Failure recovery

- Retry only transient failures: timeouts, connection resets, HTTP 429, and provider 5xx responses.
- Honor `Retry-After`; otherwise use bounded exponential backoff with jitter. Stop after six attempts and move the sync to an operator-visible dead-letter state.
- Do not retry invalid consent, authentication, schema, signature, or reconciliation failures automatically.
- Make every sync resumable from the last committed cursor and safe to execute more than once.

## Webhooks

- Verify the provider signature over the exact raw request body before parsing it.
- Require an event identifier and timestamp. Reject future events, events outside the five-minute replay window, and previously processed event identifiers.
- Store the event identifier atomically with the resulting job so concurrent deliveries cannot enqueue duplicate work.
- Rotate webhook secrets with an overlap window and audit every rejected signature without logging payload secrets.

## Observability and operations

Required metrics:

- successful and failed syncs by provider and reason;
- end-to-end sync latency and provider API latency;
- imported, duplicate, rejected, pending, and reconciled transaction counts;
- consent expirations due within 30, 7, and 1 day;
- retry attempts, dead-letter jobs, webhook signature failures, and replay rejections.

Page an operator for sustained provider failure, reconciliation mismatches, token-decryption failures, abnormal webhook rejection rates, or a growing dead-letter queue. Maintain runbooks for provider outage, credential compromise, encryption-key rotation, bad-import rollback, and user-data deletion.

## Privacy and retention

- Define retention periods for provider payloads, normalized transactions, audit events, and dead-letter records.
- Minimize stored raw payloads and redact account identifiers, IBANs, names, tokens, and payment references from logs.
- Implement account disconnect and user deletion as auditable workflows that revoke provider consent and remove locally retained bank data.

## Release evidence

Before production activation, attach evidence for:

1. provider sandbox end-to-end connect, callback, paginated sync, webhook, renewal, revocation, and reconnect;
2. duplicate delivery and duplicate sync tests;
3. transient failure, rate-limit, and dead-letter recovery tests;
4. balance-reconciliation and rollback tests;
5. penetration testing of OAuth callback, token storage, webhook verification, and authorization boundaries;
6. alert delivery and incident-runbook exercises;
7. data deletion and retention verification.

Passing unit tests proves the domain controls behave correctly. It does not replace deployment evidence, provider certification, security review, or sandbox end-to-end results.
