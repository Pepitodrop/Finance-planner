#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"

umask 077
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
plain="$workdir/restore.dump"

sha256sum --check "$BACKUP_FILE.sha256"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -in "$BACKUP_FILE" -out "$plain"
pg_restore --list "$plain" >/dev/null
pg_restore --clean --if-exists --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$plain"

psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public') THEN
    RAISE EXCEPTION 'restore produced no public tables';
  END IF;
END $$;
SQL

printf '{"schemaVersion":1,"status":"passed","verifiedAt":"%s"}\n' "$(date -u +%FT%TZ)" > "${RESTORE_EVIDENCE_FILE:-artifacts/restore-drill.json}"
