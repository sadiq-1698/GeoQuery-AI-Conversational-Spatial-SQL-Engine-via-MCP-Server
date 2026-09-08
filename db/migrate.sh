#!/bin/bash
# Applies db/schema/*.sql and *.sh files against DATABASE_URL, in filename order.
#
# Safe to re-run: a schema_migrations tracking table records which numbered
# files have already been applied, so running this against a database that
# Docker's docker-entrypoint-initdb.d already initialized (those scripts only
# run once, on a fresh volume) is a no-op for anything already applied — only
# new/edited migrations run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMA_DIR="$SCRIPT_DIR/schema"

# Convenience: pick up DATABASE_URL/MCP_RO_PASSWORD/etc. from .env if present
# and not already exported, so `./db/migrate.sh` works standalone.
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (see .env.example)}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
"

while IFS= read -r file; do
  filename="$(basename "$file")"
  version="${filename%%_*}"

  already_applied="$(psql "$DATABASE_URL" -tAc \
    "SELECT 1 FROM schema_migrations WHERE version = '$version'")"

  if [ "$already_applied" = "1" ]; then
    echo "skip  $filename (already applied)"
    continue
  fi

  echo "apply $filename"
  case "$filename" in
    *.sql) psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file" ;;
    *.sh)  bash "$file" ;;
  esac

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO schema_migrations (version) VALUES ('$version');"
done < <(find "$SCHEMA_DIR" -maxdepth 1 -type f \( -name '*.sql' -o -name '*.sh' \) | sort)

echo "Migrations up to date."
