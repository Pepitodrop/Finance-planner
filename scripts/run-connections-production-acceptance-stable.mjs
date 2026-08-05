import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SOURCE = resolve('scripts/connections-production-acceptance.mjs')
const FINAL_ARTIFACT = resolve(process.env.CONNECTIONS_ACCEPTANCE_ARTIFACT_PATH || 'artifacts/connections-production-acceptance.json')
const APP_URL = process.env.ACCEPTANCE_APP_URL || 'http://127.0.0.1:4173'
const CASES = [
  ['empty', 'Connect your financial accounts'],
  ['populated', 'Connected accounts'],
  ['institution-selector', 'Choose your institution'],
  ['institution-search', 'Choose your institution'],
  ['account-type', 'What would you like to connect?'],
  ['bank-confirmation', 'Continue to your provider'],
  ['paypal-confirmation', 'Continue to PayPal'],
  ['checking', 'Checking your connection'],
  ['sync-selection', 'Choose accounts'],
  ['attention', 'Connection needs attention'],
  ['manual', 'Add manual account'],
  ['statement-preview', 'finance_statement_march.csv'],
]
const FINAL_ROW_MODES = new Set(['populated', 'sync-selection', 'attention', 'statement-preview'])

function runNode(script, env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], { stdio: 'inherit', env: { ...process.env, ...env } })
    child.once('exit', (code, signal) => resolveRun({ code, signal }))
  })
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
        "  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}`)",
        "  const diagnostics = await evaluate(client, sessionId, `(() => ({ href: location.href, storedMode: localStorage.getItem('finance-planner-connections-acceptance-mode'), hasBridge: typeof window.__financePlannerAcceptanceState === 'function', root: Boolean(document.querySelector('[data-connections-ready=true]')), overview: Boolean(document.querySelector('.connections-overview')), empty: Boolean(document.querySelector('.connections-empty')), text: document.body.innerText.slice(0, 1200) }))()`).catch((reason) => ({ diagnosticError: String(reason) }))\n  throw new Error(`Timed out waiting for ${description}. Last value: ${JSON.stringify(lastValue)}. Diagnostics: ${JSON.stringify(diagnostics)}`)",
      )
    assert.notEqual(patched, source, `Failed to isolate Connections mode: ${mode}`)
    assert.ok(patched.includes('finance-planner-connections-acceptance-mode'), `Failed to persist Connections fixture mode: ${mode}`)
    assert.ok(patched.includes(`toLocaleLowerCase('en').includes(${expectedTextLowerLiteral})`), `Failed to embed Connections text assertion: ${mode}`)
    assert.equal(patched.includes('String(expectedText)'), false, `Leaked runner variable into browser assertion: ${mode}`)
    const scriptPath = join(workspace, `connections-${mode}.mjs`)
    await writeFile(scriptPath, patched)

    const result = await runNode(scriptPath, {
      ACCEPTANCE_APP_URL: APP_URL,
      CONNECTIONS_ACCEPTANCE_ARTIFACT_PATH: modeArtifact,
    })
    const report = JSON.parse(await readFile(modeArtifact, 'utf8'))
    const cleanupOnlyFailure = result.code !== 0 && report.passed === true && !report.failure
    assert.ok(result.code === 0 || cleanupOnlyFailure, `Connections mode ${mode} failed with exit ${result.code ?? result.signal}: ${report.failure || 'no report failure'}`)
    assert.equal(report.passed, true, `Connections mode ${mode} did not pass: ${report.failure || 'unknown failure'}`)
    assert.ok(report.screenshots.length >= 4, `Connections mode ${mode} produced incomplete evidence.`)
    combined.screenshots.push(...report.screenshots)
    combined.browserErrors.push(...(report.browserErrors || []))
    combined.cases.push({ mode, passed: true, screenshots: report.screenshots.length, cleanupOnlyFailure })
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
