#!/usr/bin/env bash
# Runs the database test suite against a throwaway local PostgreSQL cluster.
# Usage: npm run test:db   (requires PostgreSQL 15+ server binaries)
set -euo pipefail

if [[ -n "${DATABASE_TEST_URL:-}" ]]; then
  exec npx vitest run --project db
fi

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Set PG_BIN or DATABASE_TEST_URL." >&2
  exit 1
fi

TMP="$(mktemp -d)"
PORT="${PG_TEST_PORT:-54329}"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # initdb refuses to run as root; use the postgres system user.
  chown -R postgres "$TMP"
  RUN_AS=(runuser -u postgres --)
fi
cleanup() { "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -m immediate -w stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=127.0.0.1" -l "$TMP/log" -w start >/dev/null

DATABASE_TEST_URL="postgres://postgres@127.0.0.1:$PORT/postgres" npx vitest run --project db
