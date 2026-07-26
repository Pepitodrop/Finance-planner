# COBOL financial core

COBOL is the authoritative language for deterministic financial rules in Finance Planner. React and TypeScript render the user interface; Node.js handles HTTPS, OAuth and provider-specific transport. Money classification, balance application, projections and future budgeting rules belong in this directory.

## Modules

### `finance_projection.cob`

Calculates an end balance from:

- starting balance in cents
- monthly income in cents
- monthly expenses in cents
- projection duration in months

### `transaction_rules.cob`

Provides the server-callable transaction rules engine:

- converts a signed provider amount into `income` or `expense`
- returns the absolute amount in integer cents
- applies income or expense transactions to an account balance
- rejects unsupported operations and invalid transaction types

No binary floating-point arithmetic is used inside the COBOL core. Provider decimal strings are converted to integer cents by the adapter before crossing the COBOL boundary.

## Compile

```bash
mkdir -p ../../build
cobc -Wall -Wextra -m finance_projection.cob
cobc -Wall -Wextra -x -o ../../build/transaction-rules transaction_rules.cob
```

## Command contract

```bash
build/transaction-rules NORMALIZE -1299
# OK|expense|1299

build/transaction-rules APPLY 100000 1299 expense
# OK|98701
```

The connector backend refuses production financial normalization when the COBOL executable is unavailable. A JavaScript fallback exists only for explicitly enabled non-production development.

Future financial features—budgets, recurring-payment schedules, savings allocation, debt plans and reconciliation—must be implemented in COBOL first and exposed through a stable process or C ABI boundary.
