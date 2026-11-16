"""Compare selected source metadata to the restored local DB, with no source access."""
import argparse
import json
from pathlib import Path
from local_db import Blocked, LocalDB, SqlError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dependencies', type=Path, required=True)
    args = parser.parse_args()
    expected = json.loads(args.dependencies.read_text())
    db = LocalDB()
    db.preflight_auth()
    query = Path(__file__).with_name('catalog.sql').read_text().strip().rstrip(';')
    actual = json.loads(db.execute(query))
    # Extension versions may differ; extension names/schema differences are reported
    # for manual compatibility review rather than silently ignored.
    different = [key for key in expected if actual.get(key) != expected[key]]
    if different:
        raise Blocked('Restored metadata differs in categories: ' + ', '.join(different))
    db.execute('UPDATE math24_security_harness.baseline SET verified=true')
    print('Selected baseline metadata matches local restore. This is NOT a backend test pass.')
    print('Indirect/dynamic SQL dependencies still require body review and runtime tests.')


if __name__ == '__main__':
    try:
        main()
    except (Blocked, SqlError, OSError, ValueError) as e:
        raise SystemExit('BLOCKED: ' + str(e))
