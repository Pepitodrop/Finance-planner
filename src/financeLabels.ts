import type { AgentAction, AgentPlan } from './financialAgent'
import type { SmartnessAssessment } from './smartness'

// Record<Union, string> makes the compiler enforce exhaustiveness: adding a
// new AgentAction['status']/AgentPlan['dataQuality']/SmartnessAssessment['level']
// literal without a label here is a type error, not a silent `?? rawValue` fallback.
export const ACTION_STATUS_LABELS: Record<AgentAction['status'], string> = { proposed: 'Vorgeschlagen', approved: 'Genehmigt', rejected: 'Abgelehnt' }
export const DATA_QUALITY_LABELS: Record<AgentPlan['dataQuality'], string> = { low: 'niedrig', medium: 'mittel', high: 'hoch' }
export const SMARTNESS_LEVEL_LABELS: Record<SmartnessAssessment['level'], string> = { basic: 'Basis', adaptive: 'Adaptiv', advanced: 'Fortgeschritten' }
