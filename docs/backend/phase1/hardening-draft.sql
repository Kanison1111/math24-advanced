-- REVIEW-ONLY DRAFT. Not in automatic migrations. Never executed in this PR.
-- A mandatory stop prevents accidental application, even on dev.
BEGIN;
DO $$ BEGIN
  RAISE EXCEPTION 'DRAFT ONLY: review dependencies and test locally before extracting a real migration';
END $$;

-- Audit finding: public.rls_auto_enable() has unnecessary public execution grants.
-- First prove this is the same event-trigger function, and test DDL-trigger behavior
-- in the disposable Local Supabase before/after this candidate delta.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND p.pronargs=0 AND p.prorettype='event_trigger'::regtype AND p.prosecdef
  ) THEN RAISE EXCEPTION 'Unexpected event trigger definition'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
-- Do NOT revoke the six math24 RPCs wholesale. is_member is used by SELECT policies.
ROLLBACK;

-- Random-code candidate: replace only the random-number expression inside the
-- EXISTING create RPC after obtaining its exact body/signature. No helper/RPC is
-- created here. Verify pgcrypto's actual schema and execute grants first.
-- Use gen_random_bytes(4), decode to unsigned bigint, reject n >= 4294000000,
-- then lpad((n % 1000000)::text, 6, '0'). Rejection avoids modulo bias.
-- Keep UNIQUE(code), bounded collision retries and all existing game validation.
-- pg_catalog.random() is not a CSPRNG. A random code is still not an auth secret.

-- Other deltas depend on the missing baseline:
-- * Keep denied join attempts committed; do not raise after updating a counter if
--   the same transaction would roll it back. Preserve approved response contract.
-- * Add a bounded create-room quota and cross-identity protection at the server.
-- * Verify gateway capabilities inside EXISTING mutation RPCs; revoke/remove all
--   legacy overload routes that lack the check only after compatibility tests.
-- * Unify public join failure messages if room-existence disclosure is unwanted.
-- No CREATE TABLE, copied RPC bodies, production ALTER, Auth configuration or
-- Realtime publication change is authorized by this draft.
