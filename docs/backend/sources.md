# แหล่งอ้างอิงและหลักฐาน

อ่านเมื่อ 16 พฤศจิกายน 2026 จาก source เอกสารปัจจุบันขององค์กร Supabase ใน branch `master` ไม่ใช่เอกสารที่เดาขึ้นจากความจำ เว็บไซต์ `supabase.com/docs` ตอบ proxy 403 ใน environment นี้ แต่ source ทางการบน `raw.githubusercontent.com` อ่านได้ HTTP 200 ทั้ง 7 ไฟล์ด้านล่าง SHA-256 ระบุเนื้อหาที่อ่านในรอบนี้; branch master อาจเปลี่ยนภายหลัง ไม่ได้ยืนยันว่าความสามารถทั้งหมดในเอกสารเปิดในโปรเจกต์ของผู้ใช้แล้ว

- [Database functions](https://supabase.com/docs/guides/database/functions) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/functions.mdx)
  SHA-256: `a96122809b079ffab67f6cd745eb4ac7ba00ef0ca263c448e5134c84cda6b2ee`
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/database/postgres/row-level-security.mdx)
  SHA-256: `7cccf50d0d0a30bc14ac20985ea7276a316d6ba6a7644862a35615a7866c6ccf`
- [Anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-anonymous.mdx)
  SHA-256: `f69a4444d1a8666bdabf4314fc490d0a6fde7874b5546c168afee3ea32bc937c`
- [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/rate-limits.mdx)
  SHA-256: `d44cf2f2236e9a9725cb7f2ff3ff1e99f3fce204a10eecfa23ce3dc1e776815e`
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/realtime/postgres-changes.mdx)
  SHA-256: `32d0dcaef7c5b59cb62509e9a0ef42f395c7c88efb0bb0b0634d256ca41ed431`
- [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/realtime/authorization.mdx)
  SHA-256: `ffae7e036102dfaf90eb5eddc18723a0ce3f8c672b80a5a23aa1eb9e01efe8d4`
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys) · [source ที่อ่าน](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/getting-started/api-keys.mdx)
  SHA-256: `2bdd0ec8e5ba5d3fc3a61fdb50db063f38ac65f7a92d75e1d880c791681be242`

## ข้อสรุปที่ใช้

- Database functions: invoker เป็น default; definer ต้องตรวจ ownership ใน body และจำกัด EXECUTE; empty search_path ต้อง qualify references
- RLS: grants และ policies ทำงานร่วมกัน; uid null ไม่มี user; service role/owner อาจ bypass RLS; permissive policies รวมแบบ OR
- Anonymous sign-in: ได้ authenticated role และ is_anonymous claim; สูญเสีย identity ได้เมื่อล้าง session; ต้องพิจารณา CAPTCHA/abuse และ cleanup
- Auth rate limits: เป็นของ Auth endpoints ไม่ใช่ limiter สำหรับ join RPC ของแอป
- Postgres Changes: table RLS เป็นตัวกรองสิทธิ์; ตรวจ publication, DELETE/replica identity และ fanout/load
- Realtime Authorization: private Broadcast/Presence ใช้ realtime.messages policies; channel authorization มี caching จึงต้องตรวจ revocation แยกจาก Postgres Changes
- API keys: publishable key ไม่ใช่สิทธิ์ผู้ใช้; secret/service-role มีอำนาจสูง ห้ามส่งลง browser

## ข้อจำกัด

ไม่มีการอ่าน metadata/rows/Advisor จาก math24-advanced-dev จึงยังไม่อ้างว่า RPC ปลอดภัยหรือมี settings ใดเปิดอยู่ ตัว inventory เป็น candidate discovery ต้องตาม helper และ schema exposure ต่อ เอกสาร Advisor index ที่ลองค้นไม่พบ (404) ไม่ใช้เป็นหลักฐานว่าคำเตือนในโปรเจกต์เป็นประเภทใด ต้องขอ finding จริง

Git fetch ของ repository สำเร็จ แต่ GitHub REST/GraphQL API ตอบ Forbidden ระหว่างตรวจใน environment นี้ ความสำเร็จของ Git ไม่ได้ยืนยันสิทธิ์ API หรือการสร้าง PR จะรายงานผล push/PR จริงแยกต่างหาก
