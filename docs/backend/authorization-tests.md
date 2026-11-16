# แผนทดสอบสิทธิ์ — ยังไม่ได้รันกับ Supabase

## สภาพแวดล้อมและ actor

ผลิตภัณฑ์ตัดสินใจแล้วว่า **ทุกคนสร้างห้องได้**; กรณีทดสอบต้องยืนยันว่า authenticated users (รวม anonymous sign-ins เมื่อเปิดจริง) สร้างห้องตนเองได้ แต่ไม่สามารถสวมเจ้าของห้องอื่นหรือแก้แถวห้องอื่นได้ การสมัครใหม่หลายตัวตนไม่ควรใช้เลี่ยง abuse limits

รันเฉพาะ local/disposable database ที่มี schema export ผ่าน review และ seeded accounts ปลอม ไม่รันบน dev จริงหรือ production โดยอัตโนมัติ ห้าม `supabase db reset --linked`, `db push` หรือสร้างผู้ใช้ในโปรเจกต์จริงในขั้นออกแบบนี้

Fixture: ผู้สร้างห้อง T เจ้าของห้อง A, ผู้เล่น P1/P2 ใน A, ผู้สร้างห้อง U และผู้เล่น Q ของห้อง B, ผู้เล่น G ที่ sign-in แบบ anonymous แต่ยังไม่อยู่ห้อง, N ไม่มี session เตรียม JWT จริงต่าง users ในระบบทดสอบ และมี P1 ที่ revoke membership ได้ ทุก actor ต้องต่าง uid ตรวจว่าไม่มี service-role token ใน client ทดสอบ

วิธีทดสอบสองชั้น:

1. SQL transaction/pgTAP หรือ runner ที่มีอยู่หลังตรวจ tooling: `SET LOCAL ROLE`/JWT claims ใน fixture ที่ได้รับอนุญาต เพื่อครอบคลุม policies, constraints, EXECUTE, function body และ race ใช้ independent connections สำหรับ concurrency ไม่สรุปจาก role simulation อย่างเดียว
2. HTTP ผ่าน Auth/PostgREST/Realtime ด้วย session ของ actor จริง: ทดสอบ request ที่ UI ไม่ยอมสร้าง, forged arguments, named overload และ anonymous JWT; SQL-only ไม่ยืนยัน gateway/headers/token validation ได้

จำนวนด้านล่างคือ **32 กรณีที่ออกแบบ ยังไม่ใช่ tests ที่ผ่าน** เมื่อ implementation ต้องรายงานทั้งจำนวน assertions/subcases ที่รัน ไม่รวม UI tests เดิมเป็นหลักฐานว่า RLS ผ่าน การ denied แบบ SELECT อาจได้ 200+empty ไม่จำเป็นต้อง 403 ตรวจข้อมูลที่เห็นและผลหลัง mutation ด้วย actor ผู้มีสิทธิ์เสมอ

| ID | ทำอะไร | ต้องได้ผลอะไร |
|---|---|---|
| A01 | N อ่าน rooms/members/limits และเรียก RPC ทุกตัว/ทุก overload | ไม่มีข้อมูล ไม่มีผลเปลี่ยนแปลงหรือสิทธิ์ EXECUTE ที่ไม่ควรมี |
| A02 | T/P1 โหลด A | เห็นเฉพาะข้อมูลที่อนุญาตของ A ไม่มีข้อมูลอ่อนไหว/เฉลย/limit |
| A03 | U/Q/G เดา UUID A แล้ว SELECT/filter/read RPC | ไม่เห็น A แม้เป็นครูหรือ authenticated |
| A04 | P1 เปลี่ยน owner/settings/state ห้อง A ด้วย REST DML | ไม่สำเร็จ ตรวจ A เหมือนเดิม |
| A05 | P1 เปลี่ยน ready/role/user_id/room_id ของ P2/T | ไม่สำเร็จ ทุกแถวเป้าหมายเหมือนเดิม |
| A06 | P1 set ready ตัวเองทั้ง true/false ใน waiting | สำเร็จเฉพาะแถวตัวเอง ไม่ย้ายห้อง/ยกสิทธิ์ |
| A07 | Q/U เรียก ready/start/leave โดยระบุ A/uid P1 | ไม่สำเร็จ A ไม่เปลี่ยน |
| A08 | P1/G สร้างห้องโดยปลอม owner/teacher/user_metadata | บัญชีที่ลงชื่อเข้าใช้สามารถสร้างห้องของตัวเองได้ แต่ owner_id ต้องตรงกับ auth.uid() เท่านั้น; ห้ามยึดห้องคนอื่นหรือข้าม server-side creation limits |
| A09 | T start A ทุกคนพร้อม เทียบ P1/U start A | T สำเร็จครั้งเดียว คนอื่นไม่ได้ |
| A10 | T start A ขณะมีสมาชิกไม่พร้อม/ห้องปิด/เริ่มแล้ว | transition ถูกกติกา ไม่มี start timestamp ใหม่จาก retry |
| A11 | ทุก actor direct INSERT/UPDATE/DELETE ตารางและ join_limits | ปฏิเสธตาม RPC-only design ไม่มี reset limiter หรือเปลี่ยนคะแนน |
| A12 | P1 leave ตัวเอง/leave ซ้ำ | สมาชิกอื่นคงเดิม ผลซ้ำไม่พัง; ทดสอบ owner leave ตาม contract ที่ยืนยันแล้วแยก |
| A13 | P1 ถูกถอดสมาชิกแล้วเรียก read/mutation | ไม่มีข้อมูลหรือสิทธิ์ห้องเดิม รวม session ที่ยังไม่หมดอายุ |
| A14 | เรียก helper/view/overload ด้วย PUBLIC, anon, authenticated และ uid null | ไม่มีทางอ้อมข้ามสิทธิ์/policy recursion หรือแถวที่ไม่เกี่ยวข้อง |
| A15 | ส่ง malformed UUID, SQL-like nickname, ชื่อยาว/HTML, ค่าตัวเลือกเกินขอบเขต | validate บน server ไม่มี injection/XSS/stack trace/ข้อมูลห้อง |
| A16 | ทดสอบ temporary-object/search_path shadowing ใน DB sandbox | RPC อ้าง object ที่ตั้งใจจริง ไม่มี privilege escalation |
| R01 | G join code string ที่ถูก/leading zero | สมัครได้เฉพาะตัวเองเมื่อ waiting/มีที่ การ join ไม่ให้ owner |
| R02 | รหัสผิด/ปิด/เต็ม/รูปแบบผิด | error ภายนอกไม่เผยข้อมูล; latency ไม่มี oracle ชัดเจน |
| R03 | เกิน join quota แม้ failed attempts/rollback attempts | DB limiter เพิ่มจริงและปฏิเสธตามขอบเขตเวลาของ server |
| R04 | หลาย uid ใหม่/IP เดิม, uid เดิม/IP ใหม่ และข้าม gateway | มาตรการรวม identities ทำงาน; direct RPC เลี่ยงไม่ได้ ถ้ายังได้ให้ block online release |
| R05 | sign-up ถี่/ไม่ส่ง CAPTCHA/ส่ง token ซ้ำหรือปลอม | เป็นไปตาม Auth+CAPTCHA config ที่ตรวจแล้ว ไม่คิดว่า join quota คุม signup |
| R06 | หลายผู้เรียนหลัง NAT เดียว/retry เมื่อ cooldown หมด | โหลดปกติยังเข้าได้ ระบบคืน retry state ที่ใช้งานได้ ไม่เปิดเผย code |
| C01 | 2 joins พร้อมกันแย่งที่ว่างสุดท้าย | รับได้ 1 คน ไม่เกิน capacity ไม่มีข้อมูลค้างครึ่ง transaction |
| C02 | uid เดียว join ซ้ำพร้อมกัน/หลาย tab | membership เดียว ไม่มีสิทธิ์เพิ่ม |
| C03 | ready=false/leave แข่งกับ start | ลำดับ transaction สอดคล้อง invariant ไม่มีเริ่มทั้งที่ state ก่อน start ไม่พร้อม |
| C04 | start พร้อมกัน/timeout หลัง commit แล้ว retry | รอบและ server deadline เดียว ไม่เริ่มซ้ำ |
| S01 | T/P1 subscribe A, U/Q subscribe A ทั้งใส่/ไม่ใส่ filter | คนที่มีสิทธิ์เท่านั้นรับข้อมูล; private flag ไม่ช่วยให้คนอื่นอ่านได้ |
| S02 | P1 ถูกถอดสมาชิกระหว่างเปิด socket/DELETE event | snapshot และ event ไม่เผยข้อมูลใหม่ของ A; ตรวจ payload จริงและช่องทาง DELETE ไม่อ้างจาก UI อย่างเดียว |
| S03 | event หาย/ซ้ำ/สลับ/มาระหว่าง snapshot และตอบ fetch เก่าช้า | UI ลงท้ายตรง snapshot ล่าสุดของห้องปัจจุบัน ไม่มี ghost member/ready เก่า |
| S04 | network หลุด/กลับมา/refresh JWT/หมดอายุ/reload | ไม่สร้าง identity ใหม่, re-subscribe+snapshot, ไม่มี auto-start/retry toggle ผิด |
| S05 | เปลี่ยนห้อง/ออกห้อง/sign out/สอง tabs | ล้าง channel/cache เก่า ไม่เห็น event ห้องเดิม ไม่ออกห้องเพียงเพราะ tab หลุด |
| S06 | spoof Presence/Broadcast ready/owner และ load หลายห้อง | authoritative state ไม่เปลี่ยน; วัด latency/quotas; ถ้าใช้ private Broadcast ตรวจ revocation cache แยก |

## การวัดผลและการเก็บหลักฐาน

- แต่ละ mutation ที่ควรถูกปฏิเสธให้ตรวจ snapshot ก่อน/หลังด้วย privileged **test fixture เท่านั้น** และตรวจว่าไม่มีแถวถูกเพิ่ม/แก้ ไม่ตีความ HTTP 200 ว่าสำเร็จเสมอ
- สำหรับ rate limit ใช้ request IDs/จำนวน attempts และ server clock ของ disposable DB เก็บเฉพาะ anonymized metrics ไม่เก็บ tokens, raw IP หรือ room codes
- บันทึก schema revision, SDK/Postgres version, config assumptions, จำนวนผ่าน/ล้มเหลว/skip พร้อมเหตุผล, expected/actual และรายการที่ยังไม่รัน ข้อที่ขาด prerequisite คือ blocked ไม่ใช่ passed
- UI regression เดิม: `CHROMIUM_PATH=/usr/bin/chromium /workspace/.venvs/math24-test/bin/python -B -m unittest discover -s tests -v` จาก repo root; ยังต้องคงผ่าน แต่ไม่แทน A/R/C/S
- ภายหลังเชื่อม adapter ให้ใช้สอง browser contexts ของจริงสร้าง/เข้า/พร้อม/เริ่ม/ออก ตรวจขนาด 360/390/740/1280px และ subpath GitHub Pages โดยแยก fixtures จำลองจาก backend integration ชัดเจน
