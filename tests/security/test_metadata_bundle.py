"""Offline metadata fixtures only, not an application schema/baseline."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/security'))
from baseline_metadata import CATEGORIES, RPCS, TABLES, validate_metadata
from local_db import Blocked
import verify_restore


def metadata_fixture():
    return dict(postgres_major=17, extensions=[{'name': 'plpgsql'}],
                functions=[{'name': n, 'body_hash': 'a'*32} for n in sorted(RPCS)],
                tables=[{'name': n} for n in sorted(TABLES)],
                columns=[{'table_name': n} for n in sorted(TABLES)],
                constraints=[{'name': 'fixture'}], indexes=[{'name': 'fixture'}],
                policies=[{'name': 'fixture'}], event_triggers=None, publications=None)


class MetadataBundleTests(unittest.TestCase):
    def test_complete_fixture_structure_is_accepted(self):
        validate_metadata(metadata_fixture())

    def test_empty_or_partial_catalog_is_blocked(self):
        for value in ({}, [], None, {'tables': []}):
            with self.subTest(value=value), self.assertRaises(Blocked):
                validate_metadata(value)
        for key in CATEGORIES:
            value = metadata_fixture()
            del value[key]
            with self.subTest(missing=key), self.assertRaises(Blocked):
                validate_metadata(value)

    def test_missing_rpc_or_table_or_columns_is_blocked(self):
        for key in ('functions', 'tables', 'columns'):
            value = metadata_fixture()
            value[key].pop()
            with self.subTest(key=key), self.assertRaises(Blocked):
                validate_metadata(value)

    def test_invalid_rows_or_missing_hash_is_blocked(self):
        for key in CATEGORIES - {'postgres_major'}:
            value = metadata_fixture()
            value[key] = ['invalid row']
            with self.subTest(key=key), self.assertRaises(Blocked):
                validate_metadata(value)
        value = metadata_fixture()
        value['functions'][0]['body_hash'] = ''
        with self.assertRaises(Blocked):
            validate_metadata(value)

    def verify(self, expected, actual, hash_matches=True):
        db = Mock()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'dependencies.json'
            path.write_text(json.dumps(expected))
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            db.rows.return_value = [{'metadata_sha256': digest if hash_matches else 'b'*64}]
            db.execute.side_effect = lambda query: json.dumps(actual) if query.startswith('SELECT') else ''
            with patch.object(sys, 'argv', ['verify_restore', '--dependencies', str(path)]), patch.object(verify_restore, 'LocalDB', return_value=db):
                try:
                    verify_restore.main()
                finally:
                    self.calls = [call.args[0] for call in db.execute.call_args_list]
        return db

    def test_metadata_mismatch_clears_old_verification(self):
        expected, actual = metadata_fixture(), metadata_fixture()
        actual['functions'][0]['body_hash'] = 'b'*32
        with self.assertRaises(Blocked):
            self.verify(expected, actual)
        self.assertIn('UPDATE math24_security_harness.baseline SET verified=false', self.calls)
        self.assertNotIn('UPDATE math24_security_harness.baseline SET verified=true', self.calls)

    def test_unreviewed_metadata_hash_never_verifies(self):
        with self.assertRaises(Blocked):
            self.verify(metadata_fixture(), metadata_fixture(), hash_matches=False)
        self.assertNotIn('UPDATE math24_security_harness.baseline SET verified=true', self.calls)

    def test_matching_reviewed_metadata_verifies(self):
        self.verify(metadata_fixture(), metadata_fixture())
        self.assertEqual(self.calls[-1], 'UPDATE math24_security_harness.baseline SET verified=true')
