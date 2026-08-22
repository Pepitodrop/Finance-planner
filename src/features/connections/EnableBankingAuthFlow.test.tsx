import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnableBankingAuthFlow } from './EnableBankingAuthFlow'

vi.mock('./enableBankingWidgetLoader', () => ({
  loadEnableBankingAuthFlowWidget: vi.fn(),
  ENABLE_BANKING_WIDGET_ELEMENT_TAG: 'enablebanking-auth-flow',
}))

import { loadEnableBankingAuthFlowWidget } from './enableBankingWidgetLoader'

afterEach(() => { cleanup(); vi.clearAllMocks() })

async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

describe('EnableBankingAuthFlow', () => {
  it('5. creates the widget element with the exact authorization id and origin once the loader resolves', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container } = render(<EnableBankingAuthFlow authorizationId="auth-123" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    const element = container.querySelector('enablebanking-auth-flow')
    expect(element).not.toBeNull()
    expect(element?.getAttribute('authorization')).toBe('auth-123')
    expect(element?.getAttribute('origin')).toBe('https://auth.enablebanking.com')
    expect(element?.getAttribute('locale')).toBe('EN')
  })

  it('6a. sets the sandbox attribute (present, empty value) when sandbox is true', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://tilisy-sandbox.enablebanking.com" sandbox onStatusChange={vi.fn()}/>)
    await flush()
    const element = container.querySelector('enablebanking-auth-flow')
    expect(element?.hasAttribute('sandbox')).toBe(true)
    expect(element?.getAttribute('sandbox')).toBe('')
  })

  it('6b. omits the sandbox attribute entirely when sandbox is false', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    const element = container.querySelector('enablebanking-auth-flow')
    expect(element?.hasAttribute('sandbox')).toBe(false)
  })

  it('shows an explicit test-environment warning for sandbox authorizations', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { getByRole } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://tilisy-sandbox.enablebanking.com" sandbox onStatusChange={vi.fn()}/>)
    await flush()
    const note = getByRole('note', { name: 'Sandbox test environment' })
    expect(note.textContent).toContain('Sandbox test')
    expect(note.textContent).toContain('test credentials only')
    expect(note.textContent).toContain('Never enter credentials from a real bank account')
  })

  it('does not show the sandbox warning for production authorizations', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { queryByRole } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    expect(queryByRole('note', { name: 'Sandbox test environment' })).toBeNull()
  })

  it('7. reports "ready" when the widget fires its ready event', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const onStatusChange = vi.fn()
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={onStatusChange}/>)
    await flush()
    act(() => { container.querySelector('enablebanking-auth-flow')?.dispatchEvent(new Event('ready')) })
    expect(onStatusChange).toHaveBeenCalledWith('ready')
  })

  it('reports "ready" when the widget fires ais-loaded instead of ready', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const onStatusChange = vi.fn()
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={onStatusChange}/>)
    await flush()
    act(() => { container.querySelector('enablebanking-auth-flow')?.dispatchEvent(new Event('ais-loaded')) })
    expect(onStatusChange).toHaveBeenCalledWith('ready')
  })

  it('8/9. reports "error" when the widget fires an error event, and never inspects/logs the event payload', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const onStatusChange = vi.fn()
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={onStatusChange}/>)
    await flush()
    act(() => { container.querySelector('enablebanking-auth-flow')?.dispatchEvent(new CustomEvent('error', { detail: { message: 'sensitive provider-internal detail' } })) })
    expect(onStatusChange).toHaveBeenCalledWith('error')
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('9. reports "error" when the script loader itself rejects', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockRejectedValue(new Error('script failed'))
    const onStatusChange = vi.fn()
    render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={onStatusChange}/>)
    await flush()
    expect(onStatusChange).toHaveBeenCalledWith('error')
  })

  it('removes the widget element and its listeners on unmount', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container, unmount } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    expect(container.querySelector('enablebanking-auth-flow')).not.toBeNull()
    unmount()
    expect(document.querySelector('enablebanking-auth-flow')).toBeNull()
  })

  it('recreates the widget element when the authorizationId changes, never reusing the previous one', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container, rerender } = render(<EnableBankingAuthFlow authorizationId="auth-1" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    const firstElement = container.querySelector('enablebanking-auth-flow')
    rerender(<EnableBankingAuthFlow authorizationId="auth-2" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    const secondElement = container.querySelector('enablebanking-auth-flow')
    expect(secondElement).not.toBe(firstElement)
    expect(secondElement?.getAttribute('authorization')).toBe('auth-2')
  })

  it('fixtureStatus bypasses the loader entirely and reports the given status immediately, contacting no script', async () => {
    const onStatusChange = vi.fn()
    render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={onStatusChange} fixtureStatus="error"/>)
    await flush()
    expect(loadEnableBankingAuthFlowWidget).not.toHaveBeenCalled()
    expect(onStatusChange).toHaveBeenCalledWith('error')
  })

  it('11. never renders any credential-shaped input inside the wrapper -- the widget internal DOM is opaque and untouched', async () => {
    vi.mocked(loadEnableBankingAuthFlowWidget).mockResolvedValue(undefined)
    const { container } = render(<EnableBankingAuthFlow authorizationId="a" origin="https://auth.enablebanking.com" sandbox={false} onStatusChange={vi.fn()}/>)
    await flush()
    expect(container.querySelectorAll('input')).toHaveLength(0)
  })
})
