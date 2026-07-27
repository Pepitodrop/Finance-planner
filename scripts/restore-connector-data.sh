#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:-}"
if [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "Usage: bash scripts/restore-connector-data.sh backups/connector-data-<timestamp>.tar.gz" >&2
  exit 1
fi

project_name="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-')}"
project_name="${project_name%-}"
volume_name="${CONNECTOR_DATA_VOLUME:-${project_name}_connector-data}"
checksum_file="${archive}.sha256"

command -v docker >/dev/null 2>&1 || { echo "docker is required" >&2; exit 1; }
if [[ -f "$checksum_file" ]]; then
  sha256sum --check "$checksum_file"
else
  echo "Refusing restore because checksum file '$checksum_file' is missing." >&2
  exit 1
fi

docker volume inspect "$volume_name" >/dev/null 2>&1 || docker volume create "$volume_name" >/dev/null

if docker compose ps --status running --services 2>/dev/null | grep -qx connector; then
  echo "Stop the connector service before restoring: docker compose stop connector" >&2
  exit 1
fi

printf "This will replace all data in Docker volume '%s'. Type RESTORE to continue: " "$volume_name"
read -r confirmation
[[ "$confirmation" == "RESTORE" ]] || { echo "Restore cancelled."; exit 1; }

archive_dir="$(cd "$(dirname "$archive")" && pwd)"
archive_name="$(basename "$archive")"

docker run --rm \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -v "${volume_name}:/data" \
  -v "${archive_dir}:/backup:ro" \
  alpine:3.22 \
  sh -ceu "find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -C /data -xzf /backup/${archive_name}"

echo "Restore completed. Start the connector and verify health and provider synchronization."
