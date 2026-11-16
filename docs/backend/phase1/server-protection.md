# ข้อเสนอ Turnstile + Server rate limits (ยังไม่เปิดใช้งาน)

สิ่งที่ยืนยันจากผู้ใช้: dev เปิด Anonymous Sign-ins แต่ CAPTCHA ปิดอยู่ ห้ามเปลี่ยนค่าจริงใน Phase นี้ ผู้ใช้งานทุกคนเป็น host ได้เฉพาะห้องของตน ไม่สร้าง teacher whitelist

## ขอบเขตสองระบบที่ต้องแยกกัน

1. **Auth abuse:** เมื่ออนุมัติภายหลัง ตั้ง Turnstile provider ใน Supabase Auth, จำกัด hostname/sitekey และส่ง `captchaToken` ใน `signInAnonymously()` ตาม SDK ที่ pin ร่วมกับ Auth anonymous-signup limits ไม่สร้าง user ใหม่ทุก reconnect และทดสอบห้องเรียนที่ใช้ NAT เดียวกัน ขณะนี้ยังไม่ได้เปิด/ตั้งค่าใด
2. **Application abuse:** signup สำเร็จไม่ได้ให้สิทธิ์สร้างห้องหรือเดารหัสไม่จำกัด ต้องจำกัด create/join และความถี่ ready/start/leave ฝั่ง server ด้วย Auth limits ไม่ครอบคลุม RPC อัตโนมัติ

## เส้นทางคำขอที่เสนอ

Browser (user session) → gateway ที่เชื่อถือได้ → ตรวจ JWT/User → ตรวจ Turnstile เมื่อจำเป็น → consume atomic rate budget → mint capability อายุสั้น → เรียก RPC เดิมที่ตรวจ capability + `auth.uid()`/owner/member/state → transaction

gateway อาจเป็น Edge Function หรือ Worker ที่ได้รับอนุมัติภายหลัง ยังไม่ได้สร้าง/deploy service ใด API ฝั่ง UI เป็นเพียง client ถ้า Supabase RPC ยังเปิดเรียกตรงโดยไม่มี proof จะเลี่ยง gateway ได้ จึง **ห้ามเปิดออนไลน์จน direct-path tests ผ่าน**

## Turnstile ที่ server ต้องตรวจ

- ใช้ Siteverify `https://challenges.cloudflare.com/turnstile/v0/siteverify` ฝั่ง server เท่านั้น secret อยู่ secure binding ไม่อยู่ HTML/Git/URL/log มีเฉพาะ sitekey ใน browser
- ตรวจ success, hostname allowlist, action (`create_room`/`join_room` หรือ action ที่กำหนดจริง), token expiry/error และ binding กับ authenticated request; ห้ามเชื่อค่า success จาก client
- token มีอายุ 300 วินาทีและตั้งใจให้ใช้ครั้งเดียว แต่เอกสารระบุการตรวจ replay มี network-convergence window จึงไม่ใช้ Turnstile อย่างเดียวเป็น idempotency/anti-replay ของ RPC
- ใส่ server timeout, fail closed เมื่อ verify/limiter ใช้ไม่ได้, ให้ UI ขอ challenge ใหม่เมื่อหมดอายุ ห้าม fallback ไป public RPC โดยไม่มีการตรวจ
- ไม่ใช้ siteverify retry เพื่อทำ mutation ซ้ำ; request idempotency และ capability nonce ต้อง atomic ที่ server/DB เอง ไม่เก็บ token ใน analytics

## Capability ป้องกัน direct RPC bypass

ข้อเสนอที่ต้องตรวจ schema ก่อนลงมือ: gateway ออก proof ที่ DB ตรวจได้ ผูก `uid`, operation, hash ของ normalized arguments, opaque room id (เมื่อมี), expiry สั้นเช่น 30 วินาที และ nonce ใช้ครั้งเดียว proof ที่เปลี่ยน uid/args/op/room หรือส่งซ้ำต้องถูกปฏิเสธ **ภายใน RPC เดิมก่อนแตะข้อมูล**

เลือกได้ระหว่างลายเซ็น/MAC ที่ DB ตรวจด้วย key ฝั่ง server เท่านั้น หรือ capability random 256-bit ที่เก็บ hash และ consume แบบ atomic ใน private storage ต้องตรวจ crypto/secret-storage dependencies และ ledger ที่มีอยู่ก่อนเพิ่มของใหม่ ห้ามเก็บ key literal ใน function body หรือเชื่อ request header/custom GUC ที่ client ปลอมได้

ใช้ session JWT เดิมในการเรียกเพื่อรักษา `auth.uid()`; ห้ามใช้ service-role สร้าง `owner_id` จาก UUID ที่ browser ส่งมา ถ้าต้องมี privileged issuance route ให้มีหน้าที่แคบสำหรับออก proof เท่านั้น ตรวจ user จาก token ที่ verify แล้ว ไม่มีสิทธิ์ผู้ใช้ปลอม uid ระบบตรวจ JWT/nonce/key rotation และ storage ยังเป็นงานที่จะอนุมัติหลัง baseline ไม่ได้ติดตั้งแล้วใน PR นี้

RPC create/join/ready/start/leave ทุก overload เก่าที่ไม่มี proof ต้องถูกปิดเส้นทางหรือเพิ่ม check อย่างเข้ากันได้ หลังตรวจ dependencies ห้ามทิ้ง overload เก่าไว้เป็นทางลัด ส่วน `math24_is_member` และ read policies ให้คง least privilege ตามหน้าที่ ไม่ revoke รวมทั้งหมดเพื่อลบคำเตือน Advisor

**CORS, ซ่อน URL, ปิดปุ่ม, key ใน browser, header `X-Trusted: true` หรือ proof ที่เพียง verify ใน JavaScript ไม่ป้องกัน direct bypass** ถ้ายังออกแบบ proof/ledger ให้ทดสอบได้ไม่ได้ ให้หยุด online rollout ไม่ใช้กลไกอ่อนชั่วคราว

## Limiter และ idempotency

- รวม budget ต่อ uid + trusted IP/เครือข่าย + global/project; create มีเพดานต่อช่วงเวลาและห้อง active รวม join attempts ทั้งสำเร็จและผิด ไม่ใช้ room-code bucket อย่างเดียวเพราะทำให้โจมตีปิดห้องคนอื่นได้
- per-uid 5/10 นาทีจาก Audit ไม่กันหลาย anonymous users; ต้องมี quota ข้าม identities และ CAPTCHA ที่ต้นทาง signup พร้อมกัน ทดสอบจำนวน attempts ที่เกินเพดานและ cooldown ด้วย server clock
- เก็บ/consume budget ใน durable atomic store ไม่ใช่ตัวแปร memory ของแต่ละ server instance ใช้ `math24_join_limits` ของเดิมเท่าที่รองรับหลังตรวจ baseline ไม่สร้าง limiter ซ้ำโดยไม่ตรวจ
- trusted IP ต้องอ่านจาก reverse proxy ที่เชื่อถือได้และล้าง spoofed forwarding headers ไม่ใช้ IP ที่ browser อ้าง ส่งให้ DB เป็น signed/bound context เท่านั้น IP hashing ควร keyed+rotate+retention ไม่เป็นข้อมูลใน lobby
- ตั้ง threshold หลังวัดโหลดจริงของห้องเรียน NAT หลายคน IP เดียว การบล็อก IP ทั้งก้อนอาจทำให้ทุกคนเข้าไม่ได้ อาจใช้ risk scoring/backoff แทน hard lock เหมารวม
- denied attempt ต้องบันทึกอยู่แม้ไม่พบห้อง ถ้า UPDATE counter แล้ว `RAISE EXCEPTION` ใน transaction เดียวกัน counter จะ rollback ต้องทดสอบด้วยหลาย connections ไม่แก้โดย catch ฝั่ง browser
- การส่ง proof/token เดิมซ้ำต้องไม่สร้างหลายห้องหรือเลื่อน deadline ซ้ำ ใช้ idempotency key ผูก actor/op/args และ replay result ที่ปลอดภัยหรือปฏิเสธ nonce ที่ใช้ไปแล้ว
- log เฉพาะ request id/op/outcome/latency ที่ไม่ระบุตัวเด็ก ไม่เก็บ raw IP, code, JWT, proof หรือ Turnstile token

## กรณีทดสอบ gateway ที่ยังไม่รัน

ไม่มี token/หมดอายุ/hostname-action ผิด; token/proof ถูกใช้ซ้ำพร้อมกัน; เซ็น uid A แต่ใช้ JWT B; เปลี่ยน args หลังเซ็น; direct RPC ไม่มี proof/overload เก่า; spoof IP header; หลาย anonymous identities; limiter outage; NAT ห้องเรียน; key rotation; timeout หลัง commit และ retry ต้องไม่เกิด mutation ซ้ำ

อ้างอิง source ทางการที่อ่าน HTTP 200 ในรอบนี้:
- [Cloudflare server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) ([source](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/turnstile/get-started/server-side-validation.mdx))
- [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha) ([source](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/auth-captcha.mdx))

การตั้งค่าจริงต้องขออนุมัติแยก ไม่มีการเปิด CAPTCHA/แก้ Auth Settings หรือสร้าง cloud resource ใน Phase นี้
