// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENABLE_BANKING_WIDGET_ELEMENT_TAG, ENABLE_BANKING_WIDGET_SCRIPT_URL, __resetEnableBankingAuthFlowWidgetLoaderForTests, loadEnableBankingAuthFlowWidget } from './enableBankingWidgetLoader'

function appendedScripts(): HTMLScriptElement[] {
  return Array.from(document.head.querySelectorAll<HTMLScriptElement>(`script[src="${ENABLE_BANKING_WIDGET_SCRIPT_URL}"]`))
}

// customElements.define() can only ever be called ONCE per tag name for the
// lifetime of the whole test process (jsdom throws NotSupportedError on a
// second call, matching real browser behavior) -- every test below except
// the dedicated "already registered" one at the very end must run with the
// tag still undefined, so ordering here is deliberate, not incidental.
describe('loadEnableBankingAuthFlowWidget', () => {
  beforeEach(() => {
    __resetEnableBankingAuthFlowWidgetLoaderForTests()
    for (const script of appendedScripts()) script.remove()
  })
  afterEach(() => { vi.useRealTimers() })

  it('3. appends exactly one <script> tag for the fixed, constant widget URL -- never a provider/user-suppliable value', async () => {
    const promise = loadEnableBankingAuthFlowWidget()
    expect(appendedScripts()).toHaveLength(1)
    expect(appendedScripts()[0].src).toBe(ENABLE_BANKING_WIDGET_SCRIPT_URL)
    appendedScripts()[0].dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow()
  })

  it('4. concurrent callers share exactly one Promise and never inject a second <script> tag', async () => {
    const first = loadEnableBankingAuthFlowWidget()
    const second = loadEnableBankingAuthFlowWidget()
    expect(first).toBe(second)
    expect(appendedScripts()).toHaveLength(1)
    appendedScripts()[0].dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow()
  })

  it('a fresh call after the module "forgot" its promise (e.g. an unmounted component) replaces any stale tag with a brand new one, rather than waiting on it forever', async () => {
    const firstAttempt = loadEnableBankingAuthFlowWidget()
    const firstScript = appendedScripts()[0]
    // Simulate the module having "forgotten" its in-flight promise (e.g. a
    // component unmounted) while the script tag itself is still there.
    __resetEnableBankingAuthFlowWidgetLoaderForTests()
    expect(appendedScripts()).toHaveLength(1)
    const secondAttempt = loadEnableBankingAuthFlowWidget()
    expect(appendedScripts()).toHaveLength(1)
    // A genuinely fresh <script> element, not the same stale node reused --
    // this is what makes a retry able to actually re-fetch instead of
    // waiting on a tag whose network request already settled.
    expect(appendedScripts()[0]).not.toBe(firstScript)
    appendedScripts()[0].dispatchEvent(new Event('error'))
    await expect(secondAttempt).rejects.toThrow()
    // The original, now-orphaned promise never settles on its own here
    // (nothing dispatches on the removed node), so only assert the live one.
    void firstAttempt
  })

  it('handles script load failure with a safe, generic error', async () => {
    const promise = loadEnableBankingAuthFlowWidget()
    appendedScripts()[0].dispatchEvent(new Event('error'))
    await expect(promise).rejects.toThrow('The secure bank authorization widget could not be loaded.')
  })

  it('times out with a safe error if the script neither loads nor errors', async () => {
    vi.useFakeTimers()
    const promise = loadEnableBankingAuthFlowWidget()
    const assertion = expect(promise).rejects.toThrow('Loading the secure bank authorization widget timed out.')
    await vi.advanceTimersByTimeAsync(11_000)
    await assertion
  })

  // Regression coverage (security review, 2026-08-22): the original
  // implementation reused a previous, already-failed <script> tag on retry
  // instead of removing it, so "Try again" could never actually re-fetch --
  // it just waited on a tag whose error event had already fired, hanging
  // until this module's own timeout. The fix removes any stale tag before
  // creating a fresh one on every attempt.
  it('a failed attempt does not permanently poison the module -- a later call creates a genuinely fresh, independently-functioning script tag', async () => {
    const firstPromise = loadEnableBankingAuthFlowWidget()
    const firstScript = appendedScripts()[0]
    firstScript.dispatchEvent(new Event('error'))
    await expect(firstPromise).rejects.toThrow()

    // No manual cleanup here -- the production code itself must remove the
    // stale failed tag, not the caller.
    const secondPromise = loadEnableBankingAuthFlowWidget()
    expect(secondPromise).not.toBe(firstPromise)
    expect(appendedScripts()).toHaveLength(1)
    expect(appendedScripts()[0]).not.toBe(firstScript)
    // Dispatching on the FIRST (removed, stale) script must have no effect
    // on the second attempt -- proving the second promise is genuinely
    // listening to its own fresh tag, not still attached to the old one.
    firstScript.dispatchEvent(new Event('load'))
    appendedScripts()[0].dispatchEvent(new Event('error'))
    await expect(secondPromise).rejects.toThrow('The secure bank authorization widget could not be loaded.')
  })

  // Must run last -- see the top-of-file note on customElements.define()'s
  // one-shot nature. Guarded with a get() check (found by review, 2026-08-22):
  // Vitest's threaded pool can run more than one test file inside the same
  // shared jsdom environment, resetting only the module cache between files,
  // not the customElements registry -- an unconditional define() here can
  // intermittently throw NotSupportedError if some other file in the same
  // worker batch already registered this tag (e.g. a re-run of this same
  // file within one worker). The guard makes this test's own assertion
  // (widget already registered -> resolves without a script tag) hold either
  // way, regardless of which invocation actually performed the definition.
  it('resolves immediately without appending a script tag once the custom element is already registered', async () => {
    if (!customElements.get(ENABLE_BANKING_WIDGET_ELEMENT_TAG)) customElements.define(ENABLE_BANKING_WIDGET_ELEMENT_TAG, class extends HTMLElement {})
    await expect(loadEnableBankingAuthFlowWidget()).resolves.toBeUndefined()
    expect(appendedScripts()).toHaveLength(0)
  })
})
