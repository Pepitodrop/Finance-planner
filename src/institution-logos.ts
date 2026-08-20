/**
 * Institution visual identity for the Connections picker.
 *
 * Reviewed Simple Icons CDN assets (same cdn.simpleicons.org path already
 * approved and used by Finance Planner for merchant logos, see
 * merchant-logos.ts) are used only where a matching brand slug was verified
 * to exist in the simple-icons project. Every other institution gets an
 * original Finance Planner lettermark -- never a downloaded bank-site image
 * and never another app's branding.
 */
export interface InstitutionLogoDefinition { slug: string; color?: string }

const REVIEWED_LOGOS: Record<string, InstitutionLogoDefinition> = {
  paypal: { slug: 'paypal', color: '003087' },
  n26: { slug: 'n26' },
  commerzbank: { slug: 'commerzbank', color: 'FFCC33' },
  'deutsche-bank': { slug: 'deutschebank', color: '0018A8' },
  sparkasse: { slug: 'sparkasse' },
}

export function institutionLogoUrl(institutionId: string): string | null {
  const logo = REVIEWED_LOGOS[institutionId]
  if (!logo) return null
  return `https://cdn.simpleicons.org/${encodeURIComponent(logo.slug)}${logo.color ? `/${logo.color}` : ''}`
}

// Curated 1-3 letter monograms for institutions with a distinctive
// abbreviation; anything not listed here falls back to deriving initials
// from its name.
const LETTERMARK_OVERRIDES: Record<string, string> = {
  ing: 'ING',
  dkb: 'DKB',
  comdirect: 'CD',
  postbank: 'PB',
  hypovereinsbank: 'HVB',
  volksbank: 'VR',
  'trade-republic': 'TR',
}

// A small palette derived from Finance Planner's own accent/semantic colors
// (design-foundation.css), never a bank's real corporate color, so
// lettermarks read as clearly original to the product.
const LETTERMARK_PALETTE = ['#8B6AEE', '#5AA9E6', '#4FD1A5', '#E6B75A', '#E67E9A', '#6AC6E6', '#B48EF0', '#7FD9C4']

function deriveInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '').join('')
  return initials || name.slice(0, 2).toUpperCase()
}

function paletteIndex(seed: string): number {
  let hash = 0
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0
  return hash % LETTERMARK_PALETTE.length
}

export interface InstitutionLettermark { letters: string; color: string }

export function institutionLettermark(institutionId: string, name: string): InstitutionLettermark {
  return {
    letters: LETTERMARK_OVERRIDES[institutionId] || deriveInitials(name),
    color: LETTERMARK_PALETTE[paletteIndex(institutionId)],
  }
}
