# หน้า Multiplayer Online (M3)

หน้า `online.html` เป็น client คนละหน้ากับ `../multiplayer.html` ซึ่งยังเป็น Demo เดิม ไม่มีการเปลี่ยนเกมคนเดียวหรือสูตรคิดคะแนนฝั่ง browser เพื่อใช้เป็นคะแนนจริง

## สถานะที่ต้องแยก

- **UI + API protocol + Server engine:** ทดสอบด้วย Chromium สอง contexts ที่แยก Session ผ่าน HTTP จริง จบการแข่งขัน 10 ข้อได้ โดย Server engine ตรวจสูตร/ให้คะแนน/จัดอันดับ
- **Auth และ Repository ใน browser integration tests:** เป็น Mock ชัดเจน แสดงแถบ “Mock API / Offline test” ไม่มี Supabase tables หรือ schema จำลองที่อ้างว่าเป็นของจริง
- **Supabase Online:** ยัง BLOCKED ไม่มี production persistence adapter, RPC guard/nonce ledger, durable limiter หรือการทดสอบ RLS/E2E กับ baseline จริง ค่าเริ่มต้น config ว่างและ gateway ไม่พร้อม → ปิด create/join และไม่สร้าง Anonymous Account

## หน้าที่ไฟล์

| ไฟล์ | หน้าที่ |
|---|---|
| `config.js` | public config ว่างโดยค่าเริ่มต้น ไม่มี Secret |
| `session.mjs` | ใช้ Session เดิม ตรวจ user, ป้องกันสร้าง identity ซ้ำเมื่อ reconnect/หลายคำขอ และไม่แทน Session ที่สูญหายโดยเงียบ ๆ |
| `api.mjs` | เรียกเฉพาะ Gateway, ตรวจ capabilities ก่อน, ส่ง user bearer token, เก็บ request ID เดิมเมื่อผลคำขอไม่แน่นอน ไม่มี direct RPC fallback |
| `sync.mjs` | subscribe ตารางเดิม, event ทำให้ fetch snapshot ใหม่, poll/backoff, กัน response เก่าข้ามห้อง และ cleanup channel |
| `online.mjs` | create/join/lobby/ready/start/leave, keypad/formula, hint/skip confirmation, countdown และ Ranking จาก snapshot |
| `online.html`, `online.css` | หน้า responsive ที่รองรับ GitHub Pages subpath |
| `vendor/` | SDK browser bundle ที่ build จาก lockfile พร้อมใบอนุญาต ไม่ต้องเรียก CDN ตอนเปิดเว็บ |

## SDK และการ build

SDK ตรึง `@supabase/supabase-js@2.119.0`, esbuild `0.25.10` และ transitive dependencies ใน `package-lock.json` ใช้ Node 22+ ขึ้นไป อัปเดตจาก SDK เก่าหลัง dependency audit พบ low advisories; audit ของ dependency ปัจจุบันไม่พบรายการที่รายงานในรอบนี้ ไม่ใช่การรับรองว่าไม่มีช่องโหว่ทุกประเภท

ไฟล์ vendor ถูก commit เพื่อให้เว็บ static ใช้งานได้โดยไม่ต้อง build ตอนเปิดเว็บ การพัฒนา/ตรวจ artifact ซ้ำ:

```sh
npm ci --ignore-scripts
npm run check:client
npm test
```

เมื่ออัปเดต dependency ให้ review lockfile แล้ว `npm run build:client` และรัน tests ใหม่ script รวม license ของ packages ที่เข้า bundle และ `check:client` ตรวจ artifact drift ไม่มี timestamp ใน output

ตรวจ SDK bundle จริงใน Chromium แล้วว่า import/initialize/getSession ว่างได้โดยไม่เรียก CDN หรือ signup ส่วน Auth HTTP จริงยังไม่ได้ทดสอบ Tests ที่เหลือใช้ factory double เพื่อควบคุมสถานะอย่างชัดเจน

## การตั้งค่าจริงภายหลัง approval

`config.js` รับเฉพาะ:

- `supabaseUrl`: URL โปรเจกต์ที่ยืนยันแล้ว
- `publishableKey`: public `sb_publishable_...` หรือ legacy anon key เท่านั้น ไม่รับ secret/service-role key
- `gatewayUrl`: HTTPS endpoint ของ Gateway ที่ deploy หลังอนุมัติ อาจมี API/function prefix
- `turnstileSiteKey`: public sitekey หลังตั้งค่าที่อนุมัติแล้ว

ห้ามใส่ DB password, service-role, signing key หรือ Turnstile secret ลงไฟล์นี้ Browser ใช้เฉพาะ Session token ของตัวเองที่ SDK จัดการ ไม่พิมพ์ token ใน log หรือ URL

ก่อน signup/mutation client ต้องได้ `GET capabilities` → `{ready:true, mode:'online'}` จากระบบที่ตรวจแล้ว การเปลี่ยน config อย่างเดียวไม่ทำให้ฐานข้อมูลปลอดภัยหรือเปิดออนไลน์ได้ readiness ต้องอิง baseline, deployed RPC guards, durable storage/limiter, Auth abuse protection และผลจริง ไม่ตั้งเป็น true เพื่อข้าม tests

Server deployment ต้องกำหนด `basePath` ให้ตรง function prefix เช่น `/functions/v1/math24-online` และ CORS allowlist ต้องเป็น origin ของ GitHub Pages เว็บไซต์จริง Session ไม่ใช้ URL redirect detection จึงไม่รับ arbitrary login tokens จาก query/hash

## Gateway protocol

ทุก mutation มี `requestId` ที่ client สุ่มและ bearer user token Gateway ตรวจตัวตนเอง actor ไม่อยู่ใน params ที่ browser เลือกได้ create/join มี `challengeToken` เพิ่มเติม

| เส้นทาง | ข้อมูล |
|---|---|
| `GET capabilities` | readiness/mode/blockers ไม่มี secret |
| `POST create` | name/count/duration/mode/difficulty/ranking/mix |
| `POST join` | code เป็น string 6 หลัก/nickname |
| `GET snapshot/:roomId` | room projection + members + meId + match snapshot หรือ null |
| `POST ready/:roomId` | ready boolean ของผู้เรียก |
| `POST start/:roomId` | ไม่มี client score/time/owner |
| `POST leave/:roomId` | ออกเฉพาะตัวเอง; owner leave ตาม RPC contract จริง |
| `POST answer/:roomId` | questionId/formula เท่านั้น ไม่รับคะแนนหรือเวลาที่ browser อ้าง |
| `POST hint/:roomId`, `POST next/:roomId` | questionId |

Room snapshot ที่ repository ต้อง normalize จากของเดิม: `room:{id,name,code,hostId,status,settings}`, `members:[{id,name,ready}]`, `meId`, `match` ตาม `server/match-engine.mjs` นี่เป็น API projection ที่เสนอ ไม่ใช่การยืนยัน columns นอกเหนือ metadata ที่มี การสร้าง/เข้าห้องคืน envelope นี้, leave คืน `{left:true}`, answer/hint/next คืน `{result,snapshot}`

## Realtime/reconnect

Subscribe เฉพาะ `math24_rooms` ตาม `id` และ `math24_room_members` ตาม `room_id`; ไม่ subscribe limiter หรือคำตอบ/เฉลย Events ใช้ invalidation เท่านั้น เมื่อ SUBSCRIBED/refresh token/network กลับมา ให้โหลด snapshot ใหม่ มี poll 10 วินาทีและ backoff สูงสุดประมาณ 30 วินาทีเพื่อชดเชย event ที่หาย

Realtime publication/RLS จริงยังไม่ได้เปิด/ทดสอบ จึงไม่อ้างว่ารับ Realtime จาก Supabase แล้ว Offline integration ใช้ polling 250ms และ subscription double เพื่อทดสอบ UI; test นี้ไม่พิสูจน์ websocket/revocation ของ Supabase

หาก Session หมดอายุ/หาย จะปิด mutation และให้ผู้ใช้ตั้งใจเลือกเริ่มตัวตนใหม่ ไม่ยึด host/สมาชิกเดิมจากชื่อเล่นหรือรหัสห้อง หากถูกนำออกจะล้างข้อมูลห้องและ channel

## ทดสอบ

```sh
python3 -B -m unittest discover -s tests/security -v
node --test tests/server/*.test.mjs tests/client/*.test.mjs
CHROMIUM_PATH=/usr/bin/chromium /workspace/.venvs/math24-test/bin/python -B -m unittest discover -s tests -v
```

ติดตั้ง Python requirements ตาม README หลักถ้าไม่ได้ใช้ cloud virtualenv นี้ Tests ใหม่ชื่อ `test_online_mock.py` ระบุสถานะ Offline ชัดเจน ครอบคลุม two sessions จบ 10 ข้อ, shared questions, final ranking, duplicate/forged score/outsider, skip cancel/confirm, reconnect/reload, lost Session, room-full/rate-limit และ server expiry รวม actual vendor SDK import smoke

ตรวจหน้าใหม่ที่ 360/390/740/1280 px รวมภาพหน้าจอและ overflow; ยังไม่ได้ทดสอบมือถือจริง/คีย์บอร์ด OS, Safari/Firefox, network ผ่านอินเทอร์เน็ตคนละเครื่อง หรือ Supabase E2E

Legacy anon key รองรับ Local Supabase CLI ที่ยังใช้ JWT API keys การ decode role ตรงนี้เป็นเพียงการกรอง API key ที่เปิดเผยได้ ไม่ใช่การตรวจลายเซ็นหรือยืนยันผู้ใช้ ทั้ง SDK getUser และ server `/auth/v1/user` ยังต้องตรวจ Session จริง Mock mode ต้องใช้ loopback Auth fixture และ factory double เท่านั้น จึงไม่ fallback ไปสมัครบัญชีในโปรเจกต์จริง
