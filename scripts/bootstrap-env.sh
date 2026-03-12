#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_ENV="${1:-${REPO_ROOT}/.env}"
SHARED_ENV_FILE="${SIGIL_SHARED_ENV_FILE:-${HOME}/work/sigil/.env}"
EXAMPLE_ENV="${REPO_ROOT}/.env.example"

if [[ -f "${TARGET_ENV}" ]]; then
  exit 0
fi

mkdir -p "$(dirname "${TARGET_ENV}")"

if [[ -f "${SHARED_ENV_FILE}" ]]; then
  cp "${SHARED_ENV_FILE}" "${TARGET_ENV}"
  echo "Bootstrapped ${TARGET_ENV} from ${SHARED_ENV_FILE}"
  exit 0
fi

if [[ -f "${EXAMPLE_ENV}" ]]; then
  cp "${EXAMPLE_ENV}" "${TARGET_ENV}"
  echo "Bootstrapped ${TARGET_ENV} from ${EXAMPLE_ENV}"
  exit 0
fi

echo "No env source found for ${TARGET_ENV}" >&2
exit 1
