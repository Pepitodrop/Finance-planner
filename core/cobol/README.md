# COBOL financial core

This directory contains deterministic fixed-point financial calculations.

The first module, `finance_projection.cob`, calculates an end balance from:

- starting balance in cents
- monthly income in cents
- monthly expenses in cents
- projection duration in months

No binary floating-point arithmetic is used for money.

Compile with GnuCOBOL:

```bash
cobc -m finance_projection.cob
```

The web MVP currently mirrors this logic in TypeScript. The next native milestone will expose the compiled module through a stable C ABI for Tauri desktop and mobile builds.
