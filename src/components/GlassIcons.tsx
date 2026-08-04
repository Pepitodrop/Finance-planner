import type { CSSProperties, ReactElement } from 'react'
import './GlassIcons.css'

const gradientMapping: Record<string, string> = {
  blue: 'linear-gradient(145deg, hsl(223 90% 58%), hsl(208 90% 52%))',
  purple: 'linear-gradient(145deg, hsl(283 90% 58%), hsl(258 90% 50%))',
  red: 'linear-gradient(145deg, hsl(3 90% 58%), hsl(338 90% 52%))',
  indigo: 'linear-gradient(145deg, hsl(253 90% 60%), hsl(228 90% 52%))',
  orange: 'linear-gradient(145deg, hsl(43 95% 58%), hsl(23 92% 52%))',
  green: 'linear-gradient(145deg, hsl(153 80% 44%), hsl(118 75% 40%))',
}

export interface GlassIconsItem {
  icon: ReactElement
  color: string
  label: string
  customClass?: string
  onClick?: () => void
}

interface GlassIconsProps {
  items?: GlassIconsItem[]
  className?: string
}

export function GlassIcons({ items = [], className = '' }: GlassIconsProps) {
  const background = (color: string): CSSProperties => ({ background: gradientMapping[color] || color })

  return <div className={`icon-btns ${className}`.trim()}>
    {items.map((item) => <button
      key={item.label}
      className={`icon-btn ${item.customClass || ''}`.trim()}
      aria-label={item.label}
      title={item.label}
      type="button"
      onClick={item.onClick}
    >
      <span className="icon-btn__back" style={background(item.color)} aria-hidden="true"/>
      <span className="icon-btn__front">
        <span className="icon-btn__icon" aria-hidden="true">{item.icon}</span>
      </span>
      <span className="icon-btn__label">{item.label}</span>
    </button>)}
  </div>
}
