# สร้าง baseline จริงโดยไม่เปลี่ยนต้นทาง

ปัจจุบันไม่มี schema-only baseline ที่ครบและผ่าน review ใน repository ผู้ใช้ยืนยันแล้ว การไม่มี baseline ทำให้ restore/test ของระบบเดิมยัง blocked ไม่มีการสร้าง SQL จำลองให้หน้าตาคล้ายของจริง

## 1. Export แบบอ่านอย่างเดียว (ผู้ดูแลทำเมื่อพร้อม)

ใช้ `pg_dump`/`psql` PostgreSQL major ที่เข้ากับต้นทาง (Audit ระบุ 17.11) บนเครื่องที่ได้รับอนุญาตเชื่อม dev ตรวจ project ref ด้วยตนเอง ชื่อโปรเจกต์ไม่ใช่ hostname อย่าเดา connection string ห้าม `supabase link`, `db pull` ที่สร้าง migration, `db push` หรือ reset dev ในงานนี้

ตั้ง `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` และ credential ผ่าน secure environment/`PGPASSFILE` นอก Git ใช้ reader ที่ได้รับอนุญาตให้อ่าน schema definitions และ metadata โดยไม่เปิดสิทธิ์ใหม่บน dev หาก reader อ่านบาง object ไม่ได้ ให้รายงาน blocked ห้าม dump บางส่วนแล้วเรียกว่า baseline ครบ ตรวจ TLS CA ผ่าน `PGSSLROOTCERT` ตามการเชื่อมต่อที่รองรับ

หลังยืนยันต้นทางและสิทธิ์ read-only แล้วเท่านั้น:

```sh
MATH24_READONLY_EXPORT_CONFIRMED=yes bash scripts/security/export_baseline.sh /tmp/math24-security-export
```

สคริปต์บังคับ `sslmode=verify-full` และ `default_transaction_read_only=on`, ไม่รับ PGOPTIONS/PGSERVICE ที่อาจเปลี่ยนขอบเขต, ไม่พิมพ์ credential, ไม่เขียน output ลง checkout และไม่ overwrite ไฟล์เดิม มีเพียง `pg_dump --schema-only` กับ metadata SELECT; ไม่มี source DDL/DML/Auth API

ผลลัพธ์:

- `public.schema.sql`: public tables, constraints, indexes, RLS policies, grants/default privileges, owners, RPC bodies/signatures และ public helpers/views รวม event-trigger definitions ของ public functions ที่ schema-selected pg_dump ไม่ได้รวมให้
- `dependencies.json`: PostgreSQL major, extension names/schema, function signatures/body hashes/owners/grants/search_path, table RLS/ACLs, columns, constraints, indexes, policies, event triggers และ Realtime publication metadata ไม่มี player rows

export public ทั้ง schema เพื่อไม่ตกหล่น helper ชื่ออื่น ตรวจและตัดสินใจขอบเขต **ก่อน**นำเข้า Git ถ้ามี object ของแอปอื่น ให้แยก dependency-complete baseline ที่ผ่าน review ใหม่ ห้ามตัด SQL ที่ไม่รู้หน้าที่แบบสุ่ม `pg_dump --schema` ไม่รวม dependencies ต่าง schema/managed Auth อัตโนมัติ ต้องตาม function bodies/dynamic SQL, views, triggers, extensions และ role dependencies ด้วยตนเอง เพิ่ม schema ที่จำเป็นเฉพาะเมื่อ review แล้ว ห้าม dump `auth.users` หรือ vault secret values

`pg_dump` และ metadata SELECT ใช้คนละ snapshot หาก schema เปลี่ยนพร้อม export ให้ export ใหม่ช่วงที่โครงสร้างนิ่ง ไม่แก้ต้นทางเพื่อให้ dump ผ่าน

## 2. ตรวจข้อมูลก่อน Git และก่อน restore

```sh
python3 -B scripts/security/review_baseline.py /tmp/math24-security-export/public.schema.sql
python3 -B scripts/security/review_baseline.py /tmp/math24-security-export/dependencies.json
```

scanner flag รูปแบบ Secret/JWT/private key/URL ที่มีรหัสผ่าน/email/data dump/external server โดยแสดงเฉพาะประเภท ไม่พิมพ์ค่าที่พบ INSERT ภายใน dollar-quoted RPC body ไม่ถือเป็น player data แต่ยังสแกน Secret ภายใน body อยู่

**scanner ไม่ใช่หลักฐานว่าไม่มีข้อมูลอ่อนไหวทั้งหมด** ผู้ดูแลต้องอ่าน function literals/defaults/comments/ACLs/ข้อมูลระบุตัวบุคคลและ endpoints ทั้งสองไฟล์ ถ้าพบ secret อย่านำไฟล์เข้า Git และจัดการตามขั้นตอนของผู้ดูแล; อย่า redaction โค้ดให้ semantics ต่างแล้วอ้างว่าทดสอบ baseline เดิม

คัดลอก `review.example.json` ออกไปนอก Git เติม `sha256` ของ SQL ที่ตรวจแล้วและ `reviewed: true` ด้วยตนเอง ขณะนี้ PR นี้ไม่มี baseline, manifest ที่อนุมัติ หรือ credential ที่ commit มีเพียง template

## 3. สร้าง Local Supabase เฉพาะงาน

ต้องมี Docker และ Supabase CLI ที่ติดตั้งจากแหล่งทางการ บันทึกเวอร์ชัน CLI/container/Postgres ที่ใช้จริง **ไม่ต้องสร้าง Supabase cloud project** ใช้ directory นอก repository เช่น `/tmp/math24-security-local`:

```sh
mkdir -p /tmp/math24-security-local
cd /tmp/math24-security-local
supabase init
```

ตรวจไฟล์ config ที่ CLI สร้าง เปลี่ยน **local** `project_id` เป็น `math24-security-phase1` และใช้พอร์ต local ที่ไม่ชนงานอื่น ห้ามใช้ config/project_id ของ dev ไม่เปิด public tunnel/local service ให้ภายนอก ตรวจ firewall/bindings ก่อน start:

```sh
supabase start
```

คำสั่งนี้ใช้ resource เครื่อง local และอาจดาวน์โหลด images; ไม่สร้าง cloud project แต่ CLI อาจแสดง local keys ใน terminal อย่านำ output หรือ keys ไป commit ตั้ง anonymous provider เฉพาะ local ได้ภายหลัง review แต่ SQL fixture suite ไม่ต้องเปิด signup หรือ CAPTCHA และไม่แตะ dev Auth Settings

ต้องมี container `supabase_db_math24-security-phase1`, label `com.supabase.cli.project=math24-security-phase1` และ official Supabase Postgres image runner ไม่รับ host/port/DSN ภายนอก จึงไม่ส่ง mutation ไป `math24-advanced-dev` ถ้า CLI รุ่นที่ใช้ตั้ง name/label ต่าง ให้หยุดและตรวจสาเหตุ ห้ามปิด guard เพื่อให้รันผ่าน

## 4. Restore และพิสูจน์ว่าโครงสร้างสร้างซ้ำได้

กลับ repository root แล้วรัน:

```sh
python3 -B scripts/security/restore_baseline.py \
  --baseline /tmp/math24-security-export/public.schema.sql \
  --review /tmp/math24-security-export/review.json
python3 -B scripts/security/verify_restore.py \
  --dependencies /tmp/math24-security-export/dependencies.json
```

restore ตรวจชื่อ/label/image container, actual `auth.users`, `auth.uid()`, `anon`/`authenticated` ก่อน ไม่สร้าง Auth stubs เอง ต้องเป็น fresh Local Supabase ที่ไม่มี math24 objects อยู่ก่อน รักษา owners/ACL เพื่อไม่เปลี่ยน SECURITY DEFINER semantics; ถ้า role/extension/helper ไม่มี ให้หยุดและแก้ prerequisites อย่างมี review ไม่เปลี่ยน owner เป็น superuser เพื่อกลบปัญหา

restore อยู่ใน transaction พร้อม timeout; psql meta commands นอกเหนือ pg_dump restrict markers และ cluster/transaction commands ถูกบล็อก แต่ยังต้อง review SQL ด้วยมนุษย์ ไม่ใช้ไฟล์จากแหล่งไม่เชื่อถือ

หลัง restore มี marker hash ใน schema `math24_security_harness` เฉพาะ Local ส่วน verify เทียบหมวด metadata กับไฟล์ source โดยไม่กลับไปเชื่อม source ถ้าเทียบไม่ตรงจะ blocked และ runner ไม่ยอมทดสอบจน marker `verified=true` ค่า extension/ACL ordering/version ที่ต่างต้องตรวจ ไม่ลบการตรวจเพื่อให้ผ่าน

ผ่าน restore/metadata compare ยังไม่พิสูจน์ helper แบบ dynamic SQL ทุกเส้นทาง เพราะ pg_dump อาจปิด function-body checking ตอน restore ต้องรัน RPC/RLS tests และตาม dependencies ต่อ

ถ้าจะตรวจสร้างซ้ำรอบสอง ใช้ fresh dedicated Local instance อีกครั้ง การทำลาย Local test state ให้ผู้ดูแลยืนยันเป้าหมายใน directory นี้เท่านั้น เครื่องมือใน PR ไม่ auto reset หรือลบ volume ของผู้ใช้

## 5. เติม contract แล้วทดสอบ

คัดลอก `contract.example.json` ออกนอก Git เติมชื่อ columns และ **ทุก input argument ตาม signature ของจริง** พร้อม create settings ที่ถูกต้อง ไม่เติมชื่อจากการคาดเดา runner ตรวจชื่อ/ชนิด/overload กับ catalog ก่อนรัน กรณี overloaded/default args ให้ระบุ input ครบทุกตัว; ambiguous signature ถูก block

`$room`, `$code`, `$ready`, `$nickname` เป็น substitution ของ fixture ข้อมูลอื่นเป็นค่าทดสอบที่ valid ตาม baseline เลือก expected running state ตามของจริง `join_attempts_per_window=5`/`join_window_seconds=600` มาจาก Audit ส่วน `create_burst_max=3`/`cross_identity_join_max=3` เป็น **threshold เสนอเพื่อ review** ไม่ใช่สิ่งที่ยืนยันว่าติดตั้งแล้ว

ความจุห้องเป็นค่าคงที่ **50 คนใน `math24_join_room`** ตามที่ผู้ใช้ยืนยัน ไม่ใช่คอลัมน์ใน `math24_rooms` ใช้ `expected.room_member_limit: 50` และไม่เพิ่ม capacity ใน column mapping หรือ create settings เพื่อทดสอบ runner ปฏิเสธค่าที่ต่างจากข้อจำกัดที่ยืนยันนี้ การทดสอบ last-slot นับสมาชิกที่มีอยู่แล้ว (รวม host ถ้าอยู่ใน membership) แล้วเติมผ่าน join RPC ให้มี 49 คน จากนั้นให้ identities ใหม่ 2 คนเข้าพร้อมกัน ต้องรับเพียงคนเดียวและลงท้ายที่ 50 คน การเตรียมนี้ใช้ fixture users เพิ่มประมาณ 50 คนใน Local เท่านั้น; ถ้า limiter ที่ได้รับการปรับปรุงปฏิเสธขั้นเตรียม ให้รายงาน failure และออกแบบ fixture ที่ได้รับอนุญาตแยก ห้ามลด capacity หรือปิด limiter เพื่อให้ผ่าน

รัน `run_security.py` ตาม README เก็บผลผ่าน/ล้มเหลว/blocked จริง การแก้ contract ให้ threshold ใหญ่จน test ผ่านไม่ใช่การแก้ช่องโหว่ การทดสอบใช้เฉพาะ synthetic users/rooms ที่สร้างใน Local และ cleanup เฉพาะ UUID ของตัวเอง ไม่มี dev writes

**รอบนี้ยังทำขั้น export/restore/metadata comparison/DB tests ไม่ได้จริง** เพราะไม่มี baseline หรือการเชื่อม source ที่ได้รับมา จึงไม่มีหลักฐานว่าฐานข้อมูลเดิมสร้างซ้ำและทดสอบผ่านแล้ว
