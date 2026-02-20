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
  export SIGIL_TRAFFIC_ONESHOT="${SIGIL_TRAFFIC_ONESHOT:-0}"
  export SIGIL_TRAFFIC_ASSERT_TIMEOUT_SECONDS="${SIGIL_TRAFFIC_ASSERT_TIMEOUT_SECONDS:-180}"
  export SIGIL_TRAFFIC_ENABLE_DOTNET="${SIGIL_TRAFFIC_ENABLE_DOTNET:-auto}"

  if [[ "${SIGIL_TRAFFIC_ONESHOT}" == "1" || "${SIGIL_TRAFFIC_ONESHOT}" == "true" ]]; then
    if [[ "${SIGIL_TRAFFIC_MAX_CYCLES:-}" =~ ^[1-9][0-9]*$ ]]; then
      export SIGIL_TRAFFIC_MAX_CYCLES
    else
      export SIGIL_TRAFFIC_MAX_CYCLES="2"
    fi
    if [[ "${SIGIL_TRAFFIC_ENABLE_DOTNET}" == "auto" ]]; then
      export SIGIL_TRAFFIC_ENABLE_DOTNET="true"
    fi
  else
    export SIGIL_TRAFFIC_MAX_CYCLES="${SIGIL_TRAFFIC_MAX_CYCLES:-0}"
  fi
}

CHILD_NAMES=()
CHILD_PIDS=()
DOTNET_ENABLED=1
DOTNET_MSBUILD_ARGS=()

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
  pnpm install --frozen-lockfile --prod=false

  log "building JS SDK"
  pnpm --filter @grafana/sigil-sdk-js run build
}

setup_python() {
  log "installing python SDK, provider helper packages, and framework modules"
  python3 -m venv "${PYTHON_VENV}"
  "${PYTHON_VENV}/bin/pip" install --upgrade pip
  "${PYTHON_VENV}/bin/pip" install \
    -e "${ROOT_DIR}/sdks/python" \
    -e "${ROOT_DIR}/sdks/python-providers/openai" \
    -e "${ROOT_DIR}/sdks/python-providers/anthropic" \
    -e "${ROOT_DIR}/sdks/python-providers/gemini" \
    -e "${ROOT_DIR}/sdks/python-frameworks/langchain" \
    -e "${ROOT_DIR}/sdks/python-frameworks/langgraph"
}

setup_java() {
  log "building Java devex emitter classes"
  cd "${ROOT_DIR}/sdks/java"
  ./gradlew --no-daemon :devex-emitter:classes >/dev/null
}

setup_dotnet() {
  local dotnet_toggle="${SIGIL_TRAFFIC_ENABLE_DOTNET}"
  local protoc_path
  if [[ "${dotnet_toggle}" == "false" || "${dotnet_toggle}" == "0" ]]; then
    DOTNET_ENABLED=0
    log "dotnet emitter disabled via SIGIL_TRAFFIC_ENABLE_DOTNET=${dotnet_toggle}"
    return 0
  fi

  protoc_path="$(command -v protoc || true)"
  if [[ -n "${protoc_path}" ]]; then
    DOTNET_MSBUILD_ARGS=(-p:Protobuf_ProtocFullPath="${protoc_path}")
    log "using protoc from ${protoc_path} for .NET build"
  else
    DOTNET_MSBUILD_ARGS=()
  fi

  log "restoring .NET devex emitter project"
  cd "${ROOT_DIR}"
  dotnet restore ./sdks/dotnet/examples/Grafana.Sigil.DevExEmitter/Grafana.Sigil.DevExEmitter.csproj "${DOTNET_MSBUILD_ARGS[@]}" >/dev/null

  log "running .NET emitter preflight build"
  set +e
  dotnet build ./sdks/dotnet/examples/Grafana.Sigil.DevExEmitter/Grafana.Sigil.DevExEmitter.csproj "${DOTNET_MSBUILD_ARGS[@]}" >/dev/null
  local build_status=$?
  set -e

  if (( build_status == 0 )); then
    return 0
  fi

  if [[ "${dotnet_toggle}" == "true" || "${dotnet_toggle}" == "1" ]]; then
    log ".NET preflight failed and SIGIL_TRAFFIC_ENABLE_DOTNET is forced"
    return "${build_status}"
  fi

  DOTNET_ENABLED=0
  log "dotnet preflight build failed with status ${build_status}; continuing without dotnet emitter"
  return 0
}

start_child() {
  local name="$1"
  local cmd="$2"

  log "starting ${name} emitter"
  bash -c "${cmd}" &
  local pid=$!

  CHILD_NAMES+=("${name}")
  CHILD_PIDS+=("${pid}")
}

find_exited_child_index() {
  local idx
  for idx in "${!CHILD_PIDS[@]}"; do
    if ! kill -0 "${CHILD_PIDS[$idx]}" 2>/dev/null; then
      printf '%s' "${idx}"
      return 0
    fi
  done
  printf '%s' "-1"
}

supervise_children() {
  local status
  local exited_idx
  local exited_name

  if (( ${#CHILD_PIDS[@]} == 0 )); then
    log "no emitters were started"
    return 1
  fi

  while true; do
    set +e
    wait -n "${CHILD_PIDS[@]}"
    status=$?
    set -e

    exited_idx="$(find_exited_child_index)"
    if [[ "${exited_idx}" == "-1" ]]; then
      log "wait returned but no exited child could be identified"
      cleanup_children
      return 1
    fi

    exited_name="${CHILD_NAMES[$exited_idx]}"
    if (( status == 0 )); then
      log "${exited_name} emitter exited unexpectedly with status 0"
      cleanup_children
      return 1
    fi

    log "${exited_name} emitter exited with status ${status}"
    cleanup_children
    return "${status}"
  done
}

supervise_one_shot_children() {
  local idx
  local pid
  local status
  local name

  if (( ${#CHILD_PIDS[@]} == 0 )); then
    log "no emitters were started"
    return 1
  fi

  for idx in "${!CHILD_PIDS[@]}"; do
    pid="${CHILD_PIDS[$idx]}"
    name="${CHILD_NAMES[$idx]}"
    set +e
    wait "${pid}"
    status=$?
    set -e
    if (( status != 0 )); then
      log "${name} emitter exited with status ${status}"
      cleanup_children
      return "${status}"
    fi
    log "${name} emitter completed one-shot run"
  done

  CHILD_PIDS=()
  return 0
}

run_one_shot_assertions() {
  log "running one-shot Sigil API assertions"
  "${PYTHON_VENV}/bin/python" "${ROOT_DIR}/.config/devex/sdk-traffic/assert-one-shot.py"
}

main() {
  set_default_env
  log "runtime defaults interval_ms=${SIGIL_TRAFFIC_INTERVAL_MS} stream_percent=${SIGIL_TRAFFIC_STREAM_PERCENT} conversations=${SIGIL_TRAFFIC_CONVERSATIONS} rotate_turns=${SIGIL_TRAFFIC_ROTATE_TURNS} oneshot=${SIGIL_TRAFFIC_ONESHOT} max_cycles=${SIGIL_TRAFFIC_MAX_CYCLES}"
  wait_for_sigil
  setup_node
  setup_python
  setup_java
  setup_dotnet

  if [[ "${SIGIL_TRAFFIC_ONESHOT}" == "1" || "${SIGIL_TRAFFIC_ONESHOT}" == "true" ]]; then
    if (( DOTNET_ENABLED != 1 )); then
      log "one-shot mode requires dotnet emitter availability"
      return 1
    fi
  fi

  start_child "go" "cd '${ROOT_DIR}' && go run ./sdks/go/cmd/devex-emitter"
  start_child "js" "cd '${ROOT_DIR}/sdks/js' && node ./scripts/devex-emitter.mjs"
  start_child "python" "cd '${ROOT_DIR}' && ${PYTHON_VENV}/bin/python ./sdks/python/scripts/devex_emitter.py"
  start_child "java" "cd '${ROOT_DIR}/sdks/java' && ./gradlew --no-daemon :devex-emitter:run"
  if (( DOTNET_ENABLED == 1 )); then
    start_child "dotnet" "cd '${ROOT_DIR}' && dotnet run --no-build --project ./sdks/dotnet/examples/Grafana.Sigil.DevExEmitter/Grafana.Sigil.DevExEmitter.csproj"
  fi

  if [[ "${SIGIL_TRAFFIC_ONESHOT}" == "1" || "${SIGIL_TRAFFIC_ONESHOT}" == "true" ]]; then
    supervise_one_shot_children
    run_one_shot_assertions
    return 0
  fi

  supervise_children
}

main "$@"
