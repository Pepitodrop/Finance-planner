---
type: security
domain: security
status: implemented
---

# User-Enumeration Mitigation

Two independent fixes, both fixed 2026-08-02/2026-08-10:

1. **Passkey authentication-options endpoint** always returns a real challenge with HTTP 200 regardless of whether the email matches a known account (previously threw, leaking account existence).
2. **Password login timing** — see [[Timing-Safe Password Verification]].

Related: [[Security Index]] · [[Timing-Safe Password Verification]] · [[Security Decisions]]
