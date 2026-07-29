# Changelog

All notable changes to this project are documented in this file.

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

### Changed
- Local development setup docs now cover starting the connector backend and its
  current sign-in limitations, so following the README gets you a working app.
- Added a system architecture diagram covering the browser, connector, auth,
  COBOL engine, bank/PayPal providers, and the AI request path.
- Hardened lint/build tooling (ESLint/TypeScript configuration alignment,
  tracked dependency lockfiles for reproducible installs).
