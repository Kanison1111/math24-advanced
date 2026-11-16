# ตรวจสิทธิ์และความเสี่ยงก่อนเปิดออนไลน์

**ข้อตกลงที่อนุมัติ:** ทุกคนที่มี Auth session ที่ถูกต้องสามารถสร้างห้องได้ แม้ไม่ใช่ครู จึง **ไม่ต้องมี teacher-only role หรือบัญชีครู** แต่ทุก RPC ต้องตรวจ `auth.uid()` และเจ้าของห้องต้องควบคุมได้เฉพาะห้องของตนเอง ต้องจำกัดการสร้างห้อง/การเดารหัสบน server ก่อนเปิดใช้งานจริง

**ผลปัจจุบัน: ยังตรวจสิทธิ์จริงไม่ได้** ข้อมูลว่ามี RLS/SECURITY DEFINER มาจากผู้ใช้ ไม่เท่ากับผ่าน audit ตารางนี้เป็นเกณฑ์ที่ต้องพิสูจน์ด้วย schema จริงและ tests

## ขอบเขตสิทธิ์ที่เสนอ

| การกระทำ | เจ้าของห้อง A | ผู้เล่น A | เจ้าของ/สมาชิกห้อง B ที่ไม่ได้อยู่ A | ไม่มี session |
|---|---|---|---|---|
| อ่านห้อง A/รายชื่อ A | ได้ | ได้ | ไม่ได้ | ไม่ได้ |
| เข้าห้องด้วย code ที่ถูก | ตามกติกาเดิม | ได้ถ้ายังรอ/ไม่เต็ม | ได้เฉพาะผ่าน join ที่ตรวจ limit ไม่ใช่ SELECT code | ไม่ได้จน sign-in |
| เปลี่ยน ready | เฉพาะแถวตัวเองถ้ามี | เฉพาะตัวเอง | ไม่ได้ | ไม่ได้ |
| เริ่มห้อง A/แก้ settings | เฉพาะ RPC ที่ตรวจ owner/state | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| ออกจากห้อง A | เฉพาะตัวเอง ตาม owner-leave contract เดิม | เฉพาะตัวเอง | ไม่ได้ | ไม่ได้ |
| เปลี่ยน owner/role/room_id/member user_id/คะแนน | ไม่ผ่าน direct client DML | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| อ่าน/เขียน join limit records | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ |

“สมาชิก B” ที่เข้าห้อง A สำเร็จแล้วเป็นสมาชิก A ตามกติกา อย่าทดสอบความลับโดยใช้ actor ที่ join A ไปแล้ว เจ้าของห้องไม่ควรมีสิทธิ์อ่านห้องอื่นเพียงเพราะเป็นเจ้าของห้องหนึ่ง

ข้อเสนอให้ client อ่านข้อมูลที่อนุญาตและเขียนผ่าน RPC เท่านั้น หากของเดิมอนุญาต direct DML ต้องทบทวน compatibility ก่อน revoke ห้ามถือว่าแค่ซ่อนปุ่มใน UI กันการแก้ REST request ได้ RLS ต้องมี `USING`/`WITH CHECK` ตาม operation และไม่พึ่ง policy ที่ permissive หลายตัว OR กันจนรั่ว

## SECURITY DEFINER และ Advisor

SECURITY DEFINER ไม่ใช่ช่องโหว่โดยตัวมันเอง และ warning อาจหมายถึง **view** หรือ search_path ของ function ต้องเก็บ finding id/ชื่อ object/schema/รายละเอียดเต็มก่อนสรุป ห้ามปิด Advisor หรือเปลี่ยนทุกฟังก์ชันเป็น invoker เพื่อให้ warning หาย

รายการตรวจสำหรับ RPC และ helper ทุก overload:

- `auth.uid()` ต้องมีค่า; actor ต้องมาจาก session ไม่ใช่ argument การเป็น `authenticated` รวม anonymous sign-in ด้วย
- owner/member/state ตรวจจากข้อมูล server ก่อนอ่าน/เขียนทุกแถว แม้ function owner ข้าม RLS ได้ ต้องไม่คืนข้อมูลก่อนตรวจสิทธิ์
- ตรวจ `prosecdef`, owner, EXECUTE ผ่าน PUBLIC/anon/authenticated/role inheritance; ปกติ functions ใหม่ได้ PUBLIC EXECUTE ต้อง revoke PUBLIC และ direct grants ที่ไม่จำเป็นด้วย grant เฉพาะ actor role ที่ต้องใช้
- `search_path=''` ใช้ได้เมื่อ qualify ตาราง ฟังก์ชัน operator/type ที่เกี่ยวข้องครบแล้ว ตรวจ dynamic SQL/temporary-object shadowing และ injection ก่อนเปลี่ยน ห้าม ALTER search_path อย่างเดียวแล้วทำ RPC พัง
- helper ที่ควร private ไม่อยู่ exposed schema/ไม่มี EXECUTE ให้ client โดยไม่จำเป็น ตรวจ PostgREST exposed schemas แยกจาก PostgreSQL schema
- ตรวจ views/materialized views/trigger/helper ที่เปิดทางอ้อม รวม SECURITY DEFINER view และ `security_invoker` ตามเวอร์ชัน PostgreSQL ที่ใช้จริง
- ownership check ใน SELECT policy ของ members ที่ query ตารางตัวเองอาจ recursion ใช้แนวทาง helper ที่ scope แคบและตรวจ uid จริง อย่าแก้ recursion ด้วยการเปิดอ่านทุกคน
- ตรวจ constraints/indexes/lock order และ rows affected ไม่ยอมรับผลสำเร็จทั้งที่เขียนแถวคนอื่น

`math24_join_limits` เป็นข้อมูลควบคุม server ไม่ใช่ตารางให้ผู้เล่น reset เอง ห้ามอ่านผ่าน SELECT, view, RPC error, Realtime หรือเขียนผ่าน RPC ที่ส่ง arbitrary user_id ได้

## รหัสห้อง 6 หลักและการจำกัดคำขอ

code เป็น string เก็บ leading zero เช่น `000123` ไม่ใช่ integer พื้นที่ค้นหาสูงสุดเพียง 1,000,000 ค่า (~20 bits; ถ้าห้าม leading zero เหลือ 900,000) จึงเป็นคำเชิญแบบเดาได้ ไม่ใช่รหัสผ่านหรือสิทธิ์ครู โอกาสพบ **ห้องใดก็ได้** สูงขึ้นตามจำนวนห้องที่เปิด

- สุ่มด้วยแหล่งสุ่มปลอดภัยฝั่ง server ไม่ใช้ Math.random; ตรวจ unique/ขอบเขต code และ retry collision ใน transaction โดยมีเพดาน ห้ามให้ client เลือก code เพื่อยึดห้องคนอื่น
- ห้าม public room listing หรือ SELECT room-by-code ก่อน join ใช้ join RPC เดิมเพื่อตรวจ code+limit แบบ atomic ไม่คืน UUID/ชื่อครู/จำนวนสมาชิกเมื่อเข้าไม่สำเร็จ
- error ภายนอก “ไม่สามารถเข้าห้องได้ ตรวจรหัสหรือสอบถามครู” สำหรับไม่พบ/ปิด/เต็ม ลด oracle ทั้งข้อความ status และ timing; internal telemetry เก็บเหตุผลที่จำเป็น ไม่เก็บ code, JWT, IP ดิบ หรือชื่อเด็ก
- server บันทึก failed attempts ด้วย แม้คืนผล denied ต้องไม่ถูก rollback จนตัวนับหาย เช่น raise exception หลัง UPDATE limit จะ rollback ทั้ง transaction ให้ review การคืนผลปฏิเสธแบบข้อมูลที่ไม่รั่วและ commit ตัวนับ ทดสอบ response/error compatibility ก่อนแก้
- ตรวจทุกทางเข้า: REST `/rpc`, overload เก่า, GraphQL ถ้าเปิด, view/helper และช่องทาง realtime ไม่ให้เลี่ยง limit ด้วยการเรียก API ตรง

ข้อเสนอเริ่มสำหรับทดสอบ (ยังไม่ได้ตั้งค่า และต้องปรับหลัง load test): join ไม่เกิน 5 attempts/นาที/uid และ 20 attempts/ชั่วโมง/uid นับทั้งสำเร็จและไม่สำเร็จ ตรวจ global bucket/cap ที่เหมาะกับโหลดเพื่อจำกัดหลายบัญชี และให้ cooldown/retry hint ที่ไม่เผยข้อมูลห้อง อย่าล็อก code ห้องจาก failed attempts อย่างเดียวเพราะคนภายนอกใช้ปิดห้องครูได้

Auth rate limit คุม signup/login ไม่คุม join RPC อัตโนมัติ per-uid limit อย่างเดียวเลี่ยงได้ด้วยสร้าง anonymous users ใหม่ ต้องตรวจ CAPTCHA/Turnstile และ Auth rate limits จริง พร้อมกลไกคุม abuse ที่ไม่พึ่ง browser หากต้องใช้ per-IP ให้ทำที่ trusted gateway/WAF ที่อ่าน source IP เชื่อถือได้ ไม่รับ X-Forwarded-For จาก client มาบันทึก DB ตรง ๆ และทดสอบ NAT ห้องเรียนที่มี IP เดียวหลายคน

**จุดตัดสินใจก่อนเปิดออนไลน์:** direct-RPC ใช้ได้ต่อเมื่อ limit ใน DB รวมหลาย identities และการสร้างบัญชีได้รับการพิสูจน์ว่าเพียงพอ หากต้องบังคับ per-IP gateway ต้องมีวิธีปิดการเรียก join โดยตรงที่เลี่ยง gateway ได้ (เช่น server-verified request capability + expiry/replay protection ภายใน RPC เดิม หรือ restricted execution route ที่ผูก actor อย่างปลอดภัย) ยังไม่ได้เลือก/ติดตั้งวิธีใด ห้ามใส่ gateway ไว้หน้า UI แต่ปล่อย public RPC ข้ามได้ ห้ามแก้ด้วย service-role browser key ห้ามสร้างตาราง limiter ใหม่ซ้ำก่อนตรวจ `math24_join_limits`

ถ้า code-only ยังเสี่ยงสำหรับห้องเรียนจริง ให้พิจารณาครูอนุมัติสมาชิก/คำเชิญเพิ่มเป็นงาน product แยก การรู้ code ถูกต้องยังเปิดให้คนอื่นเข้ามาได้ตามเจตนาระบบปัจจุบัน

## Anonymous sign-in และข้อมูลเด็ก

- ตรวจเปิด Anonymous provider จริงหรือไม่, CAPTCHA, quotas, การเก็บ/ล้างบัญชีที่หมดอายุ และ storage quotas; ไม่เดาว่ามี cleanup อัตโนมัติ
- ยึด session เดิม ไม่เก็บ token ใน URL/analytics/log หลีกเลี่ยง XSS ด้วย `textContent` สำหรับชื่อห้อง/ชื่อเล่น ห้ามใส่ input ผู้ใช้ลง `innerHTML`
- browser publishable/anon key เปิดเผยได้โดยการออกแบบ แต่ยังต้องมี RLS+grants; secret/service-role bypass RLS ต้องเก็บเฉพาะ server ที่ได้รับอนุมัติในงานถัดไป ไม่มีเหตุให้ใช้ใน frontend
- จำกัดความยาวชื่อ ไม่เก็บ email/IP/ข้อมูลส่วนตัวในรายชื่อผู้เล่นหรือ event ที่สมาชิกคนอื่นรับได้ แยกข้อมูล abuse และกำหนด retention ภายหลัง review schema จริง
- OTP/magic link ไม่ใช่ Anonymous sign-in: ต้องคุม redirect allowlist, email abuse/OTP limits และไม่ใช้เป็นการยืนยันบทบาทครูโดยลำพัง

## Gate ก่อนเขียน migration จริง

ต้องได้ metadata/grants/function bodies และ Advisor finding; ตกลงครู/owner; เลือก non-bypassable rate limiting; ตรวจ dependencies และ schema baseline; ทำ tests ใน disposable DB ได้จริง จึงอนุมัติ delta migration แต่ละจุด การ rollback schema ต้องคืนเฉพาะ grants/policies เดิมที่บันทึกไว้ และพิจารณาผลต่อ session ที่ยังเปิด ไม่ใช้ blanket GRANT ALL เป็นทางแก้
