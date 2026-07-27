# Bank connection production runbook

## Required secrets

- Store provider client secrets, OAuth state HMAC keys, webhook HMAC keys, and token-encryption keys in a managed KMS or secret manager.
- Grant decrypt/sign access only to the bank callback, sync worker, and webhook worker identities that require it.
- Rotate token-encryption keys by retaining previous decrypt-only keys until all stored ciphertext has been re-encrypted.

## OAuth callback

1. Verify the signed state against the authenticated user, provider, and exact registered redirect URI.
2. Atomically consume the state nonce before exchanging or loading provider credentials.
3. Reject unknown, expired, reused, or consent-mismatched state.
4. Record callback success/failure counters and latency without logging tokens or authorization codes.

## Webhooks

1. Verify the signature over the raw request body before JSON parsing.
2. Enforce the event timestamp replay window.
3. Atomically claim an event with a processing lease.
4. Mark the event complete only after the handler succeeds.
5. Release the lease after recoverable failure so provider redelivery can retry.

## Alerts

Alert on sustained callback failures, webhook signature failures, sync failures, refresh-token failures, reconciliation failures, cursor conflicts, consent expiry, and provider latency. Never include credentials or raw bank payloads in logs or alert labels.

## Incident response

- Provider credential exposure: disable the credential, rotate it, revoke affected requisitions where required, and inspect audit records.
- Token-encryption key exposure: introduce a new active key, re-encrypt stored tokens, retire the compromised key, and force reconnection where ciphertext integrity cannot be established.
- Webhook secret exposure: rotate the secret with a bounded overlap window and reject the retired version after provider confirmation.
- Reconciliation failure: quarantine the page, preserve the previous cursor, and investigate before retrying.

## Release evidence

Before enabling real institutions, capture a successful provider sandbox flow covering authorization, callback replay rejection, token refresh, paginated transaction sync, webhook duplicate delivery, reconciliation quarantine, disconnect/revoke, and observability checks.
