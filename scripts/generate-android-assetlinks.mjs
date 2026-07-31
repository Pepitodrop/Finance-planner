import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(root, 'public/.well-known/assetlinks.json')
const packageName = process.env.ANDROID_PACKAGE_NAME?.trim() || 'de.luisbenedikt.financeplanner'
const rawFingerprints = process.env.ANDROID_SHA256_CERT_FINGERPRINT || ''

function normalizeFingerprint(value) {
  const compact = value.trim().replace(/[^a-fA-F0-9]/g, '').toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(compact)) {
    throw new Error(`Invalid SHA-256 certificate fingerprint: ${value || '<empty>'}`)
  }
  return compact.match(/.{2}/g).join(':')
}

const fingerprints = [...new Set(rawFingerprints.split(',').filter(Boolean).map(normalizeFingerprint))]
if (fingerprints.length === 0) {
  throw new Error('ANDROID_SHA256_CERT_FINGERPRINT is required. Use a comma-separated list during signing-key rotation.')
}
if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) {
  throw new Error(`Invalid Android package name: ${packageName}`)
}

const statements = [{
  relation: ['delegate_permission/common.handle_all_urls'],
  target: {
    namespace: 'android_app',
    package_name: packageName,
    sha256_cert_fingerprints: fingerprints,
  },
}]

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(statements, null, 2)}\n`, 'utf8')
console.log(`Wrote ${outputPath} for ${packageName} with ${fingerprints.length} certificate fingerprint(s).`)
