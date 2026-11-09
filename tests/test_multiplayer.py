"""Functional coverage of the isolated static multiplayer prototype."""
import functools
import http.server
import os
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

class MultiplayerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT.parent)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.page = self.browser.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.url = f'http://127.0.0.1:{self.server.server_port}/{ROOT.name}/'

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def click(self, ident):
        self.page.locator('#' + ident).click()

    def visible(self, ident):
        self.page.locator('#' + ident).wait_for(state='visible')

    def no_overflow(self):
        self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

    def create(self, ranking='live', count='10'):
        self.page.goto(self.url + 'multiplayer.html')
        self.page.locator('#room-name').fill('ม.5/1 ' + 'ชื่อห้องยาว' * 4)
        self.page.locator('#question-count').select_option(count)
        self.page.locator('#ranking-mode').select_option(ranking)
        self.click('create-submit')
        self.visible('lobby-panel')

    def test_host_and_ranking_all_viewports(self):
        for width, height in [(360,800),(1280,900),(740,360)]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width':width,'height':height})
                self.create(count='5')
                self.no_overflow()
                self.assertTrue(self.page.locator('#start-button').is_disabled())
                self.page.locator('#lobby-panel summary').click()
                self.click('demo-ready')
                self.click('demo-connection')
                self.assertTrue(self.page.locator('#start-button').is_disabled())
                self.click('demo-connection')
                self.click('start-button')
                self.visible('ranking-panel')
                self.assertEqual(self.page.locator('.rank-row').count(),3)
                self.no_overflow()
                self.page.locator('#rank-filter').select_option('me')
                self.assertEqual(self.page.locator('.rank-row').count(),1)
                self.page.locator('#ranking-panel summary').click()
                for state in ['loading','empty','error']:
                    self.page.locator(f'[data-rank-state="{state}"]').click()
                    self.assertEqual(self.page.locator('.rank-row').count(),0)
                self.click('retry-ranking')
                self.assertEqual(self.page.locator('.rank-row').count(),1)
                self.page.locator('[data-rank-state="normal"]').click()
                self.click('finish-button')
                self.assertTrue(self.page.locator('#finish-button').is_hidden())
                self.click('back-lobby')
                self.click('leave-button')
                self.visible('leave-dialog')
                self.page.keyboard.press('Escape')
                self.assertTrue(self.page.locator('#leave-button').evaluate('el => el === document.activeElement'))
                self.click('leave-button')
                self.click('cancel-leave')
                self.click('leave-button')
                self.click('confirm-leave')
                self.visible('create-panel')

    def test_mixed_validation_and_final_privacy(self):
        self.page.goto(self.url + 'multiplayer.html')
        self.page.locator('#room-name').fill('ห้องทดสอบ')
        self.page.locator('#difficulty').select_option('mixed')
        self.page.locator('#question-count').select_option('15')
        self.click('create-submit')
        self.assertIn('ต้องรวม',self.page.locator('#create-error').inner_text())
        self.page.locator('#mix-easy').fill('9')
        self.page.locator('#room-mode').select_option('advanced')
        self.page.locator('#duration').fill('15')
        self.page.locator('#ranking-mode').select_option('final')
        self.click('create-submit')
        self.visible('lobby-panel')
        self.assertIn('ง่าย 9',self.page.locator('#lobby-rules').inner_text())
        self.page.locator('#lobby-panel summary').click()
        self.click('demo-ready'); self.click('start-button')
        self.assertEqual(self.page.locator('.rank-row').count(),0)
        self.page.locator('#ranking-panel summary').click()
        self.page.locator('[data-rank-state="normal"]').click()
        self.assertEqual(self.page.locator('.rank-row').count(),0)
        self.click('finish-button')
        self.assertEqual(self.page.locator('.rank-row').count(),3)
        self.click('ranking-leave'); self.click('confirm-leave')
        self.visible('create-panel')

    def test_join_errors_ready_and_safe_names(self):
        self.page.set_viewport_size({'width':360,'height':800})
        self.page.goto(self.url + 'multiplayer.html'); self.click('join-tab')
        self.page.locator('#nickname').fill('<img src=x onerror=alert(1)>')
        for code, message in [('111111','เต็ม'),('000000','ปิด'),('123456','ไม่พบ')]:
            self.page.locator('#room-code').fill(code); self.click('join-submit')
            self.assertIn(message,self.page.locator('#join-error').inner_text())
        self.page.locator('#room-code').fill('123')
        self.click('join-submit'); self.visible('join-panel')
        self.page.locator('#room-code').fill('240024'); self.click('join-submit')
        self.visible('lobby-panel'); self.no_overflow()
        self.assertTrue(self.page.locator('#start-button').is_hidden())
        self.click('ready-button'); self.click('ready-button'); self.click('ready-button')
        self.page.locator('#lobby-panel summary').click(); self.click('demo-ready')
        self.click('demo-connection')
        self.assertTrue(self.page.locator('#ready-button').is_disabled())
        self.click('demo-connection'); self.click('demo-start')
        self.visible('ranking-panel'); self.no_overflow()
        self.assertEqual(self.page.locator('#rankings img').count(),0)

    def test_subpath_navigation_and_keyboard(self):
        self.page.goto(self.url)
        self.page.get_by_role('link',name='Multiplayer · ทดลองห้องแข่งขัน V1.0').click()
        self.visible('create-panel')
        self.page.locator('#join-tab').focus(); self.page.keyboard.press('Enter')
        self.assertTrue(self.page.locator('#join-title').evaluate('el => el === document.activeElement'))
        self.page.get_by_role('link',name='← เล่นคนเดียว').click()
        self.assertTrue(self.page.locator('#answer').count())
