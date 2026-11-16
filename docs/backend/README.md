# แผน Backend Multiplayer — ยังไม่เชื่อมฐานข้อมูลจริง

สถานะ: **ออกแบบเพื่อ review เท่านั้น ไม่ใช่ผล audit ฐานข้อมูล และไม่พร้อมเปิดออนไลน์**
วันที่ตรวจเอกสาร: 16 พฤศจิกายน 2026
เริ่มจาก `main` commit `e932c86ef2c35c0ba8209406e7f2f45ee00efa2f`

## เริ่มอ่านตรงไหน

| ไฟล์ | หน้าที่ |
|---|---|
| [dev-security-audit-2026-11-16.md](dev-security-audit-2026-11-16.md) | ผลตรวจ metadata และคำเตือน Supabase ของจริงแบบอ่านอย่างเดียว พร้อมงานที่ยังไม่ผ่าน |\n| [architecture.md](architecture.md) | เส้นทางข้อมูล Frontend → Auth/RPC → ฐานข้อมูล และวิธีรับ Realtime/reconnect |
| [security-review.md](security-review.md) | สิทธิ์แต่ละคน จุดเสี่ยง และเงื่อนไขก่อนเปิดออนไลน์ |
| [authorization-tests.md](authorization-tests.md) | กรณีทดสอบสิทธิ์ การเดารหัส และการทำงานพร้อมกัน |
| [sql/inventory.sql](sql/inventory.sql) | คำสั่งอ่าน metadata เพื่อระบุของเดิม ไม่อ่านข้อมูลผู้เล่น ไม่เปลี่ยน schema |
| [sql/hardening.sql.template](sql/hardening.sql.template) | ร่างแก้สิทธิ์แบบมีเงื่อนไข ต้องเติมชื่อ/signature จากของจริงก่อน จงใจไม่ใช่ migration ที่รันได้ |
| [sources.md](sources.md) | เอกสารทางการที่อ่านและข้อจำกัดของหลักฐาน |

## สิ่งที่รู้และยังไม่รู้

**ตรวจใน Git แล้ว:** `multiplayer.js` ใช้ตัวแปรในหน่วยความจำ สร้างห้อง/เข้าห้อง/พร้อม/Ranking จำลองทั้งหมด ไม่มี Supabase client, migration, schema snapshot หรือ backend tests; `index.html` เป็นเกมคนเดียวที่คิดคะแนนใน browser ส่วน `tests/` ทดสอบ browser ไม่ได้ทดสอบสิทธิ์ฐานข้อมูล

**ข้อมูลจากผู้ใช้ ยังไม่ได้ตรวจยืนยันกับโปรเจกต์:** มี `math24-advanced-dev`, ตาราง `math24_rooms`, `math24_room_members`, `math24_join_limits`, RPC สร้าง/เข้า/ออก/พร้อม/เริ่มแข่ง และเปิด RLS แล้ว รวมถึงคำเตือน SECURITY DEFINER

**ยังไม่ทราบ:** project ref/URL, ชื่อ schema/columns/constraints, ชื่อและ overload ของ RPC, function body/owner/grants/search_path, policies/views/triggers, Auth providers/limits/CAPTCHA, Realtime publication/replica identity/quotas และข้อความเต็มของ Advisor

ไม่ได้เชื่อม Supabase: ไม่มี connector หรือ binding ที่เกี่ยวข้องในเครื่อง และไม่มี Supabase CLI การมีชื่อโปรเจกต์อย่างเดียวไม่ทำให้เรียก API ได้ ไม่มีการขอหรือบันทึก secret ค่าใด ไม่มีคำสั่ง SQL ในชุดนี้ถูกรันบนฐานข้อมูลจริง

## ขั้นตอนถัดไป

1. ผู้ดูแลที่มีสิทธิ์อ่าน metadata ตรวจ project ref ของ dev ให้ถูกต้อง แล้ว review/run `inventory.sql` ด้วยตนเอง ส่งเฉพาะโครงสร้างและ Advisor finding ที่ตัดข้อมูลอ่อนไหวแล้ว ไม่ส่ง secret ในแชตหรือ Git
2. เติม mapping ของ RPC และตรวจ policies/function body เทียบ security matrix รวมถึงตัดสินใจวิธียืนยันครูจริง หากต้องจำกัดเฉพาะครู
3. แปลงเฉพาะช่องโหว่ที่พบเป็น migration จริง ใช้ชื่อ/signature เดิม ไม่สร้างชุดตารางหรือ RPC ใหม่คู่ขนาน ตรวจ dependencies ก่อนแก้ grants/search_path
4. ทดสอบ schema ที่ตรวจแล้วในฐานข้อมูล local/disposable ที่ได้รับอนุญาต แยกจาก `math24-advanced-dev`; ห้าม reset/push/link dev เพื่อทดสอบโดยอัตโนมัติ
5. เมื่อสิทธิ์และการจำกัดคำขอผ่าน จึงพัฒนา adapter เชื่อม UI ห้องรอ ทดสอบสอง browser sessions และ reconnect
6. แยกงานแข่งขัน/ตรวจคำตอบบน server ออกเป็นขั้นถัดไป ต้องตรวจคะแนนและเวลาโดย server ก่อนเรียกว่าแข่งขันออนไลน์จริง
7. การเปลี่ยน dev database และการ Deploy ต้องมีการอนุมัติแยกภายหลัง PR นี้ไม่อนุมัติให้ทำสิ่งเหล่านั้น

หากข้อมูล audit ยังไม่ครบ ให้หยุดที่แผนนี้ ไม่เปิด online mode และไม่ตีความร่าง SQL ว่าฐานข้อมูลปลอดภัยแล้ว

## ผลตรวจในรอบออกแบบนี้

- ชุดทดสอบ browser เดิม: ผ่าน 20, ไม่ผ่าน 0, ข้าม 0 บน Chromium
- ตรวจลิงก์เอกสารภายในและ whitespace ผ่าน
- กรณีทดสอบสิทธิ์ 32 กรณี: ออกแบบแล้ว แต่ยังไม่ได้รัน
- SQL inventory ยังไม่ได้รันกับ PostgreSQL และ template ยังไม่ได้ parse/apply
- ยังไม่ได้ทดสอบ Auth/RLS/RPC/Realtime/CAPTCHA/limits กับ Supabase จริง
- เปลี่ยนเฉพาะเอกสาร ไม่มีการเชื่อม online mode, เปลี่ยนคะแนน, database mutation หรือ Deploy
