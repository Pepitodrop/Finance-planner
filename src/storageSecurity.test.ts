// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { configureAuthenticatedStorage, loadLegacyState } from './infrastructure/persistence/storage'

const CURRENT_PLAINTEXT_KEY = 'finance-planner-state-v2'
const OLD_RECOVERY_KEY = 'finance-planner-recovery-state'

describe('legacy plaintext migration security', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not create an orphan plaintext recovery copy for malformed JSON', () => {
    const malformed = '{"accounts":['
    localStorage.setItem(CURRENT_PLAINTEXT_KEY, malformed)
    configureAuthenticatedStorage('storage-security-malformed-user')

    expect(() => loadLegacyState()).toThrow(/nicht verändert/)
    expect(localStorage.getItem(CURRENT_PLAINTEXT_KEY)).toBe(malformed)
    expect(localStorage.getItem(OLD_RECOVERY_KEY)).toBeNull()
  })

  it('does not silently replace an unknown plaintext shape with an empty vault', () => {
    const unknown = JSON.stringify({ unexpected: 'finance data' })
    localStorage.setItem(CURRENT_PLAINTEXT_KEY, unknown)
    configureAuthenticatedStorage('storage-security-unknown-user')

    expect(() => loadLegacyState()).toThrow(/unbekanntes Format/)
    expect(localStorage.getItem(CURRENT_PLAINTEXT_KEY)).toBe(unknown)
    expect(localStorage.getItem(OLD_RECOVERY_KEY)).toBeNull()
  })
})
