import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('production deployment contract', () => {
  it('builds frontend and backend dependencies from committed lockfiles', () => {
    const web = read('Dockerfile.web')
    const server = read('Dockerfile.server')

    expect(web).toContain('COPY package.json package-lock.json ./')
    expect(web).toContain('RUN npm ci --no-fund --no-audit')
    expect(server).toContain('COPY server/package.json server/package-lock.json ./')
    expect(server).toContain('npm ci --omit=dev --no-fund --no-audit')
    expect(web).not.toMatch(/RUN npm install/)
    expect(server).not.toMatch(/RUN npm install/)
  })

  it('ships both authoritative COBOL executables and fails closed for banking rules', () => {
    const server = read('Dockerfile.server')

    expect(server).toContain('core/cobol/transaction_rules.cob')
    expect(server).toContain('core/cobol/banking/banking-core.cob')
    expect(server).toContain('cobc -Wall -Wextra -x -o build/transaction-rules')
    expect(server).toContain('cobc -Wall -Wextra -x -o build/banking-core')
    expect(server).toContain('COPY --from=build /app/build/transaction-rules ./build/transaction-rules')
    expect(server).toContain('COPY --from=build /app/build/banking-core ./build/banking-core')
    expect(server).toContain('COBOL_BANKING_BINARY=/app/build/banking-core')
    expect(server).toContain('COBOL_BANKING_REQUIRED=true')
  })

  it('forwards documented authentication, passkey and provider settings into the connector', () => {
    const compose = read('compose.yaml')
    const requiredMappings = [
      'AUTH_MODE: ${AUTH_MODE:?',
      'GOOGLE_SUBSCRIPTIONS_ENABLED: ${GOOGLE_SUBSCRIPTIONS_ENABLED:-false}',
      'GOOGLE_SUBSCRIPTIONS_SCOPES: ${GOOGLE_SUBSCRIPTIONS_SCOPES:-openid email profile}',
      'GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: ${GOOGLE_SUBSCRIPTIONS_DATA_SOURCE:-}',
      'WEBAUTHN_RP_ID: ${WEBAUTHN_RP_ID:-}',
      'WEBAUTHN_RP_NAME: ${WEBAUTHN_RP_NAME:-Finance Planner}',
      'PAYPAL_PARTNER_MERCHANT_ID: ${PAYPAL_PARTNER_MERCHANT_ID:-}',
      'PAYPAL_ENV: ${PAYPAL_ENVIRONMENT:-sandbox}',
      'COBOL_BANKING_REQUIRED: ${COBOL_BANKING_REQUIRED:-true}',
    ]

    for (const mapping of requiredMappings) expect(compose).toContain(mapping)
  })

  it('does not present an invalid local-auth production template', () => {
    const example = read('.env.example')

    expect(example).toContain('AUTH_MODE=google')
    expect(example).toContain('PUBLIC_DEPLOYMENT=true')
    expect(example).toContain('APP_ORIGIN=https://')
    expect(example).toContain('PAYPAL_ENVIRONMENT=sandbox')
    expect(example).not.toMatch(/^AUTH_MODE=local$/m)
  })
})
