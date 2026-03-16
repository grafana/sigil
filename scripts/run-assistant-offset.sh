#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGIL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_ASSISTANT_DIR="${SIGIL_DIR}/../grafana-assistant-app"

ASSISTANT_DIR="${ASSISTANT_DIR:-${DEFAULT_ASSISTANT_DIR}}"
OFFSET="${ASSISTANT_PORT_OFFSET:-20000}"
PROJECT_NAME="${ASSISTANT_COMPOSE_PROJECT:-assistant-offset}"
PROFILE="${ASSISTANT_PROFILE:-core}"
IMPORT_SIGIL_ENV="${ASSISTANT_IMPORT_SIGIL_ENV:-0}"
SIGIL_ENV_FILE="${SIGIL_ENV_FILE:-${SIGIL_DIR}/.env}"
ACTION="up"
EXTRA_ARGS=()

usage() {
  cat <<'EOF'
Run grafana-assistant-app with host ports remapped by an offset.

Usage:
  scripts/run-assistant-offset.sh [action] [options] [-- extra docker compose args]

Actions:
  up      (default) run docker compose up -d with selected profile
  down    run docker compose down
  ps      run docker compose ps
  logs    run docker compose logs -f

Options:
  --assistant-dir <path>   Path to grafana-assistant-app repo
  --offset <n>             Host port offset (default: 20000)
  --project-name <name>    Compose project name (default: assistant-offset)
  --profile <name>         Compose profile for "up" (default: core)
  --sigil-env-file <path>  .env file to import SIGIL vars from
  --no-sigil-env           Disable importing SIGIL vars into assistant run
  -h, --help               Show this help

Examples:
  scripts/run-assistant-offset.sh up
  scripts/run-assistant-offset.sh up --offset 12000 --profile core
  scripts/run-assistant-offset.sh logs -- api
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    up|down|ps|logs)
      ACTION="$1"
      shift
      ;;
    --assistant-dir)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --assistant-dir requires a value" >&2
        exit 1
      fi
      ASSISTANT_DIR="$2"
      shift 2
      ;;
    --offset)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --offset requires a value" >&2
        exit 1
      fi
      OFFSET="$2"
      shift 2
      ;;
    --project-name)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --project-name requires a value" >&2
        exit 1
      fi
      PROJECT_NAME="$2"
      shift 2
      ;;
    --profile)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --profile requires a value" >&2
        exit 1
      fi
      PROFILE="$2"
      shift 2
      ;;
    --sigil-env-file)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --sigil-env-file requires a value" >&2
        exit 1
      fi
      SIGIL_ENV_FILE="$2"
      shift 2
      ;;
    --no-sigil-env)
      IMPORT_SIGIL_ENV="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! [[ "${OFFSET}" =~ ^[0-9]+$ ]]; then
  echo "Offset must be an integer, got: ${OFFSET}" >&2
  exit 1
fi

if (( OFFSET > 65535 )); then
  echo "Offset must be <= 65535, got: ${OFFSET}" >&2
  exit 1
fi

COMPOSE_FILE="${ASSISTANT_DIR}/docker-compose.yaml"
if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Assistant compose file not found: ${COMPOSE_FILE}" >&2
  exit 1
fi

load_sigil_env() {
  local env_file="$1"
  if [[ ! -f "${env_file}" ]]; then
    return 0
  fi

  while IFS='=' read -r raw_key raw_value; do
    # Keep parser strict/simple: skip comments/empty/malformed lines.
    if [[ -z "${raw_key}" ]]; then
      continue
    fi

    local key="${raw_key#"${raw_key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"

    if [[ "${key}" == \#* ]]; then
      continue
    fi

    if [[ "${key}" != SIGIL_* && "${key}" != "GRAFANA_ASSISTANT_ACCESS_TOKEN" ]]; then
      continue
    fi

    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    local value="${raw_value-}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    # Strip surrounding single/double quotes if present.
    if [[ "${value}" =~ ^\".*\"$ ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" =~ ^\'.*\'$ ]]; then
      value="${value:1:${#value}-2}"
    fi

    export "${key}=${value}"
  done < "${env_file}"
}

derive_assistant_sigil_env() {
  # Respect explicit caller-provided DASH_API_SIGIL_* values.
  export DASH_API_SIGIL_ENDPOINT="${DASH_API_SIGIL_ENDPOINT:-${SIGIL_ENDPOINT:-host.docker.internal:4317}}"
  export DASH_API_SIGIL_TENANT_ID="${DASH_API_SIGIL_TENANT_ID:-${SIGIL_FAKE_TENANT_ID:-${SIGIL_TENANT_ID:-fake}}}"
  export DASH_API_SIGIL_AUTH_TOKEN="${DASH_API_SIGIL_AUTH_TOKEN:-${SIGIL_AUTH_TOKEN:-}}"
  export DASH_API_SIGIL_AUTH_USER="${DASH_API_SIGIL_AUTH_USER:-${SIGIL_AUTH_USER:-}}"
  export DASH_API_SIGIL_INSECURE="${DASH_API_SIGIL_INSECURE:-${SIGIL_INSECURE:-true}}"

  # When running alongside the Sigil stack, route OTel traces+metrics through
  # Sigil's Alloy (gRPC on host port 14317) so they land in Tempo and Prometheus
  # instead of the assistant's own Jaeger.
  # Auto-enabled when importing Sigil env; override with ASSISTANT_OTEL_ENDPOINT.
  if [[ "${IMPORT_SIGIL_ENV}" == "1" ]]; then
    export ASSISTANT_OTEL_ENDPOINT="${ASSISTANT_OTEL_ENDPOINT:-http://host.docker.internal:14317}"
  fi
}

if [[ "${IMPORT_SIGIL_ENV}" == "1" ]]; then
  load_sigil_env "${SIGIL_ENV_FILE}"
fi
derive_assistant_sigil_env

TMP_COMPOSE="${ASSISTANT_DIR}/.assistant-remapped.${PROJECT_NAME}.$$.yaml"
TMP_RESOLVED="${ASSISTANT_DIR}/.assistant-resolved.${PROJECT_NAME}.$$.yaml"
TMP_ENV_OVERRIDE="${ASSISTANT_DIR}/.assistant-sigil-env.${PROJECT_NAME}.$$.yaml"
trap 'rm -f "${TMP_COMPOSE}" "${TMP_RESOLVED}" "${TMP_ENV_OVERRIDE}"' EXIT

CONFIG_ARGS=(--project-directory "${ASSISTANT_DIR}" -f "${COMPOSE_FILE}")
if [[ "${ACTION}" == "up" ]]; then
  CONFIG_ARGS+=(--profile "${PROFILE}")
fi
docker compose "${CONFIG_ARGS[@]}" config > "${TMP_RESOLVED}"

python3 "${SIGIL_DIR}/scripts/assistant_offset_compose.py" \
  "${TMP_RESOLVED}" \
  "${TMP_COMPOSE}" \
  "${OFFSET}" \
  "${PROJECT_NAME}" \
  "${SIGIL_DIR}/docker-compose.yaml" \
  "${SIGIL_DIR}/.config/docker-compose-base.yaml"

RESOLVED_SERVICES="$(docker compose "${CONFIG_ARGS[@]}" config --services 2>/dev/null | paste -sd, -)"

python3 - "${TMP_ENV_OVERRIDE}" "${RESOLVED_SERVICES}" <<'PY'
import os
import sys
from pathlib import Path

out_path = Path(sys.argv[1])

def q(value: str) -> str:
  return "'" + value.replace("'", "''") + "'"

endpoint = os.environ.get("DASH_API_SIGIL_ENDPOINT", "")
tenant_id = os.environ.get("DASH_API_SIGIL_TENANT_ID", "")
auth_token = os.environ.get("DASH_API_SIGIL_AUTH_TOKEN", "")
auth_user = os.environ.get("DASH_API_SIGIL_AUTH_USER", "")
insecure = os.environ.get("DASH_API_SIGIL_INSECURE", "true")
otel_endpoint = os.environ.get("ASSISTANT_OTEL_ENDPOINT", "")

content = [
  "services:",
  "  api:",
  "    environment:",
  f"      DASH_API_SIGIL_ENDPOINT: {q(endpoint)}",
  f"      DASH_API_SIGIL_TENANT_ID: {q(tenant_id)}",
  f"      DASH_API_SIGIL_AUTH_TOKEN: {q(auth_token)}",
  f"      DASH_API_SIGIL_AUTH_USER: {q(auth_user)}",
  f"      DASH_API_SIGIL_INSECURE: {q(insecure)}",
]

otel_services = ["api", "fulfillment-analyzer", "search"]

if otel_endpoint:
  content.append(f"      OTEL_EXPORTER_OTLP_ENDPOINT: {q(otel_endpoint)}")
  resolved = sys.argv[2] if len(sys.argv) > 2 else ""
  resolved_services = set(resolved.split(",")) if resolved else set()

  for svc in otel_services:
    if svc == "api":
      continue
    if resolved_services and svc not in resolved_services:
      continue
    content += [
      f"  {svc}:",
      "    environment:",
      f"      OTEL_EXPORTER_OTLP_ENDPOINT: {q(otel_endpoint)}",
    ]

content.append("")

out_path.write_text("\n".join(content), encoding="utf-8")
PY

COMPOSE_ARGS=(-p "${PROJECT_NAME}" -f "${TMP_COMPOSE}" -f "${TMP_ENV_OVERRIDE}")
CMD=(docker compose "${COMPOSE_ARGS[@]}")

case "${ACTION}" in
  up)
    CMD+=(--profile "${PROFILE}" up -d)
    ;;
  down)
    CMD+=(down)
    ;;
  ps)
    CMD+=(ps)
    ;;
  logs)
    CMD+=(logs -f)
    ;;
esac

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  CMD+=("${EXTRA_ARGS[@]}")
fi

echo "Running: ${CMD[*]}"
"${CMD[@]}"
