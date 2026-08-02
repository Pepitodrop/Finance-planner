# Security policy

## Supported versions

Security fixes are applied to the latest `main` branch. Tagged releases should be upgraded to the newest patch release before a vulnerability is reported as unresolved.

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities involving authentication, financial data, secrets, provider credentials, or encryption. Report the issue privately through GitHub Security Advisories for this repository and include:

- affected commit or release;
- reproduction steps using synthetic data;
- expected and observed behavior;
- impact assessment;
- any suggested mitigation.

Do not include real bank credentials, access tokens, session cookies, personal financial records, passkeys, private keys, or encryption keys.

## Response targets

| Severity | Initial triage | Containment target | Fix target |
|---|---:|---:|---:|
| Critical | 4 hours | 8 hours | 24 hours |
| High | 1 business day | 2 business days | 7 days |
| Medium | 3 business days | As required | 30 days |
| Low | 5 business days | As required | Next planned release |

Critical incidents include unauthorized access to financial data, authentication bypass, encryption-key compromise, credential exposure, remote code execution, and destructive database access.

## Coordinated remediation

1. Reproduce the issue in an isolated environment.
2. Revoke or rotate affected credentials, provider tokens, keys, and sessions.
3. Preserve relevant logs and deployment metadata without copying unnecessary financial data.
4. Prepare a private fix with a regression test.
5. Validate exact-head CI, browser acceptance, operations acceptance, security analysis, backup recovery, and rollback.
6. Deploy the fix and verify health, metrics, and provider behavior.
7. Publish a minimally sufficient advisory only after affected deployments are protected.

## Production security requirements

A public deployment is not considered supported unless all of the following are true:

- `APP_ORIGIN` uses HTTPS;
- `PUBLIC_DEPLOYMENT=true`;
- `AUTH_MODE` is not `local` (the connector refuses to start with `AUTH_MODE=local` under `NODE_ENV=production` regardless of `PUBLIC_DEPLOYMENT`, since it mints unauthenticated sessions);
- `SESSION_SECRET`, `CONNECTOR_MASTER_KEY`, and `AUTH_MASTER_KEY` are independent random secrets with at least 32 characters;
- secrets are injected at runtime and are not stored in source control or container images;
- the connector API is not exposed directly to the public internet;
- `TRUST_PROXY=true` is set whenever the bundled reverse proxy is used;
- encrypted application data is backed up and restore-tested;
- provider applications use production callback URLs and least-privilege credentials;
- CI, browser acceptance, operations acceptance, load acceptance, and security analysis are green for the exact deployed commit;
- container images and production dependencies are scanned before deployment;
- production metrics and alerts are connected to an operator-owned notification route.

## Data handling

The browser application stores local financial and AI-learning data on the user's device. Connector credentials and authentication state are encrypted at rest by the backend. Encryption does not replace host security, access controls, backups, key rotation, or incident response.

## Known limitations

`TRUST_PROXY=true` makes the connector trust the `X-Real-IP` header on the assumption that only the reverse proxy can reach the connector port. The bundled Compose stack publishes the connector port only to the deployment host's loopback interface. Operators must restrict host-level shell and process access to trusted operators because host access also permits reading runtime secrets and encrypted storage.

When another proxy, load balancer, or CDN is placed in front of nginx, it must strip or overwrite client-provided forwarding headers. Do not add an upstream hop that forwards `X-Real-IP` or `X-Forwarded-For` without sanitization.
