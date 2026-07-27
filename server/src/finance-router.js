import { projectSavingsBalance } from './cobol-engine.js'
import { HttpError } from './runtime-security.js'

export function createFinanceRouter({ env = process.env, send, body, userId, projectSavings = projectSavingsBalance }) {
  return async function handleFinance(request, response, url) {
    if (request.method !== 'POST' || url.pathname !== '/api/finance/project-savings') return false

    userId(request)
    const input = await body(request)
    const balanceCents = input.balanceCents
    const monthlyContributionCents = input.monthlyContributionCents
    const months = input.months

    if (!Number.isSafeInteger(balanceCents) || !Number.isSafeInteger(monthlyContributionCents)) {
      throw new HttpError(400, 'invalid_projection_input', 'Balance and monthly contribution must use integer cents.')
    }
    if (!Number.isSafeInteger(months) || months < 0 || months > 1200) {
      throw new HttpError(400, 'invalid_projection_input', 'Months must be an integer between 0 and 1200.')
    }

    const projectedBalanceCents = await projectSavings(balanceCents, monthlyContributionCents, months, env)
    send(response, 200, {
      balanceCents,
      monthlyContributionCents,
      months,
      projectedBalanceCents,
      calculationEngine: 'cobol',
    })
    return true
  }
}
