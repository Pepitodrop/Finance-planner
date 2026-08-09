import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, Dumbbell, Gamepad2, House, Landmark, ShoppingBasket, TrainFront, Utensils } from 'lucide-react'
import { merchantLogoUrl, resolveMerchantLogo } from './merchant-logos'
import type { TransactionType } from './types'

interface MerchantLogoProps {
  description: string
  type: TransactionType
}

function initials(description: string): string {
  const parts = description.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '•'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function fallbackGraphic(description: string, type: TransactionType): ReactNode {
  if (/minecraft|steam|xbox|playstation|nintendo|game/i.test(description)) return <Gamepad2 size={19}/>
  if (/restaurant|cafe|café|essen|food/i.test(description)) return <Utensils size={19}/>
  if (/rewe|edeka|lidl|aldi|supermarkt|grocery/i.test(description)) return <ShoppingBasket size={19}/>
  if (/deutschlandticket|bahn|train|transit|bus|mobilität/i.test(description)) return <TrainFront size={19}/>
  if (/miete|rent|wohnung|housing/i.test(description)) return <House size={19}/>
  if (/fitness|gym/i.test(description)) return <Dumbbell size={19}/>
  if (/gehalt|salary|werkstudent|payroll|lohn/i.test(description)) return <BriefcaseBusiness size={19}/>
  if (/bank|konto|account|sparkasse/i.test(description)) return <Landmark size={19}/>
  return <span className="merchant-initials">{initials(description)}</span>
}

export function MerchantLogo({ description, type }: MerchantLogoProps) {
  const [failed, setFailed] = useState(false)
  const logo = resolveMerchantLogo(description)
  const fixturesActive = import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true'

  useEffect(() => setFailed(false), [description])

  if (logo && !failed && !fixturesActive) {
    return (
      <span className="transaction-merchant-logo branded" title={logo.label} aria-label={`${logo.label} logo`}>
        <img
          src={merchantLogoUrl(logo)}
          alt=""
          width={22}
          height={22}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </span>
    )
  }

  return (
    <span className={`transaction-merchant-logo fallback ${type}`} aria-hidden="true">
      <span className="merchant-fallback-graphic">{fallbackGraphic(description, type)}</span>
      <span className="merchant-direction">
        {type === 'income' ? <ArrowUpRight size={10}/> : <ArrowDownRight size={10}/>}
      </span>
    </span>
  )
}
