import { readFile } from 'node:fs/promises'
import { hashTestPassword } from '../src/test-password-auth.js'

const password = (await readFile(0, 'utf8')).replace(/[\r\n]+$/, '')
if (!password) throw new Error('Pipe the test password through standard input.')
process.stdout.write(`${hashTestPassword(password)}\n`)
