import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PACKAGE_SPEC = '@huggingface/transformers@3.8.1'
const PACKAGE_VERSION = '3.8.1'
const EXPECTED_PACKAGE_INTEGRITY = 'sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA=='
const EXPECTED_RUNTIME_SHA256 = 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'
const OUTPUT_PATH = join(process.cwd(), 'public', 'vendor', `transformers-${PACKAGE_VERSION}.min.js`)

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function existingRuntimeIsValid() {
  try {
    return sha256(await readFile(OUTPUT_PATH)) === EXPECTED_RUNTIME_SHA256
  } catch {
    return false
  }
}

if (await existingRuntimeIsValid()) {
  console.log(`Verified vendored Transformers.js runtime: ${OUTPUT_PATH}`)
  process.exit(0)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'finance-planner-transformers-'))
try {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const { stdout } = await execFileAsync(npmExecutable, [
    'pack',
    PACKAGE_SPEC,
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temporaryDirectory,
  ], { maxBuffer: 20 * 1024 * 1024 })

  const packResult = JSON.parse(stdout).at(-1)
  if (!packResult || packResult.version !== PACKAGE_VERSION || !packResult.filename) {
    throw new Error('npm pack returned unexpected package metadata.')
  }
  if (packResult.integrity !== EXPECTED_PACKAGE_INTEGRITY) {
    throw new Error(`Unexpected npm package integrity for ${PACKAGE_SPEC}.`)
  }

  const tarballPath = join(temporaryDirectory, packResult.filename)
  await execFileAsync('tar', [
    '-xzf',
    tarballPath,
    '-C',
    temporaryDirectory,
    'package/dist/transformers.min.js',
  ])

  const runtime = await readFile(join(temporaryDirectory, 'package', 'dist', 'transformers.min.js'))
  if (sha256(runtime) !== EXPECTED_RUNTIME_SHA256) {
    throw new Error(`Unexpected browser-runtime hash for ${PACKAGE_SPEC}.`)
  }

  await mkdir(dirname(OUTPUT_PATH), { recursive: true })
  await writeFile(OUTPUT_PATH, runtime, { mode: 0o644 })
  console.log(`Verified and vendored ${PACKAGE_SPEC} to ${OUTPUT_PATH}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
