#!/usr/bin/env bash
# Start the whole platform locally: backing services, API, worker and Web_Client.
#
#   ./dev.sh               start everything; Ctrl+C stops the three app processes
#   ./dev.sh --skip-deps   skip `uv sync` and `npm install`
#   ./dev.sh --no-frontend start the backend only
#
# Runs in Git Bash on Windows, and on macOS and Linux. Needs docker, uv and npm.
# Docker containers keep running after Ctrl+C; stop them with
# `docker compose down` from backend/.
#
# Logs go to .dev-logs/{api,worker,web}.log.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LOGS="$ROOT/.dev-logs"

API_URL="http://127.0.0.1:8000"
WEB_URL="http://localhost:5173"

SKIP_DEPS=0
WITH_FRONTEND=1
for arg in "$@"; do
  case "$arg" in
    --skip-deps) SKIP_DEPS=1 ;;
    --no-frontend) WITH_FRONTEND=0 ;;
    -h | --help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (see --help)" >&2; exit 2 ;;
  esac
done

is_windows() { [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; }
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

for tool in docker uv curl; do
  command -v "$tool" >/dev/null || die "$tool is not on PATH"
done
if [[ $WITH_FRONTEND -eq 1 ]]; then command -v npm >/dev/null || die "npm is not on PATH"; fi
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop first."

port_busy() { curl -s -o /dev/null -m 2 "$1"; }
port_busy "$API_URL" && die "Something already answers on $API_URL. Stop the old API first."
if [[ $WITH_FRONTEND -eq 1 ]] && port_busy "$WEB_URL"; then
  die "Something already answers on $WEB_URL. Stop the old dev server first."
fi

# ── Process handling ──────────────────────────────────────────────────────────
PIDS=()

# Stops a process and everything it started (uv -> uvicorn -> python, npm -> node).
kill_tree() {
  local pid=$1
  if is_windows; then
    local winpid
    winpid=$(cat "/proc/$pid/winpid" 2>/dev/null) || return 0
    taskkill //F //T //PID "$winpid" >/dev/null 2>&1 || true
  else
    local child
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  trap - INT TERM EXIT
  if [[ ${#PIDS[@]} -gt 0 ]]; then
    step "Stopping the API, worker and Web_Client"
    for pid in "${PIDS[@]}"; do kill_tree "$pid"; done
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# Starts a command in the background, logging to .dev-logs/<name>.log.
start() {
  local name=$1 dir=$2; shift 2
  (cd "$dir" && exec "$@") >"$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
  eval "PID_$name=$!"
}

# Waits until $url answers, failing early if the process behind it died.
wait_for_url() {
  local name=$1 url=$2 pid=$3 seconds=$4
  for ((i = 0; i < seconds; i++)); do
    curl -s -o /dev/null -m 2 "$url" && return 0
    kill -0 "$pid" 2>/dev/null || { tail -n 30 "$LOGS/$name.log"; die "$name exited during startup (log above)"; }
    sleep 1
  done
  tail -n 30 "$LOGS/$name.log"
  die "$name did not answer on $url within ${seconds}s (log above)"
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing
}

wait_healthy() {
  local container=$1 seconds=$2
  for ((i = 0; i < seconds; i++)); do
    [[ "$(container_health "$container")" == healthy ]] && return 0
    sleep 1
  done
  die "$container is not healthy after ${seconds}s. Check: docker logs $container"
}

mkdir -p "$LOGS"

# ── 1. Configuration ─────────────────────────────────────────────────────────
step "Configuration"
if [[ ! -f "$BACKEND/.env" ]]; then
  cp "$BACKEND/.env.example" "$BACKEND/.env"
  echo "Created backend/.env from .env.example"
fi

# Windows can reserve port 9001 (Hyper-V / WinNAT), which MinIO's console wants.
if is_windows && ! grep -q '^MINIO_CONSOLE_PORT=' "$BACKEND/.env"; then
  if netsh int ipv4 show excludedportrange protocol=tcp 2>/dev/null |
    awk '$1 ~ /^[0-9]+$/ && $1 <= 9001 && $2 >= 9001 { found = 1 } END { exit !found }'; then
    printf '\nMINIO_CONSOLE_PORT=9011\n' >>"$BACKEND/.env"
    echo "Windows reserves port 9001, so the MinIO console will use 9011 (set in backend/.env)"
  fi
fi

# ── 2. Backing services ───────────────────────────────────────────────────────
step "Backing services (docker compose; the first run compiles MinIO, a few minutes)"
(cd "$BACKEND" && docker compose up -d --build)
echo "Waiting for postgres and minio to be healthy..."
wait_healthy hasoub-postgres 120
wait_healthy hasoub-minio 120

# OpenBao runs in dev mode and keeps nothing across restarts, so its transit key
# has to exist again before the API can encrypt or decrypt anything.
step "OpenBao transit key"
TRANSIT_KEY=$(grep -E '^OPENBAO_TRANSIT_KEY=' "$BACKEND/.env" | cut -d= -f2- | tr -d '\r')
TRANSIT_KEY=${TRANSIT_KEY:-hasoub-data-key}
bao() { docker exec hasoub-openbao env BAO_ADDR=http://127.0.0.1:8200 BAO_TOKEN=dev-root-token bao "$@"; }
for ((i = 0; i < 30; i++)); do bao status >/dev/null 2>&1 && break; sleep 1; done
bao secrets list 2>/dev/null | grep -q '^transit/' || bao secrets enable transit >/dev/null
if bao read "transit/keys/$TRANSIT_KEY" >/dev/null 2>&1; then
  echo "Transit key $TRANSIT_KEY is present"
else
  bao write -f "transit/keys/$TRANSIT_KEY" >/dev/null
  warn "Created a NEW transit key $TRANSIT_KEY. Data encrypted under the old one (MFA"
  warn "secrets, national IDs) can't be decrypted: re-seed the admin and re-enrol MFA."
fi

# ── 3. Backend ────────────────────────────────────────────────────────────────
if [[ $SKIP_DEPS -eq 0 ]]; then
  step "Backend dependencies (uv sync)"
  (cd "$BACKEND" && uv sync --extra dev --extra lint)
fi

step "Database migrations (alembic upgrade head)"
(cd "$BACKEND" && uv run alembic upgrade head)

step "Starting the API and the worker"
start api "$BACKEND" uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
start worker "$BACKEND" uv run arq app.worker.WorkerSettings
wait_for_url api "$API_URL/api/docs" "$PID_api" 120
echo "API is up"

# ── 4. Frontend ───────────────────────────────────────────────────────────────
if [[ $WITH_FRONTEND -eq 1 ]]; then
  if [[ $SKIP_DEPS -eq 0 ]] && [[ ! -d "$FRONTEND/node_modules" ||
    "$FRONTEND/package-lock.json" -nt "$FRONTEND/node_modules/.package-lock.json" ]]; then
    step "Frontend dependencies (npm install)"
    (cd "$FRONTEND" && npm install)
  fi
  step "Starting the Web_Client"
  # There is no dev proxy, so the Web_Client calls the API by its full URL.
  # Variables already in the environment win over frontend/.env files.
  export VITE_API_BASE_URL="${VITE_API_BASE_URL:-$API_URL/api/v1}"
  start web "$FRONTEND" npm run dev -- --port 5173 --strictPort
  wait_for_url web "$WEB_URL" "$PID_web" 120
fi

# ── Ready ─────────────────────────────────────────────────────────────────────
CONSOLE_PORT=$(grep -E '^MINIO_CONSOLE_PORT=' "$BACKEND/.env" | cut -d= -f2- | tr -d '\r')
step "Ready"
[[ $WITH_FRONTEND -eq 1 ]] && echo "  App            $WEB_URL"
echo "  API docs       $API_URL/api/docs"
echo "  Mailpit        http://localhost:8025   (verification codes)"
echo "  MinIO console  http://localhost:${CONSOLE_PORT:-9001}   (minioadmin / minioadmin)"
echo "  Logs           .dev-logs/{api,worker,web}.log"
CLAM=$(container_health hasoub-clamav)
if [[ "$CLAM" != healthy ]]; then
  warn "ClamAV is $CLAM. It needs ~2 min on first boot; until it is healthy,"
  warn "uploaded CVs stay 'Scan pending' (scanning fails closed)."
fi
echo
echo "Press Ctrl+C to stop the API, worker and Web_Client."

# Exit (and clean up) as soon as any of the app processes dies.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "A process exited unexpectedly. Check .dev-logs/. Stopping the rest."
      exit 1
    fi
  done
  sleep 2
done
