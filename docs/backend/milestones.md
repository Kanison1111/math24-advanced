# Milestones: Multiplayer end-to-end

เริ่มจาก main `11a468e` ซึ่งรวม commit ของ PR #12 (`f16b2cb`) แล้ว อ่านสัญญา RPC ที่ตรวจแบบ read-only ไว้ใน `contract.example.json` เป็นฐาน ไม่สร้าง room schema จำลองแทนของจริง

## M1 — Baseline readiness

Branch: `feat/multiplayer-baseline-readiness`

แก้ verifier ไม่ให้ metadata ว่าง/บางส่วนผ่าน ผูก hash ของ SQL และ metadata ที่ได้รับ review เข้ากับ local restore marker และล้าง verified เดิมทุกครั้งก่อนตรวจ drift

คำสั่ง restore เพิ่ม `--dependencies /path/dependencies.json`; review manifest ต้องมีทั้ง `sha256` และ `metadata_sha256` ทดสอบ offline security harness 27 รายการผ่าน (รวมเดิม 20 + metadata regressions 7) ไม่ใช่ผล RPC/RLS

**BLOCKED:** ผู้ใช้ยืนยันไม่มี read-only binding หรือ baseline ที่พร้อมใช้ใน workspace จึงยัง export/restore/schema compare/DB tests ไม่ได้ ไม่สร้าง Auth/table stubs แทนของจริง Export guide ใช้ pg_dump schema-only พร้อม TLS verification และ read-only connection options โดยรับ PG credentials ผ่าน secure environment/PGPASSFILE นอก Git

ลองเตรียม Supabase CLI แล้ว: npm cache ปรับเข้า writable workspace ได้ แต่ CLI 3.1.0 เขียน config ลง home ที่อ่านอย่างเดียว และ CLI 2.75.0 download checksum ผ่าน Node ล้มเหลว DNS จึงไม่อ้างว่า Local Supabase เริ่มได้แล้ว ไม่ปิด TLS/checksum verification เพื่อแก้การติดตั้ง

GitHub API ตอบ Forbidden แม้ git fetch/push ได้ จึงต้องรายงานการเปิด PR แยกจากการ push branch ตามผลจริง

## M2 — Server-authoritative match engine and protection primitives

Branch: `feat/multiplayer-match-engine` (stacked on M1)

เพิ่ม server math rules ที่ generate จาก source เดิมและตรวจ drift, match engine ที่คิดคะแนน/เวลาฝั่ง server, atomic repository service contract, RPC argument mapper ตาม PR #12, Auth verification, Turnstile verification, signed capabilities และ uid/network/global limiter budgets

ทดสอบ Node **33 ผ่าน** ครอบคลุม bank/parser, scoring boundaries, hint/skip, request replay/conflict, deadline, shared questions/ranking, concurrent duplicate submissions และ rollback ด้วย repository double อย่างชัดเจน ไม่มีผล Supabase RPC/RLS จริง

[คู่มือ Server](../../server/README.md) ระบุ persistence/guard/limiter ที่ยัง BLOCKED และข้อจำกัดคลังโจทย์ 14 ชุดของบางโหมด ยังไม่มี database migration ที่ apply หรือ production repository fallback

## M3 — Online client, Session/API/Realtime structure and offline full flow

Branch: `feat/multiplayer-online-client` (stacked on M2)

เพิ่มหน้า `multiplayer/online.html` แยก Demo เดิม พร้อม Session reuse/explicit replacement, Gateway API, snapshot-driven Realtime/poll/backoff, reconnect/reload/page lifecycle, create/join/ready/start/leave, answer/hint/skip, countdown และ live/final Ranking จาก server snapshot ค่า config เริ่มต้นว่างและ fail closed ไม่มี direct RPC/Demo fallback

เพิ่ม local SDK bundle `@supabase/supabase-js@2.119.0`, lockfile, reproducible build/drift check และ third-party licenses หลังพบ Chromium โหลด CDN ไม่สำเร็จ ทดสอบ SDK จริงจาก local bundle แล้ว รองรับทั้ง publishable และ legacy anon public key โดยไม่ใช้ decoded JWT เป็นการยืนยันผู้ใช้ Mock integration ต้องมี loopback Auth + explicit fixture factory ไม่ส่ง signup ไปโปรเจกต์จริง

ตรวจ integration contracts เพิ่ม: capability ผูกกับ RPC args หลัง normalize/trim และการเริ่มห้องต้องได้ boolean true จาก RPC ก่อนบันทึก match ไม่สร้าง match หาก RPC คืน false

### ผลทดสอบที่รันจริง

| ชุด | ผ่าน | ไม่ผ่าน | ข้าม | สถานะ |
|---|---:|---:|---:|---|
| Browser เดิม | 20 | 0 | 0 | single-player + Demo regression |
| Browser Online integration/SDK | 8 | 0 | 0 | HTTP/engine จริง; Auth/repository เป็น Mock, SDK import smoke ใช้ SDK จริงโดยไม่ signup |
| Node server/client | 50 | 0 | 0 | rules/scoring/transactions/protection/session/sync ด้วย doubles ตามกรณี |
| Security harness offline | 27 | 0 | 0 | metadata/guards/contract regressions ไม่ใช่ RLS result |
| Supabase app RPC/RLS/restore | 0 executed | — | — | **BLOCKED** ไม่ใช่ PASSED หรือ skipped |

Browser integration แข่งจบ **10 ข้อ** ด้วย 2 isolated browser sessions ตรวจ shared cards, คะแนน 200 ต่อคนเมื่อถูกเร็วครบ, final Ranking, request ซ้ำ/ปลอมคะแนน/คนนอก, skip cancel/confirm, net drop/reload, explicit identity replacement, room-full/rate-limit และ server expiry ตรวจ viewport 360/390/740/1280, keypad >=44px, negative insertion, dialog bounds, XSS-safe names และ subpath

`npm ci --ignore-scripts`, vendor artifact check, source-rule parity, syntax/docs links/whitespace ผ่าน Dependency audit ที่รันหลัง pin SDK ปัจจุบันรายงาน 0 known advisories ไม่ใช่ security certification

### ข้อจำกัดที่ยังคงอยู่

- [Local runtime](local-runtime.md): CLI 2.75.0 ติดตั้งแบบตรวจ checksum และ init สำเร็จแล้ว แต่ start ถูกบล็อกด้วย Docker vfs storage `no space left on device`; ไม่มี container/volume ที่สร้างแอปสำเร็จ
- ไม่มี source baseline/bindings ตามที่ผู้ใช้ยืนยัน จึงยังไม่ export/restore/compare หรือใช้จริงกับ `math24-advanced-dev`
- Production repository, DB capability/nonce guard, durable limiter, Auth CAPTCHA/signup protection และ Realtime publication ยังไม่ติดตั้ง/ทดสอบจริง การคุม direct RPC ใน dev ยังไม่ถูกแก้ในงานนี้
- บาง curated pools มีแค่ 14 multisets จึงยังไม่รองรับ 15/20 ข้อในโหมดนั้น; ไม่เปลี่ยน difficulty หรือทำโจทย์ซ้ำเงียบ ๆ
- ยังไม่ได้ทดสอบมือถือจริง/OS keyboard, Safari/Firefox, internet ระหว่างสองเครื่อง หรือ durable Supabase end-to-end

ดู [คู่มือหน้า Online](../../multiplayer/README.md), [server contracts](../../server/README.md) และ [รายการที่ต้องให้เจ้าของปลดล็อก/อนุมัติ](online-change-plan.md)

เจ้าของเลือกข้ามการเปิด PR ผ่าน API เพราะ network policy จึงส่ง branch/commit/compare links แยก Milestone ให้เปิด PR ผ่านอีกช่องทางหนึ่ง ไม่มี Merge/Deploy/แก้ dev/Auth Settings/เปิด CAPTCHA หรือ Secret จริงใน Git
