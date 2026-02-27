#!/usr/bin/env bash
#
# Common functions for E2E test scripts.
# Source this file from e2e-route-sharing.sh and e2e-stops.sh
#
# Usage:
#   source "${ROOT_DIR}/scripts/lib/e2e-common.sh"
#

# Prevent double-sourcing
if [[ -n "${E2E_COMMON_LOADED:-}" ]]; then
  return 0
fi
E2E_COMMON_LOADED=1

# --- Logging ---

# Default log prefix (can be overridden by sourcing script)
: "${LOG_PREFIX:=[e2e]}"

log() {
  echo "${LOG_PREFIX} $*"
}

# --- Directory Management ---

cleanup_run_dir() {
  rm -rf "${RUN_DIR}"
  mkdir -p "${RUN_DIR}"
}

# --- String Utilities ---

strip_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

# --- Environment Parsing ---

# Parse supabase status -o env output into env vars
parse_status_env() {
  local status_output="$1"

  while IFS= read -r line; do
    case "$line" in
      API_URL=*|SUPABASE_URL=*|SUPABASE_API_URL=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${API_URL:=$value}"
        : "${SUPABASE_URL:=$value}"
        : "${SUPABASE_API_URL:=$value}"
        ;;
      ANON_KEY=*|SUPABASE_ANON_KEY=*|SUPABASE_PUBLISHABLE_KEY=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${ANON_KEY:=$value}"
        : "${SUPABASE_ANON_KEY:=$value}"
        : "${SUPABASE_PUBLISHABLE_KEY:=$value}"
        ;;
      DB_URL=*|DATABASE_URL=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_URL:=$value}"
        : "${DATABASE_URL:=$value}"
        ;;
      DB_HOST=*|PGHOST=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_HOST:=$value}"
        : "${PGHOST:=$value}"
        ;;
      DB_PORT=*|PGPORT=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_PORT:=$value}"
        : "${PGPORT:=$value}"
        ;;
      DB_USER=*|PGUSER=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_USER:=$value}"
        : "${PGUSER:=$value}"
        ;;
      DB_PASSWORD=*|PGPASSWORD=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_PASSWORD:=$value}"
        : "${PGPASSWORD:=$value}"
        ;;
      DB_NAME=*|PGDATABASE=*)
        local value
        value=$(strip_quotes "${line#*=}")
        : "${DB_NAME:=$value}"
        : "${PGDATABASE:=$value}"
        ;;
    esac
  done <<< "$status_output"
}

# --- Tool Verification ---

ensure_tools() {
  local missing=0

  if ! command -v supabase >/dev/null 2>&1; then
    log "supabase CLI not found in PATH" >&2
    missing=1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log "docker CLI not found in PATH" >&2
    missing=1
  elif ! docker info >/dev/null 2>&1; then
    log "Docker daemon is not reachable. Please start Docker and try again." >&2
    missing=1
  fi

  if ! command -v psql >/dev/null 2>&1; then
    log "psql CLI not found in PATH" >&2
    missing=1
  fi

  if ! command -v curl >/dev/null 2>&1; then
    log "curl CLI not found in PATH" >&2
    missing=1
  fi

  if [[ "$missing" -eq 1 ]]; then
    exit 1
  fi
}

# --- Docker Log Utilities ---

write_container_log() {
  local destination="$1"
  shift
  local candidates=("$@")

  : > "$destination"

  local running
  running="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"

  for name in "${candidates[@]}"; do
    if grep -qx "$name" <<< "$running"; then
      docker logs "$name" >"$destination" 2>&1 || true
      return
    fi
  done

  {
    echo "No matching container found for: ${candidates[*]}"
    echo "Available containers:"
    echo "$running"
  } >"$destination"
}

snapshot_docker_logs() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker CLI unavailable for log capture" >"${KONG_LOG:-/dev/null}"
    echo "Docker CLI unavailable for log capture" >"${EDGE_LOG:-/dev/null}"
    echo "Docker CLI unavailable for log capture" >"${AUTH_LOG:-/dev/null}"
    echo "Docker CLI unavailable for log capture" >"${STORAGE_LOG:-/dev/null}"
    return
  fi

  write_container_log "${KONG_LOG:-/dev/null}" "supabase_kong"
  write_container_log "${EDGE_LOG:-/dev/null}" "supabase_edge-runtime" "supabase_edge_runtime" "edge-runtime"
  write_container_log "${AUTH_LOG:-/dev/null}" "supabase_auth" "supabase_auth_backend" "auth"
  write_container_log "${STORAGE_LOG:-/dev/null}" "supabase_storage-api" "supabase_storage" "storage-api"
}

# --- HTTP Utilities ---

curl_code() {
  local url="$1"
  local raw rc code

  if raw="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)"; then
    rc=0
  else
    rc=$?
  fi
  code="$(printf '%s' "$raw" | tr -cd '0-9' | head -c 3)"

  if [ "$rc" -ne 0 ] || [ -z "$code" ]; then
    echo "000"
    return 0
  fi

  echo "$code"
}

WARNED_STATUS_CODE_LENGTH=false
normalize_status_code() {
  local code="$1"
  local label="$2"
  local normalized="$code"

  if [ "${#code}" -ne 3 ]; then
    if [ "$WARNED_STATUS_CODE_LENGTH" != "true" ]; then
      log "Warning: ${label} status code '${code}' malformed; normalizing to 3 digits"
      WARNED_STATUS_CODE_LENGTH=true
    fi
    normalized="$(printf '%s' "$code" | tr -cd '0-9' | head -c 3)"
    if [ -z "$normalized" ]; then
      normalized="000"
    elif [ "${#normalized}" -lt 3 ]; then
      normalized="$(printf '%03d' "$normalized")"
    fi
  fi

  echo "$normalized"
}

# --- Readiness Polling ---

# Poll storage endpoint until ready or timeout
# Usage: poll_storage_ready "http://localhost:54321" 360000 "$LOG_FILE"
poll_storage_ready() {
  local base_url="$1"
  local timeout_ms="${2:-360000}"
  local log_file="${3:-/dev/null}"
  local poll_url="${base_url}/storage/v1/bucket"
  local interval=2
  local elapsed=0

  log "Polling storage at ${poll_url} (timeout: ${timeout_ms}ms)"

  while true; do
    local code
    code=$(curl_code "$poll_url")

    echo "[$(date -Iseconds)] storage poll: ${code}" >> "$log_file"

    if [[ "$code" =~ ^2 ]]; then
      log "Storage ready (HTTP ${code})"
      return 0
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval * 1000))

    if [ "$elapsed" -ge "$timeout_ms" ]; then
      log "Storage readiness timeout after ${timeout_ms}ms"
      return 1
    fi
  done
}

# Poll functions endpoint until ready or timeout
# Usage: poll_functions_ready "http://localhost:54321" 60000 "$LOG_FILE" "function-name"
poll_functions_ready() {
  local base_url="$1"
  local timeout_ms="${2:-60000}"
  local log_file="${3:-/dev/null}"
  local function_name="${4:-health}"
  local poll_url="${base_url}/functions/v1/${function_name}"
  local interval=2
  local elapsed=0

  log "Polling functions at ${poll_url} (timeout: ${timeout_ms}ms)"

  while true; do
    local code
    code=$(curl_code "$poll_url")

    echo "[$(date -Iseconds)] functions poll: ${code}" >> "$log_file"

    # Accept any response (even 401/403) as "function is responding"
    if [[ "$code" != "000" ]]; then
      log "Functions ready (HTTP ${code})"
      return 0
    fi

    sleep "$interval"
    elapsed=$((elapsed + interval * 1000))

    if [ "$elapsed" -ge "$timeout_ms" ]; then
      log "Functions readiness timeout after ${timeout_ms}ms"
      return 1
    fi
  done
}

# --- Diagnostic Utilities ---

write_storage_diagnostics() {
  local base_url="$1"
  local output_file="$2"

  {
    echo "=== Storage Diagnostics ==="
    echo "Time: $(date -Iseconds)"
    echo ""
    echo "--- Bucket List ---"
    curl -sS "${base_url}/storage/v1/bucket" 2>&1 || echo "(curl failed)"
    echo ""
    echo "--- Health Check ---"
    curl -sS "${base_url}/storage/v1/health" 2>&1 || echo "(curl failed)"
  } > "$output_file"
}

# --- Run Orchestration Helpers ---

set_e2e_paths() {
  : "${RUN_DIR:?RUN_DIR is required}"

  RUN_LOG="${RUN_LOG:-${RUN_DIR}/run.log}"
  DB_RESET_LOG="${DB_RESET_LOG:-${RUN_DIR}/db-reset.log}"
  READINESS_STORAGE_LOG="${READINESS_STORAGE_LOG:-${RUN_DIR}/readiness-storage.log}"
  READINESS_FUNCTIONS_LOG="${READINESS_FUNCTIONS_LOG:-${RUN_DIR}/readiness-functions.log}"
  SQL_PROOFS_LOG="${SQL_PROOFS_LOG:-${RUN_DIR}/sql-proofs.log}"
  SUPABASE_STATUS_LOG="${SUPABASE_STATUS_LOG:-${RUN_DIR}/supabase-status.txt}"
  E2E_NODE_LOG="${E2E_NODE_LOG:-${RUN_DIR}/e2e-node.log}"
  KONG_LOG="${KONG_LOG:-${RUN_DIR}/kong.log}"
  EDGE_LOG="${EDGE_LOG:-${RUN_DIR}/edge.log}"
  AUTH_LOG="${AUTH_LOG:-${RUN_DIR}/auth.log}"
  STORAGE_LOG="${STORAGE_LOG:-${RUN_DIR}/storage.log}"
  SUPABASE_ENV_LOG="${SUPABASE_ENV_LOG:-${RUN_DIR}/supabase-env.log}"
}

finalize_run() {
  trap - EXIT
  local exit_code=$?

  snapshot_docker_logs

  if [ "$exit_code" -ne 0 ]; then
    log "Run failed with exit code ${exit_code}. See ${RUN_LOG}"
  fi

  exit "$exit_code"
}

setup_e2e_logging() {
  cleanup_run_dir
  mkdir -p "${RUN_DIR}"
  touch "$RUN_LOG" "$DB_RESET_LOG" "$READINESS_STORAGE_LOG" "$READINESS_FUNCTIONS_LOG" \
    "$SQL_PROOFS_LOG" "$SUPABASE_STATUS_LOG" "$E2E_NODE_LOG" "$KONG_LOG" "$EDGE_LOG" "$AUTH_LOG" \
    "$STORAGE_LOG" "$SUPABASE_ENV_LOG"

  exec > >(tee "$RUN_LOG")
  exec 2> >(tee -a "$RUN_LOG" >&2)
  trap finalize_run EXIT
}

start_supabase_stack() {
  log "Run directory: ${RUN_DIR}"
  log "Supabase status will be recorded at ${SUPABASE_STATUS_LOG}"

  if supabase status | tee "$SUPABASE_STATUS_LOG"; then
    log "Supabase already running"
  else
    log "Supabase not running, starting (excluding studio/logflare/vector)"
    supabase start -x studio,logflare,vector | tee -a "$SUPABASE_STATUS_LOG"
    supabase status | tee -a "$SUPABASE_STATUS_LOG" || true
  fi
}

resolve_db_connection() {
  if [ -n "${DB_URL:-}" ]; then
    DB_CONNECTION_URI="${DB_URL}"
  elif [ -n "${DATABASE_URL:-}" ]; then
    DB_CONNECTION_URI="${DATABASE_URL}"
  elif [ -n "${DB_HOST:-}" ] && [ -n "${DB_PORT:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ]; then
    DB_CONNECTION_URI="postgresql://${DB_USER}:${DB_PASSWORD:-postgres}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  else
    log "Unable to determine database connection info from supabase status"
    exit 1
  fi
}

run_sql_proofs() {
  local connection_uri="$1"

  log "Running SQL proofs against ${connection_uri}"
  set +e
  PGOPTIONS="--client-min-messages=warning" \
  psql "$connection_uri" <<'SQL' | tee "$SQL_PROOFS_LOG"
\set ON_ERROR_STOP on
select 'route_cache_exists', to_regclass('public.route_cache') is not null;
select count(*) as route_cache_count from public.route_cache;
select 'route_compositions_exists', to_regclass('public.route_compositions') is not null;
select count(*) = 3 as route_compositions_required_columns
from information_schema.columns
where table_schema = 'public'
  and table_name = 'route_compositions'
  and column_name in ('route_hash', 'hit_count', 'last_accessed_at');
select count(*) as route_generation_stats_rows from public.route_generation_stats;
select count(*) from public.route_compositions;
SQL
  local sql_status=${PIPESTATUS[0]}
  set -e

  if [ "$sql_status" -ne 0 ]; then
    log "SQL proofs failed; see ${SQL_PROOFS_LOG}"
    exit "$sql_status"
  fi
}

run_node_flow() {
  local script_path="$1"
  local node_log="$2"

  log "Starting Node E2E script (${script_path})"
  log "Env: KATAI_E2E_FIXTURE=${KATAI_E2E_FIXTURE:-} KATAI_E2E_FORCE_LLM_FAIL=${KATAI_E2E_FORCE_LLM_FAIL:-}"

  set +e
  node "${script_path}" | tee "$node_log"
  local node_status=${PIPESTATUS[0]}
  set -e

  if [ "$node_status" -ne 0 ]; then
    log "E2E node flow failed; see ${node_log}"
    exit "$node_status"
  fi

  log "E2E flow (${script_path}) completed successfully"
}

run_e2e_suite() {
  : "${ROOT_DIR:?ROOT_DIR is required}"

  cd "${ROOT_DIR}"

  set_e2e_paths
  setup_e2e_logging
  ensure_tools
  start_supabase_stack

  local status_env_output
  status_env_output="$(supabase status -o env 2>&1 || true)"
  printf "%s\n" "$status_env_output" >"$SUPABASE_ENV_LOG"
  parse_status_env "$status_env_output"

  if [ -z "${API_URL:-}" ] || [ -z "${ANON_KEY:-}" ]; then
    log "Unable to determine Supabase API URL or anon key. See ${SUPABASE_STATUS_LOG} and ${SUPABASE_ENV_LOG}"
    exit 1
  fi

  resolve_db_connection

  export API_URL SUPABASE_URL SUPABASE_API_URL ANON_KEY SUPABASE_ANON_KEY SUPABASE_PUBLISHABLE_KEY
  export SUPABASE_DB_ONLY=true

  set +e
  DB_RESET_LOG="$DB_RESET_LOG" node "${ROOT_DIR}/scripts/e2e-db-reset.mjs"
  local reset_status=$?
  set -e

  local known_storage_502=false
  if [ "$reset_status" -ne 0 ]; then
    if grep -qi "502" "$DB_RESET_LOG" && grep -qi "storage" "$DB_RESET_LOG"; then
      known_storage_502=true
      log "supabase db reset hit known storage 502 race; continuing after readiness checks"
    else
      log "supabase db reset failed (non-502). See ${DB_RESET_LOG}"
      exit "$reset_status"
    fi
  fi

  : "${KATAI_E2E_STORAGE_READY_TIMEOUT_MS:=360000}"
  if ! poll_storage_ready "${API_URL}" "${KATAI_E2E_STORAGE_READY_TIMEOUT_MS}" "$READINESS_STORAGE_LOG"; then
    write_storage_diagnostics "${API_URL}" "${RUN_DIR}/storage-readiness.log"
    exit 1
  fi

  if ! poll_functions_ready "${API_URL}" 120000 "$READINESS_FUNCTIONS_LOG" "_internal/health"; then
    log "Functions readiness timed out"
    exit 1
  fi

  run_sql_proofs "$DB_CONNECTION_URI"

  if [ "$reset_status" -ne 0 ] && [ "$known_storage_502" != "true" ]; then
    log "Database reset failed for non-502 reason"
    exit "$reset_status"
  fi

  E2E_NODE_SCRIPT="${E2E_NODE_SCRIPT:-scripts/e2e-route-sharing.mjs}"
  run_node_flow "$E2E_NODE_SCRIPT" "$E2E_NODE_LOG"
}
