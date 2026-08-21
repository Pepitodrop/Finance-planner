// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import '../../styles.css'
import './connections.css'
import '../../post-release-fixes.css'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Connections setup modal scroll layout', () => {
  it('keeps long step content in normal flex flow so the content region owns scrolling', () => {
    document.body.innerHTML = `
      <section class="modal connections-setup-modal">
        <div class="connections-setup-content">
          <h2>Choose your institution</h2>
          <label class="connections-search"><input /></label>
          <div class="connections-categories"><button>Popular</button></div>
          <div class="connections-institution-list"><button class="connections-institution-row">Bank</button></div>
          <p class="connections-footnote">Provider availability depends on your institution and region.</p>
        </div>
        <div class="connections-setup-header"></div>
        <div class="connections-setup-progress"></div>
      </section>
    `

    const dialog = document.querySelector<HTMLElement>('.connections-setup-modal')!
    const content = document.querySelector<HTMLElement>('.connections-setup-content')!
    const institutionList = document.querySelector<HTMLElement>('.connections-institution-list')!
    const header = document.querySelector<HTMLElement>('.connections-setup-header')!
    const progress = document.querySelector<HTMLElement>('.connections-setup-progress')!

    const dialogStyle = getComputedStyle(dialog)
    const contentStyle = getComputedStyle(content)
    const institutionListStyle = getComputedStyle(institutionList)
    const headerStyle = getComputedStyle(header)
    const progressStyle = getComputedStyle(progress)

    expect(dialogStyle.display).toBe('flex')
    expect(dialogStyle.flexDirection).toBe('column')

    expect(contentStyle.display).toBe('flex')
    expect(contentStyle.flexDirection).toBe('column')
    expect(contentStyle.flexGrow).toBe('1')
    expect(contentStyle.flexShrink).toBe('1')
    expect(contentStyle.minHeight).toBe('0px')
    expect(contentStyle.overflowY).toBe('auto')

    // The live regression happened because Grid shrank this overflow:hidden
    // list inside the content region. As a non-shrinking flex child its full
    // intrinsic height instead contributes to the parent's scroll overflow.
    expect(institutionListStyle.flexShrink).toBe('0')

    expect(headerStyle.flexShrink).toBe('0')
    expect(progressStyle.flexShrink).toBe('0')
  })
})
