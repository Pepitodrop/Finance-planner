export interface MerchantLogoDefinition {
  slug: string
  color: string
  label: string
}

const LOGOS: Array<{ pattern: RegExp; logo: MerchantLogoDefinition }> = [
  { pattern: /\bspotify\b/i, logo: { slug: 'spotify', color: '1ED760', label: 'Spotify' } },
  { pattern: /\bnetflix\b/i, logo: { slug: 'netflix', color: 'E50914', label: 'Netflix' } },
  { pattern: /\bshell\b/i, logo: { slug: 'shell', color: 'FFD500', label: 'Shell' } },
  { pattern: /\brewe\b/i, logo: { slug: 'rewe', color: 'CC071E', label: 'REWE' } },
  { pattern: /\bpaypal\b/i, logo: { slug: 'paypal', color: '003087', label: 'PayPal' } },
  { pattern: /\bamazon\b/i, logo: { slug: 'amazon', color: 'FF9900', label: 'Amazon' } },
  { pattern: /\bapple\b|\bitunes\b|\bapp store\b/i, logo: { slug: 'apple', color: 'F5F5F7', label: 'Apple' } },
  { pattern: /\bgoogle\b|\byoutube\b/i, logo: { slug: 'google', color: '4285F4', label: 'Google' } },
  { pattern: /\btelekom\b|\bt-mobile\b/i, logo: { slug: 'deutschetelekom', color: 'E20074', label: 'Deutsche Telekom' } },
  { pattern: /\blidl\b/i, logo: { slug: 'lidl', color: '0050AA', label: 'Lidl' } },
  { pattern: /\baldi\b/i, logo: { slug: 'aldi', color: '00005F', label: 'ALDI' } },
  { pattern: /\bikea\b/i, logo: { slug: 'ikea', color: '0058A3', label: 'IKEA' } },
  { pattern: /\bmicrosoft\b|\bxbox\b/i, logo: { slug: 'microsoft', color: '5E5E5E', label: 'Microsoft' } },
  { pattern: /\bsteam\b/i, logo: { slug: 'steam', color: '1B2838', label: 'Steam' } },
  { pattern: /\buber\b/i, logo: { slug: 'uber', color: 'FFFFFF', label: 'Uber' } },
  { pattern: /\bbooking(?:\.com)?\b/i, logo: { slug: 'bookingdotcom', color: '003B95', label: 'Booking.com' } },
  { pattern: /\bairbnb\b/i, logo: { slug: 'airbnb', color: 'FF5A5F', label: 'Airbnb' } },
  { pattern: /\bdb\b|\bdeutsche bahn\b/i, logo: { slug: 'deutschebahn', color: 'EC0016', label: 'Deutsche Bahn' } },
  { pattern: /\bdhl\b/i, logo: { slug: 'dhl', color: 'FFCC00', label: 'DHL' } },
  { pattern: /\bzalando\b/i, logo: { slug: 'zalando', color: 'FF6900', label: 'Zalando' } },
]

export function resolveMerchantLogo(description: string): MerchantLogoDefinition | null {
  const normalized = description.trim()
  if (!normalized) return null
  return LOGOS.find(({ pattern }) => pattern.test(normalized))?.logo ?? null
}

export function merchantLogoUrl(logo: MerchantLogoDefinition): string {
  return `https://cdn.simpleicons.org/${encodeURIComponent(logo.slug)}/${logo.color}`
}
