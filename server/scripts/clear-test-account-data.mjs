import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import {
  normalizeTestAccountEmail,
  testAccountUserId,
} from '../src/test-account-provisioning.js'

export const REQUIRED_CONFIRMATION = 'CLEAR_TEST_ACCOUNT_FINANCE_DATA'

const env = process.env
const email = normalizeTestAccountEmail(process.argv[2] || env.TEST_ACCOUNT_EMAIL)
const confirmation = String(env.TEST_DATA_RESET_CONFIRM || '').trim()
const expectedUserId = testAccountUserId(email)

if (confirmation !== REQUIRED_CONFIRMATION) {
  throw new Error(`Refusing test-data reset. Set TEST_DATA_RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`)
}

const pool = createDatabase(env.DATABASE_URL)
await migrateDatabase(pool)

try {
  const store = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )
  await store.load()
  const user = store.findByEmail(email)
  if (!user) throw new Error('The configured test account does not exist.')
  if (user.id !== expectedUserId || !String(user.id).startsWith('test:')) {
    throw new Error('Refusing to clear data for a non-test account.')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const connectorConnections = await client.query('DELETE FROM connector_connections WHERE user_id=$1', [user.id])
    const oauthNonces = await client.query('DELETE FROM oauth_nonces WHERE user_id=$1', [user.id])
    const financeState = await client.query('DELETE FROM user_finance_state WHERE user_id=$1', [user.id])
    const learningProfiles = await client.query('DELETE FROM user_budget_learning_profiles WHERE user_id=$1', [user.id])
    await client.query('COMMIT')

    console.log(JSON.stringify({
      status: 'ok',
      userId: user.id,
      accountPreserved: true,
      providerRevocationAttempted: false,
      deleted: {
        connectorConnections: connectorConnections.rowCount || 0,
        oauthNonces: oauthNonces.rowCount || 0,
        financeState: financeState.rowCount || 0,
        learningProfiles: learningProfiles.rowCount || 0,
      },
      note: 'Local test data was removed. Provider-side sandbox sessions are not revoked by this maintenance command.',
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
