import { useEffect, useState } from 'react'

function synchronizeCurrentNavigation(): boolean {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.sidebar nav button')]
  if (!buttons.length) return false

  const active = buttons.find((button) => button.classList.contains('active')) ?? buttons[0]
  for (const button of buttons) {
    if (button === active) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }

  return document.querySelectorAll('.sidebar nav [aria-current="page"]').length === 1
}

export function NavigationAccessibility() {
  const [navigationReady, setNavigationReady] = useState(false)

  useEffect(() => {
    let frame = 0
    const synchronize = () => {
      window.cancelAnimationFrame(frame)
      const readyNow = synchronizeCurrentNavigation()
      setNavigationReady(readyNow)
      frame = window.requestAnimationFrame(() => {
        setNavigationReady(synchronizeCurrentNavigation())
      })
    }

    synchronize()
    const observer = new MutationObserver(synchronize)
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

  return navigationReady
    ? <span className="sr-only" data-dashboard-ready="true">Finanzübersicht</span>
    : null
}
