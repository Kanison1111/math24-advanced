SELECT jsonb_build_object(
 'postgres_major', current_setting('server_version_num')::int / 10000,
 'extensions', (SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname) ORDER BY e.extname)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace),
 'functions', (SELECT jsonb_agg(jsonb_build_object('name',p.proname,
    'arguments',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),
    'security_definer',p.prosecdef,'settings',p.proconfig,'acl',p.proacl,
    'body_hash',md5(pg_get_functiondef(p.oid))) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f' AND (p.proname LIKE 'math24_%' OR p.proname='rls_auto_enable')),
 'tables', (SELECT jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
    'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,
    'replica_identity',c.relreplident) ORDER BY c.relname)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('math24_rooms','math24_room_members','math24_join_limits')),
 'columns', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.table_name,x.ordinal_position) FROM (
    SELECT table_name,column_name,ordinal_position,data_type,udt_schema,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public'
    AND table_name IN ('math24_rooms','math24_room_members','math24_join_limits')) x),
 'constraints', (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,
    'definition',pg_get_constraintdef(k.oid,true)) ORDER BY c.relname,k.conname)
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('math24_rooms','math24_room_members','math24_join_limits')),
 'indexes', (SELECT jsonb_agg(jsonb_build_object('table',tablename,'name',indexname,'definition',indexdef) ORDER BY tablename,indexname)
    FROM pg_indexes WHERE schemaname='public' AND tablename IN ('math24_rooms','math24_room_members','math24_join_limits')),
 'policies', (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.tablename,x.policyname) FROM (
    SELECT tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies
    WHERE schemaname='public' AND tablename IN ('math24_rooms','math24_room_members','math24_join_limits')) x),
 'event_triggers', (SELECT jsonb_agg(jsonb_build_object('name',e.evtname,'event',e.evtevent,
    'owner',pg_get_userbyid(e.evtowner),'function',n.nspname||'.'||p.proname,'enabled',e.evtenabled,'tags',e.evttags) ORDER BY e.evtname)
    FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'),
 'publications', (SELECT jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename) ORDER BY pubname,tablename)
    FROM pg_publication_tables WHERE tablename IN ('math24_rooms','math24_room_members','math24_join_limits'))
)
