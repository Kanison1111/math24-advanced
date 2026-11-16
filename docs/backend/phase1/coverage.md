# ผลตรวจและ Coverage Phase 1

## สิ่งที่รันจริงใน cloud workspace นี้

- Browser regression เดิม: **20 ผ่าน / 0 ไม่ผ่าน / 0 ข้าม** ครบ test_game, test_multiplayer และ test_next_question_ui บน Chromium
- Offline harness safeguards/regressions: **20 ผ่าน / 0 ไม่ผ่าน / 0 ข้าม** รวม safeguards เดิม 14 รายการ และ regression เพิ่ม 6 รายการสำหรับ fixed capacity: contract/metadata ไม่ต้องมี capacity column, ปฏิเสธค่าที่ไม่ใช่ 50, เตรียม race ตอนมี 49 คน, ตรวจจับการรับทั้งสองคนจนเกิน 50 และ cross-identity scenario ที่ไม่อ่าน capacity จาก room record
- `bash -n` ตรวจ syntax export script และตรวจ Python syntax/link/whitespace ของไฟล์ที่เพิ่ม
- ทดลองเรียก runner ด้วย contract ตัวอย่าง: **BLOCKED exit 2 ก่อนส่ง SQL** เพราะยังไม่ได้เติมและ review ไม่มีผล Backend pass

## ยังไม่รันกับฐานข้อมูลจริง

**Backend RPC/RLS: 0 tests executed.** ไม่มี schema-only baseline ที่ครบ/ผ่าน review และไม่มี Local Supabase สำหรับแอปที่ restore baseline แล้ว จึงยังไม่ได้ export จริง, restore, เปรียบเทียบ metadata หรือรัน DB assertions ใด ไม่มี schema จำลองที่อ้างว่าเหมือน dev

มีชุด executable SQL tests **18 รายการ** เตรียมไว้ เมื่อ prerequisites ครบจะทดสอบ:

- catalog RLS/effective grants, create ที่ owner ตรง actor และ code 6 หลัก
- สมาชิกอ่านได้/คนห้องอื่นอ่านไม่ได้, ไม่มี session ไม่อ่าน/เรียก mutation ได้
- direct UPDATE ไม่ยึด owner หรือแก้สมาชิกคนอื่น, ready เฉพาะตน, helper ผูก session, limiter อ่าน/reset ไม่ได้
- host เท่านั้นเริ่มได้, unready เริ่มไม่ได้, start ซ้ำไม่เปลี่ยน state/ข้อมูลเดิม, leave ตัดสมาชิกและสิทธิ์อ่าน
- failed join attempts คงอยู่และเกิน quota แล้ว join ไม่ได้
- creation burst และหลาย fresh fixture identities ตาม budget ที่ต้อง review
- concurrent same-user join, แย่งที่ว่างสุดท้าย และ start พร้อมกันด้วย connections แยก

Last-slot ใช้ขีดจำกัดคงที่ 50 คนตาม `math24_join_room` ที่ผู้ใช้ยืนยัน โดยเติมให้มี 49 สมาชิกก่อน race ไม่อ้างว่ามีคอลัมน์ `room_capacity` และไม่เปลี่ยน schema เพื่อทดสอบ Offline regression ใช้ metadata/member-list doubles เท่านั้น ไม่ได้รัน SQL หรือพิสูจน์ concurrency ของ RPC จริง

SQL fixtures สร้างแถว users ทดสอบและตั้ง JWT claims ใน transaction เพื่อทดสอบ DB ไม่ใช่ HTTP JWT verification/Anonymous Auth signup จริง ชุดนี้ไม่มีการสร้างบัญชีบน dev

## เชื่อมกับแผน 32 กรณีเดิม

| หมวด | Phase 1 เตรียมอะไร | ยังขาดอะไร |
|---|---|---|
| A01–A14 | executable tests ส่วนหลักของ create/read/member/ready/start/leave/grants | HTTP JWT/REST ทุกเส้นทาง, direct INSERT/DELETE ทุก columns, NULL uid ใน authenticated, ทุก helper/view และ owner-leave contract แบบเต็ม |
| A15–A16 | quoting safeguards และ draft search_path/dependency review | input fuzz, XSS, temp-object shadowing และ dynamic SQL ด้วย baseline จริง |
| R01–R03 | valid join, รูปแบบ code ที่สร้าง, failed-attempt persistence และ quota | code leading zero ที่สร้างจริง, full/closed/error timing, cooldown 10 นาที และ concurrent limiter updates |
| R04–R06 | fresh identity SQL scenario และแผน gateway/Turnstile | จริง ๆ ยังไม่สร้าง anonymous accounts ผ่าน Auth API; IP/CAPTCHA/signup quotas/NAT/gateway bypass ยังไม่ทดสอบ |
| C01–C04 | final slot, same-user join และ concurrent start | ready/leave แข่งกับ start, timeout-after-commit และ full linearizability analysis |
| S01–S06 | คงแผน Realtime เดิม ไม่เปิด publication | ยังไม่ได้รัน Realtime/reconnect/token refresh/revocation/load ใด |

ไม่ได้อ้างว่า implement/run ครบทั้ง 32 cases ค่า `join_window_seconds` เป็นข้อมูล contract ยังไม่มี time-travel/cooldown assertion ส่วน create-burst test ตรวจจำนวนห้องที่เห็นหลังคำขอ ไม่พิสูจน์ cumulative create+leave quota ทุกเส้นทาง ต้องเพิ่มเมื่อได้ owner-leave semantics จริง

## Findings ปัจจุบันและการแก้เฉพาะจุด

ยังยึด [Audit เดิม](../dev-security-audit-2026-11-16.md) เป็นหลักฐานการอ่าน metadata ไม่ใช่ผล tests:

1. `pg_catalog.random()` ไม่เหมาะกับ security: draft เสนอใช้ CSPRNG + rejection sampling + UNIQUE retry ไม่เปลี่ยนจำนวนหลัก/กติกาเกม Tests รูปแบบ code ไม่รับรอง cryptographic quality
2. ต่อ-uid join limit อาจเลี่ยงด้วยหลายบัญชี และ CAPTCHA ยังปิดตามผู้ใช้: เสนอ proof ที่ตรวจใน RPC + server budgets ไม่ใช่ UI-only gateway
3. ไม่ยืนยัน creation flood prevention: มี test budget และเอกสารออกแบบ ไม่รายงานว่าแก้แล้ว
4. `rls_auto_enable()` public execute: draft มี mandatory stop ก่อน revoke ต้องตรวจ event-trigger behavior ใน Local ก่อน ยังไม่มี migration ที่ apply ได้โดยอัตโนมัติ
5. SECURITY DEFINER RPC ทั้งหกมีสิทธิ์ใช้งานตามหน้าที่ ไม่แก้เป็น invoker/revoke รวมโดยไม่มีเหตุผล

## เงื่อนไขจบขั้นถัดไป

ได้ baseline ที่ไม่มีข้อมูลอ่อนไหว → restore และ metadata compare สำเร็จ → contract ตรงจริง → รัน 18 tests และเพิ่ม subcases ที่จำเป็นตาม findings → เก็บผล Backend จริงแยกจาก harness → review delta migration และ gateway design → ขออนุมัติแยกก่อนเปลี่ยน dev/เปิด CAPTCHA/Deploy
