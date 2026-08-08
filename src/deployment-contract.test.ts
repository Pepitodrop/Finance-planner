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

  it('ships, requires, and health-checks both authoritative COBOL executables', () => {
    const server = read('Dockerfile.server')

    expect(server).toContain('core/cobol/transaction_rules.cob')
    expect(server).toContain('core/cobol/banking/banking-core.cob')
    expect(server).toContain('cobc -Wall -Wextra -x -o build/transaction-rules')
    expect(server).toContain('cobc -Wall -Wextra -x -o build/banking-core')
    expect(server).toContain('COPY --from=build /app/build/transaction-rules ./build/transaction-rules')
    expect(server).toContain('COPY --from=build /app/build/banking-core ./build/banking-core')
    expect(server).toContain('COBOL_BANKING_BINARY=/app/build/banking-core')
    expect(server).toContain('COBOL_BANKING_REQUIRED=true')
    expect(server).toContain('/app/build/banking-core normalize-account-type checking')
  })

  it('forwards documented authentication, passkey, Google and provider settings into the connector', () => {
    const compose = read('compose.yaml')
    const requiredMappings = [
      'AUTH_MODE: ${AUTH_MODE:-google}',
      'GOOGLE_SUBSCRIPTIONS_ENABLED: ${GOOGLE_SUBSCRIPTIONS_ENABLED:-false}',
      'GOOGLE_SUBSCRIPTIONS_SOURCE: ${GOOGLE_SUBSCRIPTIONS_SOURCE:-gmail}',
      'GOOGLE_SUBSCRIPTIONS_SCOPES: ${GOOGLE_SUBSCRIPTIONS_SCOPES:-openid email profile https://www.googleapis.com/auth/gmail.readonly}',
      'GOOGLE_SUBSCRIPTIONS_GMAIL_QUERY: ${GOOGLE_SUBSCRIPTIONS_GMAIL_QUERY:-}',
      'GOOGLE_SUBSCRIPTIONS_MAX_MESSAGES: ${GOOGLE_SUBSCRIPTIONS_MAX_MESSAGES:-100}',
      'GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: ${GOOGLE_SUBSCRIPTIONS_DATA_SOURCE:-}',
      'WEBAUTHN_RP_ID: ${WEBAUTHN_RP_ID:-}',
      'WEBAUTHN_RP_NAME: ${WEBAUTHN_RP_NAME:-Finance Planner}',
      'GOCARDLESS_WEBHOOK_SECRET: ${GOCARDLESS_WEBHOOK_SECRET:-}',
      'PAYPAL_PARTNER_MERCHANT_ID: ${PAYPAL_PARTNER_MERCHANT_ID:-}',
      'PAYPAL_ENV: ${PAYPAL_ENVIRONMENT:-sandbox}',
      'COBOL_BANKING_REQUIRED: ${COBOL_BANKING_REQUIRED:-true}',
      'HF_LIVE_VERIFIED_AT: ${HF_LIVE_VERIFIED_AT:-}',
    ]

    for (const mapping of requiredMappings) expect(compose).toContain(mapping)
    expect(compose).not.toContain('AUTH_MODE: ${AUTH_MODE:-local}')
  })

  it('documents honest Google receipt and hosted AI production boundaries', () => {
    const example = read('.env.example')

    expect(example).toContain('AUTH_MODE=google')
    expect(example).toContain('PUBLIC_DEPLOYMENT=true')
    expect(example).toContain('APP_ORIGIN=https://')
    expect(example).toContain('GOOGLE_SUBSCRIPTIONS_SOURCE=gmail')
    expect(example).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(example).toContain('never scrapes Google account pages')
    expect(example).toContain('HF_LIVE_VERIFIED_AT=')
    expect(example).toContain('GOCARDLESS_WEBHOOK_SECRET=')
    expect(example).toContain('PAYPAL_PARTNER_MERCHANT_ID=')
    expect(example).toContain('PAYPAL_ENVIRONMENT=sandbox')
    expect(example).not.toMatch(/^AUTH_MODE=local$/m)
    expect(example).not.toContain('supports owner-reporting credentials')
  })

  it('retains credential-aware hosted text and vision acceptance evidence', () => {
    const workflow = read('.github/workflows/hosted-ai-acceptance.yml')
    const script = read('scripts/live-ai-acceptance.mjs')

    expect(workflow).toContain('secrets.HF_TOKEN')
    expect(workflow).toContain('hosted-ai-acceptance')
    expect(script).toContain('blocked_by_credentials')
    expect(script).toContain('image_url')
    expect(script).toContain("type: 'json_schema'")
    expect(script).not.toMatch(/console\.log\([^)]*HF_TOKEN/)
  })

  it('revalidates the application shell while caching hashed assets immutably', () => {
    const nginx = read('deploy/nginx.conf')
    const securitySnippet = read('deploy/security-headers.conf')

    expect(nginx).toContain('location = /index.html')
    expect(nginx).toContain('Cache-Control "no-cache, no-store, must-revalidate"')
    expect(nginx).toContain('Cache-Control "public, immutable"')
    expect(securitySnippet).toContain('Cross-Origin-Opener-Policy same-origin')
    expect(securitySnippet).toContain('Cross-Origin-Resource-Policy same-origin')
  })

  it('never lets a location-specific add_header silently strip the shared security headers', () => {
    // nginx does not merge add_header directives across scopes: a location
    // block that declares its own add_header (e.g. a location-specific
    // Cache-Control) stops inheriting every add_header from the server
    // block, not just the one it redeclares. Any such location must
    // `include` the shared security-headers snippet so the headers survive.
    const nginx = read('deploy/nginx.conf')
    const securitySnippet = read('deploy/security-headers.conf')

    const requiredHeaders = [
      'Strict-Transport-Security',
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
    ]
    for (const header of requiredHeaders) {
      expect(securitySnippet).toContain(`add_header ${header} `)
    }

    const includeDirective = 'include /etc/nginx/security-headers.conf;'
    expect(nginx).toContain(includeDirective)

    const locationBlocks = [...nginx.matchAll(/location\s+[^{]*\{([^}]*)\}/g)].map((match) => match[1])
    expect(locationBlocks.length).toBeGreaterThan(0)
    for (const block of locationBlocks) {
      if (/\badd_header\s/.test(block)) {
        expect(block).toContain(includeDirective)
      }
    }
  })
})
