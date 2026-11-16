"""Real SQL/RLS/RPC tests: only the dedicated Local Supabase, never dev.

Synthetic auth.users + JWT claims exercise DB authorization, not Auth HTTP or
CAPTCHA. Missing prerequisites are BLOCKED exit 2, never skipped/passed tests.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import re
from pathlib import Path
import sys
import unittest
import uuid
from local_db import Blocked, LocalDB, SqlError, ident, literal

TABLES = ('math24_rooms', 'math24_room_members', 'math24_join_limits')
DB = CONTRACT = None
ARG_TYPES = {}


def validate_contract(contract):
    if contract.get('reviewed') is not True:
        raise Blocked('Fill and review the contract against the actual baseline first')
    encoded = json.dumps(contract)
    if '<' in encoded or '>' in encoded:
        raise Blocked('Contract contains unresolved placeholders')
    if not re.fullmatch('[a-f0-9]{64}', contract.get('baseline_sha256', '')):
        raise Blocked('Contract needs the reviewed baseline SHA-256')
    for name in ('room_id', 'room_owner', 'room_code', 'room_state', 'member_room',
                 'member_user', 'member_ready', 'limit_user', 'limit_attempts'):
        ident(contract['columns'][name])
    for operation in ('create', 'join', 'ready', 'start', 'leave', 'member'):
        cfg = contract['rpc'][operation]
        ident(cfg['name'])
        if not isinstance(cfg['args'], dict):
            raise Blocked('RPC args must be named-argument objects')
        for key in cfg['args']:
            ident(key)
    expected = contract['expected']
    # Verified RPC behavior, not a rooms column or a configurable test capacity.
    if type(expected.get('room_member_limit')) is not int or expected['room_member_limit'] != 50:
        raise Blocked('The verified math24_join_room member limit must be 50')
    for key in ('join_attempts_per_window', 'join_window_seconds', 'create_burst_max', 'cross_identity_join_max'):
        if type(expected[key]) is not int or not 1 <= expected[key] <= 600:
            raise Blocked('Invalid or unbounded test budget')
    if expected['create_burst_max'] > 10 or expected['cross_identity_join_max'] > 10:
        raise Blocked('Abuse fixtures are deliberately bounded to small bursts')


def preflight(db, cfg):
    db.preflight_auth()
    marker = db.rows('SELECT sha256, verified FROM math24_security_harness.baseline')
    if marker != [{'sha256': cfg['baseline_sha256'], 'verified': True}]:
        raise Blocked('Contract and restored baseline hashes differ')
    for table in TABLES:
        columns = db.rows('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=' + literal(table))
        actual = {r['column_name'] for r in columns}
        keys = {'math24_rooms': ['room_id', 'room_owner', 'room_code', 'room_state'],
                'math24_room_members': ['member_room', 'member_user', 'member_ready'],
                'math24_join_limits': ['limit_user', 'limit_attempts']}[table]
        if not {cfg['columns'][k] for k in keys} <= actual:
            raise Blocked('Mapped columns do not match restored baseline: ' + table)
    for op, rpc in cfg['rpc'].items():
        # Reject ambiguous overloads instead of silently targeting a different RPC.
        rows = db.rows("SELECT p.proargnames AS names, ARRAY(SELECT format_type(t,NULL) FROM unnest(p.proargtypes::oid[]) t) AS types "
                       "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=" + literal(rpc['name']) + " AND p.prokind='f'")
        matches = [r for r in rows if len(r['types']) == len(rpc['args'])
                   and set((r['names'] or [])[:len(r['types'])]) == set(rpc['args'])]
        if len(matches) != 1:
            raise Blocked('Use the full exact input signature; missing/ambiguous RPC: ' + op)
        row = matches[0]
        ARG_TYPES[op] = dict(zip(row['names'], row['types']))


class SecurityTests(unittest.TestCase):
    def setUp(self):
        self.db = DB
        self.users, self.rooms = [], []
        self.addCleanup(self.cleanup)
        self.host, self.peer, self.other, self.guest = [self.user() for _ in range(4)]
        self.a = self.create(self.host)
        self.b = self.create(self.other)

    def user(self):
        uid = str(uuid.uuid4())
        # These are disposable fixture identities, not real anonymous Auth signups.
        self.db.execute("INSERT INTO auth.users(id,aud,role,is_anonymous,raw_user_meta_data) VALUES ("
                        + literal(uid) + ",'authenticated','authenticated',true,'{\"host\":true}'::jsonb)")
        self.users.append(uid)
        return uid

    def col(self, key):
        return ident(CONTRACT['columns'][key])

    def rpc(self, op, uid, room=None, code=None, ready=True):
        rpc = CONTRACT['rpc'][op]
        replacements = {'$room': room, '$code': code, '$ready': ready, '$nickname': 'security-fixture'}
        parts = []
        for key, value in rpc['args'].items():
            if isinstance(value, str) and value.startswith('$'):
                if value not in replacements:
                    raise Blocked('Unknown contract substitution')
                value = replacements[value]
            expression = 'NULL' if value is None else literal(json.dumps(value) if isinstance(value, (dict, list)) else value)
            parts.append(ident(key) + ' => ' + expression + '::' + ARG_TYPES[op][key])
        statement = 'SELECT public.' + ident(rpc['name']) + '(' + ','.join(parts) + ')'
        return self.db.execute(statement, actor=uid, unauthenticated=uid is None)

    def create(self, uid):
        self.rpc('create', uid)
        rows = self.db.rows('SELECT * FROM public.math24_rooms WHERE ' + self.col('room_owner') + '=' + literal(uid))
        # Fresh actor normally has one room. Do not trust RPC return shapes.
        self.assertTrue(rows, 'Create did not produce a room owned by actor')
        self.rooms.extend(r[CONTRACT['columns']['room_id']] for r in rows)
        return rows[-1]

    def room_id(self, room):
        return room[CONTRACT['columns']['room_id']]

    def code(self, room):
        return room[CONTRACT['columns']['room_code']]

    def members(self, room, actor=None):
        return self.db.rows('SELECT * FROM public.math24_room_members WHERE ' + self.col('member_room') + '=' + literal(self.room_id(room)) + ' ORDER BY ' + self.col('member_user'), actor=actor)

    def snapshot(self):
        # Limit observations to this test's rows; no real player data exists here.
        ids = ','.join(literal(u) for u in self.users)
        return [self.db.rows('SELECT * FROM public.math24_rooms WHERE ' + self.col('room_owner') + ' IN (' + ids + ') ORDER BY ' + self.col('room_id')),
                self.db.rows('SELECT * FROM public.math24_room_members WHERE ' + self.col('member_user') + ' IN (' + ids + ') ORDER BY ' + self.col('member_room') + ',' + self.col('member_user'))]

    def denied(self, callback):
        before = self.snapshot()
        try:
            callback()
        except SqlError as e:
            # Permission/business denial only. Syntax/undefined-object/deadlock
            # errors are broken tests/prerequisites, never successful denial.
            self.assertIn(e.state, {'42501', 'P0001', '28000'})
        self.assertEqual(self.snapshot(), before, 'Denied action changed room/member data')

    def join(self, uid, room):
        self.rpc('join', uid, code=self.code(room))
        rows = self.members(room)
        self.assertIn(uid, [r[CONTRACT['columns']['member_user']] for r in rows])

    def cleanup(self):
        if self.users:
            ids = ','.join(literal(u) for u in self.users)
            self.db.execute('DELETE FROM public.math24_rooms WHERE ' + self.col('room_owner') + ' IN (' + ids + ')')
            self.db.execute('DELETE FROM public.math24_join_limits WHERE ' + self.col('limit_user') + ' IN (' + ids + ')')
            self.db.execute('DELETE FROM auth.users WHERE id IN (' + ids + ')')

    def test_catalog_rls_and_effective_grants(self):
        for table in TABLES:
            row = self.db.rows("SELECT c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=" + literal(table))[0]
            self.assertTrue(row['rls'])
            for privilege in ('INSERT', 'UPDATE', 'DELETE'):
                row = self.db.rows("SELECT has_table_privilege('authenticated'," + literal('public.' + table) + ',' + literal(privilege) + ') AS allowed')[0]
                self.assertFalse(row['allowed'])
        for rpc in CONTRACT['rpc'].values():
            rows = self.db.rows("SELECT has_function_privilege('anon',p.oid,'EXECUTE') AS anon, "
                                "EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public "
                                "FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=" + literal(rpc['name']))
            self.assertTrue(rows)
            for row in rows:
                self.assertFalse(row['anon'])
                self.assertFalse(row['public'])

    def test_member_helper_is_scoped_to_session(self):
        self.assertIn(self.rpc('member', self.host, self.room_id(self.a)), {'t', 'true'})
        self.assertNotIn(self.rpc('member', self.other, self.room_id(self.a)), {'t', 'true'})
        self.join(self.peer, self.a)
        self.assertIn(self.rpc('member', self.peer, self.room_id(self.a)), {'t', 'true'})

    def test_limiter_records_cannot_be_read_or_reset(self):
        self.join(self.peer, self.a)
        query = 'SELECT * FROM public.math24_join_limits WHERE ' + self.col('limit_user') + '=' + literal(self.peer)
        before = self.db.rows(query)
        for actor in (self.host, self.peer, self.other):
            try:
                self.assertEqual(self.db.rows(query, actor=actor), [])
            except SqlError as e:
                self.assertEqual(e.state, '42501')
            try:
                self.db.execute('UPDATE public.math24_join_limits SET ' + self.col('limit_attempts') + '=0 WHERE ' + self.col('limit_user') + '=' + literal(self.peer), actor=actor)
            except SqlError as e:
                self.assertEqual(e.state, '42501')
            self.assertEqual(self.db.rows(query), before)

    def test_create_binds_owner_and_six_digit_code(self):
        for room, owner in [(self.a, self.host), (self.b, self.other)]:
            self.assertEqual(room[CONTRACT['columns']['room_owner']], owner)
            self.assertRegex(str(self.code(room)), r'^\d{6}$')
        self.assertNotEqual(self.code(self.a), self.code(self.b))

    def test_rls_nonmember_cannot_read_room_or_members(self):
        for actor in (self.peer, self.other, self.guest):
            rows = self.db.rows('SELECT * FROM public.math24_rooms WHERE ' + self.col('room_id') + '=' + literal(self.room_id(self.a)), actor=actor)
            self.assertEqual(rows, [])
            self.assertEqual(self.members(self.a, actor), [])
        self.join(self.peer, self.a)
        self.assertTrue(self.members(self.a, self.peer))

    def test_no_session_has_no_read_or_mutation_access(self):
        for table in TABLES:
            try:
                self.assertEqual(self.db.rows('SELECT * FROM public.' + ident(table), unauthenticated=True), [])
            except SqlError as e:
                self.assertEqual(e.state, '42501')
        for op in CONTRACT['rpc']:
            self.denied(lambda op=op: self.rpc(op, None, self.room_id(self.a), self.code(self.a)))

    def test_direct_updates_cannot_change_owner_or_members(self):
        self.join(self.peer, self.a)
        for actor in (self.host, self.peer, self.other):
            self.denied(lambda: self.db.execute('UPDATE public.math24_rooms SET ' + self.col('room_owner') + '=' + literal(self.peer) + ' WHERE ' + self.col('room_id') + '=' + literal(self.room_id(self.a)), actor=actor))
            self.denied(lambda: self.db.execute('UPDATE public.math24_room_members SET ' + self.col('member_ready') + '=NOT ' + self.col('member_ready') + ' WHERE ' + self.col('member_user') + '=' + literal(self.host), actor=actor))

    def test_rpc_ready_changes_only_own_membership(self):
        self.join(self.peer, self.a)
        before = {r[CONTRACT['columns']['member_user']]: r for r in self.members(self.a)}
        for ready in (True, False):
            self.rpc('ready', self.peer, self.room_id(self.a), ready=ready)
            after = {r[CONTRACT['columns']['member_user']]: r for r in self.members(self.a)}
            self.assertEqual(after[self.peer][CONTRACT['columns']['member_ready']], ready)
            self.assertEqual(after[self.host], before[self.host])
            self.assertEqual(self.members(self.b), self.members(self.b, self.other))

    def test_foreign_actor_cannot_ready_start_or_leave(self):
        for op in ('ready', 'start', 'leave'):
            self.denied(lambda op=op: self.rpc(op, self.other, self.room_id(self.a)))

    def ready_pair(self):
        self.join(self.peer, self.a)
        for actor in (self.host, self.peer):
            self.rpc('ready', actor, self.room_id(self.a), ready=True)

    def test_only_host_can_start_and_start_is_not_repeated(self):
        self.ready_pair()
        self.denied(lambda: self.rpc('start', self.peer, self.room_id(self.a)))
        self.rpc('start', self.host, self.room_id(self.a))
        rows = self.snapshot()[0]
        a = next(r for r in rows if r[CONTRACT['columns']['room_id']] == self.room_id(self.a))
        self.assertEqual(a[CONTRACT['columns']['room_state']], CONTRACT['expected']['running_state'])
        self.denied(lambda: self.rpc('start', self.host, self.room_id(self.a)))

    def test_host_cannot_start_with_unready_member(self):
        self.join(self.peer, self.a)
        self.rpc('ready', self.peer, self.room_id(self.a), ready=False)
        self.denied(lambda: self.rpc('start', self.host, self.room_id(self.a)))

    def test_leave_removes_self_and_revokes_reads(self):
        self.join(self.peer, self.a)
        host_before = next(r for r in self.members(self.a) if r[CONTRACT['columns']['member_user']] == self.host)
        self.rpc('leave', self.peer, self.room_id(self.a))
        rows = self.members(self.a)
        self.assertNotIn(self.peer, [r[CONTRACT['columns']['member_user']] for r in rows])
        self.assertEqual(next(r for r in rows if r[CONTRACT['columns']['member_user']] == self.host), host_before)
        self.assertEqual(self.members(self.a, self.peer), [])
        self.denied(lambda: self.rpc('leave', self.peer, self.room_id(self.a)))

    def test_join_attempt_limit_persists_after_denials(self):
        limit = CONTRACT['expected']['join_attempts_per_window']
        codes = {r['code'] for r in self.db.rows('SELECT code FROM public.math24_rooms')}
        invalid = next(f'{i:06d}' for i in range(1000) if f'{i:06d}' not in codes)
        for _ in range(limit + 1):
            try:
                self.rpc('join', self.guest, code=invalid)
            except SqlError as e:
                self.assertIn(e.state, {'P0001', '42501'})
        rows = self.db.rows('SELECT ' + self.col('limit_attempts') + ' AS attempts FROM public.math24_join_limits WHERE ' + self.col('limit_user') + '=' + literal(self.guest))
        self.assertTrue(rows, 'Failed attempts vanished, possibly due to exception rollback')
        self.assertGreaterEqual(rows[0]['attempts'], limit)
        self.denied(lambda: self.rpc('join', self.guest, code=self.code(self.a)))

    def test_create_burst_has_server_side_bound(self):
        maximum = CONTRACT['expected']['create_burst_max']
        for _ in range(maximum + 1):
            try:
                self.rpc('create', self.guest)
            except SqlError as e:
                self.assertIn(e.state, {'P0001', '42501'})
        rooms = self.db.rows('SELECT * FROM public.math24_rooms WHERE ' + self.col('room_owner') + '=' + literal(self.guest))
        self.assertLessEqual(len(rooms), maximum, 'Creation abuse budget is not enforced on direct RPC')

    def test_new_identities_cannot_bypass_direct_rpc_abuse_budget(self):
        maximum = CONTRACT['expected']['cross_identity_join_max']
        before = len(self.members(self.a))
        capacity = CONTRACT['expected']['room_member_limit']
        self.assertGreaterEqual(capacity, before + maximum + 1, 'Fixture capacity would mask limiter behavior')
        for _ in range(maximum + 1):
            actor = self.user()
            try:
                self.rpc('join', actor, code=self.code(self.a))
            except SqlError as e:
                self.assertIn(e.state, {'P0001', '42501'})
        self.assertLessEqual(len(self.members(self.a)) - before, maximum,
                             'Fresh fixture identities bypass the chosen direct-RPC budget; this does not test Auth signup')

    def parallel(self, callbacks):
        def run(fn):
            try:
                fn()
                return 'committed'
            except SqlError as e:
                return e.state
        with ThreadPoolExecutor(max_workers=len(callbacks)) as pool:
            states = list(pool.map(run, callbacks))
        self.assertFalse(set(states) - {'committed', 'P0001', '42501'}, 'Unexpected concurrent SQL failure: ' + str(states))

    def test_concurrent_same_user_join_has_one_membership(self):
        self.parallel([lambda: self.rpc('join', self.peer, code=self.code(self.a)) for _ in range(2)])
        rows = [r for r in self.members(self.a) if r[CONTRACT['columns']['member_user']] == self.peer]
        self.assertEqual(len(rows), 1)

    def test_concurrent_last_slot_cannot_exceed_capacity(self):
        capacity = CONTRACT['expected']['room_member_limit']
        before = len(self.members(self.a))
        self.assertLessEqual(before, capacity - 1, 'Fixture must leave a slot for the race')
        # Count the host if already present, and fill to exactly 49 via real RPCs.
        # Use fresh identities so the per-user join quota does not mask capacity.
        for _ in range(capacity - 1 - before):
            self.join(self.user(), self.a)
        self.assertEqual(len(self.members(self.a)), capacity - 1)
        actors = [self.user(), self.user()]
        self.parallel([lambda actor=actor: self.rpc('join', actor, code=self.code(self.a)) for actor in actors])
        rows = self.members(self.a)
        self.assertEqual(len(rows), capacity)
        accepted = {r[CONTRACT['columns']['member_user']] for r in rows} & set(actors)
        self.assertEqual(len(accepted), 1)

    def test_concurrent_start_is_single_transition(self):
        self.ready_pair()
        self.parallel([lambda: self.rpc('start', self.host, self.room_id(self.a)) for _ in range(2)])
        room = self.db.rows('SELECT * FROM public.math24_rooms WHERE ' + self.col('room_id') + '=' + literal(self.room_id(self.a)))[0]
        self.assertEqual(room[CONTRACT['columns']['room_state']], CONTRACT['expected']['running_state'])
        self.denied(lambda: self.rpc('start', self.host, self.room_id(self.a)))


def main():
    global DB, CONTRACT
    p = argparse.ArgumentParser()
    p.add_argument('--contract', type=Path, required=True)
    args = p.parse_args()
    CONTRACT = json.loads(args.contract.read_text())
    validate_contract(CONTRACT)
    DB = LocalDB()
    preflight(DB, CONTRACT)
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SecurityTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print('SQL fixture identities only: Auth HTTP, CAPTCHA, Realtime and real signup abuse NOT TESTED.')
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Blocked, SqlError, OSError, ValueError, KeyError) as e:
        print('BLOCKED: ' + str(e) + '; backend suite did not complete.', file=sys.stderr)
        sys.exit(2)
