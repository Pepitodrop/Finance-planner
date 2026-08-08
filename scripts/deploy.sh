#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_DIR}/compose.yaml}"
ENV_FILE="${ENV_FILE:-${REPO_DIR}/.env}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
SKIP_PULL=false
NO_CACHE=false
SKIP_HEALTH=false

usage() {
  cat <<'USAGE'
Usage: ./scripts/deploy.sh [options]

Safely deploy the Finance Planner Docker Compose stack from the main branch.

Options:
  --skip-pull    Do not fetch and fast-forward the local main branch.
  --no-cache     Rebuild Docker images without using the build cache.
  --skip-health  Do not wait for container and HTTP health checks.
  -h, --help     Show this help text.

Environment overrides:
  COMPOSE_FILE=/path/to/compose.yaml
  ENV_FILE=/path/to/.env
  HEALTH_TIMEOUT=180
  WEB_PORT=8080
  CONNECTOR_PORT=8787
USAGE
}

log() {
  printf '\n\033[1;35m[deploy]\033[0m %s\n' "$*"
}

fail() {
  printf '\n\033[1;31m[deploy] ERROR:\033[0m %s\n' "$*" >&2
  exit 1
}

for argument in "$@"; do
  case "${argument}" in
    --skip-pull) SKIP_PULL=true ;;
    --no-cache) NO_CACHE=true ;;
    --skip-health) SKIP_HEALTH=true ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: ${argument}" ;;
  esac
done

command -v git >/dev/null 2>&1 || fail "git is not installed."
command -v docker >/dev/null 2>&1 || fail "docker is not installed."
command -v node >/dev/null 2>&1 || fail "Node.js is not installed."
command -v curl >/dev/null 2>&1 || fail "curl is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is not available."
[[ -f "${COMPOSE_FILE}" ]] || fail "Compose file not found: ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]] || fail "Environment file not found: ${ENV_FILE}. Copy .env.example and configure it first."

cd "${REPO_DIR}"

on_error() {
  local exit_code=$?
  printf '\n\033[1;31m[deploy] Deployment failed (exit %s). Recent service status and logs follow.\033[0m\n' "${exit_code}" >&2
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps >&2 || true
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" logs --tail=120 web connector postgres >&2 || true
  exit "${exit_code}"
}
trap on_error ERR

if [[ "${SKIP_PULL}" == false ]]; then
  current_branch="$(git branch --show-current)"
  [[ "${current_branch}" == "main" ]] || fail "Current branch is '${current_branch:-detached}', not 'main'. Switch to main or use --skip-pull deliberately."

  if [[ -n "$(git status --porcelain)" ]]; then
    fail "The working tree contains local changes. Commit or stash them before deployment."
  fi

  log "Fetching and fast-forwarding main"
  git fetch --prune origin main
  git pull --ff-only origin main
fi

repository_sha="$(git rev-parse HEAD)"
package_version="$(node -e "const fs=require('node:fs'); const value=JSON.parse(fs.readFileSync('package.json','utf8')).version; if(!value) process.exit(1); process.stdout.write(String(value))")"

if [[ -z "${RELEASE_SHA:-}" || "${RELEASE_SHA}" == "unknown" ]]; then
  export RELEASE_SHA="${repository_sha}"
fi
if [[ -z "${RELEASE_VERSION:-}" || "${RELEASE_VERSION}" == "unknown" ]]; then
  export RELEASE_VERSION="${package_version}"
fi

[[ "${RELEASE_SHA}" =~ ^[0-9a-fA-F]{40}$ ]] || fail "RELEASE_SHA must be a full 40-character Git commit SHA."
[[ "${RELEASE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || fail "RELEASE_VERSION must be a semantic version, not '${RELEASE_VERSION}'."

log "Validating Docker Compose configuration"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --quiet

build_args=(--pull)
if [[ "${NO_CACHE}" == true ]]; then
  build_args+=(--no-cache)
fi

log "Building production images"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build "${build_args[@]}"

log "Starting the Finance Planner stack"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --remove-orphans

if [[ "${SKIP_HEALTH}" == false ]]; then
  log "Waiting for containers to become healthy"
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  services=(postgres connector web)

  while (( SECONDS < deadline )); do
    healthy=true
    for service in "${services[@]}"; do
      container_id="$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q "${service}")"
      if [[ -z "${container_id}" ]]; then
        healthy=false
        break
      fi

      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}")"
      if [[ "${status}" != "healthy" && "${status}" != "running" ]]; then
        healthy=false
        break
      fi
    done

    if [[ "${healthy}" == true ]]; then
      break
    fi
    sleep 3
  done

  (( SECONDS < deadline )) || fail "Containers did not become healthy within ${HEALTH_TIMEOUT} seconds."

  web_port="${WEB_PORT:-8080}"
  connector_port="${CONNECTOR_PORT:-8787}"

  log "Verifying HTTP health endpoints and release identity"
  curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-connrefused \
    "http://127.0.0.1:${web_port}/healthz" >/dev/null
  ready_json="$(curl --fail --silent --show-error --retry 12 --retry-delay 2 --retry-connrefused \
    "http://127.0.0.1:${connector_port}/health/ready")"
  READY_JSON="${ready_json}" EXPECTED_VERSION="${RELEASE_VERSION}" EXPECTED_SHA="${RELEASE_SHA}" node -e '
    const payload = JSON.parse(process.env.READY_JSON || "{}");
    if (payload.status !== "ready") throw new Error(`Connector reported ${payload.status || "no status"}.`);
    if (payload.version !== process.env.EXPECTED_VERSION) throw new Error(`Version mismatch: ${payload.version} !== ${process.env.EXPECTED_VERSION}`);
    if (payload.commit !== process.env.EXPECTED_SHA) throw new Error(`Commit mismatch: ${payload.commit} !== ${process.env.EXPECTED_SHA}`);
  '
fi

log "Removing unused build cache and dangling images"
docker image prune -f >/dev/null

trap - ERR
log "Deployment completed successfully"
printf 'Release: %s (%s)\n' "${RELEASE_VERSION}" "${RELEASE_SHA}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps
