# Dev database preflight — 17 พฤศจิกายน 2026

**สถานะ: อ่านข้อมูลและทดสอบ RLS แบบอ่านอย่างเดียว; ยังไม่มี backup ที่ยืนยันว่ากู้คืนได้; ยังไม่ได้แก้ dev database.**

โครงการ: `math24-advanced-dev` (ref `oxggfwnnefoqibrhlbcj`) · PostgreSQL 17.11

## หลักฐานการตรวจ

- ตาราง `public.math24_rooms`, `public.math24_room_members`, `public.math24_join_limits` มีอยู่และเปิด RLS ทั้งสาม
- ก่อนเปลี่ยนแปลงมี **1 ห้อง, 2 สมาชิก, 1 limiter record** (นับจำนวนอย่างเดียว ไม่มีการส่งออกข้อมูลผู้เล่น)
- พบ RPC 6 ตัว: `math24_create_room`, `math24_join_room`, `math24_leave_room`, `math24_set_ready`, `math24_start_room`, `math24_is_member`
- ตรวจพบ 25 columns, 23 constraints, 5 indexes และ 2 RLS SELECT policies รวมถึง `ensure_rls` event trigger ที่เรียก `public.rls_auto_enable()`
- `pg_publication_tables` ยังไม่เผยแพร่ `math24_rooms` หรือ `math24_room_members` ผ่าน Realtime Postgres Changes
- รัน `scripts/security/catalog.sql` กับโปรเจกต์ผ่านการอ่าน metadata สำเร็จ และบันทึก **metadata snapshot ไม่มีข้อมูลแถวของผู้ใช้** ใน [dev-metadata-2026-11-17.json](dev-metadata-2026-11-17.json)
- ตรวจแบบ `BEGIN READ ONLY` + `SET LOCAL ROLE authenticated` + JWT claims ใน transaction: ตัวตนที่เลือกจากสมาชิกเดิมเห็น 1 ห้องและสมาชิก 2 รายการ; ตัวตน UUID ใหม่ที่ไม่ได้เป็นสมาชิกเห็น 0 ห้องและ 0 สมาชิก
- การทดสอบ JWT claims ข้างต้นเป็น **การจำลองสิทธิ์ใน SQL session** ไม่ได้พิสูจน์ HTTP JWT/Auth API, การแก้ไขข้อมูล, RPC mutation หรือการแยกห้องทุกกรณี

## พบไฟล์โครงสร้างเดิมจาก PR #6 (ตรวจเพิ่ม)

ค้นพบแหล่ง SQL ต้นฉบับ: [PR #6 commit af50cb0](https://github.com/Kanison1111/math24-advanced/blob/af50cb0b978651c6e6cdbeb0d154668dedfd59c0/supabase/migrations/202611150001_lobby_foundation.sql) และเก็บสำเนา [lobby-schema-historical-pr6.sql.txt](lobby-schema-historical-pr6.sql.txt) ไว้นอกโฟลเดอร์ `supabase/migrations` เพื่อป้องกันการรันอัตโนมัติ

เทียบเนื้อหา body ของ `math24_*` ทั้ง **6 ฟังก์ชัน** จาก PR #6 กับ `pg_get_functiondef` ใน dev แล้ว **ตรงกันหลังตัดความต่างของ whitespace, comment และ dollar quoting** นี่ช่วยให้มี SQL ต้นฉบับสำหรับตรวจและทำแผน rollback แต่ **ยังไม่ใช่ logical backup และยังไม่ผ่าน independent restore** รวมทั้งไม่รวม `auth.users` และ `ensure_rls` event trigger ที่มีอยู่ใน dev

ผู้ดูแลยืนยันว่า **ไม่มี Database Backup ใน Supabase Dashboard** ในวันที่ตรวจ จึงยังไม่ apply schema changes กับ dev เพื่อไม่ให้ข้อมูลหายโดยไม่มี recovery plan ที่ทดสอบได้

## ข้อจำกัดและสิ่งที่ต้องยืนยันก่อน Database Migration

1. **Backup/recovery gate:** เครื่องมือที่เชื่อมต่ออยู่ไม่มี API อ่านรายการ Database Backups จึงยังยืนยันไม่ได้ว่ามี backup หรือสามารถกู้คืนได้จริง ตรวจสถานะใน Supabase Dashboard → **Database → Backups** และใช้วิธีสำรองที่เหมาะกับแพ็กเกจ; [เอกสาร Supabase](https://supabase.com/docs/guides/platform/backups) ระบุว่า automated daily backup มีใน Pro/Team/Enterprise ส่วน Free ควรทำ logical backup เป็นประจำ
2. ต้องได้ **schema-only baseline** (`pg_dump` หรือคำสั่ง CLI ที่เข้ากับรุ่นจริง) และสำรอง **ข้อมูล** อย่างปลอดภัยแยกต่างหาก หากจะทำ destructive/backfill changes; schema-only snapshot ไม่ได้เก็บ records หรือ auth identities
3. ต้องทดสอบ restore ในสภาพแวดล้อมแยก และบันทึกว่ากลับไปใช้ข้อมูลเดิมได้อย่างไร ก่อน apply migration กับ dev; อย่าอ้างว่าไฟล์ metadata JSON นี้เป็น backup หรือ migration
4. ต้องตรวจแผนแก้ RLS/permission, code randomness, rate limit หลายตัวตน, nonce/capability, durable match storage และ Realtime ตาม [online-change-plan](online-change-plan.md) ก่อนแก้ dev
5. หลังตรวจ backup และ local test ผ่าน ให้ใช้ changeset เล็ก ๆ + ตรวจ `get_advisors` + real-user authorization tests + rollback plan; ไม่เปลี่ยน Auth/CAPTCHA หรือ Deploy โดยพลการ

## ขอบเขตที่ไม่เกิดการเปลี่ยน

ยังไม่เปลี่ยน schema, policies, RPC, grants, Auth/CAPTCHA, Realtime publication, โค้ดเกม, GitHub Pages หรือบริการ hosting ในการตรวจครั้งนี้; ไม่มี secret, auth.users rows หรือข้อมูลส่วนตัวของสมาชิกใน commit

**หมายเหตุ:** metadata snapshot ไม่ใช่ proof ว่า `pg_dump` และ restore ผ่าน แม้ได้ body hashes ก็ไม่มี RPC bodies ที่ใช้สร้างกลับได้ ต้องใช้ baseline/restore จริง
