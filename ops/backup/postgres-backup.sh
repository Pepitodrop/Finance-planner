#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:=/var/backups/finance-planner}"
: "${BACKUP_RETENTION_DAYS:=30}"
: "${BACKUP_ENCRYPTION_KEY_FILE:?BACKUP_ENCRYPTION_KEY_FILE is required}"

umask 077
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
plain="$BACKUP_DIR/finance-planner-$stamp.dump"
encrypted="$plain.enc"
checksum="$encrypted.sha256"

pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$plain"
pg_restore --list "$plain" >/dev/null
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -pass "file:$BACKUP_ENCRYPTION_KEY_FILE" -in "$plain" -out "$encrypted"
rm -f "$plain"
sha256sum "$encrypted" > "$checksum"
find "$BACKUP_DIR" -type f -mtime "+$BACKUP_RETENTION_DAYS" -delete
printf '%s\n' "$encrypted"
