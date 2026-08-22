import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { decryptCloudPayload, encryptCloudPayload, validateCloudPayload } from '../src/user-state-store.js'

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
  const preservedUserIds = users.map((user) => user.id)

  const emptyPayload = validateCloudPayload({
    state: { accounts: [], transactions: [], goals: [] },
    secureData: {},
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const existingFinanceState = await client.query('SELECT user_id FROM user_finance_state')
    const resetTargetIds = [...new Set([
      ...preservedUserIds,
      ...existingFinanceState.rows.map((row) => String(row.user_id || '')).filter(Boolean),
    ])]

    const financeVersions = []
    for (const userId of resetTargetIds) {
      const encryptedEmptyPayload = encryptCloudPayload(emptyPayload, env.CONNECTOR_MASTER_KEY, userId)
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
        [userId, encryptedEmptyPayload],
      )
      financeVersions.push({ userId, version: Number(financeState.rows[0].version) })
    }

    const connectorConnections = await client.query('DELETE FROM connector_connections')
    const oauthNonces = await client.query('DELETE FROM oauth_nonces')
    const learningProfiles = await client.query('DELETE FROM user_budget_learning_profiles')
    const webhookEvents = await client.query('DELETE FROM webhook_events')

    const persistedFinanceState = await client.query('SELECT user_id, encrypted_payload FROM user_finance_state ORDER BY user_id')
    for (const row of persistedFinanceState.rows) {
      const payload = decryptCloudPayload(row.encrypted_payload, env.CONNECTOR_MASTER_KEY, row.user_id)
      const empty = payload.state.accounts.length === 0
        && payload.state.transactions.length === 0
        && payload.state.goals.length === 0
        && Object.keys(payload.secureData).length === 0
      if (!empty) throw new Error(`Finance reset verification failed for user ${row.user_id}.`)
    }

    const residual = await client.query(`SELECT
      (SELECT count(*)::int FROM connector_connections) AS connector_connections,
      (SELECT count(*)::int FROM oauth_nonces) AS oauth_nonces,
      (SELECT count(*)::int FROM user_budget_learning_profiles) AS learning_profiles,
      (SELECT count(*)::int FROM webhook_events) AS webhook_events`)
    const remaining = residual.rows[0]
    if (Object.values(remaining).some((count) => Number(count) !== 0)) {
      throw new Error('Finance reset verification found residual provider or learning data.')
    }

    await client.query('COMMIT')

    console.log(JSON.stringify({
      status: 'ok',
      accountsPreserved: users.length,
      financeStateReset: true,
      verifiedEmpty: true,
      financeStateRows: persistedFinanceState.rowCount || 0,
      financeStates: financeVersions,
      providerRevocationAttempted: false,
      deleted: {
        connectorConnections: connectorConnections.rowCount || 0,
        oauthNonces: oauthNonces.rowCount || 0,
        learningProfiles: learningProfiles.rowCount || 0,
        webhookEvents: webhookEvents.rowCount || 0,
      },
      remaining: {
        connectorConnections: 0,
        oauthNonces: 0,
        learningProfiles: 0,
        webhookEvents: 0,
      },
      note: 'Every existing cloud finance-state row and every preserved Finance Planner account now has an encrypted empty state. Local provider records were cleared. External provider sessions/consents are not revoked by this maintenance command.',
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
