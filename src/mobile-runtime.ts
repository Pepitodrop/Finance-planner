export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function isStandaloneDisplay(mediaMatches: boolean, navigatorStandalone?: boolean) {
  return mediaMatches || navigatorStandalone === true
}

export function shouldOfferInstall(input: {
  standalone: boolean
  promptAvailable: boolean
  dismissedUntil: number
  now: number
}) {
  return !input.standalone && input.promptAvailable && input.dismissedUntil <= input.now
}

export function installDismissalDeadline(now: number, days = 14) {
  return now + days * 24 * 60 * 60 * 1000
}

export function isSafeServiceWorkerUpdate(registration: ServiceWorkerRegistration | undefined) {
  return Boolean(registration?.waiting && navigator.serviceWorker.controller)
}

export function requestServiceWorkerActivation(registration: ServiceWorkerRegistration | undefined) {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
}
