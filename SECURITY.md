# Security policy

## Supported versions

Security fixes are applied to the latest `main` branch. Tagged releases should be upgraded to the newest patch release before a vulnerability is reported as unresolved.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities involving authentication, financial data, secrets, provider credentials, or encryption. Report the issue privately through GitHub Security Advisories for this repository and include:

- affected commit or release
- reproduction steps
- expected and observed behavior
- impact assessment
- any suggested mitigation

Do not include real bank credentials, access tokens, session cookies, personal financial records, or encryption keys.

## Production security requirements

A public deployment is not considered supported unless all of the following are true:

- `APP_ORIGIN` uses HTTPS
- `PUBLIC_DEPLOYMENT=true`
- `AUTH_MODE` is not `local` (the connector refuses to start with `AUTH_MODE=local`
  under `NODE_ENV=production` regardless of `PUBLIC_DEPLOYMENT`, since it mints
  unauthenticated sessions)
- `SESSION_SECRET` and `CONNECTOR_MASTER_KEY` are independent random secrets with at least 32 characters
- secrets are injected at runtime and are not stored in source control or container images
- the connector API is not exposed directly to the public internet
- encrypted application data is backed up and restore-tested
- provider applications use production callback URLs and least-privilege credentials
- CI is green for the exact deployed commit
- container images and production dependencies are scanned before deployment

## Data handling

The browser application stores local financial and AI-learning data on the user's device. Connector credentials and authentication state are encrypted at rest by the backend. Encryption does not replace host security, access controls, backups, key rotation, or incident response.

## Known limitations

The encrypted backend store is designed for a single application instance. Multi-instance deployment requires a shared transactional database, distributed rate limiting, coordinated session handling, and tested migrations before horizontal scaling is safe.
