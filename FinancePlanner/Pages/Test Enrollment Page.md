---
type: page
domain: auth
status: implemented
---

# Test Enrollment Page

Non-production page allowing a reviewer/CI/QA identity to enroll a passkey for a `test:`-prefixed account without real authenticator hardware.

- **Component:** `src/TestEnrollmentPage.tsx`
- **Backend service:** [[test-enrollment.js]] — time-limited (≤60 min), single-use token
- **Scope:** explicitly non-production, paired with [[test-account-provisioning.js]] and [[test-password-auth.js]]
- **Purpose:** lets [[Production Browser Acceptance]] and CI exercise the post-login passkey UI without hardware

Related: [[Authentication]] · [[WebAuthn Passkeys]]
