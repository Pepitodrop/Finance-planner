# Finance Planner

An offline-first, cross-platform personal finance dashboard for tracking income, expenses, savings goals, recurring payments, contracts, and long-term financial projections.

The project is designed to use **COBOL as the primary financial calculation language**, while modern platform layers provide the web, mobile, desktop, banking, and AI integrations.

## Vision

Finance Planner should help users understand their current financial position, identify recurring obligations, create realistic savings plans, and model future scenarios without requiring their private financial data to be uploaded to a cloud service.

## Planned capabilities

- Income and expense tracking
- Account and net-worth overview
- Monthly and annual cash-flow projections
- Savings goals and emergency-fund planning
- Recurring-payment detection
- Subscription and contract overview
- Upcoming-payment calendar
- Scenario planning for salary, inflation, interest, and major purchases
- CSV, CAMT, and MT940 imports
- Optional consent-based bank synchronization
- Local AI-assisted transaction categorization
- Merchant normalization and anomaly detection
- Encrypted local storage, backup, export, and restore
- Web, Android, iOS, Windows, macOS, and Linux clients

## Architecture

```text
core/
  cobol/          Deterministic financial calculations and projections
  ffi/            Stable interface around the COBOL modules

apps/
  client/         Shared cross-platform user interface

services/
  bank-sync/      Optional PSD2/Open Banking adapters
  ai/             Local model inference and evaluation

packages/
  domain/         Shared schemas, validation, money, and date types

infra/
  CI, packaging, signing, containers, and release automation

docs/
  Architecture decisions, privacy model, threat model, and model cards
```

## Technology direction

### Financial core

The financial engine should be implemented with **GnuCOBOL** and fixed-point decimal arithmetic. COBOL owns deterministic rules such as:

- Income and expense aggregation
- Savings schedules
- Cash-flow forecasts
- Net-worth projections
- Debt repayment calculations
- Interest and inflation scenarios

Binary floating-point values must not be used for monetary calculations.

### Cross-platform application

The current product prototype is built with Base44. The longer-term client architecture should support:

- Web dashboard
- Android and iOS applications
- Windows, macOS, and Linux desktop applications
- Offline-first local operation

A shared React/TypeScript application with a native wrapper such as Tauri is the preferred direction where Base44 alone cannot provide native or offline capabilities.

### Local AI

AI is advisory and must not replace deterministic financial logic. Suitable uses include:

- Transaction categorization
- Merchant recognition
- Recurring-payment and contract detection
- Duplicate-payment warnings
- Unusual-spending flags
- Human-readable explanations

Models should be open source, run locally where practical, expose confidence scores, and always allow user corrections.

### Banking

Bank synchronization must use consent-based PSD2/Open Banking integrations. The application must never scrape or store online-banking passwords.

Offline manual use remains fully functional. Bank synchronization is an optional online operation, after which downloaded data remains locally available.

## Core design principles

1. COBOL owns financial calculations and projection rules.
2. Money uses fixed-point decimal representations.
3. Manual offline use remains available without bank or AI services.
4. Financial data is private and local by default.
5. AI output is explainable, confidence-scored, and correctable.
6. Bank and AI providers are replaceable adapters.
7. User-entered corrections override automated predictions.
8. Security, exportability, and recoverability are first-class requirements.

## Initial roadmap

### Phase 1 — Foundation

- Define the domain model
- Establish the repository structure
- Add CI and coding standards
- Implement encrypted local storage
- Document the privacy and threat models

### Phase 2 — Finance MVP

- Accounts and balances
- Income and expense tracking
- Categories and budgets
- Savings goals
- Twelve-month cash-flow projection
- CSV import and export

### Phase 3 — Intelligence

- Recurring-payment detection
- Subscription and contract overview
- Local transaction categorization
- Merchant correction rules
- Duplicate and anomaly detection

### Phase 4 — Banking

- Provider-neutral banking interface
- Mock connector
- PSD2 sandbox integration
- OAuth consent flow
- Balance and transaction synchronization
- Pending and booked transaction reconciliation

### Phase 5 — Distribution

- Mobile and desktop packaging
- Encrypted backup and restore
- Signed installers
- Automated releases
- Security review
- Version 1.0 release

## Current status

- Base44 prototype exists
- Product architecture and implementation backlog are being defined
- GitHub repository initialization is in progress
- COBOL engine and native clients are not yet implemented

## Development

Development instructions will be added after the initial project structure and build tooling are committed.

## Security notice

This project is intended to process sensitive financial data. Until a formal security review has been completed, it must not be treated as production-ready financial software.

## License

No license has been selected yet. Until a license file is added, all rights are reserved by the repository owner.
