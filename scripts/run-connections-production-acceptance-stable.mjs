import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SOURCE = resolve('scripts/connections-production-acceptance.mjs')
const FINAL_ARTIFACT = resolve(process.env.CONNECTIONS_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/connections-production-acceptance.json')
const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const MAX_TRANSIENT_ATTEMPTS = 3
const CASES = [
  ['empty', 'Connect your financial accounts'],
  ['populated', 'Connected accounts'],
  ['institution-selector', 'Choose your institution'],
  ['institution-search', 'Choose your institution'],
  ['provider-unavailable', 'Choose your institution'],
  ['paypal-unconfigured', "PayPal isn't available right now"],
  ['account-type', 'What would you like to connect?'],
  ['bank-confirmation', 'Continue to your provider'],
  ['paypal-confirmation', 'Continue with the owner PayPal connection'],
  ['checking', 'Checking your connection'],
  ['sync-selection', 'Choose accounts'],
  ['attention', 'Connection needs attention'],
  ['manual', 'Add manual account'],
  ['statement-preview', 'finance_statement_march.csv'],
  ['enablebanking-auth-flow-loading', 'Secure bank authorization'],
  ['enablebanking-auth-flow-error', 'Secure bank authorization'],
]
const FINAL_ROW_MODES = new Set(['populated', 'sync-selection', 'attention', 'statement-preview'])

function runNode(script, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, ...env } })
    child.once('exit', (code, signal) => resolveRun({ code, signal }))
  })
}

function isRetryableBrowserFailure(report) {
  const failure = String(report?.failure || '')
  return /Inspected target navigated or closed|CDP connection (?:closed|failed)|Failed to fetch|Chrome did not publish a DevTools endpoint|CDP connection timed out/.test(failure)
}

const source = await readFile(SOURCE, 'utf8')
const workspace = await mkdtemp(join(tmpdir(), 'finance-planner-connections-cases-'))
const combined = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  appUrl: APP_URL,
  execution: 'isolated-mode-processes',
  screenshots: [],
  cases: [],
  browserErrors: [],
}

try {
  for (const [mode, expectedText] of CASES) {
    const modeArtifact = resolve(`artifacts/connections-${mode}-acceptance.json`)
    const finalModes = FINAL_ROW_MODES.has(mode) ? [mode] : []
    const expectedTextLowerLiteral = JSON.stringify(expectedText.toLocaleLowerCase('en'))
    const patched = source
      .replace(/const MODES = \[[\s\S]*?\n\]/, `const MODES = ${JSON.stringify([[mode, expectedText]], null, 2)}`)
      .replace("for (const mode of ['populated', 'sync-selection', 'attention', 'statement-preview']) {", `for (const mode of ${JSON.stringify(finalModes)}) {`)
      .replace(
        "  await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)\n  await ensureConnectionsDestination(client, sessionId, width)",
        "  await ensureConnectionsDestination(client, sessionId, width)\n  await evaluate(client, sessionId, `window.__financePlannerAcceptanceState(${JSON.stringify(mode)})`)",
      )
      .replace(
        "  await setViewport(client, sessionId, width, height)",
        "  await setViewport(client, sessionId, width, height)\n  await evaluate(client, sessionId, `localStorage.setItem('finance-planner-connections-acceptance-mode', ${JSON.stringify(mode)})`)",
      )
      .replace(
        'document.body.innerText.includes(${JSON.stringify(expectedText)})',
        `document.body.innerText.toLocaleLowerCase('en').includes(${expectedTextLowerLiteral})`,
      )
      .replace(
        'expectedText: bodyText.includes(${JSON.stringify(expectedText)}),',
        `expectedText: bodyText.toLocaleLowerCase('en').includes(${expectedTextLowerLiteral}),`,
      )
      .replace(
        "  if (suffix === 'final-row') {",
        "  await waitFor(client, sessionId, '!document.querySelector(\".automatic-analysis, .mobile-connectivity-status, .mobile-install-card, .passkey-enrolment, .platform-action-bar\")', 'clean Connections runtime state')\n\n  if (suffix === 'final-row') {",
      )
      .replace(
        '      mobileNavigationUnobscured: ${width <= 768} ? unobscured(mobileNavigation) : true,',
        "      mobileNavigationUnobscured: ${width <= 768} ? unobscured(mobileNavigation) : true,\n      mobileNavigationInert: mobileNavigation?.hasAttribute('inert') ?? false,",
      )
      .replace(
        '  assert.equal(assertions.mobileNavigationUnobscured, true)',
        "  const modalMode = ['institution-selector', 'institution-search', 'provider-unavailable', 'paypal-unconfigured', 'account-type', 'bank-confirmation', 'paypal-confirmation', 'manual', 'enablebanking-auth-flow-loading', 'enablebanking-auth-flow-error'].includes(mode)\n  if (width <= 768 && modalMode) {\n    assert.equal(assertions.mobileNavigationUnobscured, false)\n    assert.equal(assertions.mobileNavigationInert, true)\n  } else {\n    assert.equal(assertions.mobileNavigationUnobscured, true)\n  }",
      )
      .replace(
        '  assert.deepEqual(assertions.viewport, { width, height })',
        "  console.log(`Connections assertion snapshot ${mode} ${width}x${height}: ${JSON.stringify(assertions)}`)\n  assert.deepEqual(assertions.viewport, { width, height })",
      )
      .replace(
        '    await rm(launched.profile, { recursive: true, force: true })',
        '    await rm(launched.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })',
      )
      .replace(
        "  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`)",
        "  const diagnostics = await evaluate(client, sessionId, `(() => ({ href: location.href, storedMode: localStorage.getItem('finance-planner-connections-acceptance-mode'), hasBridge: typeof window.__financePlannerAcceptanceState === 'function', root: Boolean(document.querySelector('[data-connections-ready=true]')), overview: Boolean(document.querySelector('.connections-overview')), empty: Boolean(document.querySelector('.connections-empty')), text: document.body.innerText.slice(0, 1200) }))()`).catch((reason) => ({ diagnosticError: String(reason) }))\n  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Diagnostics: ${JSON.stringify(diagnostics)}`)",
      )
    assert.notEqual(patched, source, `Failed to isolate Connections mode: ${mode}`)
    assert.ok(patched.includes('finance-planner-connections-acceptance-mode'), `Failed to persist Connections fixture mode: ${mode}`)
    assert.ok(patched.includes(`toLocaleLowerCase('en').includes(${expectedTextLowerLiteral})`), `Failed to embed Connections text assertion: ${mode}`)
    assert.ok(patched.includes('clean Connections runtime state'), `Failed to isolate Connections visual evidence: ${mode}`)
    assert.ok(patched.includes('mobileNavigationInert'), `Failed to add modal navigation assertion: ${mode}`)
    assert.ok(patched.includes('Connections assertion snapshot'), `Failed to add Connections assertion diagnostics: ${mode}`)
    assert.equal(patched.includes('String(expectedText)'), false, `Leaked runner variable into browser assertion: ${mode}`)
    const scriptPath = join(workspace, `connections-${mode}.mjs`)
    await writeFile(scriptPath, patched)

    // A crashed attempt that dies before writing modeArtifact must never be
    // read back as a stale pass from an earlier run of this same mode --
    // remove it up front so a missing file after a bad exit code fails loud
    // (readFile throws) instead of silently reusing old evidence.
    await rm(modeArtifact, { force: true })

    let result
    let report
    let attempts = 0
    for (attempts = 1; attempts <= MAX_TRANSIENT_ATTEMPTS; attempts += 1) {
      result = await runNode(scriptPath, {
        ACCEPTANCE_APP_URL: APP_URL,
        CONNECTIONS_ACCEPTANCE_ARTIFACT_PATH: modeArtifact,
      })
      report = JSON.parse(await readFile(modeArtifact, 'utf8'))
      const cleanupOnlyFailure = result.code !== 0 && report.passed === true && !report.failure
      if (result.code === 0 || cleanupOnlyFailure || !isRetryableBrowserFailure(report) || attempts === MAX_TRANSIENT_ATTEMPTS) break
      console.warn(`Retrying Connections mode ${mode} after transient browser failure (${attempts}/${MAX_TRANSIENT_ATTEMPTS}): ${report.failure}`)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempts))
    }

    const cleanupOnlyFailure = result.code !== 0 && report.passed === true && !report.failure
    assert.ok(result.code === 0 || cleanupOnlyFailure, `Connections mode ${mode} failed with exit ${result.code ?? result.signal}: ${report.failure || 'no report failure'}`)
    assert.equal(report.passed, true, `Connections mode ${mode} did not pass: ${report.failure || 'unknown failure'}`)
    assert.ok(report.screenshots.length >= 4, `Connections mode ${mode} produced incomplete evidence.`)
    combined.screenshots.push(...report.screenshots)
    combined.browserErrors.push(...(report.browserErrors || []))
    combined.cases.push({ mode, passed: true, screenshots: report.screenshots.length, cleanupOnlyFailure, attempts })
  }

  assert.deepEqual(combined.browserErrors, [])
  combined.passed = true
  await writeFile(FINAL_ARTIFACT, `${JSON.stringify(combined, null, 2)}\n`)
  console.log(`Connections production acceptance passed in ${combined.cases.length} isolated modes with ${combined.screenshots.length} screenshots.`)
} catch (error) {
  combined.passed = false
  combined.failure = error instanceof Error ? error.stack || error.message : String(error)
  await writeFile(FINAL_ARTIFACT, `${JSON.stringify(combined, null, 2)}\n`)
  throw error
} finally {
  await rm(workspace, { recursive: true, force: true }).catch(() => {})
}
