import { useMemo, useState } from 'react'
import { ArrowRight, Building2, CreditCard, Landmark, Search, WalletCards } from 'lucide-react'
import { commonInstitutions, groupInstitutions, searchInstitutions, type Institution, type InstitutionKind } from './institutions'

interface InstitutionPickerProps {
  disabledInstitutionIds?: ReadonlySet<string>
  onSelect: (institution: Institution) => void
}

const sectionLabels: Record<InstitutionKind, string> = {
  bank: 'Banken',
  wallet: 'Wallets und Zahlungsdienste',
  broker: 'Broker und Depots',
  card: 'Kreditkarten',
  manual: 'Manuelle Konten',
}

function InstitutionIcon({ kind }: { kind: InstitutionKind }) {
  if (kind === 'wallet') return <WalletCards size={22}/>
  if (kind === 'broker') return <Landmark size={22}/>
  if (kind === 'card') return <CreditCard size={22}/>
  return <Building2 size={22}/>
}

export function InstitutionPicker({ disabledInstitutionIds = new Set(), onSelect }: InstitutionPickerProps) {
  const [query, setQuery] = useState('')
  const grouped = useMemo(() => groupInstitutions(searchInstitutions(query, commonInstitutions)), [query])
  const visibleKinds = (Object.keys(sectionLabels) as InstitutionKind[]).filter((kind) => grouped[kind].length > 0)

  return <div className="institution-picker">
    <label className="bank-search">
      <Search size={18}/>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Bank, BIC oder BLZ suchen"
        aria-label="Bank, BIC oder BLZ suchen"
      />
    </label>

    {visibleKinds.length === 0 && <div className="connection-empty-state compact">
      <strong>Keine passende Bank gefunden</strong>
      <span>Prüfe den Namen, die BIC oder die BLZ. Alternativ kannst du ein manuelles Konto anlegen.</span>
    </div>}

    {visibleKinds.map((kind) => <section className="institution-picker-section" key={kind} aria-labelledby={`institution-${kind}`}>
      <h3 id={`institution-${kind}`}>{sectionLabels[kind]}</h3>
      <div className="bank-picker-list">
        {grouped[kind].map((institution) => {
          const disabled = disabledInstitutionIds.has(institution.id)
          const metadata = [institution.bic && `BIC ${institution.bic}`, institution.blz && `BLZ ${institution.blz}`].filter(Boolean).join(' · ')
          return <button
            className="bank-picker-item"
            key={institution.id}
            disabled={disabled}
            onClick={() => onSelect(institution)}
          >
            <span className="bank-picker-icon"><InstitutionIcon kind={institution.kind}/></span>
            <span>
              <strong>{institution.name}</strong>
              <small>{disabled ? 'Bereits verbunden' : institution.description || metadata || 'Sicher über den passenden Anbieter verbinden.'}</small>
              {!disabled && institution.description && metadata && <small>{metadata}</small>}
            </span>
            <ArrowRight size={18}/>
          </button>
        })}
      </div>
    </section>)}
  </div>
}
