# Finance Planner

An offline-first personal finance dashboard inspired by the original Base44 prototype, but implemented as an independent open-source application in this GitHub repository.

## Current MVP

The first implementation includes:

- Responsive React and TypeScript dashboard
- Account and balance overview
- Income and expense tracking
- New transaction form
- Local browser persistence
- Savings goals
- Recurring-payment and contract overview
- Twelve-month balance projection
- Expense-category analysis
- German `de-DE` formatting in euros
- Initial GnuCOBOL fixed-point projection module
- GitHub Actions builds for the web client and COBOL core

## Run locally

Requirements:

- Node.js 22+
- npm
- Optional: GnuCOBOL for the financial core

```bash
npm install
npm run dev
```

Open the URL printed by Vite.

Production build:

```bash
npm run build
npm run preview
```

Compile the COBOL module:

```bash
cobc -m core/cobol/finance_projection.cob
```

## Architecture

```text
src/                    React/TypeScript web MVP
core/cobol/             Deterministic fixed-point financial calculations
.github/workflows/      CI for web and COBOL
```

The current web application stores its state in `localStorage`, so it remains usable without a server after loading. The next milestone will migrate local data to encrypted SQLite and introduce Tauri for Windows, macOS, Linux, Android, and iOS packaging.

## Product principles

1. Money is represented as integer cents.
2. Financial projections are deterministic.
3. Manual offline use works without external accounts.
4. AI is advisory and never performs authoritative calculations.
5. Bank synchronization will use consent-based Open Banking APIs.
6. User data remains local by default.

## Roadmap

### Next

- Encrypted SQLite storage
- Editable accounts and savings goals
- CSV import/export
- Automatic recurring-payment inference
- Tauri desktop and mobile shell
- COBOL C ABI and native bindings

### Later

- Local Hugging Face / ONNX transaction categorization
- PSD2/Open Banking adapters
- Contract cancellation reminders
- Scenario comparison for salary, inflation, interest, and major purchases
- Encrypted backup and restore

## Security

This is an early MVP and has not undergone a formal security review. Do not use it as the sole record of important financial information.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
