# รูปแบบการเชื่อมต่อที่เสนอ

## ขอบเขตและของเดิม

ระยะแรกเชื่อมเฉพาะสร้างห้อง เข้าห้อง ออกจากห้อง พร้อม และเริ่มแข่งกับของเดิม UI ปัจจุบันมีหน้าสร้าง/เข้า/ห้องรอ/Ranking แต่ Ranking และผู้เล่นทั้งหมดจำลอง ห้ามแสดงคะแนนจำลองเป็นคะแนนจริงเมื่อเปิด online mode

ใช้ HTML/CSS/JS เดิม ไม่เพิ่ม framework ไม่แก้ Parser/Solver/กติกาคะแนนหรือเกมคนเดียว การแข่งขันคนเดียวมี 10 ข้อ แต่ prototype เลือก 5/10/15/20 ข้อได้ ต้องตรวจว่า RPC รองรับชุดใดจริง ไม่ส่งค่าที่ server ไม่รองรับหรือปรับกติกาเงียบ ๆ

## แบ่งหน้าที่ก่อนลงมือเขียนโค้ด

ไฟล์ต่อไปนี้เป็น **ชื่อที่เสนอ ยังไม่ได้สร้าง/เชื่อมใช้งาน**:

- `multiplayer.js`: แสดง UI และ pending/error state; ย้ายข้อมูลจำลองเป็น adapter แยกที่เลือกชัดเจน ห้าม fallback เป็นข้อมูลจำลองเมื่อ online request ล้มเหลว
- `multiplayer-api.js`: รับ config, session, เรียก RPC เดิม และแปลง response เป็น UI model ไม่ยอมรับ owner/actor/score จาก UI
- `multiplayer-session.js`: ใช้ session เดิมเมื่อ reload, refresh token, sign-out cleanup; ไม่สร้าง anonymous user ใหม่ทุก reconnect
- `multiplayer-sync.js`: subscribe → โหลด snapshot → reconcile; ยกเลิก channel เก่าเมื่อออกห้อง
- public config: เฉพาะ Supabase project URL และ publishable key (หรือ legacy anon key หากโปรเจกต์ใช้จริง) ไม่มี secret/service-role/DB password/Management token ใน browser, bundle, repository หรือ log

เลือกและ pin เวอร์ชัน Supabase JS SDK ในงาน implementation หลังตรวจ compatibility ปัจจุบันยังไม่ได้ติดตั้ง dependency ใหม่ GitHub Pages รองรับ static client ได้ แต่ server/gateway ต้องอยู่ต่างระบบที่ได้รับอนุมัติ ไม่สมมติว่า GitHub Pages รัน backend ให้

## ตัวตนและเจ้าของห้อง

ผู้ยังไม่ sign in คือ database role `anon`; ผู้เล่น `signInAnonymously()` แล้วเป็น `authenticated` และมี `auth.uid()` เช่นผู้ใช้ทั่วไป จึงห้ามใช้เพียง `TO authenticated` เป็นหลักฐานว่าเป็นครู

**ข้อตกลงผลิตภัณฑ์ที่ยืนยันแล้ว:** ทุกคนสร้างห้องได้ ไม่ต้องเป็นครูที่ผ่านการอนุมัติ ผู้สร้างห้องเรียกว่า **เจ้าของห้อง (host)** ไม่ใช่ครูที่ได้รับการรับรอง ปัจจุบัน `public.math24_create_room` ผูก `owner_id` กับ `auth.uid()` ตามผลตรวจฐานข้อมูลแบบอ่านอย่างเดียว จึงรองรับหลักการนี้อยู่แล้ว แต่ต้องตรวจ Auth/abuse และผลคำขอจริงก่อนเปิดใช้

ข้อเสนอการใช้งาน: ผู้มาใหม่ใช้ anonymous sign-in โดยไม่ต้องกรอกอีเมลหรือรหัสผ่าน ภายใต้การตั้งค่า Auth/CAPTCHA ที่ได้รับการตรวจสอบจริง และอาจอนุญาตบัญชีถาวรตามระบบที่มี ห้ามเปิด endpoint สร้างห้องให้ผู้ไร้ session; สิทธิ์ host ผูกกับตัวตนผู้สร้างในฐานข้อมูลและใช้ได้เฉพาะห้องตัวเอง ต้องมี server-side rate limits สำหรับสร้างห้องและ join (ไม่พึ่งปิดปุ่มหรือ per-uid limiter เพียงอย่างเดียว) ห้ามเพิ่ม teacher whitelist โดยพลการ

ห้ามใช้ `user_metadata`, nickname, localStorage `host=true`, request `role` หรือ user UUID ที่ client ส่งมาเป็นแหล่งสิทธิ์ เจ้าของห้องอ่านจากฐานข้อมูลที่แก้ได้โดยทางที่เชื่อถือได้เท่านั้น ทุก RPC ต้องผูกผู้กระทำกับ `auth.uid()`; การเปลี่ยน device/ล้าง storage ของ anonymous user ทำให้เสีย identity เดิม ห้ามกู้สิทธิ์เจ้าของห้องหรือผู้เล่นจากชื่อเล่น/รหัสห้อง

## Mapping ที่ต้องเติมจาก inventory — ไม่ใช่ชื่อ API จริง

| UI action | ของเดิมที่ต้องค้นหา | สิ่งที่ต้องยืนยันใน transaction |
|---|---|---|
| สร้างห้อง | RPC create (ชื่อ/signature ยังไม่ทราบ) | actor เป็นผู้สร้างที่อนุญาต, validate settings, สุ่ม code บน server, owner เปลี่ยนโดย client ไม่ได้ |
| เข้าห้อง | RPC join | validate code 6 digits, limit ก่อน lookup, ห้องรอ/ยังมีที่, membership ไม่ซ้ำ, actor=self |
| ออกจากห้อง | RPC leave | ออกได้เฉพาะตัวเอง, repeated leave ไม่เสียข้อมูลคนอื่น; owner leave ทำตามพฤติกรรมเดิมที่ audit ยืนยัน |
| กดพร้อม | RPC ready | สมาชิกห้องรอเปลี่ยนได้เฉพาะ ready ของตัวเอง; เสนอ set boolean แทน toggle สำหรับ retry |
| เจ้าของห้องเริ่ม | RPC start | owner จริง, สมาชิกพร้อม, state ยัง waiting, start/deadline มาจาก server, เริ่มซ้ำได้ผลรอบเดิม |
| โหลดห้องรอ | SELECT ที่ RLS อนุญาต หรือ read RPC เดิมถ้ามี | เฉพาะเจ้าของ/สมาชิก; columns เท่าที่จำเป็น ไม่มี secret/เฉลย/limit records |

ต้องบันทึกชื่อเต็ม schema, `pg_get_function_identity_arguments`, named parameters, return type/JSON shape, errors และ idempotency ให้ครบก่อนเขียน adapter ห้ามเดาชื่อ `create_room()` แล้วสร้างใหม่เพราะหาไม่เจอ

`RoomSnapshot` เป็น **UI model ที่เสนอ ไม่ใช่คอลัมน์ที่ยืนยันแล้ว**: opaque room id, settings, phase, owner marker, รายการสมาชิกกับ ready, server start/deadline และ version ถ้ามี UUID ห้องใช้หลังเข้าห้องแล้ว ไม่ใช้ code เป็นช่องทางอ่านทุกข้อมูล response ต้องไม่เผยข้อมูลห้องอื่น

## การเขียนข้อมูลและความพร้อมกัน

หนึ่ง mutation = หนึ่ง transaction ที่ตรวจ actor, membership และ state ก่อนเขียน ล็อกห้องเดิมเป็นลำดับเดียวกันใน join/leave/ready/start เพื่อกันเกินความจุและ start แข่งกับ unready/leave ตรวจ unique membership และ code ตาม constraints ที่มีอยู่ก่อนเพิ่มอะไร

การปิดปุ่มใน UI ลด double-click แต่ไม่ใช่สิทธิ์หรือ idempotency ถ้า network timeout หลัง commit ให้ re-fetch ก่อน retry create/start; ห้าม retry แบบสุ่มจนได้หลายห้อง ready ควร set สถานะที่ต้องการ join/leave ควรซ้ำแล้วได้สถานะเดิม ถ้าฟังก์ชันเดิม toggle ให้ระงับ automatic retry และออกแบบการแก้ signature อย่างมี compatibility review

สถานะ server คือหลัก ไม่ใช้เวลาของ browser ตัดสินเริ่ม/หมดเวลา แสดง countdown โดยชดเชย offset จาก server time และ resync ตอนกลับมาหน้าเว็บ ไม่ตั้ง ready=false หรือออกห้องจาก websocket disconnect เพียงอย่างเดียว

## Realtime และการกลับมาเชื่อมต่อ

ข้อเสนอเริ่มด้วย **Postgres Changes เฉพาะ rooms/members** หลังตรวจ publication และ SELECT RLS แล้ว ไม่มีเหตุผลให้ publish `math24_join_limits` ใช้ opaque room id เป็น filter; filter ช่วยลด event แต่ RLS คือขอบเขตความปลอดภัย `private: true` เพียงอย่างเดียวไม่แทน table RLS

1. ตรวจ session → อ่าน membership ที่อนุญาต → เปิด subscription rooms/members ที่ scope ห้องนั้น
2. รอ `SUBSCRIBED` แล้วโหลด snapshot ที่ได้รับสิทธิ์ เก็บ event ระหว่าง fetch เป็น dirty flag ไม่เขียน payload ทับ snapshot โดยไม่ตรวจ
3. event เป็นสัญญาณให้ re-fetch แบบ debounce; ถ้าระหว่าง fetch มี event เพิ่ม ให้ fetch อีกรอบจนไม่มี dirty flag ใช้ request generation ป้องกัน response เก่าจากห้องเดิมมาทับห้องใหม่ ถ้ามี revision จริงใช้เทียบลำดับด้วย
4. หากไม่มี atomic snapshot API เดิม ให้โหลด room/members แล้วตรวจสถานะห้องซ้ำ; เมื่อผลไม่สอดคล้องให้คง UI syncing และ retry ห้ามคำนวณสิทธิ์ start จาก snapshot ที่ไม่ครบ
5. `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`: แสดงกำลังเชื่อมต่อ, ปิด mutation ที่เสี่ยง, retry ด้วย exponential backoff+jitter สูงสุดราว 30 วินาที แล้ว subscribe/snapshot ใหม่ ไม่ replay คำสั่ง start ที่หมดอายุ
6. `TOKEN_REFRESHED`: ใช้ token ใหม่กับ Realtime ตาม SDK version ที่ pin; token ใช้ไม่ได้ให้หยุด channel และกลับ sign-in ห้ามสร้าง user ใหม่เงียบ ๆ
7. ตอน `online`/กลับ focus และเป็นระยะประมาณ 10–15 วินาทีในห้องรอ ให้ snapshot อีกครั้งเพื่อจับ event ที่หาย โดย pause เมื่อ hidden และ backoff เมื่อผิดพลาด; จำกัดภาระตาม quotas ที่วัดจริง
8. leave/ถูกนำออก/ห้องปิด: unsubscribe, clear cache และ disable UI ทันที; สิทธิ์ต้องถูกตัดฝั่ง DB ด้วย เปิดหลาย tab ต้องไม่สร้าง membership ซ้ำ

DELETE มีข้อจำกัดเกี่ยวกับ filter, replica identity และ payload/RLS จึงไม่ใช้ DELETE payload เป็นแหล่งรายชื่อหรือข้อมูลอ่อนไหว ตรวจพฤติกรรมของโปรเจกต์จริงและใช้ periodic snapshot ชดเชย ห้ามเปิด `REPLICA IDENTITY FULL` โดยไม่ทบทวนข้อมูลที่ WAL/event อาจเผย หาก schema รองรับ inactive/left state อยู่แล้วให้พิจารณา UPDATE แทน ไม่เพิ่มคอลัมน์โดยเดา

Presence บอกได้เพียง “น่าจะเชื่อมต่ออยู่” ไม่ใช่ ready/สมาชิก/ครู ถ้าภายหลังใช้ Broadcast/Presence ต้องมี private-channel authorization ของ `realtime.messages` แยกต่างหาก สิทธิ์ channel อาจ cache จน refresh JWT/หมดอายุ จึงไม่ส่งคะแนนลับ/เฉลยผ่าน broadcast โดยคิดว่าถอดสมาชิกแล้วจะตัดทันที

## ขอบเขตการแข่งขันจริงขั้นถัดไป

RPC start ไม่ได้พิสูจน์ว่ามี backend รับคำตอบ โจทย์กลาง การตรวจคะแนน หรือ leaderboard ที่ปลอดภัยแล้ว ต้อง inventory เพิ่มและออกแบบ authoritative server validation, attempt idempotency, shared question order, เวลาจาก server และการซ่อนเฉลย คะแนนที่คำนวณใน `index.html` ห้ามรับไปบันทึกเป็นคะแนนออนไลน์ที่เชื่อถือได้ ห้ามเปลี่ยนกติกาคะแนน/เพิ่มคะแนนติดลบเพื่อแก้ความปลอดภัย
