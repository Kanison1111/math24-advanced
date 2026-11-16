-- REVIEW ONLY. Not run by this PR. Run manually only with authorized metadata access.
-- Collect schema/code, not user rows or secret values. Redact any sensitive literals
-- in existing function definitions before sharing. No CLI linking/reset is required.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT current_database() AS database_name, version() AS postgres_version;
SELECT extname, extversion FROM pg_catalog.pg_extension ORDER BY extname;

-- Discover schema; do not assume public. Includes RLS and replica identity.
SELECT n.nspname AS schema_name, c.relname, c.relkind,
       c.relrowsecurity, c.relforcerowsecurity, c.relreplident,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner, c.reloptions
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY n.nspname, c.relname;

SELECT table_schema, table_name, column_name, data_type, udt_schema, udt_name,
       is_nullable, column_default, is_generated, generation_expression
FROM information_schema.columns
WHERE table_name IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY table_schema, table_name, ordinal_position;

SELECT n.nspname AS schema_name, c.relname, k.conname,
       pg_catalog.pg_get_constraintdef(k.oid, true) AS definition
FROM pg_catalog.pg_constraint k
JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3;

SELECT schemaname, tablename, indexname, indexdef FROM pg_catalog.pg_indexes
WHERE tablename IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE tablename IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3;

-- Expand default ACLs as well as explicit ACLs; PUBLIC=0.
SELECT n.nspname AS schema_name, c.relname,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
WHERE c.relname IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3, 4;

SELECT table_schema, table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_name IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3, 4;

-- Candidates only: manual review must follow indirect calls and overloaded RPCs.
-- PL/pgSQL/dynamic SQL dependencies are not fully discoverable from pg_depend.
SELECT n.nspname AS schema_name, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_catalog.pg_get_function_arguments(p.oid) AS named_arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result_type,
       p.prosecdef AS security_definer,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig,
       p.proacl, pg_catalog.pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (p.proname ILIKE '%math24%' OR p.prosrc ILIKE '%math24_rooms%'
       OR p.prosrc ILIKE '%math24_room_members%' OR p.prosrc ILIKE '%math24_join_limits%')
ORDER BY 1, 2, 3;

SELECT n.nspname AS schema_name, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC'
            ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(
  COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
WHERE p.prokind IN ('f', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (p.proname ILIKE '%math24%' OR p.prosrc ILIKE '%math24_rooms%'
       OR p.prosrc ILIKE '%math24_room_members%' OR p.prosrc ILIKE '%math24_join_limits%')
ORDER BY 1, 2, 3, 4;

SELECT pg_catalog.pg_get_userbyid(roleid) AS granted_role,
       pg_catalog.pg_get_userbyid(member) AS member_role, admin_option
FROM pg_catalog.pg_auth_members ORDER BY 1, 2;

SELECT n.nspname AS schema_name, c.relname, t.tgname,
       pg_catalog.pg_get_triggerdef(t.oid, true) AS definition,
       t.tgfoid::regprocedure AS trigger_function
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND c.relname IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3;

-- All application views, not only names containing math24: inspect indirect exposure.
SELECT n.nspname AS schema_name, c.relname, c.relkind, c.reloptions,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1, 2;

SELECT pubname, puballtables, pubinsert, pubupdate, pubdelete
FROM pg_catalog.pg_publication ORDER BY pubname;
SELECT pubname, schemaname, tablename FROM pg_catalog.pg_publication_tables
WHERE tablename IN ('math24_rooms', 'math24_room_members', 'math24_join_limits')
ORDER BY 1, 2, 3;

-- Inspect policy definitions, not rows, when Broadcast/Presence is being considered.
SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages';
ROLLBACK;

-- Separately inspect in authorized dashboard (do not export secret values):
-- Advisor finding IDs/details; API exposed schemas; Auth providers/CAPTCHA/rate
-- limits/JWT settings; Realtime settings/quotas; retention and cleanup jobs.
-- This candidate inventory is not a complete dependency audit. Follow all helpers
-- and inherited schema/column privileges before proposing a concrete migration.
