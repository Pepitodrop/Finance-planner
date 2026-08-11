---
type: language
domain: frontend
status: implemented
---

# CSS

- **Where used:** `src/*.css` (`auth.css`, `assistant.css`, `post-release-fixes.css`, `runtime-surfaces/runtime-surfaces.css`, `app/app-shell.css`, `app/confirmation-dialog.css`)
- **Why real bugs happened here (durable lesson):** the passkey/vault mobile-overlap regression, the dashboard-transaction-row button-border regression, and the `.ai-result` grid-width regression were all real production defects caused by CSS specificity/cascade/`position` interactions invisible to jsdom-based unit tests — only reproducible in a real browser layout engine. See [[Debugging Learnings]].
- **Verification technique:** `elementFromPoint()` hit-testing at real interaction coordinates, not bounding-box math or a scripted-click pass — the only reliable proxy the team found for "a real tap lands correctly"

Related: [[Technology Index]] · [[Debugging Learnings]] · [[Passkey Enrolment Banner]]
