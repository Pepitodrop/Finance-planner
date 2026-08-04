import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
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

export function MerchantLogo({ description, type }: MerchantLogoProps) {
  const [failed, setFailed] = useState(false)
  const logo = resolveMerchantLogo(description)

  if (logo && !failed) {
    return (
      <span className="transaction-merchant-logo branded" title={logo.label} aria-label={`${logo.label} Logo`}>
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
      <span className="merchant-initials">{initials(description)}</span>
      <span className="merchant-direction">
        {type === 'income' ? <ArrowUpRight size={11}/> : <ArrowDownRight size={11}/>} 
      </span>
    </span>
  )
}
