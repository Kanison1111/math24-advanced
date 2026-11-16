# Local runtime: ผลเตรียมจริงและวิธีปลดล็อก

## สิ่งที่ทำสำเร็จ

- Supabase CLI **2.75.0** ติดตั้งที่ `/workspace/.tools/supabase-2.75.0`
- ดาวน์โหลดจาก release ทางการผ่าน TLS และตรวจ archive SHA-256 จาก checksums ทางการก่อนแตก binary: `e5597462f865d5ac72af0453358e37ecb0d85962ad6914a114a53de847303bde`
- [Release](https://github.com/supabase/cli/releases/tag/v2.75.0) / [checksums](https://github.com/supabase/cli/releases/download/v2.75.0/supabase_2.75.0_checksums.txt)
- `supabase init` สำเร็จที่ `/tmp/math24-security-local` โดยตั้ง local `project_id = "math24-security-phase1"` ตาม guard ไม่ link cloud project
- ทาง npm postinstall เจอ DNS ของ Node; ใช้การดาวน์โหลด archive ทางการที่ตรวจ checksum แทน ไม่ปิด verification ส่วน CLI 3.1.0 ติดการเขียน config ลง home ที่อ่านอย่างเดียว

## สิ่งที่ยังไม่สำเร็จ

- Default registry `public.ecr.aws` ถูก network policy บล็อก จึงใช้ official CLI option `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` ตาม source CLI รุ่นนี้
- DockerHub ดาวน์โหลด service images บางส่วนได้ แต่ PostgreSQL `17.6.1.075` ลง layer ไม่สำเร็จ: `failed to register layer ... no space left on device`
- Docker daemon ใช้ storage driver **vfs** ต้องตรวจ quota/disk/inodes และ overhead ของ layers ในพื้นที่ daemon ข้อมูล `df /workspace` ไม่ยืนยันความจุส่วนนี้
- หลังจบการลอง start: **0 containers, 0 local volumes**; มี service image cache 4 images ประมาณ 643 MB ไม่ลบ cache/ข้อมูลของผู้ใช้หรือ reconfigure daemon โดยอัตโนมัติ
- ไม่ได้ restore baseline, สร้าง Auth stubs, สร้าง math24 tables หรือรัน app RPC/RLS tests

จึงยัง **BLOCKED** ทั้ง Local runtime readiness และ baseline ที่ยังไม่มี ผู้ดูแลเลือกใช้เครื่อง Local ที่รัน Supabase ได้ หรือเตรียม Docker runtime ให้มีพื้นที่/driver ที่เหมาะสมก่อนทดลองซ้ำ ไม่สร้าง Supabase cloud project แทนเพื่อแก้ปัญหานี้

## คำสั่งเริ่มซ้ำหลังแก้ runtime

ใน workspace นี้มี config ที่ init แล้ว คำสั่งต่อไปนี้เป็น **local เท่านั้น** และยังไม่ได้ผ่าน startup:

```sh
umask 077
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io \
  /workspace/.tools/supabase-2.75.0 start \
  --workdir /tmp/math24-security-local \
  --exclude storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor \
  > /tmp/math24-local-start.log 2>&1
```

CLI status/log อาจมี local keys เมื่อ start สำเร็จ อย่า paste raw log หรือ commit keys ลง Git ตรวจ health ด้วย service response และ `LocalDB.preflight_auth()` โดยไม่พิมพ์ค่ารหัสผ่าน/keys จากนั้นทำ [baseline restore guide](phase1/baseline.md) จริงก่อนใช้ schema marker หรือเริ่ม RPC tests

การ init config Local ไม่ได้คัดลอก Auth providers/settings ของ dev และไม่ยืนยัน Anonymous HTTP signup/Realtime ใช้งานได้จริง อย่าเปลี่ยน Auth Settings ของ dev หรือเปิด CAPTCHA เพื่อให้ tests ผ่านโดยไม่ได้รับอนุมัติ
