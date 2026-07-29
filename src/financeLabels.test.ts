import { describe, expect, it } from 'vitest'
import { ACTION_STATUS_LABELS, DATA_QUALITY_LABELS, SMARTNESS_LEVEL_LABELS } from './financeLabels'

// Regression coverage for a raw-enum-leak bug fixed during release-hardening:
// action.status/plan.dataQuality/smartness.level were once rendered verbatim
// instead of translated. The label maps are now typed as Record<Union, string>,
// so `tsc -b --noEmit` already enforces exhaustiveness at compile time — a new
// union member without a label entry is a type error, not a silent `?? raw`
// fallback. This test is the runtime documentation of that same guarantee.
describe('FinanceAssistant label maps', () => {
  it('covers every AgentAction status with a German label', () => {
    expect(Object.keys(ACTION_STATUS_LABELS).sort()).toEqual(['approved', 'proposed', 'rejected'])
    for (const label of Object.values(ACTION_STATUS_LABELS)) expect(label.length).toBeGreaterThan(0)
  })

  it('covers every AgentPlan dataQuality value with a German label', () => {
    expect(Object.keys(DATA_QUALITY_LABELS).sort()).toEqual(['high', 'low', 'medium'])
  })

  it('covers every SmartnessAssessment level with a German label', () => {
    expect(Object.keys(SMARTNESS_LEVEL_LABELS).sort()).toEqual(['adaptive', 'advanced', 'basic'])
  })
})
