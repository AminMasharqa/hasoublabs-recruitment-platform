#!/usr/bin/env bash
# Wipe the LOCAL development database and queues, then migrate to head.
#
#   ./scripts/wipe_dev_db.sh --yes      run from backend/ with the API and worker STOPPED
#
# Drops and recreates the database named in backend/.env, flushes Valkey (job
# queue, scheduler lease, audit-verify cursor), and runs `alembic upgrade head`.
# Afterwards start the stack and re-seed:   ./dev.sh --seed-admin --seed-demo
#
# What it does not touch: OpenBao (its transit key stays valid, but nothing in
# the new database is encrypted under it yet) and MinIO. MinIO's CV buckets are
# object-locked in COMPLIANCE mode, so old objects can't be removed; they are
# orphans that no row points at.
#
# Development only: refuses unless APP_ENV=development and the database is local.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${1:-}" != "--yes" ]]; then
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

env_value() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '\r'; }

[[ "$(env_value APP_ENV)" == "development" ]] || { echo "APP_ENV is not development; refusing." >&2; exit 1; }

DB_URL="$(env_value DATABASE_URL)"
[[ "$DB_URL" == *"@localhost"* || "$DB_URL" == *"@127.0.0.1"* ]] || { echo "DATABASE_URL is not local; refusing." >&2; exit 1; }
DB_NAME="${DB_URL##*/}"
DB_USER="$(echo "$DB_URL" | sed -E 's#^[^:]+://([^:]+):.*#\1#')"

if curl -s -o /dev/null -m 2 http://127.0.0.1:8000/api/docs; then
  echo "The API still answers on :8000. Stop the API and the worker first." >&2
  exit 1
fi

psql_admin() { docker exec hasoub-postgres psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d postgres -q "$@"; }

echo "Dropping and recreating database $DB_NAME"
psql_admin -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)"
psql_admin -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\""

echo "Flushing Valkey"
docker exec hasoub-valkey valkey-cli FLUSHALL >/dev/null

echo "Migrating"
uv run alembic upgrade head
echo "Done. Start the stack and re-seed: ./dev.sh --seed-admin --seed-demo"
