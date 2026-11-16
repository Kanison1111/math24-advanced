"""Offline harness safety tests. These are NOT backend authorization results."""
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts/security'))
from local_db import Blocked, CONTAINER, LocalDB, SqlError, ident, literal, validate_container
from review_baseline import findings
from run_security import validate_contract
from restore_baseline import validate_restore_text


class HarnessGuards(unittest.TestCase):
    def info(self):
        return {'Name': '/' + CONTAINER, 'State': {'Running': True},
                'Config': {'Labels': {'com.supabase.cli.project': 'math24-security-phase1'},
                           'Image': 'public.ecr.aws/supabase/postgres:17.11.0'}}

    def test_only_named_test_container_is_allowed(self):
        info = self.info()
        validate_container(info)
        info['Name'] = '/supabase_db_math24-advanced-dev'
        with self.assertRaises(Blocked):
            validate_container(info)

    def test_project_label_cannot_be_omitted_or_dev(self):
        for label in ({}, {'com.supabase.cli.project': 'math24-advanced-dev'}):
            info = self.info()
            info['Config']['Labels'] = label
            with self.assertRaises(Blocked):
                validate_container(info)

    def test_stopped_or_unexpected_image_is_blocked(self):
        info = self.info()
        info['State']['Running'] = False
        with self.assertRaises(Blocked):
            validate_container(info)
        info = self.info()
        info['Config']['Image'] = 'unrelated/postgres:latest'
        with self.assertRaises(Blocked):
            validate_container(info)

    def test_export_requires_explicit_manual_confirmation(self):
        env = dict(os.environ, MATH24_READONLY_EXPORT_CONFIRMED='no')
        result = subprocess.run(['bash', str(ROOT / 'scripts/security/export_baseline.sh')], env=env,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('Blocked:', result.stderr)

    def test_unfilled_contract_fails_before_docker_is_called(self):
        cfg = json.loads((ROOT / 'scripts/security/contract.example.json').read_text())
        with self.assertRaises(Blocked):
            validate_contract(cfg)
        cfg['reviewed'] = True
        with self.assertRaises(Blocked):
            validate_contract(cfg)

    def test_restore_allows_function_begin_but_not_top_level_transactions(self):
        validate_restore_text('CREATE FUNCTION f() RETURNS void AS $fn$\nBEGIN\n NULL;\nEND;\n$fn$ LANGUAGE plpgsql;')
        for text in ('COMMIT;', 'CREATE DATABASE unexpected;', '\\connect remote', '\\! dangerous'):
            with self.assertRaises(Blocked):
                validate_restore_text(text)

    def test_secret_patterns_are_detected_without_returning_value(self):
        secret = 'sb_secret_' + 'A' * 25
        self.assertEqual(findings(secret), ['secret-key'])
        self.assertIn('credential-url', findings('postgresql://reader:private@host/db'))
        self.assertIn('email-or-personal-literal', findings('student@example.invalid'))

    def test_top_level_data_is_blocked_but_rpc_insert_body_is_not(self):
        self.assertIn('data-insert', findings('INSERT INTO public.players VALUES (1);'))
        self.assertEqual(findings('CREATE FUNCTION f() RETURNS void AS $body$\n INSERT INTO public.x VALUES (1);\n$body$ LANGUAGE sql;'), [])
        self.assertIn('data-insert', findings('CREATE FUNCTION f() RETURNS void AS $$ INSERT INTO x VALUES (1); $$ LANGUAGE sql;\nCOPY public.x FROM stdin;'))

    def test_secret_scan_still_inspects_function_bodies(self):
        self.assertIn('secret-key', findings("CREATE FUNCTION f() RETURNS text AS $$ SELECT 'sb_secret_abcdef123456' $$ LANGUAGE sql;"))

    def test_external_connection_ddl_is_flagged(self):
        self.assertIn('external-connection', findings('CREATE SERVER external FOREIGN DATA WRAPPER postgres_fdw;'))

    def test_identifiers_and_literals_are_escaped(self):
        self.assertEqual(literal("x'; SELECT 1; --"), "'x''; SELECT 1; --'")
        for value in ('room; DROP TABLE x', '<room>', 'public.rooms', ''):
            with self.assertRaises(Blocked):
                ident(value)

    @patch('local_db.subprocess.run')
    def test_sql_errors_keep_state_and_suppress_server_details(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, '', 'ERROR:  42501\nsecret details')
        db = object.__new__(LocalDB)
        with self.assertRaises(SqlError) as caught:
            db.execute('SELECT 1')
        self.assertEqual(caught.exception.state, '42501')
        self.assertNotIn('secret', str(caught.exception))
        command = run.call_args.args[0]
        self.assertIn('--host=/var/run/postgresql', command)
        self.assertIn(CONTAINER, command)

    @patch('local_db.subprocess.run')
    def test_actor_is_scoped_to_one_transaction(self, run):
        run.return_value = subprocess.CompletedProcess([], 0, '[]\n', '')
        object.__new__(LocalDB).execute('SELECT 1', actor='00000000-0000-4000-8000-000000000001')
        sql = run.call_args.kwargs['input']
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertIn('SET LOCAL ROLE "authenticated"', sql)
        self.assertIn('request.jwt.claims', sql)
        self.assertTrue(sql.endswith(';COMMIT;'))

    @patch('local_db.subprocess.run')
    def test_absent_local_supabase_is_blocked_not_skipped(self, run):
        run.return_value = subprocess.CompletedProcess([], 1, '', '')
        with self.assertRaises(Blocked):
            LocalDB()


if __name__ == '__main__':
    unittest.main()
