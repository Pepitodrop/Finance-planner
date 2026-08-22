// Lazy loader for Enable Banking's official Auth Flow widget library
// (https://enablebanking.com/docs/api/widgets/#auth-flow). Not loaded
// globally on every Finance Planner page -- only invoked once a real
// Enable Banking /start response has produced a validated authFlow
// descriptor (see ConnectionsPage.tsx / EnableBankingAuthFlow.tsx).

// Fixed constant only. Never take this URL from provider/user input --
// server.js's /start response never carries a script URL at all, and this
// module is the only place this string is allowed to appear.
const WIDGET_SCRIPT_URL = 'https://auth.enablebanking.com/lib/widgets.umd.min.js'
const WIDGET_ELEMENT_TAG = 'enablebanking-auth-flow'
const LOAD_TIMEOUT_MS = 10_000

let loadPromise: Promise<void> | null = null

function alreadyRegistered(): boolean {
  return typeof customElements !== 'undefined' && Boolean(customElements.get(WIDGET_ELEMENT_TAG))
}

function attemptLoad(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (alreadyRegistered()) { resolve(); return }

    let settled = false
    const settle = (action: () => void) => { if (settled) return; settled = true; window.clearTimeout(timeout); action() }
    const timeout = window.setTimeout(() => settle(() => reject(new Error('Loading the secure bank authorization widget timed out.'))), LOAD_TIMEOUT_MS)

    // Always remove any tag a previous attempt left behind before creating
    // a fresh one, rather than reusing it. A `<script>` element that already
    // fired its `error` event never refetches just because new listeners are
    // attached to it -- reusing it silently turned "Try again" into a
    // guaranteed hang until this function's own timeout, never a real retry.
    // The only case this discards a genuinely still-pending load (e.g. an
    // earlier mount unmounted before its `load`/`error` fired) is rare and
    // merely costs one redundant fetch of the same fixed URL, which is a far
    // safer failure mode than a retry that can never succeed.
    for (const stale of document.querySelectorAll<HTMLScriptElement>('script[data-enablebanking-widget-loader="1"]')) stale.remove()

    const script = document.createElement('script')
    script.src = WIDGET_SCRIPT_URL
    script.async = true
    // Enable Banking is a third-party origin; withholding the full referrer
    // (which could otherwise carry this page's own URL/query) is the safer
    // default for a script load that isn't itself an API call carrying
    // Finance Planner data.
    script.referrerPolicy = 'strict-origin-when-cross-origin'
    script.dataset.enablebankingWidgetLoader = '1'
    script.addEventListener('load', () => {
      // whenDefined() resolves immediately if the element is already
      // defined by the time the script's load event fires, and waits
      // otherwise -- this is the "verify customElements.get(...) after
      // load" check, done robustly against the element being registered a
      // tick after the script itself finishes executing.
      customElements.whenDefined(WIDGET_ELEMENT_TAG).then(() => settle(resolve)).catch(() => settle(() => reject(new Error('The secure bank authorization widget did not register correctly.'))))
    }, { once: true })
    script.addEventListener('error', () => settle(() => reject(new Error('The secure bank authorization widget could not be loaded.'))), { once: true })
    document.head.appendChild(script)
  })
}

// Concurrent callers share one in-flight Promise. A failed attempt does not
// permanently poison the module -- clearing loadPromise on rejection lets a
// later retry (e.g. the user pressing "Try again" in the widget's error
// fallback) actually attempt to load again instead of forever replaying the
// same failure.
export function loadEnableBankingAuthFlowWidget(): Promise<void> {
  if (alreadyRegistered()) return Promise.resolve()
  if (!loadPromise) {
    loadPromise = attemptLoad().catch((error: unknown) => {
      loadPromise = null
      throw error
    })
  }
  return loadPromise
}

export function __resetEnableBankingAuthFlowWidgetLoaderForTests(): void {
  loadPromise = null
}

export const ENABLE_BANKING_WIDGET_SCRIPT_URL = WIDGET_SCRIPT_URL
export const ENABLE_BANKING_WIDGET_ELEMENT_TAG = WIDGET_ELEMENT_TAG
