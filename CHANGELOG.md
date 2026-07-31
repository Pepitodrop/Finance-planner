# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-07-31

### Added
- Installable Android Trusted Web Activity project with package ID
  `de.luisbenedikt.financeplanner`.
- Android 16 / API 36 build targeting Android 6 and newer, including launcher
  icon, splash screen, app links and finance shortcuts.
- GitHub Actions build that compiles, lints and signature-verifies an installable
  debug APK on every relevant change.
- Optional signed release APK and Play App Bundle generation from protected
  GitHub Actions signing secrets.
- Digital Asset Links generation and a dedicated production endpoint for
  verified fullscreen TWA operation.
- Android build, signing, direct-installation, Google Play and physical-device
  acceptance documentation.

### Changed
- Android is now a first-class delivery target rather than only an installable
  browser PWA.
- The Android shell uses the normal browser origin so Google OAuth, passkeys,
  encrypted browser storage and PostgreSQL cloud synchronization use the same
  account as the web application.
- CI and repository architecture checks now include the native Android project.

### Security
- The Android package forbids cleartext traffic, disables Android backup and
  device-transfer backup, requests only internet access, and avoids an embedded
  WebView.
- Production signing material remains outside source control and the repository
  refuses to publish a placeholder Digital Asset Links certificate.

## [0.2.0] - 2026-07-31

### Added
- Authenticated, versioned cloud-state endpoints for the complete finance vault.
- Application-encrypted PostgreSQL persistence for accounts, transactions,
  savings goals, behavior-learning data, assistant memory and secure client
  preferences.
- PostgreSQL persistence for Google profiles, passkeys and WebAuthn challenges,
  including migration from the previous encrypted file and safe encryption-key
  rotation.
- Cross-device synchronization status, offline retry handling and explicit
  conflict resolution without silent last-write-wins data loss.
- PostgreSQL integration coverage proving encrypted state round-trips,
  per-user ciphertext binding and optimistic concurrency.
- Layered frontend directories for app composition, finance domain code,
  product features and infrastructure adapters.

### Changed
- PostgreSQL is now the canonical production user-data store; the encrypted
  browser vault remains the offline device cache.
- The frontend entrypoint now delegates to `src/app/bootstrap.tsx`, while
  compatibility exports allow remaining root modules to migrate incrementally.
- Hosted Hugging Face inference receives a configurable 30-second server timeout
  so normal model cold starts do not fail at the old 12-second default.
- README and architecture, cloud-data and database operations documentation were
  rewritten for the cross-device design.

### Fixed
- Serialized local encrypted-vault writes prevent slower older writes from
  overwriting newer finance or assistant data.
- Cloud initialization and save retries use bounded backoff rather than an
  immediate retry loop.
- Local edits made while the initial cloud read is unavailable are protected by
  an explicit conflict instead of being overwritten after reconnection.
- No-op application mounts no longer create unnecessary cloud-state versions.

## [0.1.1.0] - 2026-07-29

### Fixed
- Sign-in screen, the offline/connectivity banner, and PWA install/update prompts
  now render consistently in German (the app's declared language) instead of a
  mix of English and German.
- The expense category donut chart on the dashboard now shows a distinct color
  per category instead of a single flat gray.
- The primary "Manuelle Buchung" action button no longer runs off the edge of
  the screen on narrow mobile viewports.
- Fixed the add/edit-transaction dialog and the undo-delete toast being
  unclickable whenever the "enable biometric login" banner was showing.
- The connector backend now refuses to start with local (unauthenticated) sign-in
  enabled whenever it's running in production mode, closing a session-bypass gap.
- The production Nginx configuration now correctly forwards `/api/` requests to
  the connector backend (previously these requests silently fell through to the
  app shell instead of reaching the backend).
- Rate limiting on sign-in, bank-connection, and AI endpoints is now scoped per
  real client instead of collapsing into a single shared limit for everyone
  behind the reverse proxy, and can no longer be bypassed by forging a
  client IP header.
- Restored working `lint` command (the project's ESLint configuration was
  missing).
- The Financial Assistant screen (agent status, data-quality badges, and the
  "Approval-gated Agent" label) now also renders in German instead of showing
  raw internal state values like "proposed" or "low".
- `npm run dev` now proxies `/api` and `/health/ready` requests to the local
  connector, so the frontend can reach the backend immediately with no manual
  proxy setup.
- The "enable biometric login" banner's backdrop and the undo-delete toast no
  longer share the same stacking layer, so one can no longer accidentally
  paint over and block the other.

### Changed
- Local development setup docs now cover starting the connector backend and its
  current sign-in limitations, so following the README gets you a working app.
- Added a system architecture diagram covering the browser, connector, auth,
  COBOL engine, bank/PayPal providers, and the AI request path.
- Hardened lint/build tooling (ESLint/TypeScript configuration alignment,
  tracked dependency lockfiles for reproducible installs).
