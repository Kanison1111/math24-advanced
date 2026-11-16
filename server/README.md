# Multiplayer server logic (M2)

Node.js 22+; no new runtime packages. Run from repository root:

```sh
python3 -B scripts/multiplayer/sync_rules.py --check
node --test tests/server/*.test.mjs
```

`math-rules.mjs` is generated from the unchanged single-player parser, solver, bank, playable-pool rules and hints. Regenerate with `sync_rules.py`; `--check` detects drift. The original HTML is not rewritten.

`match-engine.mjs` provides shared question IDs/order, server timestamps/deadline, per-participant progress, exact rational answer validation, existing 10/20/30 base scores and inclusive 30/60-second bonuses, existing hint limits/charges, zero-floor points, skip without reducing accumulated score, idempotency, and live/final rankings with shared ties. No browser score/time is accepted. Only the caller's current puzzle is projected; solutions, future puzzles, receipts and raw state stay out of snapshots. The source bank is already public, so this does not claim to prevent a bot from solving math or looking up known puzzles.

The API permits up to 1024 accepted request receipts per participant/match as an operational abuse bound. Requests are bound to immutable question IDs. Wrong answers do not advance or score. Reveal is unavailable in competition. Invalid/stale/late requests fail explicitly.

`match-service.mjs` requires an injected repository with a real transaction locking the existing room and match. Every read/write checks current membership, not only the frozen participant list. Starting the existing room and storing its common match MUST commit atomically. Commands and nonce consumption MUST be serialized in that transaction. There is no production memory-store fallback.

Repository contract:

- `transaction(roomId, work)` supplies `readRoom`, `readMatch`, `authorize(context)`, `startRoom`, `saveMatch`.
- `readRoom` returns a trusted projection `{id, hostId, status, settings, members:[{id,name,ready}]}` from existing tables; it is not a new room schema.
- `authorize` verifies the signed capability against the verified actor, operation, room, arguments, request ID, expiry and atomically consumed nonce. Do not accept a browser-supplied trust header without cryptographic verification.
- `startRoom` invokes the existing start RPC within that same transaction with actor claims and proof and returns its boolean result. The service requires true; false must not create a match. It must not make a separate HTTP transaction that can commit before match storage.
- match storage is new functionality. No new persistence schema or migration has been invented/applied without the actual baseline; inspect existing objects before adding storage.

`gateway.mjs` exports a Fetch Request/Response handler, not a deployed service. Default readiness is unavailable and all mutations fail closed. The injected `rooms` integration must implement current-membership-safe `snapshot` and guarded/idempotent `mutate` (create/join/ready/leave), forwarding only arguments mapped by `room-contract.mjs` to the verified existing RPC signatures. A production adapter is **BLOCKED** on baseline and guard migration. Snapshot may load the match through the callback only after releasing any separate room read lock, or project both in one repository transaction to avoid nested locks.

`supabase-auth.mjs` verifies tokens against Supabase Auth `/auth/v1/user` with a publishable or legacy anon public API key. Key classification is not user authentication; JWT user identity is still verified by Supabase Auth. It never authorizes from a decoded JWT alone. `protection.mjs` implements short-lived signed capabilities, server-side Turnstile response/hostname/action validation and proposed uid/network/global budgets. The limiter must be a durable atomic implementation; network identity comes from the trusted server transport, not client forwarding headers. A failed challenge/limiter/provider must fail closed. Cloudflare token-reuse convergence means the database nonce ledger is still required.

**Not yet implemented/verified against Supabase:** persistence adapter, database proof/nonce guard, durable limiter, Auth signup/CAPTCHA settings, Realtime publication, deployment and actual multi-device integration. Without those the gateway remains blocked; adding the gateway alone does not close direct RPC access in dev.

Some original playable pools have only 14 unique four-number multisets (basic medium / advanced easy). Selecting 15 or 20 unique questions there returns `insufficient_bank`; no repetition, reclassification or score-rule change is hidden. Expanding the curated bank/classification needs a separately tested change. Five/ten and suitable mixed settings work in the offline engine.

Tests use explicit repository/Auth/HTTP doubles where stated. The test repository in `tests/server/fake-repository.mjs` is not imported by production modules, does not reconstruct a Supabase schema, and must not be deployed. Passing these tests is not an RPC/RLS or Supabase E2E pass.

Capability params for existing room operations are `{rpc, args}` after RPC mapping/trim/default normalization; use `capabilityParams` to derive them from actual operation arguments rather than trusting caller-provided binding data. Match commands bind their exact command params plus room ID. Production guards must compare the verified payload against current invocation arguments inside the transaction.
