import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const TRANSFORMERS_PACKAGE_SPEC = '@huggingface/transformers@3.8.1'
const TRANSFORMERS_PACKAGE_VERSION = '3.8.1'
const EXPECTED_TRANSFORMERS_PACKAGE_INTEGRITY = 'sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA=='
const EXPECTED_TRANSFORMERS_RUNTIME_SHA256 = 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa'
const ONNX_RUNTIME_PACKAGE_VERSION = '1.22.0-dev.20250409-89f8206ba4'
const ONNX_RUNTIME_PACKAGE_SPEC = `onnxruntime-web@${ONNX_RUNTIME_PACKAGE_VERSION}`
const EXPECTED_ONNX_RUNTIME_PACKAGE_INTEGRITY = 'sha512-0uS76OPgH0hWCPrFKlL8kYVV7ckM7t/36HfbgoFw6Nd0CZVVbQC4PkrR8mBX8LtNUFZO25IQBqV2Hx2ho3FlbQ=='
const VENDOR_DIRECTORY = join(process.cwd(), 'public', 'vendor')
const TRANSFORMERS_CORE_PATH = join(VENDOR_DIRECTORY, `transformers-${TRANSFORMERS_PACKAGE_VERSION}.core.min.js`)
const TRANSFORMERS_WRAPPER_PATH = join(VENDOR_DIRECTORY, `transformers-${TRANSFORMERS_PACKAGE_VERSION}.min.js`)
const ONNX_RUNTIME_DIRECTORY_NAME = `onnxruntime-${ONNX_RUNTIME_PACKAGE_VERSION}`
const ONNX_RUNTIME_OUTPUT_DIRECTORY = join(VENDOR_DIRECTORY, ONNX_RUNTIME_DIRECTORY_NAME)
const ONNX_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
]
const TRANSFORMERS_WRAPPER = `import { env } from './transformers-${TRANSFORMERS_PACKAGE_VERSION}.core.min.js'\n\nconst wasm = env?.backends?.onnx?.wasm\nif (wasm) wasm.wasmPaths = '/vendor/${ONNX_RUNTIME_DIRECTORY_NAME}/'\n\nexport * from './transformers-${TRANSFORMERS_PACKAGE_VERSION}.core.min.js'\n`

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isWasm(buffer) {
  return buffer.length > 5_000_000
    && buffer[0] === 0x00
    && buffer[1] === 0x61
    && buffer[2] === 0x73
    && buffer[3] === 0x6d
}

async function existingRuntimeIsValid() {
  try {
    if (sha256(await readFile(TRANSFORMERS_CORE_PATH)) !== EXPECTED_TRANSFORMERS_RUNTIME_SHA256) return false
    if (await readFile(TRANSFORMERS_WRAPPER_PATH, 'utf8') !== TRANSFORMERS_WRAPPER) return false
    for (const filename of ONNX_RUNTIME_FILES) {
      const asset = await readFile(join(ONNX_RUNTIME_OUTPUT_DIRECTORY, filename))
      if (filename.endsWith('.wasm') ? !isWasm(asset) : asset.length < 10_000) return false
    }
    return true
  } catch {
    return false
  }
}

async function packPackage(npmExecutable, temporaryDirectory, spec, expectedVersion, expectedIntegrity) {
  const { stdout } = await execFileAsync(npmExecutable, [
    'pack',
    spec,
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temporaryDirectory,
  ], { maxBuffer: 20 * 1024 * 1024 })

  const packResult = JSON.parse(stdout).at(-1)
  if (!packResult || packResult.version !== expectedVersion || !packResult.filename) {
    throw new Error(`npm pack returned unexpected package metadata for ${spec}.`)
  }
  if (packResult.integrity !== expectedIntegrity) {
    throw new Error(`Unexpected npm package integrity for ${spec}.`)
  }
  return join(temporaryDirectory, packResult.filename)
}

if (await existingRuntimeIsValid()) {
  console.log(`Verified vendored Transformers.js and ONNX Runtime assets in ${VENDOR_DIRECTORY}`)
  process.exit(0)
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'finance-planner-transformers-'))
try {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const transformersTarball = await packPackage(
    npmExecutable,
    temporaryDirectory,
    TRANSFORMERS_PACKAGE_SPEC,
    TRANSFORMERS_PACKAGE_VERSION,
    EXPECTED_TRANSFORMERS_PACKAGE_INTEGRITY,
  )
  const onnxRuntimeTarball = await packPackage(
    npmExecutable,
    temporaryDirectory,
    ONNX_RUNTIME_PACKAGE_SPEC,
    ONNX_RUNTIME_PACKAGE_VERSION,
    EXPECTED_ONNX_RUNTIME_PACKAGE_INTEGRITY,
  )

  const transformersExtraction = join(temporaryDirectory, 'transformers')
  const onnxRuntimeExtraction = join(temporaryDirectory, 'onnxruntime')
  await mkdir(transformersExtraction, { recursive: true })
  await mkdir(onnxRuntimeExtraction, { recursive: true })

  await execFileAsync('tar', [
    '-xzf',
    transformersTarball,
    '-C',
    transformersExtraction,
    'package/dist/transformers.min.js',
  ])
  await execFileAsync('tar', [
    '-xzf',
    onnxRuntimeTarball,
    '-C',
    onnxRuntimeExtraction,
    ...ONNX_RUNTIME_FILES.map((filename) => `package/dist/${filename}`),
  ])

  const transformersRuntime = await readFile(join(transformersExtraction, 'package', 'dist', 'transformers.min.js'))
  if (sha256(transformersRuntime) !== EXPECTED_TRANSFORMERS_RUNTIME_SHA256) {
    throw new Error(`Unexpected browser-runtime hash for ${TRANSFORMERS_PACKAGE_SPEC}.`)
  }

  await mkdir(dirname(TRANSFORMERS_CORE_PATH), { recursive: true })
  await mkdir(ONNX_RUNTIME_OUTPUT_DIRECTORY, { recursive: true })
  await writeFile(TRANSFORMERS_CORE_PATH, transformersRuntime, { mode: 0o644 })
  await writeFile(TRANSFORMERS_WRAPPER_PATH, TRANSFORMERS_WRAPPER, { mode: 0o644 })

  for (const filename of ONNX_RUNTIME_FILES) {
    const asset = await readFile(join(onnxRuntimeExtraction, 'package', 'dist', filename))
    if (filename.endsWith('.wasm') && !isWasm(asset)) {
      throw new Error(`Invalid ONNX Runtime WASM asset: ${filename}`)
    }
    await writeFile(join(ONNX_RUNTIME_OUTPUT_DIRECTORY, filename), asset, { mode: 0o644 })
  }

  console.log(`Verified and vendored ${TRANSFORMERS_PACKAGE_SPEC} with ${ONNX_RUNTIME_PACKAGE_SPEC}`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
