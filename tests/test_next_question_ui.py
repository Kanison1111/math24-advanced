"""Regression tests for the approved single-player UI and next-question confirmation."""
from datetime import datetime, timezone
import functools
import http.server
import os
from pathlib import Path
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class NextQuestionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0),
            functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH')
        cls.browser = cls.playwright.chromium.launch(
            **({'executable_path': executable} if executable else {})
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.page = self.browser.new_page()
        self.errors = []
        self.page.on('pageerror', lambda exc: self.errors.append(str(exc)))
        epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.page.clock.install(time=epoch)
        self.page.clock.pause_at(epoch)
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/')

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def test_skip_requires_confirmation_and_cancel_preserves_question(self):
        before = self.page.evaluate('JSON.stringify([current.nums, current.solution, stats])')
        self.page.locator('#new').click()
        self.assertTrue(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.assertIn('ไม่ได้คะแนน', self.page.locator('#skip-confirm-description').inner_text())
        self.page.locator('#skip-cancel').click()
        self.assertFalse(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.assertEqual(self.page.evaluate('JSON.stringify([current.nums, current.solution, stats])'), before)
        self.assertTrue(self.page.locator('#new').evaluate('e => e === document.activeElement'))

    def test_confirm_skip_counts_once_without_penalty(self):
        before = self.page.evaluate('({ score: stats.score, skipped: stats.skipped })')
        self.page.locator('#new').click()
        self.page.locator('#skip-confirm').click()
        after = self.page.evaluate('({ score: stats.score, skipped: stats.skipped })')
        self.assertEqual(after['score'], before['score'])
        self.assertEqual(after['skipped'], before['skipped'] + 1)
        self.assertFalse(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))

    def test_solved_and_revealed_go_next_without_confirmation(self):
        self.page.evaluate('input.value = current.solution; checkAnswer()')
        self.page.locator('#new').click()
        self.assertFalse(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.page.evaluate('showSolution()')
        self.page.locator('#new').click()
        self.assertFalse(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))

    def test_competition_skip_is_counted_and_timeout_closes_dialog(self):
        self.page.evaluate("playStyleSelect.value='competition'; startCompetition()")
        self.page.locator('#new').click()
        self.assertTrue(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.page.locator('#skip-confirm').click()
        self.assertEqual(self.page.evaluate('competition.skipped'), 1)
        self.page.locator('#new').click()
        self.assertTrue(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.page.evaluate("finishCompetition('time')")
        self.assertFalse(self.page.locator('#skip-confirm-dialog').evaluate('e => e.open'))
        self.assertTrue(self.page.locator('#contest-result-dialog').evaluate('e => e.open'))

    def test_layout_mobile_and_desktop(self):
        for width in [360, 390, 740, 1280]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 850})
                self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
                self.assertEqual(self.page.locator('#numbers .tile').count(), 4)
                self.assertTrue(self.page.locator('#new').is_visible())
                self.assertTrue(self.page.locator('.multiplayer-cta').is_visible())
                gap = self.page.locator('.keypads').evaluate('e => parseFloat(getComputedStyle(e).columnGap)')
                self.assertEqual(gap, 18 if width <= 400 else 26)


if __name__ == '__main__':
    unittest.main()
