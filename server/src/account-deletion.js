import { HttpError } from './runtime-security.js'

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT'
// Postgres mode removes every connector_connections row for the user
// unconditionally (one DELETE, no provider filter). This file-mode fallback
// has to enumerate providers explicitly instead, so it must be kept in sync
// with every provider that persists through the connector store -- 'google-subscriptions'
// (see google-subscriptions-router.js's PROVIDER constant) was previously
// missing here, so account deletion in file-persistence mode left a deleted
// user's stored Google-subscriptions connection behind. This does not
// affect provider-side revocation (google-subscriptions-router.js's own
// disconnect flow already calls Google's revoke endpoint independently) --
// it only affects Finance Planner's own stored copy of the connection.
const PROVIDERS = Object.freeze(['gocardless', 'finapi', 'paypal', 'google-subscriptions'])

function safeUserId(value) {
  const userId = String(value || '').trim()
  if (!userId || userId.length > 256) throw new HttpError(400, 'invalid_account', 'Authenticated user identifier is invalid.')
  return userId
}

export function validateAccountDeletionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_account_deletion', 'Account deletion input must be an object.')
  if (Object.keys(input).some((key) => key !== 'confirmation')) throw new HttpError(400, 'invalid_account_deletion', 'Unexpected account deletion field.')
  if (input.confirmation !== ACCOUNT_DELETE_CONFIRMATION) {
    throw new HttpError(400, 'account_deletion_confirmation_required', `Type ${ACCOUNT_DELETE_CONFIRMATION} to delete the account.`)
  }
  return { confirmation: ACCOUNT_DELETE_CONFIRMATION }
}

export async function deleteAccountData({ userId, persistence, store, sessionRevocations, now = new Date() }) {
  const normalizedUserId = safeUserId(userId)
  if (!sessionRevocations) throw new Error('Session revocation registry is required for account deletion.')
  const revokedBefore = await sessionRevocations.revoke(normalizedUserId, now)

  if (!persistence?.pool) {
    for (const provider of PROVIDERS) await store.remove(normalizedUserId, provider)
    return {
      userId: normalizedUserId,
      revokedBefore,
      persistence: 'file',
      deleted: { connectorConnections: PROVIDERS.length, oauthNonces: 0, financeState: 0, learningProfiles: 0 },
    }
  }

  const client = await persistence.pool.connect()
  try {
    await client.query('BEGIN')
    const connectorConnections = await client.query('DELETE FROM connector_connections WHERE user_id=$1', [normalizedUserId])
    const oauthNonces = await client.query('DELETE FROM oauth_nonces WHERE user_id=$1', [normalizedUserId])
    const financeState = await client.query('DELETE FROM user_finance_state WHERE user_id=$1', [normalizedUserId])
    const learningProfiles = await client.query('DELETE FROM user_budget_learning_profiles WHERE user_id=$1', [normalizedUserId])
    await client.query('COMMIT')
    return {
      userId: normalizedUserId,
      revokedBefore,
      persistence: 'postgres',
      deleted: {
        connectorConnections: connectorConnections.rowCount || 0,
        oauthNonces: oauthNonces.rowCount || 0,
        financeState: financeState.rowCount || 0,
        learningProfiles: learningProfiles.rowCount || 0,
      },
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
