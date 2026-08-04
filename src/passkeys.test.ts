import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listKnownAccounts, rememberAccount } from './passkeys'

const values = new Map<string, string>()
const storage: Storage = {
  get length() { return values.size },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key) },
  setItem: (key, value) => { values.set(key, String(value)) },
}

vi.stubGlobal('localStorage', storage)

describe('passkey account memory', () => {
  beforeEach(() => storage.clear())

  it('remembers recent accounts without duplicates', () => {
    rememberAccount({ id: 'one', email: 'one@example.com' })
    rememberAccount({ id: 'two', email: 'two@example.com', displayName: 'Two' })
    rememberAccount({ id: 'one', email: 'one@example.com', displayName: 'One' })
    expect(listKnownAccounts().map((account) => account.id)).toEqual(['one', 'two'])
    expect(listKnownAccounts()[0].displayName).toBe('One')
  })

  it('ignores malformed stored values', () => {
    storage.setItem('finance-planner-known-accounts-v1', '{broken')
    expect(listKnownAccounts()).toEqual([])
  })
})
