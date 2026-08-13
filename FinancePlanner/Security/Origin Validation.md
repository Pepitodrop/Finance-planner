---
type: security
domain: security
status: implemented
---

# Origin Validation

The server validates the return-URI origin before issuing a provider redirect (bank/PayPal connection setup) and before trusting an OAuth callback — prevents an attacker-supplied redirect target from being honored.

Related: [[Security Index]] · [[Bank Connection Flow]] · [[OAuth State and Nonce]]
