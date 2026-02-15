#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/app/sigil"
PYTHON_VENV="/opt/venv-sigil-traffic"

log() {
  printf '[sdk-traffic] %s\n' "$*"
}

set_default_env() {
  export SIGIL_TRAFFIC_INTERVAL_MS="${SIGIL_TRAFFIC_INTERVAL_MS:-2000}"
  export SIGIL_TRAFFIC_STREAM_PERCENT="${SIGIL_TRAFFIC_STREAM_PERCENT:-30}"
  export SIGIL_TRAFFIC_CONVERSATIONS="${SIGIL_TRAFFIC_CONVERSATIONS:-3}"
  export SIGIL_TRAFFIC_ROTATE_TURNS="${SIGIL_TRAFFIC_ROTATE_TURNS:-24}"
  export SIGIL_TRAFFIC_CUSTOM_PROVIDER="${SIGIL_TRAFFIC_CUSTOM_PROVIDER:-mistral}"
  export SIGIL_TRAFFIC_GEN_HTTP_ENDPOINT="${SIGIL_TRAFFIC_GEN_HTTP_ENDPOINT:-http://sigil:8080/api/v1/generations:export}"
  export SIGIL_TRAFFIC_GEN_GRPC_ENDPOINT="${SIGIL_TRAFFIC_GEN_GRPC_ENDPOINT:-sigil:4317}"
  export SIGIL_TRAFFIC_TRACE_HTTP_ENDPOINT="${SIGIL_TRAFFIC_TRACE_HTTP_ENDPOINT:-http://alloy:4318/v1/traces}"
  export SIGIL_TRAFFIC_TRACE_GRPC_ENDPOINT="${SIGIL_TRAFFIC_TRACE_GRPC_ENDPOINT:-alloy:4317}"
}

CHILD_NAMES=()
CHILD_PIDS=()

cleanup_children() {
  for pid in "${CHILD_PIDS[@]:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      kill "${pid}" 2>/dev/null || true
    fi
  done

  for pid in "${CHILD_PIDS[@]:-}"; do
    if [[ -n "${pid}" ]]; then
      wait "${pid}" 2>/dev/null || true
    fi
  done
}

on_signal() {
  log "received termination signal, shutting down child emitters"
  cleanup_children
  exit 143
}

trap on_signal INT TERM

wait_for_sigil() {
  local attempts=0
  local max_attempts=180

  until curl -fsS "http://sigil:8080/healthz" >/dev/null; do
    attempts=$((attempts + 1))
    if (( attempts >= max_attempts )); then
      log "sigil health check did not become ready after ${max_attempts} attempts"
      return 1
    fi
    sleep 2
  done

  log "sigil is healthy"
}

setup_node() {
  log "installing pnpm dependencies"
  cd "${ROOT_DIR}"
  corepack enable
  pnpm install --frozen-lockfile

  log "building JS SDK"
  cd "${ROOT_DIR}/sdks/js"
  pnpm run build
}

setup_python() {
  log "installing python SDK and provider helper packages"
  python3 -m venv "${PYTHON_VENV}"
  "${PYTHON_VENV}/bin/pip" install --upgrade pip
  "${PYTHON_VENV}/bin/pip" install \
    -e "${ROOT_DIR}/sdks/python" \
    -e "${ROOT_DIR}/sdks/python-providers/openai" \
    -e "${ROOT_DIR}/sdks/python-providers/anthropic" \
    -e "${ROOT_DIR}/sdks/python-providers/gemini"
}

setup_java() {
  log "building Java devex emitter classes"
  cd "${ROOT_DIR}/sdks/java"
  ./gradlew --no-daemon :devex-emitter:classes >/dev/null
}

setup_dotnet() {
  log "restoring .NET devex emitter project"
  cd "${ROOT_DIR}"
  dotnet restore ./sdks/dotnet/examples/Grafana.Sigil.DevExEmitter/Grafana.Sigil.DevExEmitter.csproj >/dev/null
}

start_child() {
  local name="$1"
  local cmd="$2"

  log "starting ${name} emitter"
  bash -lc "${cmd}" &
  local pid=$!

  CHILD_NAMES+=("${name}")
  CHILD_PIDS+=("${pid}")
}

find_exited_child_name() {
  local idx
  for idx in "${!CHILD_PIDS[@]}"; do
    if ! kill -0 "${CHILD_PIDS[$idx]}" 2>/dev/null; then
      printf '%s' "${CHILD_NAMES[$idx]}"
      return 0
    fi
  done
  printf 'unknown'
}

supervise_children() {
  local status
  local exited_name

  while true; do
    set +e
    wait -n "${CHILD_PIDS[@]}"
    status=$?
    set -e

    exited_name="$(find_exited_child_name)"
    if (( status == 0 )); then
      log "${exited_name} emitter exited unexpectedly with status 0"
      status=1
    else
      log "${exited_name} emitter exited with status ${status}"
    fi

    cleanup_children
    return "${status}"
  done
}

main() {
  set_default_env
  log "runtime defaults interval_ms=${SIGIL_TRAFFIC_INTERVAL_MS} stream_percent=${SIGIL_TRAFFIC_STREAM_PERCENT} conversations=${SIGIL_TRAFFIC_CONVERSATIONS} rotate_turns=${SIGIL_TRAFFIC_ROTATE_TURNS}"
  wait_for_sigil
  setup_node
  setup_python
  setup_java
  setup_dotnet

  start_child "go" "cd '${ROOT_DIR}' && go run ./sdks/go/cmd/devex-emitter"
  start_child "js" "cd '${ROOT_DIR}/sdks/js' && node ./scripts/devex-emitter.mjs"
  start_child "python" "cd '${ROOT_DIR}' && ${PYTHON_VENV}/bin/python ./sdks/python/scripts/devex_emitter.py"
  start_child "java" "cd '${ROOT_DIR}/sdks/java' && ./gradlew --no-daemon :devex-emitter:run"
  start_child "dotnet" "cd '${ROOT_DIR}' && dotnet run --project ./sdks/dotnet/examples/Grafana.Sigil.DevExEmitter/Grafana.Sigil.DevExEmitter.csproj"

  supervise_children
}

main "$@"
