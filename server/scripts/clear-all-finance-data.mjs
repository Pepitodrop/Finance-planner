import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { encryptCloudPayload, validateCloudPayload } from '../src/user-state-store.js'

export const REQUIRED_CONFIRMATION = 'CLEAR_ALL_FINANCE_DATA'

const env = process.env
const confirmation = String(env.FINANCE_DATA_RESET_CONFIRM || '').trim()

if (confirmation !== REQUIRED_CONFIRMATION) {
  throw new Error(`Refusing whole-finance reset. Set FINANCE_DATA_RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`)
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

  const users = Object.values(store.data.users)
    .filter((user) => user && typeof user.id === 'string' && user.id.length > 0)

  const emptyPayload = validateCloudPayload({
    state: { accounts: [], transactions: [], goals: [] },
    secureData: {},
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const financeVersions = []
    for (const user of users) {
      const encryptedEmptyPayload = encryptCloudPayload(emptyPayload, env.CONNECTOR_MASTER_KEY, user.id)
      const financeState = await client.query(
        `INSERT INTO user_finance_state
           (user_id, encrypted_payload, version, updated_at)
         VALUES ($1, $2, 1, now())
         ON CONFLICT (user_id)
         DO UPDATE SET
           encrypted_payload = EXCLUDED.encrypted_payload,
           version = user_finance_state.version + 1,
           updated_at = now()
         RETURNING version`,
        [user.id, encryptedEmptyPayload],
      )
      financeVersions.push({ userId: user.id, version: Number(financeState.rows[0].version) })
    }

    const connectorConnections = await client.query('DELETE FROM connector_connections')
    const oauthNonces = await client.query('DELETE FROM oauth_nonces')
    const learningProfiles = await client.query('DELETE FROM user_budget_learning_profiles')
    const webhookEvents = await client.query('DELETE FROM webhook_events')

    await client.query('COMMIT')

    console.log(JSON.stringify({
      status: 'ok',
      accountsPreserved: users.length,
      financeStateReset: true,
      financeStates: financeVersions,
      providerRevocationAttempted: false,
      deleted: {
        connectorConnections: connectorConnections.rowCount || 0,
        oauthNonces: oauthNonces.rowCount || 0,
        learningProfiles: learningProfiles.rowCount || 0,
        webhookEvents: webhookEvents.rowCount || 0,
      },
      note: 'Every preserved Finance Planner account now has an encrypted empty cloud finance state. Local provider records were cleared. External provider sessions/consents are not revoked by this maintenance command.',
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
