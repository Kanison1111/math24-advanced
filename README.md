# Math 24 Advanced

## V0.9.1

แก้การเก็บเวลาโจทย์เมื่อหมดเวลาหรือยุติการแข่งขัน โดยอ่านเวลาก่อนเปลี่ยนสถานะโจทย์ หน้าตาและกติกาเดิมไม่เปลี่ยน

## เปิดเกม

เป็นเว็บ static ไม่ต้อง build หรือติดตั้ง dependency สำหรับตัวเกม:

```sh
python3 -m http.server 8000
```

## ทดสอบอัตโนมัติ

ใช้ Python 3.10+ และ unittest ใน standard library ร่วมกับ Playwright สำหรับทดสอบ JavaScript จริงใน Chromium โดยไม่เพิ่ม framework ให้ตัวเกม:

```sh
python3 -m venv /tmp/math24-test-venv
/tmp/math24-test-venv/bin/pip install -r requirements-test.txt
/tmp/math24-test-venv/bin/python -m playwright install chromium
/tmp/math24-test-venv/bin/python -B -m unittest discover -s tests -v
```

หากมี Chromium อยู่แล้ว สามารถข้ามการดาวน์โหลด browser และกำหนด `CHROMIUM_PATH` เป็น path ของ executable เช่น:

```sh
CHROMIUM_PATH=/usr/bin/chromium python3 -B -m unittest discover -s tests -v
```

ชุดทดสอบเปิดเซิร์ฟเวอร์เฉพาะเครื่องบนพอร์ตว่างเองและปิดหลังจบ แต่ละ test ใช้ browser context ใหม่เพื่อแยก localStorage และใช้ virtual clock ไม่ต้องรอเวลาจริง ครอบคลุม parser/เศษส่วน/ลำดับคำนวณ, √ ! ^, เลขติดลบ, สูตรผิด, คะแนนและขอบเขตโบนัสเวลา, ค่าคำใบ้และจำนวนครั้ง, คะแนนซ้ำ/ดูเฉลย, เวลาฝึกซ้อม, การยุติ/หมดเวลา/ครบ 10 ข้อ, คะแนนฝึกซ้อมแยกการแข่งขัน และหน้าเว็บที่ 360/1280 px
