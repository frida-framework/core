#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT_DIR}/artifacts/e2e/stops"
DB_RESET_LOG="${ROOT_DIR}/artifacts/e2e/db-reset.log"
LOG_PREFIX="[e2e-stops]"
E2E_NODE_SCRIPT="${E2E_NODE_SCRIPT:-scripts/e2e-stops.mjs}"

: "${KATAI_E2E_FIXTURE:=1}"
: "${KATAI_E2E_STORAGE_READY_TIMEOUT_MS:=360000}"

export KATAI_E2E_FIXTURE KATAI_E2E_STORAGE_READY_TIMEOUT_MS

source "${ROOT_DIR}/scripts/lib/e2e-common.sh"

run_e2e_suite
