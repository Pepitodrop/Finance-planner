BEGIN;

-- Fixes a concurrent-duplicate-callback race found live (2026-08-25, Mock
-- ASPSP run against PR #154): consumePendingConnectionSetup() previously
-- DELETEd the nonce row before completeCallback() (the provider network
-- exchange) and finalizeConnection() ran, so a second delivery of the same
-- signed callback arriving in that window saw the nonce as gone, found no
-- finalized connection yet either, and was rejected as invalid_state --
-- even though the first delivery went on to finalize successfully moments
-- later. claim_token turns nonce consumption into a claim (mark-in-place,
-- exactly-once) instead of an immediate delete: a concurrent duplicate can
-- now see "this exact verified attempt is already claimed" from shared
-- Postgres state and wait for/observe the claimer's outcome, rather than
-- being told the attempt never existed. The row is still deleted -- just
-- after finalizeConnection() (success) or after the failure path (unchanged
-- from before), not before the network call. See server.js's callback
-- route and postgres-store.js/crypto-store.js's claimPendingConnectionSetup().
ALTER TABLE oauth_nonces ADD COLUMN IF NOT EXISTS claim_token text;

INSERT INTO schema_migrations (version) VALUES (10) ON CONFLICT DO NOTHING;
COMMIT;
