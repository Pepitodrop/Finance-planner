---
type: database
domain: data
status: implemented
---

# oauth_nonces (table)

- **Contains:** single-use OAuth/provider-callback state values
- **Store/repository:** [[postgres-store.js]] — deletes atomically on consumption (`DELETE ... RETURNING 1`, so a nonce can't be replayed)
- **Retention:** [[retention.js]] purges expired nonces (`DELETE FROM oauth_nonces WHERE expires_at < $1`)
- **Security role:** [[OAuth State and Nonce]], [[Provider Callback Binding]]
- **Deletion:** cascaded in [[Account Deletion Flow]]

Related: [[Data Index]] · [[OAuth State and Nonce]] · [[Google OAuth Flow]]
