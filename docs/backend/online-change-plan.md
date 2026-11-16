# รายการที่ต้องปลดล็อกก่อน Online จริง

นี่คือ change plan เพื่อ review ไม่ใช่ migration ที่พร้อม apply ไม่มีการแก้ `math24-advanced-dev`, Auth Settings, CAPTCHA, สร้าง cloud project, Merge หรือ Deploy ในงานนี้

## ข้อมูลที่เจ้าของโปรเจกต์ต้องจัดให้ก่อน

1. schema-only baseline และ dependencies ที่ตรวจแล้ว หรือ read-only PostgreSQL bindings ผ่าน secure environment (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSFILE`/secure password binding และ CA เมื่อจำเป็น) ไม่ส่งรหัสผ่านในแชต ใช้ direct/session connection ที่รองรับ pg_dump ไม่ใช้ transaction pooler โดยไม่ตรวจ compatibility
2. ทำตาม [baseline guide](phase1/baseline.md): pg_dump schema-only, TLS verify-full + read-only transaction, ตรวจ Secret/ข้อมูลส่วนตัวก่อน Git, review hash SQL **และ** metadata แล้ว restore/compare ใน Local Supabase ห้ามสร้าง schema สมมติแทน
3. GitHub API ถูก network policy บล็อก และเจ้าของเลือกยังไม่เพิ่มโดเมน จึงข้ามเฉพาะการเปิด PR ผ่าน API ใช้ Branch/Commit/Compare links ที่ส่งมอบเพื่อเปิด PR ผ่านอีกช่องทางหนึ่ง Native Git fetch/push ทำงานได้ ไม่ขอ Token หรือเปลี่ยน allowlist เพิ่มในงานนี้

ไม่มี binding/export ใน workspace ตามที่ผู้ใช้ยืนยัน → baseline/restore/RPC/RLS จริงยัง **BLOCKED** ค่า `contract.example.json` เป็น RPC mappings จาก metadata ที่รายงานไว้ ไม่ใช่ SQL baseline

## Database changes ที่ต้องเตรียมหลังได้ baseline

- เติม signed-capability guard ใน create/join/ready/start/leave เดิม โดยไม่สร้าง RPC ชุดซ้ำ เปรียบเทียบ `auth.uid()`, operation, room/args, request ID, expiry และ nonce ภายใน transaction; ปิดทุก overload/เส้นทางที่ไม่มี guard หลังตรวจ compatibility
- Node signer ลงนาม exact base64url payload ด้วย HMAC; DB ต้องตรวจลายเซ็นของ payload นั้น แล้วเทียบ `params.rpc`/`params.args` เป็น JSONB กับชื่อ RPC และ named arguments จริงหลัง normalize/trim (create ที่ไม่ mixed ใช้ mix=0 ทั้งสามตัว) ไม่ใช้ JSON text serialization คนละแบบมาเทียบ hash โดยไม่กำหนดสัญญา
- nonce/idempotency state ต้อง private และ consume แบบ atomic เมื่อ commit action ต้องคงบันทึก failed attempts ตาม contract ที่เลือก อย่า UPDATE limiter แล้ว RAISE จน counter rollback และอย่าใช้ header ที่ client ปลอมได้เป็น trusted marker
- เปลี่ยนเฉพาะ code generation expression เป็น CSPRNG + bounded collision retry คง UNIQUE code/6 digits/validation เดิม
- reuse `math24_join_limits` เท่าที่ schema รองรับ เพิ่ม scope/ledger เฉพาะที่ยังไม่มีจริงสำหรับ create/cross-identity/network/global limits ห้ามสร้างตาราง limiter หรือ room ซ้ำโดยไม่ตรวจ
- เพิ่ม private durable match/receipt storage เฉพาะหาก inventory ยืนยันว่าไม่มีของเดิม โดยอ้างถึง existing room/user identities การเริ่มห้องและบันทึก shared match ต้อง atomic และ commands ต้อง lock match เพื่อกัน duplicate/concurrent awards
- private match state/solutions/receipts ไม่เปิด SELECT หรือ Realtime ให้ browser ตรง ๆ ตัด projection เฉพาะ current puzzle และ ranking ที่มีสิทธิ์ คง membership check ทุกคำขอหลัง leave/revoke
- ใช้ trusted server/database clock ร่วมกันทุก instance ตั้ง starts/deadline ครั้งเดียว หมดเวลาด้วย server decision; lazy expiry ตอนอ่าน/เขียนพอสำหรับ correctness โดยไม่ต้องสร้าง paid scheduler ก่อน
- เปิด publication เฉพาะ rooms/members หลังผ่าน RLS/multi-session tests ไม่เปิด limiter/solutions/nonces และทดสอบ DELETE/revocation จริง

ยังไม่ร่าง DDL ที่เดา columns/constraints หรือ copy function bodies จาก Audit การอนุมัติ apply dev ต้องอิง delta ของ baseline จริง + restore/security tests + rollback review ไม่ใช่การอนุมัติจากเอกสารนี้ล่วงหน้า

## Auth และบริการที่ต้องอนุมัติแยก

- Supabase Auth Turnstile/CAPTCHA และ anonymous signup rate limits: ตอนนี้ Anonymous เปิด/CAPTCHA ปิด ห้ามเชื่อว่า frontend challenge ป้องกัน direct Auth signup ได้ ต้องเปิดการตรวจที่ Auth service หลังอนุมัติ
- Gateway hosting/deployment, trusted-origin/network identity, durable atomic limiter และ private key storage ต้องเลือก deployment ที่ตรวจค่าใช้จ่าย/quotas แล้วก่อนสร้างบริการ
- `TURNSTILE_SECRET`, capability signing key และ DB/server credentials เก็บใน secure server bindings เท่านั้น ส่วน sitekey/project URL/publishable key เป็น public config
- Key rotation, nonce cleanup, Auth user/room retention และ privacy ของเด็ก ต้องทดสอบตามโหลด/NAT ห้องเรียนจริง ไม่บล็อกทั้งชั้นเพราะใช้งาน IP เดียวโดยไม่ประเมิน

## ผลทดสอบที่ยังต้องได้ก่อนเปิดให้มือถือคนละเครื่อง

1. Local restore + metadata match จริงและ RPC/RLS cases (ยังไม่มีผล)
2. Guard tests: no proof/forged actor/op/args/expired/replayed nonce/direct overload และ limiter หลาย identities/concurrent updates
3. Auth signup จริงผ่าน CAPTCHA รวม failure/expired token/NAT และ Session refresh
4. Supabase Realtime websocket/snapshot/reconnect/revocation/load
5. Durable repository full competition หลาย browser/device จาก create → join → ready → start → answer/hint/skip → final ranking รวม timeout/double-submit
6. หลัง review ผลทั้งหมด จึงขออนุมัติ dev migrations/Auth Settings และ Deploy แยก ไม่มี automatic Merge/Deploy

**ผลงานปัจจุบันทดสอบ Full flow ได้เฉพาะ Offline/Mock integration; ไม่ใช่ระบบ Online สมบูรณ์**
