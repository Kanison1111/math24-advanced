"""Offline regressions for harness logic, NOT RPC/RLS database results.

Mocks below model metadata responses and member lists only. They do not construct
or claim to reproduce the Supabase schema or execute any SQL.
"""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/security'))
import run_security as security
from local_db import Blocked


def offline_contract():
    cfg = json.loads((ROOT / 'scripts/security/contract.example.json').read_text())
    cfg['reviewed'] = True
    cfg['baseline_sha256'] = 'a' * 64
    # Test-double identifiers/arguments, not claimed as actual database mappings.
    cfg['columns'] = {key: key for key in cfg['columns']}
    cfg['expected']['running_state'] = 'running'
    for rpc in cfg['rpc'].values():
        rpc['args'] = {'fixture_arg': 'fixture'}
    return cfg


class FixedCapacityRegression(unittest.TestCase):
    def test_contract_requires_no_capacity_column(self):
        cfg = offline_contract()
        self.assertNotIn('room_capacity', cfg['columns'])
        self.assertEqual(cfg['expected']['room_member_limit'], 50)
        security.validate_contract(cfg)

    def test_contract_rejects_limits_that_differ_from_verified_rpc(self):
        for value in (None, True, '50', 0, 12, 49, 51):
            with self.subTest(value=value):
                cfg = offline_contract()
                cfg['expected']['room_member_limit'] = value
                with self.assertRaises(Blocked):
                    security.validate_contract(cfg)

    def test_preflight_accepts_rooms_metadata_without_capacity(self):
        cfg = offline_contract()
        db = Mock()
        columns = {
            'math24_rooms': ['room_id', 'room_owner', 'room_code', 'room_state'],
            'math24_room_members': ['member_room', 'member_user', 'member_ready'],
            'math24_join_limits': ['limit_user', 'limit_attempts'],
        }

        def metadata(query):
            self.assertNotIn('room_capacity', query)
            if 'math24_security_harness.baseline' in query:
                return [{'sha256': cfg['baseline_sha256'], 'verified': True}]
            if 'information_schema.columns' in query:
                table = next(name for name in columns if "'" + name + "'" in query)
                return [{'column_name': name} for name in columns[table]]
            if 'pg_proc' in query:
                return [{'names': ['fixture_arg'], 'types': ['text']}]
            self.fail('Unexpected metadata query')

        db.rows.side_effect = metadata
        with patch.dict(security.ARG_TYPES, {}, clear=True):
            security.preflight(db, cfg)
        db.preflight_auth.assert_called_once()

    def last_slot_scenario(self, allow_overfill=False):
        cfg = offline_contract()
        # No capacity key exists in either the room record or column mapping.
        case = security.SecurityTests('test_concurrent_last_slot_cannot_exceed_capacity')
        case.a = {'room_id': 'fixture-room', 'room_code': '123456'}
        rows = [{'member_user': 'host'}]
        next_uid = iter('user-' + str(i) for i in range(50))
        case.user = Mock(side_effect=lambda: next(next_uid))
        case.members = Mock(side_effect=lambda room: list(rows))
        case.join = Mock(side_effect=lambda uid, room: rows.append({'member_user': uid}))

        def join_rpc(op, uid, code):
            self.assertEqual(op, 'join')
            self.assertEqual(code, '123456')
            if allow_overfill or len(rows) < 50:
                rows.append({'member_user': uid})

        case.rpc = Mock(side_effect=join_rpc)

        def race(callbacks):
            self.assertEqual(len(rows), 49, 'Race must begin with exactly one slot left')
            self.assertEqual(len(callbacks), 2)
            # Run callbacks sequentially as harness unit doubles. Real database
            # concurrency is still BLOCKED until an approved baseline is restored.
            for callback in callbacks:
                callback()

        case.parallel = Mock(side_effect=race)
        with patch.object(security, 'CONTRACT', cfg):
            case.test_concurrent_last_slot_cannot_exceed_capacity()
        return case, rows

    def test_last_slot_fills_to_49_then_accepts_only_one_of_two(self):
        case, rows = self.last_slot_scenario()
        self.assertEqual(case.join.call_count, 48)  # host already counts as one
        self.assertEqual(case.rpc.call_count, 2)
        self.assertEqual(len(rows), 50)
        self.assertEqual(case.user.call_count, 50)  # 48 filling + 2 racing identities

    def test_last_slot_assertions_detect_both_users_being_accepted(self):
        with self.assertRaises(AssertionError):
            self.last_slot_scenario(allow_overfill=True)

    def test_cross_identity_budget_does_not_read_capacity_from_room(self):
        cfg = offline_contract()
        case = security.SecurityTests('test_new_identities_cannot_bypass_direct_rpc_abuse_budget')
        case.a = {'room_id': 'fixture-room', 'room_code': '123456'}
        case.members = Mock(return_value=[{'member_user': 'host'}])
        case.user = Mock(return_value='fixture-user')
        case.rpc = Mock()  # No joins admitted by this unit double.
        with patch.object(security, 'CONTRACT', cfg):
            case.test_new_identities_cannot_bypass_direct_rpc_abuse_budget()
        self.assertEqual(case.rpc.call_count, cfg['expected']['cross_identity_join_max'] + 1)


if __name__ == '__main__':
    unittest.main()
