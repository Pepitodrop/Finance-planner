#!/usr/bin/env bash
set -Eeuo pipefail

project_name="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')}"
project_name="${project_name%-}"
volume_name="${CONNECTOR_DATA_VOLUME:-${project_name}_connector-data}"
backup_dir="${BACKUP_DIR:-$PWD/backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="${backup_dir}/connector-data-${timestamp}.tar.gz"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
docker volume inspect "$volume_name" >/dev/null 2>&1 || {
  echo "Docker volume '$volume_name' was not found. Set CONNECTOR_DATA_VOLUME explicitly if the Compose project name differs." >&2
  exit 1
}

mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

echo "Creating encrypted connector-data backup from '$volume_name'..."
docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -v "${volume_name}:/data:ro" \
  -v "${backup_dir}:/backup" \
  alpine:3.22 \
  sh -ceu "tar -C /data -czf /backup/$(basename "$archive") ."

chmod 600 "$archive"
sha256sum "$archive" > "${archive}.sha256"
chmod 600 "${archive}.sha256"

echo "Backup created: $archive"
echo "Checksum: ${archive}.sha256"
echo "Store the archive, checksum, and encryption key in separate protected locations."
