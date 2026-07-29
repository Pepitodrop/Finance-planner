# TODOS

## Infrastructure

### Install GnuCOBOL in CI/dev sandboxes so the COBOL engine tests actually run

**What:** 4 tests in `server/test/cobol-engine.test.js` fail with `Authoritative COBOL finance engine unavailable: spawn build/transaction-rules ENOENT` because GnuCOBOL is not installed and `build/transaction-rules` was never compiled.

**Why:** These tests cover the authoritative deterministic finance engine (signed amount normalization, balance updates, savings projections) — the one part of this app explicitly designed to never be probabilistic. Right now they silently don't run in this sandbox, so a real regression in the COBOL engine could ship undetected.

**Context:** Confirmed pre-existing via `git stash` during the `release-hardening` branch's `/ship` run on 2026-07-29 — same 4 failures on `main` before any of that branch's commits. README.md already lists GnuCOBOL as "optional ... for direct COBOL compilation" for local dev, but `.github/workflows/ci.yml` does install it and compile the binary for CI, so this is very likely CI-clean already — the gap is specifically sandboxes/containers (like this one) that don't have `apt-get`/root access to install `gnucobol`. Fix: either document that these 4 tests require `sudo apt-get install -y gnucobol && mkdir -p build && cobc -Wall -Wextra -x -o build/transaction-rules core/cobol/transaction_rules.cob` first, or make `cobol-engine.js` skip/mark-pending gracefully when the binary is missing instead of failing loudly (trade-off: could mask a real CI misconfiguration, so verify CI still compiles it first before softening the local behavior).

**Effort:** S
**Priority:** P0
**Depends on:** None

## Completed

