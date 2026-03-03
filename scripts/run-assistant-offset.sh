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

python3 - "${TMP_RESOLVED}" "${TMP_COMPOSE}" "${OFFSET}" "${PROJECT_NAME}" "${SIGIL_DIR}/docker-compose.yaml" "${SIGIL_DIR}/.config/docker-compose-base.yaml" <<'PY'
import re
import sys
from pathlib import Path

compose_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
offset = int(sys.argv[3])
project_name = sys.argv[4]
reserved_sources = [Path(p) for p in sys.argv[5:]]

lines = compose_path.read_text(encoding="utf-8").splitlines()

in_services = False
current_service = None
in_ports = False
services_order = []
ports_by_service = {}
service_has_container_name = {}
in_service_block = False

service_re = re.compile(r"^  ([A-Za-z0-9_.-]+):\s*$")
service_key_re = re.compile(r"^    [A-Za-z0-9_.-]+:\s*(?:#.*)?$")
container_name_re = re.compile(r"^    container_name:\s*.*$")
ports_key_re = re.compile(r"^    ports:\s*(?:#.*)?$")
port_item_re = re.compile(r"""^(\s*-\s*)['"]?([^'"]+)['"]?(\s*(?:#.*)?)$""")
published_re = re.compile(r'^(\s*published:\s*"?)(\d+)("?)(\s*(?:#.*)?)$')

def parse_port_mapping(spec: str):
  suffix = ""
  if "/" in spec:
    base, proto = spec.rsplit("/", 1)
    suffix = "/" + proto
  else:
    base = spec

  parts = base.split(":")
  if len(parts) == 2:
    host, container = parts
    ip = None
  elif len(parts) == 3:
    ip, host, container = parts
  else:
    return None, None, None, suffix

  if not host.isdigit():
    return ip, None, container, suffix

  return ip, int(host), container, suffix

def render_mapping(ip, host, container, suffix):
  if ip is None:
    return f"{host}:{container}{suffix}"
  return f"{ip}:{host}:{container}{suffix}"

def safe_container_name(project: str, service: str):
  raw = f"{project}-{service}".lower()
  clean = re.sub(r"[^a-z0-9_.-]", "-", raw)
  clean = re.sub(r"-{2,}", "-", clean).strip("-")
  return clean or "assistant-offset"

def collect_reserved_ports(paths):
  reserved = set()
  pat = re.compile(r"""^\s*-\s*['"]?([^'"]+)['"]?(?:\s*#.*)?$""")
  for p in paths:
    if not p.exists():
      continue
    for raw in p.read_text(encoding="utf-8").splitlines():
      m = pat.match(raw)
      if not m:
        continue
      _ip, host, _container, _suffix = parse_port_mapping(m.group(1).strip())
      if host is not None:
        reserved.add(host)
  return reserved

reserved_ports = collect_reserved_ports(reserved_sources)
used_ports = set(reserved_ports)

out = []

for line in lines:
  if not in_services and line.strip() == "services:":
    in_services = True
    out.append(line)
    continue

  if in_services and line and not line.startswith(" "):
    # End of services section, flush container_name for previous service if needed.
    if current_service and not service_has_container_name.get(current_service, False):
      out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')
    current_service = None
    in_ports = False
    in_service_block = False
    in_services = False
    out.append(line)
    continue

  svc_match = service_re.match(line) if in_services else None
  if svc_match:
    # Starting a new service; ensure previous service has a container_name.
    if current_service and not service_has_container_name.get(current_service, False):
      out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')

    current_service = svc_match.group(1)
    in_service_block = True
    in_ports = False
    services_order.append(current_service)
    ports_by_service[current_service] = []
    service_has_container_name[current_service] = False
    out.append(line)
    continue

  if in_service_block and current_service:
    if ports_key_re.match(line):
      in_ports = True
      out.append(line)
      continue

    if in_ports:
      pub_match = published_re.match(line)
      if pub_match:
        prefix, published_port, quote_suffix, trailing_comment = pub_match.groups()
        host = int(published_port)
        candidate = host + offset
        while candidate in used_ports:
          candidate += 1
        used_ports.add(candidate)
        ports_by_service[current_service].append(str(candidate))
        out.append(f"{prefix}{candidate}{quote_suffix}{trailing_comment}")
        continue

      item_match = port_item_re.match(line.strip())
      if item_match:
        original_spec = item_match.group(2).strip()
        trailing_comment = item_match.group(3) or ""
        ip, host, container, suffix = parse_port_mapping(original_spec)
        if host is not None:
          candidate = host + offset
          while candidate in used_ports:
            candidate += 1
          used_ports.add(candidate)
          remapped = render_mapping(ip, candidate, container, suffix)
          ports_by_service[current_service].append(remapped)
          out.append(f'      - "{remapped}"{trailing_comment}')
        else:
          out.append(line)
        continue
      # Leaving ports block.
      if service_key_re.match(line) or service_re.match(line):
        in_ports = False

    if container_name_re.match(line):
      service_has_container_name[current_service] = True
      out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')
      continue

  out.append(line)

# File ended while still in a service.
if current_service and not service_has_container_name.get(current_service, False):
  out.append(f'    container_name: "{safe_container_name(project_name, current_service)}"')

output_path.write_text("\n".join(out) + "\n", encoding="utf-8")

print(f"Generated remapped compose: {output_path}")
print(f"Remapped services: {len([s for s in services_order if ports_by_service.get(s)])}")
for svc in services_order:
  if not ports_by_service.get(svc):
    continue
  print(f"  {svc}: {', '.join(ports_by_service[svc])}")
PY

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
