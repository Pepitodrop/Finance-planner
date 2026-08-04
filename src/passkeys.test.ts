import { beforeEach, describe, expect, it } from 'vitest'
import { listKnownAccounts, rememberAccount } from './passkeys'

describe('passkey account memory', () => {
  beforeEach(() => localStorage.clear())

  it('remembers recent accounts without duplicates', () => {
    rememberAccount({ id: 'one', email: 'one@example.com' })
    rememberAccount({ id: 'two', email: 'two@example.com', displayName: 'Two' })
    rememberAccount({ id: 'one', email: 'one@example.com', displayName: 'One' })
    expect(listKnownAccounts().map((account) => account.id)).toEqual(['one', 'two'])
    expect(listKnownAccounts()[0].displayName).toBe('One')
  })

  it('ignores malformed stored values', () => {
    localStorage.setItem('finance-planner-known-accounts-v1', '{broken')
    expect(listKnownAccounts()).toEqual([])
  })
})
