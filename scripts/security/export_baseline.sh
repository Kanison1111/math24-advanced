#!/usr/bin/env bash
# MANUAL, READ-ONLY EXPORT ONLY. Never invoked by the test runner or CI.
set -euo pipefail
if [[ "${MATH24_READONLY_EXPORT_CONFIRMED:-}" != "yes" ]]; then
  echo 'Blocked: confirm the dev source and read-only credentials, then set MATH24_READONLY_EXPORT_CONFIRMED=yes.' >&2
  exit 2
fi
: "${PGHOST:?Set source PGHOST securely outside the repository}"
: "${PGDATABASE:?Set source PGDATABASE securely}"
: "${PGUSER:?Use an authorized metadata reader}"
if [[ -n "${PGSERVICE:-}" || -n "${PGOPTIONS:-}" ]]; then
  echo 'Blocked: remove PGSERVICE/PGOPTIONS so the read-only options cannot be overridden.' >&2
  exit 2
fi
for tool in pg_dump psql python3; do command -v "$tool" >/dev/null; done
# libpq handles credentials via PGPASSFILE or secure injected bindings. Never echo them.
export PGSSLMODE=verify-full
export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000'
umask 077
output="${1:-/tmp/math24-security-export}"
mkdir -p "$output"
# Never write an unreviewed export into any checkout.
if git -C "$output" rev-parse --show-toplevel >/dev/null 2>&1; then
  echo 'Blocked: export must be outside a Git checkout.' >&2
  exit 2
fi
if [[ -e "$output/public.schema.sql" || -e "$output/dependencies.json" ]]; then
  echo 'Blocked: use an empty export directory; existing files will not be overwritten.' >&2
  exit 2
fi
# All public definitions, indexes, constraints, policies, ACLs, default ACLs and
# function bodies/signatures; includes owners to preserve SECURITY DEFINER semantics.
# No data, auth.users contents, secrets schema or credential files are dumped.
pg_dump --schema-only --schema=public --strict-names --no-comments \
  --lock-wait-timeout=10s --file="$output/public.schema.sql"
# Event triggers are cluster-level objects omitted by a schema-selected dump.
# Export definitions only for public helpers; inspect their dependencies manually.
psql -X -qAt --set=ON_ERROR_STOP=1 >> "$output/public.schema.sql" <<'SQL'
BEGIN READ ONLY;
SELECT format('CREATE EVENT TRIGGER %I ON %s %s EXECUTE FUNCTION %I.%I();', e.evtname,e.evtevent,
  CASE WHEN e.evttags IS NULL THEN '' ELSE 'WHEN TAG IN (' ||
    (SELECT string_agg(quote_literal(tag), ', ') FROM unnest(e.evttags) tag) || ')' END,
  n.nspname,p.proname) || E'\n' ||
  format('ALTER EVENT TRIGGER %I %s;',e.evtname,
    CASE e.evtenabled WHEN 'D' THEN 'DISABLE' WHEN 'A' THEN 'ENABLE ALWAYS'
    WHEN 'R' THEN 'ENABLE REPLICA' ELSE 'ENABLE' END) || E'\n' ||
  format('ALTER EVENT TRIGGER %I OWNER TO %I;',e.evtname,pg_get_userbyid(e.evtowner))
FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid
JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public';
ROLLBACK;
SQL
psql -X -qAt --set=ON_ERROR_STOP=1 --file="$(dirname "$0")/catalog.sql" > "$output/dependencies.json"
python3 "$(dirname "$0")/review_baseline.py" "$output/public.schema.sql"
python3 "$(dirname "$0")/review_baseline.py" "$output/dependencies.json"
echo 'Export complete outside Git. Manual review of SQL AND dependencies is still required.'
