import { useEffect } from 'react'

function synchronizeCurrentNavigation(): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')]
  const active = buttons.find((button) => button.classList.contains('active'))
  for (const button of buttons) {
    if (button === active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
}

export function NavigationAccessibility() {
  useEffect(() => {
    synchronizeCurrentNavigation()
    const observer = new MutationObserver(synchronizeCurrentNavigation)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    return () => observer.disconnect()
  }, [])

  return null
}
