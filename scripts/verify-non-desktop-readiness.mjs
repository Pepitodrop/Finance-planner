import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const repositoryRoot = new URL('../', import.meta.url)
const configuration = JSON.parse(await readFile(new URL('../config/non-desktop-readiness.json', import.meta.url), 'utf8'))
assert.equal(configuration.schemaVersion, 1)
assert.ok(Number.isInteger(configuration.target) && configuration.target >= 90 && configuration.target <= 100)
assert.ok(Array.isArray(configuration.categories) && configuration.categories.length === configuration.scope.length)

const results = []
for (const category of configuration.categories) {
  assert.ok(configuration.scope.includes(category.id), `Unexpected readiness category: ${category.id}`)
  assert.ok(Array.isArray(category.gates) && category.gates.length > 0, `${category.id} has no gates`)
  assert.ok(Array.isArray(category.externalDependencies) && category.externalDependencies.length > 0, `${category.id} must disclose external dependencies`)
  const totalWeight = category.gates.reduce((sum, gate) => sum + Number(gate.weight || 0), 0)
  assert.equal(totalWeight, 100, `${category.id} gate weights must total 100`)

  let score = 0
  const gates = []
  for (const gate of category.gates) {
    assert.ok(Number.isInteger(gate.weight) && gate.weight > 0, `${category.id}/${gate.id} has an invalid weight`)
    assert.ok(Array.isArray(gate.evidence) && gate.evidence.length > 0, `${category.id}/${gate.id} has no evidence`)
    const evidenceResults = []
    for (const evidence of gate.evidence) {
      const url = new URL(evidence.path, repositoryRoot)
      const content = await readFile(url, 'utf8')
      for (const required of evidence.contains || []) {
        assert.ok(content.includes(required), `${category.id}/${gate.id}: ${evidence.path} is missing required evidence ${JSON.stringify(required)}`)
      }
      evidenceResults.push({ path: evidence.path, verified: true })
    }
    score += gate.weight
    gates.push({ id: gate.id, weight: gate.weight, verified: true, evidence: evidenceResults })
  }
  assert.ok(score >= configuration.target, `${category.label} repository-controlled readiness ${score}% is below ${configuration.target}%`)
  results.push({ id: category.id, label: category.label, repositoryControlledScore: score, target: configuration.target, gates, externalDependencies: category.externalDependencies })
}

assert.deepEqual(results.map((result) => result.id).sort(), [...configuration.scope].sort())
console.log(`Non-desktop readiness gates passed: ${results.map((result) => `${result.label} ${result.repositoryControlledScore}%`).join(', ')}. External acceptance remains separately disclosed.`)
