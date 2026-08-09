# Debugging Learnings

Durable investigation techniques and pitfalls found via git history, not routine bug-fix detail.

## Real defects only surface via real-browser acceptance testing, not just unit tests

The Step 12 (Finance Intelligence) browser-acceptance work (git log around `0b3e790`..`75cd53c`, early Aug 2026) found several real, previously-shipped defects that unit tests had missed entirely: a legacy stylesheet still styling three pages after a redesign, interactive controls under the 44px touch-target minimum, an `AiPanel` progress fixture that never actually showed the progress screen, a `forced-colors` button border that used `:where()` and so never won the cascade. Pattern: when a redesign/consolidation lands, a real headless-browser acceptance pass over the actual rendered pages catches classes of defect (CSS specificity, cascade order, fixture wiring) that component-level unit tests structurally cannot.

## When a UI element visually overflows, measure before guessing

`.ai-result` grid column widths were fixed by *dumping actual measured column widths* (`846c82e "Diag: dump exact .ai-result column widths instead of guessing further"`) rather than iterating by trial-and-error CSS changes. The commit sequence (`837c825` → `846c82e` → `550fd50` → `752e5b9` → `88fcc7e`) shows two earlier attempted fixes that didn't fully work before the diagnostic-measurement step was added — worth reaching for a measurement/diagnostic step early rather than after repeated guesses.

## `autoFocus` timing can break focus-restoration logic silently

Accessibility test-writing (2026-08-02, `TODOS.md` "Completed" section) found that a transaction dialog's native `autoFocus` on an input fired *before* the app's own `MutationObserver`-based focus-management code (`FrontendExperience.tsx`) got a chance to capture the true trigger element as `previousFocus`. Result: closing the dialog tried to restore focus to a node that had been replaced, and silently fell back to `<body>` — no error, no visible symptom outside actual screen-reader/keyboard use. Lesson: React's synchronous `autoFocus` on commit can race a `MutationObserver`-based enhancement layer; prefer letting the enhancement layer own initial focus rather than mixing in native `autoFocus`.

## Acceptance-script flakiness is sometimes deterministic, not timing

`16a8d3f "Diagnose: retrying didn't help -- this is deterministic, need to see the hook itself"` — a useful reminder that when retrying/waiting-longer doesn't fix a flaky-looking acceptance-test failure, the next step is to inspect the actual hook/state machine involved rather than adding more retries, because the failure may be a real, repeatable state-ordering bug (in this case, a vault-conflict dialog recurring instead of being one-shot, `019e38c`).

## String-matching test assertions can flag their own expected output

Two separate incidents (`af8ab83` "fraud-language check flagged its own required denial sentence", `69ebae3` "AUTO confidence check flagged the briefing's own real percentages") — a substring/regex check meant to detect a *bad* pattern in rendered text ended up matching the deliberately-present correct text that happens to contain a similar substring. Worth double-checking that a text-pattern assertion can't self-match the correct/expected content before trusting a "found a bug" result from it.

Related: [[Known Issues and Limitations]], [[Engineering/Commands and Tests|Commands and Tests]]
