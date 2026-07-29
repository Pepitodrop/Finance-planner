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
- `TRUST_PROXY=true` is set on the connector whenever a reverse proxy sits in front of it (required
  for per-client rate limiting to use the proxy-set `X-Real-IP` instead of the proxy's own address)
- encrypted application data is backed up and restore-tested
- provider applications use production callback URLs and least-privilege credentials
- CI is green for the exact deployed commit
- container images and production dependencies are scanned before deployment

## Data handling

The browser application stores local financial and AI-learning data on the user's device. Connector credentials and authentication state are encrypted at rest by the backend. Encryption does not replace host security, access controls, backups, key rotation, or incident response.

## Known limitations

The encrypted backend store is designed for a single application instance. Multi-instance deployment requires a shared transactional database, distributed rate limiting, coordinated session handling, and tested migrations before horizontal scaling is safe.

`TRUST_PROXY=true` makes the connector trust the `X-Real-IP` header unconditionally, on the assumption that only the reverse proxy can reach the connector's port. The bundled Compose stack also publishes the connector's port to the deployment host's loopback interface (`127.0.0.1:${CONNECTOR_PORT:-8787}`) so operators can run the documented health check directly. This means any process with host-level shell access to the deployment machine can bypass the proxy and forge `X-Real-IP` to spoof its rate-limit identity. This is not a new exposure: the same host-level access already lets a process read `SESSION_SECRET`, `CONNECTOR_MASTER_KEY`, and the encrypted store directly from the environment and disk. Operators must restrict host-level shell/process access to the deployment machine to trusted operators only, the same requirement production secret handling already depends on.

The same unconditional trust applies if another proxy, load balancer, or CDN sits in front of nginx: whatever reaches nginx as `X-Real-IP` is passed straight through to the connector, so anything upstream of nginx must itself strip or overwrite client-supplied `X-Real-IP`/`X-Forwarded-For` headers before they reach it. Do not place an additional hop in front of nginx that forwards those headers unfiltered.
