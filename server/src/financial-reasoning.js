const round = (value, digits = 3) => Number(value.toFixed(digits))

function monthsUntil(targetDate, now = new Date()) {
  const target = new Date(`${targetDate}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) return 0
  return Math.max(0, (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + target.getUTCMonth() - now.getUTCMonth())
}

function monthly(value, monthsCovered) {
  return monthsCovered > 0 ? value / monthsCovered : value
}

export function buildFinancialReasoning(snapshot, { now = new Date() } = {}) {
  const coveredMonths = Math.max(1, snapshot.monthsCovered)
  const monthlyIncomeCents = monthly(snapshot.incomeCents, coveredMonths)
  const monthlyExpenseCents = monthly(snapshot.expenseCents, coveredMonths)
  const monthlyFreeCashCents = monthly(snapshot.freeCashCents, coveredMonths)
  const monthlyRecurringCents = monthly(snapshot.recurringExpenseCents, coveredMonths)
  const savingsRate = monthlyIncomeCents > 0 ? monthlyFreeCashCents / monthlyIncomeCents : 0
  const recurringShare = monthlyExpenseCents > 0 ? monthlyRecurringCents / monthlyExpenseCents : 0
  const runwayMonths = monthlyExpenseCents > 0 ? snapshot.accountBalanceCents / monthlyExpenseCents : null

  const goals = snapshot.goals.map((goal, index) => {
    const monthsRemaining = monthsUntil(goal.targetDate, now)
    const requiredMonthlyCents = monthsRemaining > 0 ? Math.ceil(goal.remainingCents / monthsRemaining) : goal.remainingCents
    const monthlyGapCents = monthlyFreeCashCents - requiredMonthlyCents
    const feasible = goal.remainingCents === 0 || (monthsRemaining > 0 && monthlyGapCents >= 0)
    return {
      rank: index + 1,
      targetDate: goal.targetDate,
      remainingCents: goal.remainingCents,
      monthsRemaining,
      requiredMonthlyCents,
      monthlyGapCents: Math.round(monthlyGapCents),
      feasibility: feasible ? 'on-track' : monthsRemaining === 0 ? 'overdue' : 'at-risk',
    }
  })

  const stressScenarios = [
    { code: 'expense_plus_10', incomeFactor: 1, expenseFactor: 1.1 },
    { code: 'income_minus_10', incomeFactor: 0.9, expenseFactor: 1 },
    { code: 'combined_stress', incomeFactor: 0.9, expenseFactor: 1.1 },
  ].map((scenario) => {
    const stressedIncome = monthlyIncomeCents * scenario.incomeFactor
    const stressedExpense = monthlyExpenseCents * scenario.expenseFactor
    const stressedFreeCash = stressedIncome - stressedExpense
    return {
      code: scenario.code,
      monthlyFreeCashCents: Math.round(stressedFreeCash),
      remainsPositive: stressedFreeCash > 0,
      savingsRate: stressedIncome > 0 ? round(stressedFreeCash / stressedIncome) : 0,
    }
  })

  const insights = []
  if (savingsRate < 0.1) insights.push({ code: 'low_savings_rate', severity: savingsRate <= 0 ? 'critical' : 'warning', value: round(savingsRate) })
  if (recurringShare > 0.6) insights.push({ code: 'high_recurring_share', severity: 'warning', value: round(recurringShare) })
  if (runwayMonths !== null && runwayMonths < 3) insights.push({ code: 'low_liquidity_runway', severity: runwayMonths < 1 ? 'critical' : 'warning', value: round(runwayMonths, 2) })
  if (goals.some((goal) => goal.feasibility !== 'on-track')) insights.push({ code: 'goal_funding_gap', severity: 'warning', value: goals.filter((goal) => goal.feasibility !== 'on-track').length })
  if (stressScenarios.some((scenario) => !scenario.remainsPositive)) insights.push({ code: 'stress_test_failure', severity: 'warning', value: stressScenarios.filter((scenario) => !scenario.remainsPositive).length })

  const dataReliability = round(Math.min(1, (Math.min(snapshot.transactionCount, 90) / 90) * 0.55 + (Math.min(snapshot.monthsCovered, 12) / 12) * 0.45), 2)
  return {
    monthly: {
      incomeCents: Math.round(monthlyIncomeCents),
      expenseCents: Math.round(monthlyExpenseCents),
      freeCashCents: Math.round(monthlyFreeCashCents),
      recurringExpenseCents: Math.round(monthlyRecurringCents),
    },
    savingsRate: round(savingsRate),
    recurringShare: round(recurringShare),
    runwayMonths: runwayMonths === null ? null : round(runwayMonths, 2),
    goals,
    stressScenarios,
    insights,
    dataReliability,
    explainability: 'All outputs are deterministic calculations from the validated aggregate snapshot; no transaction descriptions or account identifiers are used.',
  }
}
