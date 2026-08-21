// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import '../../styles.css'
import './connections.css'
import '../../post-release-fixes.css'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Connections setup modal scroll layout', () => {
  it('lets the content region shrink and own vertical scrolling', () => {
    document.body.innerHTML = `
      <section class="modal connections-setup-modal">
        <div class="connections-setup-content"></div>
        <div class="connections-setup-header"></div>
        <div class="connections-setup-progress"></div>
      </section>
    `

    const dialog = document.querySelector<HTMLElement>('.connections-setup-modal')!
    const content = document.querySelector<HTMLElement>('.connections-setup-content')!
    const header = document.querySelector<HTMLElement>('.connections-setup-header')!
    const progress = document.querySelector<HTMLElement>('.connections-setup-progress')!

    const dialogStyle = getComputedStyle(dialog)
    const contentStyle = getComputedStyle(content)
    const headerStyle = getComputedStyle(header)
    const progressStyle = getComputedStyle(progress)

    expect(dialogStyle.display).toBe('flex')
    expect(dialogStyle.flexDirection).toBe('column')
    expect(contentStyle.flexGrow).toBe('1')
    expect(contentStyle.flexShrink).toBe('1')
    expect(contentStyle.minHeight).toBe('0px')
    expect(contentStyle.overflowY).toBe('auto')
    expect(headerStyle.flexShrink).toBe('0')
    expect(progressStyle.flexShrink).toBe('0')
  })
})
