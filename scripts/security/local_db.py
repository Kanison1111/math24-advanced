"""Only execute inside the explicitly named disposable Local Supabase container."""
import json
import re
import subprocess

PROJECT = 'math24-security-phase1'
CONTAINER = 'supabase_db_' + PROJECT


class Blocked(RuntimeError):
    pass


class SqlError(RuntimeError):
    def __init__(self, state):
        self.state = state
        super().__init__('SQL failed (SQLSTATE ' + state + '); values suppressed')


def validate_container(info):
    if info.get('Name', '').lstrip('/') != CONTAINER:
        raise Blocked('Unexpected container name')
    if not info.get('State', {}).get('Running'):
        raise Blocked('Local test container is not running')
    if info.get('Config', {}).get('Labels', {}).get('com.supabase.cli.project') != PROJECT:
        raise Blocked('Container must belong to the dedicated Local Supabase project')
    image = info.get('Config', {}).get('Image', '')
    if not image.startswith(('supabase/postgres:', 'public.ecr.aws/supabase/postgres:')):
        raise Blocked('Expected an official Local Supabase Postgres image')


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def ident(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z_][a-z0-9_]*', value):
        raise Blocked('Invalid or unfilled contract identifier')
    return '"' + value + '"'


class LocalDB:
    def __init__(self):
        proc = subprocess.run(['docker', 'inspect', CONTAINER], capture_output=True, text=True)
        if proc.returncode:
            raise Blocked('Dedicated Local Supabase is absent; no database tests ran')
        validate_container(json.loads(proc.stdout)[0])

    def execute(self, statement, actor=None, unauthenticated=False):
        # Explicit Unix socket + fixed database: no DSN, PGHOST or remote URL accepted.
        prefix = ''
        if actor is not None or unauthenticated:
            claims = {'role': 'authenticated', 'sub': actor, 'is_anonymous': True} if actor else {}
            role = 'authenticated' if actor else 'anon'
            prefix = ('SET LOCAL request.jwt.claims = ' + literal(json.dumps(claims)) + ';'
                      'SET LOCAL ROLE ' + ident(role) + ';')
        proc = subprocess.run([
            'docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-qAt',
            '--host=/var/run/postgresql', '--username=postgres', '--dbname=postgres',
            '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate',
        ], input="BEGIN; SET LOCAL statement_timeout='12s'; SET LOCAL lock_timeout='5s';"
           + prefix + statement + ';COMMIT;', capture_output=True, text=True, timeout=30)
        if proc.returncode:
            match = re.search(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b', proc.stderr)
            raise SqlError(match.group(1) if match else 'UNKNOWN')
        return proc.stdout.strip()

    def rows(self, query, actor=None, unauthenticated=False):
        value = self.execute('SELECT COALESCE(jsonb_agg(t),\'[]\'::jsonb) FROM (' + query + ') t',
                             actor, unauthenticated)
        return json.loads(value)

    def preflight_auth(self):
        rows = self.rows("SELECT to_regclass('auth.users') IS NOT NULL AS users, "
                         "to_regprocedure('auth.uid()') IS NOT NULL AS uid, "
                         "EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AS anon, "
                         "EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') AS authenticated")
        if not all(rows[0].values()):
            raise Blocked('Supabase Auth dependencies absent; do not synthesize them')
