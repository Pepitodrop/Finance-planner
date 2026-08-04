import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutDashboard, Link2, ReceiptText } from 'lucide-react'
import { GlassIcons } from './components/GlassIcons'
import { GradientText } from './components/GradientText'

function clickNavigation(label: string) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sidebar nav button'))
  buttons.find((button) => button.textContent?.trim() === label)?.click()
}

export function GlossyQuickActions() {
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar')
    const brand = sidebar?.querySelector<HTMLElement>('.brand')
    if (!sidebar || !brand) return

    const container = document.createElement('section')
    container.className = 'glossy-quick-actions'
    container.setAttribute('aria-label', 'Schnellzugriff')
    brand.insertAdjacentElement('afterend', container)
    setHost(container)
    return () => container.remove()
  }, [])

  if (!host) return null
  return createPortal(<>
    <GradientText className="glossy-quick-title" colors={['#c4b5fd', '#60a5fa', '#f0abfc', '#c4b5fd']} animationSpeed={6}>
      Schnellzugriff
    </GradientText>
    <GlassIcons
      className="glossy-sidebar-icons"
      items={[
        { icon: <LayoutDashboard/>, color: 'purple', label: 'Übersicht', onClick: () => clickNavigation('Übersicht') },
        { icon: <ReceiptText/>, color: 'blue', label: 'Transaktionen', onClick: () => clickNavigation('Transaktionen') },
        { icon: <Link2/>, color: 'indigo', label: 'Verbindungen', onClick: () => clickNavigation('Verbindungen') },
      ]}
    />
  </>, host)
}
