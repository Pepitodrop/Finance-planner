import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createDatabase, migrateDatabase, rollbackDatabase } from '../src/database.js'

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url))
const downMigrationsDir = join(migrationsDir, 'down')

// Static, DB-free consistency check: every real forward migration must have a matching
// down-migration, so this can't silently drift as new migrations are added.
test('every checked-in migration has a matching down-migration', async () => {
  const forward = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name))
  const down = (await readdir(downMigrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name))
  const forwardVersions = forward.map((name) => Number(name.split('_', 1)[0])).sort((a, b) => a - b)
  const downVersions = down.map((name) => Number(name.split('_', 1)[0])).sort((a, b) => a - b)
  assert.deepEqual(downVersions, forwardVersions, 'migrations/down/ must have exactly one file per migrations/*.sql version')
})

// The tests below exercise migrateDatabase/rollbackDatabase's actual mechanics (advisory
// locking, schema_migrations bookkeeping, fail-closed on a missing down-migration) against
// a real Postgres instance, but deliberately using synthetic, temp-directory migrations
// with uniquely-named scratch tables — never the real schema. Other test files run
// concurrently against the same TEST_DATABASE_URL and depend on the real tables existing;
// exercising rollback against them here would risk dropping tables out from under those
// tests.
async function withScratchMigrations(run) {
  const scratchDir = await mkdtemp(join(tmpdir(), 'finance-planner-migrate-'))
  const scratchDownDir = join(scratchDir, 'down')
  await mkdir(scratchDownDir)
  try {
    await writeFile(
      join(scratchDir, '901_scratch_a.sql'),
      `BEGIN;
CREATE TABLE finance_planner_test_rollback_scratch_a (id int PRIMARY KEY);
INSERT INTO schema_migrations (version) VALUES (901) ON CONFLICT DO NOTHING;
COMMIT;`,
    )
    await writeFile(
      join(scratchDownDir, '901_scratch_a.sql'),
      `BEGIN;
DROP TABLE IF EXISTS finance_planner_test_rollback_scratch_a;
DELETE FROM schema_migrations WHERE version = 901;
COMMIT;`,
    )
    await writeFile(
      join(scratchDir, '902_scratch_b.sql'),
      `BEGIN;
CREATE TABLE finance_planner_test_rollback_scratch_b (id int PRIMARY KEY);
INSERT INTO schema_migrations (version) VALUES (902) ON CONFLICT DO NOTHING;
COMMIT;`,
    )
    await writeFile(
      join(scratchDownDir, '902_scratch_b.sql'),
      `BEGIN;
DROP TABLE IF EXISTS finance_planner_test_rollback_scratch_b;
DELETE FROM schema_migrations WHERE version = 902;
COMMIT;`,
    )
    await run({ scratchDir, scratchDownDir })
  } finally {
    await rm(scratchDir, { recursive: true, force: true })
  }
}

async function tableExists(pool, tableName) {
  const result = await pool.query('SELECT to_regclass($1) AS relation', [`public.${tableName}`])
  return result.rows[0].relation !== null
}

async function cleanupScratchState(pool) {
  await pool.query('DROP TABLE IF EXISTS finance_planner_test_rollback_scratch_a, finance_planner_test_rollback_scratch_b')
  await pool.query('DELETE FROM schema_migrations WHERE version IN (901, 902)')
}

test('rolling back and re-applying synthetic migrations round-trips schema state cleanly', { skip: !databaseUrl }, async () => {
  await withScratchMigrations(async ({ scratchDir, scratchDownDir }) => {
    const pool = createDatabase(databaseUrl, { max: 2 })
    try {
      await cleanupScratchState(pool)
      await migrateDatabase(pool, scratchDir)
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_a'), true)
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_b'), true)

      const rolledBack = await rollbackDatabase(pool, 900, scratchDownDir)
      assert.deepEqual(rolledBack, [902, 901])
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_a'), false, 'rollback must drop tables it created')
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_b'), false)

      await migrateDatabase(pool, scratchDir)
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_a'), true, 're-applying forward migrations must restore dropped tables')
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_b'), true)
    } finally {
      await cleanupScratchState(pool)
      await pool.end()
    }
  })
})

test('rollback stops at the target version without touching older migrations', { skip: !databaseUrl }, async () => {
  await withScratchMigrations(async ({ scratchDir, scratchDownDir }) => {
    const pool = createDatabase(databaseUrl, { max: 2 })
    try {
      await cleanupScratchState(pool)
      await migrateDatabase(pool, scratchDir)

      const rolledBack = await rollbackDatabase(pool, 901, scratchDownDir)
      assert.deepEqual(rolledBack, [902])
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_a'), true, 'rollback must not touch versions at or below the target')
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_b'), false)
    } finally {
      await cleanupScratchState(pool)
      await pool.end()
    }
  })
})

test('rollback validates the complete plan before changing the database', { skip: !databaseUrl }, async () => {
  await withScratchMigrations(async ({ scratchDir, scratchDownDir }) => {
    const pool = createDatabase(databaseUrl, { max: 2 })
    try {
      await cleanupScratchState(pool)
      await migrateDatabase(pool, scratchDir)
      await rm(join(scratchDownDir, '901_scratch_a.sql'))

      await assert.rejects(() => rollbackDatabase(pool, 900, scratchDownDir), /No down-migration found for version 901/)
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_b'), true, 'no newer migration may be rolled back when the complete plan is invalid')
      assert.equal(await tableExists(pool, 'finance_planner_test_rollback_scratch_a'), true, 'a refused rollback must make no destructive changes')
    } finally {
      await cleanupScratchState(pool)
      await pool.end()
    }
  })
})
