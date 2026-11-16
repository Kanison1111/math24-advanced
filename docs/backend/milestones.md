# Milestones: Multiplayer end-to-end

เริ่มจาก main `11a468e` ซึ่งรวม commit ของ PR #12 (`f16b2cb`) แล้ว อ่านสัญญา RPC ที่ตรวจแบบ read-only ไว้ใน `contract.example.json` เป็นฐาน ไม่สร้าง room schema จำลองแทนของจริง

## M1 — Baseline readiness

Branch: `feat/multiplayer-baseline-readiness`

แก้ verifier ไม่ให้ metadata ว่าง/บางส่วนผ่าน ผูก hash ของ SQL และ metadata ที่ได้รับ review เข้ากับ local restore marker และล้าง verified เดิมทุกครั้งก่อนตรวจ drift

คำสั่ง restore เพิ่ม `--dependencies /path/dependencies.json`; review manifest ต้องมีทั้ง `sha256` และ `metadata_sha256` ทดสอบ offline security harness 27 รายการผ่าน (รวมเดิม 20 + metadata regressions 7) ไม่ใช่ผล RPC/RLS

**BLOCKED:** ผู้ใช้ยืนยันไม่มี read-only binding หรือ baseline ที่พร้อมใช้ใน workspace จึงยัง export/restore/schema compare/DB tests ไม่ได้ ไม่สร้าง Auth/table stubs แทนของจริง Export guide ใช้ pg_dump schema-only พร้อม TLS verification และ read-only connection options โดยรับ PG credentials ผ่าน secure environment/PGPASSFILE นอก Git

ลองเตรียม Supabase CLI แล้ว: npm cache ปรับเข้า writable workspace ได้ แต่ CLI 3.1.0 เขียน config ลง home ที่อ่านอย่างเดียว และ CLI 2.75.0 download checksum ผ่าน Node ล้มเหลว DNS จึงไม่อ้างว่า Local Supabase เริ่มได้แล้ว ไม่ปิด TLS/checksum verification เพื่อแก้การติดตั้ง

GitHub API ตอบ Forbidden แม้ git fetch/push ได้ จึงต้องรายงานการเปิด PR แยกจากการ push branch ตามผลจริง
