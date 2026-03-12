#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOOTSTRAP_ENV_SCRIPT="${SCRIPT_DIR}/bootstrap-env.sh"
ACTION="${1:-up}"
shift || true

sanitize_name() {
  local raw="$1"
  raw="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]')"
  raw="${raw//[^a-z0-9_.-]/-}"
  raw="$(printf '%s' "${raw}" | sed -E 's/-+/-/g; s/^-+//; s/-+$//')"
  if [[ -z "${raw}" ]]; then
    raw="sigil"
  fi
  printf '%s\n' "${raw}"
}

WORKTREE_NAME="$(basename "${REPO_ROOT}")"
PROJECT_NAME="$(sanitize_name "${SIGIL_WORKTREE_PROJECT_NAME:-${WORKTREE_NAME}}")"
GRAFANA_URL="${SIGIL_GRAFANA_URL:-http://grafana.${PROJECT_NAME}.orb.local}"
PLUGIN_URL="${SIGIL_PLUGIN_URL:-http://plugin.${PROJECT_NAME}.orb.local}"
SIGIL_URL="${SIGIL_URL:-http://sigil.${PROJECT_NAME}.orb.local}"
TMP_COMPOSE="$(mktemp "${TMPDIR:-/tmp}/sigil-worktree.${PROJECT_NAME}.XXXXXX")"
trap 'rm -f "${TMP_COMPOSE}"' EXIT

usage() {
  cat <<EOF
Run the Sigil stack in a worktree-safe mode.

Usage:
  scripts/run-sigil-worktree.sh [action] [-- extra docker compose args]

Actions:
  up             Start the core stack with docker compose watch
  up-detached    Start the core stack in detached mode
  down           Stop the worktree stack
  destroy        Stop the worktree stack and remove its volumes/orphans
  ps             Show worktree stack containers
  logs           Tail worktree stack logs
  config         Print the generated compose config
  url            Print the derived OrbStack URLs
EOF
}

print_urls() {
  cat <<EOF
Project: ${PROJECT_NAME}
Grafana: ${GRAFANA_URL}
Plugin: ${PLUGIN_URL}
Sigil API: ${SIGIL_URL}
EOF
}

if [[ "${ACTION}" == "-h" || "${ACTION}" == "--help" || "${ACTION}" == "help" ]]; then
  usage
  exit 0
fi

"${BOOTSTRAP_ENV_SCRIPT}" >/dev/null

export DEVELOPMENT="${DEVELOPMENT:-true}"
export WEBPACK_TYPE_CHECK="${WEBPACK_TYPE_CHECK:-false}"
export WEBPACK_LINT="${WEBPACK_LINT:-false}"
export SIGIL_GRAFANA_URL="${GRAFANA_URL}"

pushd "${REPO_ROOT}" >/dev/null
docker compose --profile core --profile traffic --profile traffic-lite config > "${TMP_COMPOSE}"
popd >/dev/null

python3 - "${TMP_COMPOSE}" <<'PY'
import re
import sys
from pathlib import Path

compose_path = Path(sys.argv[1])
lines = compose_path.read_text(encoding="utf-8").splitlines()

service_re = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")
service_key_re = re.compile(r"^    [A-Za-z0-9_.-]+:\s*(?:#.*)?$")
ports_key_re = re.compile(r"^    ports:\s*(?:#.*)?$")
container_name_re = re.compile(r"^    container_name:\s*.*$")

filtered = []
in_ports = False

for line in lines:
  if in_ports:
    if line.startswith("      - ") or line.strip() == "":
      continue
    if service_key_re.match(line) or service_re.match(line):
      in_ports = False
    else:
      continue

  if container_name_re.match(line):
    continue

  if ports_key_re.match(line):
    in_ports = True
    continue

  filtered.append(line)

compose_path.write_text("\n".join(filtered) + "\n", encoding="utf-8")
PY

COMPOSE_CMD=(
  docker compose
  --project-name "${PROJECT_NAME}"
  -f "${TMP_COMPOSE}"
)

case "${ACTION}" in
  up)
    "${COMPOSE_CMD[@]}" --profile core up --watch --build --remove-orphans "$@"
    ;;
  up-detached)
    "${COMPOSE_CMD[@]}" --profile core up --build --remove-orphans -d "$@"
    print_urls
    ;;
  up-traffic-lite)
    "${COMPOSE_CMD[@]}" --profile core --profile traffic-lite up --build -d sdk-traffic-lite "$@"
    print_urls
    ;;
  down)
    "${COMPOSE_CMD[@]}" down "$@"
    ;;
  destroy)
    "${COMPOSE_CMD[@]}" down --volumes --remove-orphans "$@"
    ;;
  down-traffic-lite)
    "${COMPOSE_CMD[@]}" stop sdk-traffic-lite "$@"
    "${COMPOSE_CMD[@]}" rm -f sdk-traffic-lite >/dev/null
    ;;
  ps)
    "${COMPOSE_CMD[@]}" ps "$@"
    print_urls
    ;;
  logs)
    "${COMPOSE_CMD[@]}" logs -f "$@"
    ;;
  config)
    cat "${TMP_COMPOSE}"
    ;;
  url)
    print_urls
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    usage >&2
    exit 1
    ;;
esac
