"""Restore reviewed public schema only inside the dedicated Local Supabase."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from local_db import Blocked, LocalDB, SqlError
from review_baseline import findings, without_dollar_bodies
from baseline_metadata import validate_metadata


def validate_restore_text(text):
    outside_bodies = without_dollar_bodies(text)
    for line in outside_bodies.splitlines():
        if line.lstrip().startswith('\\') and not line.startswith(('\\restrict ', '\\unrestrict ')):
            raise Blocked('Unexpected psql command in baseline')
    if re.search(r'^\s*(BEGIN|COMMIT|ROLLBACK|CREATE\s+DATABASE|ALTER\s+SYSTEM)\b', outside_bodies, re.I | re.M):
        raise Blocked('Unexpected transaction or cluster command in baseline')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--baseline', type=Path, required=True)
    p.add_argument('--review', type=Path, required=True)
    p.add_argument('--dependencies', type=Path, required=True)
    args = p.parse_args()
    raw = args.baseline.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    metadata_raw = args.dependencies.read_bytes()
    metadata_digest = hashlib.sha256(metadata_raw).hexdigest()
    validate_metadata(json.loads(metadata_raw))
    review = json.loads(args.review.read_text())
    if review.get('reviewed') is not True or review.get('sha256') != digest or review.get('metadata_sha256') != metadata_digest:
        raise Blocked('Missing manual approval for this exact baseline hash')
    if findings(raw.decode()) or findings(metadata_raw.decode()):
        raise Blocked('Baseline has review flags; do not automatically restore or commit it')
    db = LocalDB()
    db.preflight_auth()
    if db.rows("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
               "WHERE n.nspname='public' AND c.relname LIKE 'math24_%'"):
        raise Blocked('Application objects already exist; use a fresh dedicated Local Supabase project')
    # A pg_dump file can contain psql commands. Review is mandatory; feed to psql,
    # but its own BEGIN/COMMIT and \connect commands must not escape this target.
    text = raw.decode()
    validate_restore_text(text)
    db.execute(text + "\nCREATE SCHEMA math24_security_harness;"
               "CREATE TABLE math24_security_harness.baseline (sha256 text NOT NULL, metadata_sha256 text NOT NULL, verified boolean NOT NULL DEFAULT false);"
               "INSERT INTO math24_security_harness.baseline (sha256, metadata_sha256) VALUES ('" + digest + "','" + metadata_digest + "')")
    db.preflight_auth()
    print('Reviewed baseline restored locally; marker SHA-256:', digest)
    print('This proves restore only, not RPC/RLS correctness. Run the security suite next.')


if __name__ == '__main__':
    try:
        main()
    except (Blocked, SqlError, OSError, ValueError, TypeError, KeyError) as e:
        raise SystemExit('BLOCKED: ' + str(e))
