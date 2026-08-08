import { readFile } from 'node:fs/promises'

const files = Object.fromEntries(await Promise.all([
  'server/migrations/006_cloud_user_data.sql',
  'server/src/user-state-store.js',
  'server/src/finance-router.js',
  'server/src/auth-store.js',
  'src/AuthGate.tsx',
  'src/VaultGate.tsx',
  'src/app/bootstrap.tsx',
  'src/infrastructure/persistence/cloudState.ts',
  'src/infrastructure/persistence/storage.ts',
  'src/vault.ts',
  'deploy/nginx.conf',
  'compose.yaml',
  'README.md',
].map(async (path) => [path, await readFile(path, 'utf8')])))

function requirePattern(path, pattern, message) {
  if (!pattern.test(files[path])) throw new Error(`${message} (${path})`)
}

requirePattern('server/migrations/006_cloud_user_data.sql', /CREATE TABLE IF NOT EXISTS user_finance_state/, 'Cloud finance state table is missing')
requirePattern('server/migrations/006_cloud_user_data.sql', /CREATE TABLE IF NOT EXISTS auth_store/, 'Database auth store table is missing')
requirePattern('server/src/user-state-store.js', /AES-256-GCM/, 'Cloud finance state must be application-encrypted')
requirePattern('server/src/user-state-store.js', /setAAD\(bindingData\(userId\)\)/, 'Encrypted finance state must be bound to its authenticated user')
requirePattern('server/src/user-state-store.js', /StateVersionConflictError/, 'Cloud state must use optimistic concurrency')
requirePattern('server/src/finance-router.js', /\/api\/finance\/state/, 'Authenticated state API route is missing')
requirePattern('server/src/finance-router.js', /MAX_CLOUD_STATE_REQUEST_BYTES = 10_000_000/, 'Backend cloud-state upload limit is missing')
requirePattern('server/src/auth-store.js', /INSERT INTO auth_store/, 'Auth profiles and passkeys are not persisted to PostgreSQL')
requirePattern('src/AuthGate.tsx', /children: ReactNode \| \(\(user: AuthUser[^)]*\) => ReactNode\)/, 'Authenticated user identity must be available to the vault layer')
requirePattern('src/app/bootstrap.tsx', /VaultGate key=\{user\.id\} userId=\{user\.id\}/, 'App bootstrap must scope the device vault to the authenticated account')
requirePattern('src/VaultGate.tsx', /configureAuthenticatedStorage\(userId\)/, 'Sync state must be configured for the authenticated account')
requirePattern('src/VaultGate.tsx', /if \(!migrating\) prepareNewDeviceCloudBootstrap\(\)/, 'Only a genuinely new device may accept a remote state without migration conflict checks')
requirePattern('src/infrastructure/persistence/storage.ts', /CONFLICT_KEY_PREFIX/, 'Cloud conflicts must be isolated by account')
requirePattern('src/infrastructure/persistence/storage.ts', /SYNC_METADATA_PREFIX/, 'Offline dirty state must survive browser restarts')
requirePattern('src/infrastructure/persistence/storage.ts', /hasSyncMetadataRecord/, 'First-sync migration state must be distinguishable from a new device')
requirePattern('src/infrastructure/persistence/storage.ts', /syncMetadata\.dirty/, 'Cloud bootstrap must protect unsynchronized local edits')
requirePattern('src/infrastructure/persistence/storage.ts', /synchronizeUnlockedState/, 'Vault bootstrap does not load the cloud state')
requirePattern('src/infrastructure/persistence/storage.ts', /resolveCloudConflict/, 'Cross-device conflicts must require an explicit resolution')
requirePattern('src/vault.ts', /version: 2/, 'Device vault must use the account-bound format')
requirePattern('src/vault.ts', /additionalData: ownerBinding/, 'Device-vault ciphertext must be bound to its account')
requirePattern('src/vault.ts', /secureData: Record<string, unknown>/, 'Behavior and assistant memory are not included in the synced vault payload')
requirePattern('src/vault.ts', /persistenceQueue/, 'Encrypted local vault writes must be serialized')
requirePattern('deploy/nginx.conf', /location = \/api\/finance\/state\s*\{[\s\S]*?client_max_body_size 10m;/, 'Nginx must allow the bounded full-vault upload size on the exact state endpoint')
requirePattern('compose.yaml', /HF_TIMEOUT_MS: \$\{HF_TIMEOUT_MS:-30000\}/, 'Hosted AI timeout is not passed into the connector')
requirePattern('README.md', /PostgreSQL.*canonical/i, 'README must describe PostgreSQL as the canonical user-data store')

console.log('Cloud persistence architecture verified.')
