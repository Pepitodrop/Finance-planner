import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAssistant } from './assistant'
import { initialState } from './data'

describe('hosted assistant fallback provenance', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a backend deterministic fallback with its formatted answer and warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        summary: 'Regelbasierte Analyse verfügbar; das Sprachmodell konnte nicht sicher verwendet werden.',
        confidence: 0.7,
        signals: [],
        source: 'deterministic-fallback',
        warnings: ['Hugging Face inference timed out'],
      }),
    }))

    const request = runAssistant('analysis', initialState, 'Analysiere meine Finanzen', 'hosted', true)

    await expect(request).rejects.toMatchObject({
      name: 'HostedAiFallbackError',
      message: expect.stringContaining('Hugging Face inference timed out'),
      fallbackAnswer: expect.stringContaining('Regelbasierte Analyse verfügbar'),
    })
  })
})
