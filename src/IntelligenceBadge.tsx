import { CloudCog, Cpu, ListChecks } from 'lucide-react'

export type IntelligenceKind = 'calculated' | 'local' | 'hosted'

const ICONS = { calculated: ListChecks, local: Cpu, hosted: CloudCog } as const
const DEFAULT_LABELS: Record<IntelligenceKind, string> = {
  calculated: 'Calculated',
  local: 'On-device model',
  hosted: 'Hosted model (consented)',
}

// Keeps the three kinds of intelligence (deterministic / local model /
// hosted model, see Step 12A reference Part 4) visually distinct everywhere
// they appear, from a single source of truth rather than four ad-hoc badges.
export function IntelligenceBadge({ kind, label }: { kind: IntelligenceKind; label?: string }) {
  const Icon = ICONS[kind]
  return <span className={`intel-badge intel-badge--${kind}`}><Icon size={13}/>{label ?? DEFAULT_LABELS[kind]}</span>
}
