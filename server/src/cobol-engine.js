import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const defaultBinary = path.resolve(here, '../../build/transaction-rules')

function parseResult(stdout) {
  const line = String(stdout).trim().split(/\r?\n/).at(-1) ?? ''
  const parts = line.split('|')
  if (parts[0] !== 'OK') throw new Error(`COBOL engine rejected request: ${line || 'empty response'}`)
  return parts.slice(1)
}

async function run(args, env = process.env) {
  const binary = env.COBOL_TRANSACTION_ENGINE || defaultBinary
  try {
    const { stdout } = await execFileAsync(binary, args, { timeout: 5000, windowsHide: true })
    return parseResult(stdout)
  } catch (error) {
    if (env.ALLOW_JS_FINANCE_FALLBACK === 'true' && env.NODE_ENV !== 'production') return null
    throw new Error(`Authoritative COBOL finance engine unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function normalizeSignedAmount(amountCents, env = process.env) {
  if (!Number.isSafeInteger(amountCents)) throw new Error('Amount must be a safe integer number of cents.')
  const result = await run(['NORMALIZE', String(amountCents)], env)
  if (!result) return { type: amountCents < 0 ? 'expense' : 'income', amountCents: Math.abs(amountCents) }
  const [type, amount] = result
  const normalized = Number(amount)
  if (!['income', 'expense'].includes(type) || !Number.isSafeInteger(normalized) || normalized < 0) {
    throw new Error('COBOL engine returned an invalid normalized amount.')
  }
  return { type, amountCents: normalized }
}

export async function applyTransactionBalance(balanceCents, amountCents, type, env = process.env) {
  if (!Number.isSafeInteger(balanceCents) || !Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error('Balances and amounts must use integer cents.')
  const result = await run(['APPLY', String(balanceCents), String(amountCents), type], env)
  if (!result) return balanceCents + (type === 'income' ? amountCents : -amountCents)
  const next = Number(result[0])
  if (!Number.isSafeInteger(next)) throw new Error('COBOL engine returned an invalid balance.')
  return next
}

export async function projectSavingsBalance(balanceCents, monthlyContributionCents, months, env = process.env) {
  if (!Number.isSafeInteger(balanceCents) || !Number.isSafeInteger(monthlyContributionCents)) {
    throw new Error('Balance and monthly contribution must use integer cents.')
  }
  if (!Number.isSafeInteger(months) || months < 0 || months > 1200) {
    throw new Error('Months must be an integer between 0 and 1200.')
  }
  const result = await run(['PROJECT', String(balanceCents), String(monthlyContributionCents), String(months)], env)
  if (!result) return balanceCents + monthlyContributionCents * months
  const projected = Number(result[0])
  if (!Number.isSafeInteger(projected)) throw new Error('COBOL engine returned an invalid savings projection.')
  return projected
}
