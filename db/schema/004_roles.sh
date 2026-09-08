#!/bin/bash
# Creates the read-only role the MCP server connects as (MCP_DATABASE_URL).
#
# This is a .sh file rather than plain SQL because the password comes from
# the MCP_RO_PASSWORD environment variable (set in docker-compose.yml from
# .env) — the docker-entrypoint-initdb.d runner feeds .sql files to psql
# verbatim with no variable substitution, but sources/runs .sh files with
# the container's environment available, so this is the only init-script
# format that can inject a secret without hardcoding it in a committed file.
set -euo pipefail

: "${MCP_RO_PASSWORD:?MCP_RO_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'geoquery_ro') THEN
        CREATE ROLE geoquery_ro LOGIN PASSWORD '${MCP_RO_PASSWORD}';
      END IF;
    END
    \$\$;

    GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO geoquery_ro;
    GRANT USAGE ON SCHEMA public TO geoquery_ro;
    GRANT SELECT ON osm_pois, census_block_groups TO geoquery_ro;

    -- No INSERT/UPDATE/DELETE/TRUNCATE grants, ever, for this role.
    -- Any table/view created later by geoquery_admin is auto-readable by
    -- geoquery_ro too, so future migrations don't need a manual grant line.
    ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
      GRANT SELECT ON TABLES TO geoquery_ro;

    -- Belt-and-suspenders enforcement beneath the application-level SQL
    -- guard in services/mcp-server: even a bug in that guard can't produce
    -- a write or a runaway query from this role.
    ALTER ROLE geoquery_ro SET statement_timeout = '5s';
    ALTER ROLE geoquery_ro SET default_transaction_read_only = on;
EOSQL
