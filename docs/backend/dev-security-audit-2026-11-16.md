# ผลตรวจ Supabase แบบอ่านอย่างเดียว — 16 พฤศจิกายน 2026

**สถานะ:** ตรวจข้อมูลจริงจากโปรเจกต์ dev ด้วยการอ่าน metadata / function definitions / Security Advisor เท่านั้น **ไม่ได้แก้ฐานข้อมูล** ไม่ได้ทดสอบการเข้าถึงด้วย user tokens จริง ไม่ใช่ใบรับรองความปลอดภัย และไม่อนุญาตให้เปิด Multiplayer ออนไลน์

โปรเจกต์ที่ตรวจ: `math24-advanced-dev` (PostgreSQL 17.11; ณ วันที่ตรวจสถานะ ACTIVE_HEALTHY)
อ้างอิงแผน [Backend](README.md), [Security review](security-review.md) และ [Authorization tests](authorization-tests.md)

## สิ่งที่ตรวจยืนยันจากฐานข้อมูล

- ตาราง `public.math24_rooms`, `public.math24_room_members`, `public.math24_join_limits` มีอยู่จริงและเปิด RLS ทั้งหมด
- `math24_rooms` / `math24_room_members` มี SELECT policy สำหรับ `authenticated` ที่เรียก `math24_is_member(...)` เพื่อตรวจการเป็นสมาชิกห้อง; นี่เป็นการตรวจ **policy definition** ไม่ใช่การพิสูจน์จากการส่ง request จริง
- `authenticated` มีสิทธิ์ SELECT ตาราง rooms/members แต่ไม่มี INSERT, UPDATE, DELETE โดยตรง; `anon` ไม่มี SELECT; `join_limits` ไม่เปิด direct SELECT/DML ให้ `authenticated` และไม่มี policy (ตั้งใจเป็นตารางภายใน ต้องยืนยัน contract)
- พบ RPC ใน `public` หกตัว: `math24_create_room`, `math24_join_room`, `math24_leave_room`, `math24_set_ready`, `math24_start_room`, `math24_is_member`. ทั้งหกเป็น `SECURITY DEFINER` ใช้ empty `search_path` และมี EXECUTE สำหรับ `authenticated` ไม่ใช่ `anon` / `PUBLIC`. ห้าม revoke EXECUTE รวมทุกตัว เพราะหน้าเว็บจะต้องใช้ RPC เหล่านี้
- `math24_rooms` มี UNIQUE `code` และ CHECK ค่ารูปแบบห้อง; `math24_room_members` มีคีย์ผสม room/user และ FK ลบตามห้อง; ตาราง limiter มีคีย์ user_id
- ไม่พบ `math24_rooms`, `math24_room_members` หรือ `math24_join_limits` ในรายการ `pg_publication_tables`: **ยังไม่พร้อมใช้ Supabase Realtime Postgres Changes กับตารางเหล่านี้**
- API migrations list ส่งคืนรายการว่าง: **ไม่ได้แปลว่าฐานข้อมูลยังไม่เคยถูกเปลี่ยนด้วย SQL**; ก่อนเริ่ม migrations ต้องมี schema baseline ที่ตรวจแล้ว

## จุดที่พบจาก function definitions และสิ่งที่ต้องตัดสินใจ

1. **ผู้สร้างห้อง:** `math24_create_room` ตรวจ `auth.uid()` แต่ยังไม่ยืนยันสถานะครูจริง: user ที่ authenticated รวม anonymous sign-in สามารถเป็นเจ้าของห้องตามโค้ดปัจจุบัน ถ้าต้องการ *เฉพาะครูที่ได้รับอนุมัติ* ต้องเพิ่ม identity / server-controlled eligibility โดยเป็นงานออกแบบและทดสอบแยก ห้ามเชื่อ `user_metadata` หรือ client flag
2. **รหัสห้อง:** สร้างเลข 6 หลักด้วย `pg_catalog.random()` ซึ่งไม่ใช่ CSPRNG; พื้นที่ค้นหาเลข 6 หลักมีจำกัด รหัสควรเป็นเพียง invite code ไม่ใช่หลักฐานสิทธิ์ครู ควรใช้แหล่งสุ่มที่เหมาะสมฝั่ง server และ rate limiting ไม่เพิ่มความยาวรหัสโดยไม่ทบทวน UX
3. **การเดารหัส:** `math24_join_room` บันทึก attempts ลง `math24_join_limits` จำกัดเกิน 5 ครั้งต่อ 10 นาที **ต่อ user_id** และมีการล็อกห้องตอน join; ยังไม่มีหลักฐานป้องกันผู้ใช้สร้าง anonymous identities ใหม่หลายตัว ต้องตรวจ CAPTCHA / Auth rate limits และวิธี rate limit ที่เลี่ยงด้วยการเรียก direct RPC ไม่ได้
4. **ข้อความตอบกลับ:** `math24_join_room` แยกกรณี `room_full` กับ `room_unavailable` ทำให้ควรประเมิน room-existence disclosure; UI อาจใช้ error ภายนอกที่ไม่แยกห้องเปิด/ปิด/เต็ม หลังทดสอบ UX และ retry
5. **เริ่มแข่งขัน:** `math24_start_room` ตรวจ `owner_id=auth.uid()`, `waiting`, ห้องยังไม่หมดอายุ, สมาชิก >=2 และทุกคน ready ตาม function definition; **ไม่เท่ากับมีโจทย์ชุดเดียวกัน/คะแนนจาก server** ต้องทดสอบ concurrency ready/start/leave ใน sandbox
6. **Realtime:** ก่อนเปิด lobby ออนไลน์ต้องตรวจ publication + RLS กับ session หลายผู้ใช้ และทดสอบ reconnect; ไม่เปิด publication ของตาราง limiter

## Supabase Security Advisor ณ วันที่ตรวจ

- `public.rls_auto_enable()` เป็น `SECURITY DEFINER` ที่ **มี EXECUTE สำหรับ PUBLIC/anon/authenticated**; เป็น event-trigger function ไม่ใช่ ordinary RPC และต้องทบทวน callability/dependencies ก่อนแก้ แต่ควรพิจารณา revoke PUBLIC execute เมื่อทดสอบแล้ว
- Advisor เตือน RPC `SECURITY DEFINER` หกตัวสำหรับ `authenticated`. เป็นคำเตือนให้ตรวจ body/permissions ไม่ใช่หลักฐานว่า RPC ทั้งหมดมีช่องโหว่
- Advisor แจ้ง `math24_join_limits` ไม่มี RLS policy (INFO); **อย่าเพิ่ม policy เปิดอ่าน** เพียงเพื่อให้ warning หาย
- Advisor เตือน anonymous access policies ของ rooms/members; anonymous sign-in ได้ database role `authenticated` จึงต้องพิสูจน์ membership จริง ไม่ใช่เพียงเช็ค role
- Advisor เตือน leaked password protection disabled; ต้องพิจารณาถ้าใช้บัญชีครูแบบรหัสผ่าน การเปลี่ยน Auth settings ต้องขออนุมัติแยก

ดูเอกสาร: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Security Advisor](https://supabase.com/docs/guides/database/database-linter), [Anonymous Sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) และ [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).

## สิ่งที่ **ยังไม่ได้** ตรวจยืนยัน

- ยังไม่ทดสอบ Auth provider จริง, CAPTCHA, การสร้างบัญชี anonymous, rate limits แบบ cross-identity หรือจำกัดจำนวนสร้างห้อง
- ยังไม่ได้ทดสอบ RPC/RLS ผ่าน JWT ของครู ผู้เล่น สมาชิกห้องอื่น และผู้ไม่เข้าร่วม; 32 authorization cases ที่ออกแบบไว้ **ยังไม่ได้รัน**
- ยังไม่ได้ทดสอบ concurrency, overflow, error-oracle timing, session refresh/reconnect, Realtime subscription และ browser สองเครื่อง
- ยังไม่มี server-authoritative match/score; ห้ามเอา score ที่คำนวณบนหน้าเว็บไปถือเป็นคะแนนออนไลน์ที่เชื่อถือได้

## งานถัดไปที่เสนอ (แยก PR และแยกการอนุมัติ)

1. ยืนยันโมเดลสิทธิ์ **ครูที่ผ่านการยืนยันเท่านั้น** หรือ **ทุกคนเป็นเจ้าของห้องได้** ก่อนแก้ create-room
2. เตรียม sandbox/disposable DB และ schema baseline ตรวจ RPC bodies/grants; เขียนและรัน authorization tests ให้มีผลจริง โดยไม่ใช้บัญชีเด็กหรือข้อมูลห้องจริง
3. ทำ patch/migration เฉพาะที่พิสูจน์ว่าจำเป็น: การสุ่ม code, การควบคุม creation/join abuse, privilege ของ event trigger และ error contract; ตรวจ regression/rollback
4. หลังผ่าน security gates ค่อยเปิด Realtime ของ rooms/members และเชื่อม frontend บน Branch แยก; อัปเดต UI ให้สื่อว่า online เมื่อเชื่อมจริงเท่านั้น

**ห้ามนำไฟล์ `hardening.sql.template` ไปรันตรง ๆ** ต้องตรวจ signature/dependencies ของ RPC จริงก่อน และต้องขออนุมัติแยกสำหรับการเปลี่ยนฐานข้อมูล
