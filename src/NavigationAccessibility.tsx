import { useEffect } from 'react'

function synchronizeCurrentNavigation(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')]
  if (!buttons.length) return

  const active = buttons.find((button) => button.classList.contains('active')) ?? buttons[0]
  for (const button of buttons) {
    if (button === active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
}

export function NavigationAccessibility() {
  useEffect(() => {
    let frame = 0
    const scheduleSynchronization = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(synchronizeCurrentNavigation)
    }

    scheduleSynchronization()
    const observer = new MutationObserver(scheduleSynchronization)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  return null
}
