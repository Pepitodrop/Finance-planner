const DEFAULT_BUCKETS_MS = Object.freeze([25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000])
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function escapeLabel(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"').slice(0, 120)
}

function normalizedLabels(labels = {}) {
  return Object.fromEntries(Object.entries(labels)
    .filter(([name, value]) => LABEL_NAME.test(name) && value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, String(value).slice(0, 120)]))
}

function labelsKey(labels) {
  return JSON.stringify(normalizedLabels(labels))
}

function labelsText(labels, extra = {}) {
  const entries = Object.entries({ ...normalizedLabels(labels), ...normalizedLabels(extra) })
  return entries.length ? `{${entries.map(([name, value]) => `${name}="${escapeLabel(value)}"`).join(',')}}` : ''
}

export function operationalRoute(pathname) {
  const path = String(pathname || '').split('?', 1)[0]
  if (path === '/health' || path === '/health/live' || path === '/health/ready' || path === '/health/bank') return path
  if (path === '/metrics') return '/metrics'
  if (path === '/api/session/local') return '/api/session/local'
  if (path === '/api/auth/account') return '/api/auth/account'
  if (path.startsWith('/api/auth/')) return '/api/auth/:action'
  if (path === '/api/finance/state') return '/api/finance/state'
  if (path.startsWith('/api/finance/')) return '/api/finance/:action'
  if (path === '/api/ai/budget-plan') return '/api/ai/budget-plan'
  if (path === '/api/ai/budget-feedback') return '/api/ai/budget-feedback'
  if (path === '/api/ai/budget-profile') return '/api/ai/budget-profile'
  if (path === '/api/ai/receipt-review') return '/api/ai/receipt-review'
  if (path === '/api/ai/financial-intelligence') return '/api/ai/financial-intelligence'
  if (path === '/api/ai/behavior-prediction') return '/api/ai/behavior-prediction'
  if (path.startsWith('/api/ai/')) return '/api/ai/:action'
  if (path === '/api/connectors/sync') return '/api/connectors/sync'
  if (path === '/api/connectors/callback') return '/api/connectors/callback'
  if (/^\/api\/connectors\/(gocardless|finapi|paypal)\/start$/.test(path)) return '/api/connectors/:provider/start'
  if (/^\/api\/connectors\/(gocardless|finapi|paypal)$/.test(path)) return '/api/connectors/:provider'
  if (/^\/api\/connectors\/webhooks\/(gocardless|finapi|paypal)$/.test(path)) return '/api/connectors/webhooks/:provider'
  return path.startsWith('/api/') ? '/api/unknown' : 'unknown'
}

function sourceClass(source) {
  const value = String(source || '').toLowerCase()
  if (value.includes('hugging-face')) return 'hosted'
  if (value.includes('local')) return 'local'
  if (value.includes('deterministic') || value.includes('fallback')) return 'deterministic'
  return 'other'
}

export class OperationalMetrics {
  constructor({ now = () => Date.now(), version = 'unknown', commit = 'unknown', maxSeries = 1_000 } = {}) {
    this.now = now
    this.startedAt = now()
    this.version = String(version || 'unknown').slice(0, 80)
    this.commit = String(commit || 'unknown').slice(0, 80)
    this.maxSeries = maxSeries
    this.counters = new Map()
    this.histograms = new Map()
  }

  increment(name, labels = {}, amount = 1) {
    if (!METRIC_NAME.test(name)) throw new Error(`Invalid metric name: ${name}`)
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`Invalid counter increment for ${name}`)
    const key = `${name}:${labelsKey(labels)}`
    if (!this.counters.has(key) && this.counters.size + this.histograms.size >= this.maxSeries) return
    const current = this.counters.get(key) || { name, labels: normalizedLabels(labels), value: 0 }
    current.value += amount
    this.counters.set(key, current)
  }

  observe(name, value, labels = {}, buckets = DEFAULT_BUCKETS_MS) {
    if (!METRIC_NAME.test(name)) throw new Error(`Invalid metric name: ${name}`)
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid observation for ${name}`)
    const key = `${name}:${labelsKey(labels)}`
    if (!this.histograms.has(key) && this.counters.size + this.histograms.size >= this.maxSeries) return
    const current = this.histograms.get(key) || {
      name,
      labels: normalizedLabels(labels),
      buckets: [...buckets].sort((left, right) => left - right),
      counts: new Array(buckets.length).fill(0),
      count: 0,
      sum: 0,
    }
    current.count += 1
    current.sum += value
    current.buckets.forEach((limit, index) => {
      if (value <= limit) current.counts[index] += 1
    })
    this.histograms.set(key, current)
  }

  recordHttp({ method, pathname, status, durationMs }) {
    const labels = {
      method: String(method || 'UNKNOWN').toUpperCase().slice(0, 12),
      route: operationalRoute(pathname),
      status: String(Number(status) || 0),
    }
    this.increment('finance_planner_http_requests_total', labels)
    this.observe('finance_planner_http_request_duration_ms', Math.max(0, Number(durationMs) || 0), {
      method: labels.method,
      route: labels.route,
    })
  }

  recordBank(provider, outcome) {
    const safeProvider = ['gocardless', 'finapi', 'paypal'].includes(provider) ? provider : 'other'
    const safeOutcome = ['success', 'failure', 'expired', 'disconnected'].includes(outcome) ? outcome : 'other'
    this.increment('finance_planner_bank_operations_total', { provider: safeProvider, outcome: safeOutcome })
  }

  recordAi(pathname, source) {
    this.increment('finance_planner_ai_responses_total', {
      route: operationalRoute(pathname),
      source: sourceClass(source),
    })
  }

  recordAccountDeletion(outcome) {
    this.increment('finance_planner_account_deletions_total', {
      outcome: ['success', 'failure'].includes(outcome) ? outcome : 'other',
    })
  }

  snapshot() {
    return {
      version: this.version,
      commit: this.commit,
      uptimeSeconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000)),
      counters: [...this.counters.values()].map((entry) => ({ ...entry, labels: { ...entry.labels } })),
      histograms: [...this.histograms.values()].map((entry) => ({
        ...entry,
        labels: { ...entry.labels },
        buckets: [...entry.buckets],
        counts: [...entry.counts],
      })),
    }
  }

  prometheus() {
    const lines = [
      '# HELP finance_planner_build_info Static build and release identity.',
      '# TYPE finance_planner_build_info gauge',
      `finance_planner_build_info${labelsText({}, { version: this.version, commit: this.commit })} 1`,
      '# HELP finance_planner_process_uptime_seconds Connector process uptime.',
      '# TYPE finance_planner_process_uptime_seconds gauge',
      `finance_planner_process_uptime_seconds ${Math.max(0, (this.now() - this.startedAt) / 1_000).toFixed(3)}`,
    ]

    for (const entry of this.counters.values()) {
      lines.push(`# TYPE ${entry.name} counter`)
      lines.push(`${entry.name}${labelsText(entry.labels)} ${entry.value}`)
    }

    for (const entry of this.histograms.values()) {
      lines.push(`# TYPE ${entry.name} histogram`)
      entry.buckets.forEach((limit, index) => {
        lines.push(`${entry.name}_bucket${labelsText(entry.labels, { le: limit })} ${entry.counts[index]}`)
      })
      lines.push(`${entry.name}_bucket${labelsText(entry.labels, { le: '+Inf' })} ${entry.count}`)
      lines.push(`${entry.name}_sum${labelsText(entry.labels)} ${entry.sum}`)
      lines.push(`${entry.name}_count${labelsText(entry.labels)} ${entry.count}`)
    }

    return `${lines.join('\n')}\n`
  }
}
