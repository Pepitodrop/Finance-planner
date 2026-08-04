import type { CSSProperties, ReactNode } from 'react'
import './GradientText.css'

interface GradientTextProps {
  children: ReactNode
  className?: string
  colors?: string[]
  animationSpeed?: number
  direction?: 'horizontal' | 'vertical' | 'diagonal'
  pauseOnHover?: boolean
  showBorder?: boolean
}

export function GradientText({
  children,
  className = '',
  colors = ['#8b5cf6', '#38bdf8', '#f0abfc', '#8b5cf6'],
  animationSpeed = 7,
  direction = 'horizontal',
  pauseOnHover = true,
  showBorder = false,
}: GradientTextProps) {
  const angle = direction === 'vertical' ? 'to bottom' : direction === 'diagonal' ? 'to bottom right' : 'to right'
  const style = {
    '--gradient-text-colors': colors.join(', '),
    '--gradient-text-angle': angle,
    '--gradient-text-speed': `${Math.max(1, animationSpeed)}s`,
  } as CSSProperties

  return <span
    className={`animated-gradient-text ${showBorder ? 'with-border' : ''} ${pauseOnHover ? 'pause-on-hover' : ''} ${className}`.trim()}
    style={style}
  >
    {showBorder && <span className="gradient-overlay" aria-hidden="true"/>}
    <span className="gradient-text-content">{children}</span>
  </span>
}
