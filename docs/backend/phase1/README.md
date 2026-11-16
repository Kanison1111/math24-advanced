# Phase 1: เครื่องมือทดสอบความปลอดภัย Multiplayer

สถานะ: **เพิ่มเครื่องมือและร่างแก้ไข ยังไม่มีผลทดสอบ RPC/RLS ของจริง**
เริ่มจาก `main` commit `791b13d` โปรดใช้ Audit เดิมประกอบ แต่ไม่ตีความว่า metadata audit เป็นผลทดสอบสิทธิ์

ข้อยืนยันล่าสุด: ทุกคนสร้างห้องตนเองได้; host คุมเฉพาะห้องตนเอง; dev เปิด Anonymous Sign-ins แต่ CAPTCHA ยังปิด ขั้นนี้ **ไม่ได้เปิด CAPTCHA/แก้ Auth Settings/เปลี่ยน dev database/สร้าง cloud project**

ผู้ใช้ยืนยันเพิ่มเติมใน PR #12: `math24_rooms` ไม่มีคอลัมน์ capacity;
`math24_join_room` จำกัดสมาชิกไว้ที่ 50 คนภายใน RPC จึงเก็บ
`expected.room_member_limit: 50` เป็นข้อกำหนดของฟังก์ชัน ไม่ใช่ column mapping
การทดสอบที่ว่างสุดท้ายจะเติมให้ครบ 49 สมาชิก แล้วให้ 2 identities แข่งขันเข้าที่ว่างเดียว

## ไฟล์ใหม่ทำอะไร

| ไฟล์ | หน้าที่ |
|---|---|
| [baseline.md](baseline.md) | วิธี export แบบอ่านอย่างเดียว, ตรวจ Secret/ข้อมูลส่วนตัว, restore และพิสูจน์ metadata ใน Local Supabase |
| [server-protection.md](server-protection.md) | Turnstile + server limits + การปิดทางเรียก RPC หลบ gateway |
| [coverage.md](coverage.md) | ผลที่รันจริง ข้อจำกัด และ mapping ไปแผน 32 กรณี |
| [hardening-draft.sql](hardening-draft.sql) | ร่าง privilege/CSPRNG/limiter มีตัวหยุด ไม่ใช่ migration สำหรับรันจริง |
| `scripts/security/export_baseline.sh`, `catalog.sql` | export public schema และ metadata/dependencies โดยไม่ export แถวข้อมูล |
| `scripts/security/review_baseline.py` | ตรวจรูปแบบ Secret/ข้อมูลส่วนตัวและแสดงเฉพาะประเภทที่พบ ไม่พิมพ์ค่าที่พบ |
| `scripts/security/restore_baseline.py`, `verify_restore.py` | restore เฉพาะ container Local ที่ระบุ ตรวจ Auth dependencies และเทียบ metadata |
| `scripts/security/local_db.py` | บังคับ container ชื่อ/label/image สำหรับงานนี้ ใช้ Unix socket ไม่รับ remote DSN |
| `scripts/security/run_security.py` | ชุดทดสอบ DB 18 รายการ ด้วยหลาย fixture identities และหลาย connections |
| `scripts/security/contract.example.json`, `review.example.json` | ช่องให้เติม signature/columns/ค่าจาก baseline จริง พร้อม SHA-256 และการยืนยัน review |
| `tests/security/test_harness.py` | ทดสอบตัวป้องกันแบบ offline ไม่ใช่ทดสอบ Backend |
| `tests/security/test_fixed_capacity.py` | regression แบบ offline สำหรับ metadata ที่ไม่มี capacity column และการเตรียมทดสอบที่ว่างสุดท้ายที่ 49/50 คน |

## รันอะไรได้ทันที

จาก repository root:

```sh
python3 -B -m unittest discover -s tests/security -v
bash -n scripts/security/export_baseline.sh
CHROMIUM_PATH=/usr/bin/chromium /workspace/.venvs/math24-test/bin/python -B -m unittest discover -s tests -v
```

คำสั่งสุดท้ายใช้ virtual environment ของ cloud workspace ปัจจุบัน หากเป็นเครื่องใหม่ให้ติดตั้ง `requirements-test.txt` ตาม README หลัก แยกคำสั่ง test harness เพราะ `tests/security` ไม่ถูกรวมใน browser discovery เดิม

## เมื่อได้ baseline ที่ตรวจแล้ว

ทำตาม [baseline.md](baseline.md) ให้ครบก่อน จากนั้น:

```sh
python3 -B scripts/security/run_security.py --contract /tmp/math24-security-export/contract.json
```

exit 0 = tests ที่โหลดมารันครบและผ่าน, exit 1 = มี failure/error, exit 2 = blocked/contract หรือ prerequisites ไม่ครบ ไม่แปลว่า Backend ผ่าน

ไม่มีการสร้าง schema สมมติหรือ role/auth.uid จำลองมาแทน Supabase runner ใช้ฐานข้อมูล Local จริงที่ต้อง restore ของจริงก่อน Fixture users เป็นแถวทดสอบใน `auth.users` และ SQL JWT claims เพื่อทดสอบขอบเขต DB เท่านั้น ไม่ใช่ signup ผ่าน Auth API

## ข้อจำกัดปัจจุบันจาก Audit

- code ใช้ `pg_catalog.random()` ไม่ใช่ CSPRNG แต่มี UNIQUE; tests ตรวจรูปแบบ/ไม่ชนสองห้อง **พิสูจน์คุณภาพ randomness ไม่ได้**
- join จำกัดเกิน 5 ครั้ง/10 นาที/uid: ต้องตรวจ persistence หลัง error/rollback และ concurrent attempts จริง ยังไม่มีหลักฐานป้องกันหลาย identities
- ไม่ทราบ creation quota ที่มีอยู่จริง จึงมี test สำหรับ burst ที่ตั้ง threshold จากข้อกำหนดที่จะ review ไม่กล่าวว่าปัจจุบันป้องกันแล้ว
- message แยก `room_full`/`room_unavailable` อาจบอกว่าห้องมีอยู่
- `rls_auto_enable()` มี PUBLIC EXECUTE ตาม Audit; ต้องตรวจ dependencies/event-trigger behavior ใน Local ก่อนใช้ draft
- ยังไม่มี Realtime publication สำหรับตารางแอป; ไม่เปิดใน Phase นี้

ขั้นถัดไปคือ export ที่ได้รับอนุญาต, review baseline+dependencies, restore/compare ให้ผ่าน, เติม contract แล้วรันทดสอบ DB จริงก่อนเลือก migration เฉพาะ finding ปัจจุบัน **ไม่พร้อมเปิด online mode**
