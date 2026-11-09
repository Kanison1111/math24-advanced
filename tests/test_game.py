"""Browser regression tests against the unmodified inline game script."""
from datetime import datetime, timezone
import functools
import http.server
import os
from pathlib import Path
import threading
import unittest

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class GameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH')
        cls.browser = cls.playwright.chromium.launch(
            **({'executable_path': executable} if executable else {}))

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
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.page.clock.install(time=epoch)
        self.page.clock.pause_at(epoch)
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/')

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def js(self, expression):
        return self.page.evaluate(expression)

    def puzzle(self, difficulty='easy'):
        self.js(f"difficultySelect.value='{difficulty}'; newQuestion()")

    def solve(self):
        self.js('input.value=current.solution; checkAnswer()')

    def contest(self):
        self.js("playStyleSelect.value='competition'; startCompetition()")
        self.assertTrue(self.js('competition.active'))

    def test_parser_valid(self):
        cases = [
            ('2+3*4-1', [2,3,4,1], 'basic', '13', '1'),
            ('(2+3)*(4-1)', [2,3,4,1], 'basic', '15', '1'),
            ('8÷(3−8÷3)', [8,3,8,3], 'basic', '24', '1'),
            (' √9 × (8 - 1) + 3 ', [9,8,1,3], 'advanced', '24', '1'),
            ('4!+1-2+1', [4,1,2,1], 'advanced', '24', '1'),
            ('2^3*4-8', [2,3,4,8], 'advanced', '24', '1'),
            ('2^(1-3)+4', [2,1,3,4], 'advanced', '17', '4'),
            ('(-3)+9+9+9', [-3,9,9,9], 'basic', '24', '1'),
            ('√(1/4)+2+3', [1,4,2,3], 'advanced', '11', '2'),
        ]
        for formula, nums, mode, n, d in cases:
            with self.subTest(formula=formula):
                result = self.page.evaluate('([f,ns,m])=>{const x=calculateAnswer(f,ns,m);return [String(x.n),String(x.d)]}', [formula,nums,mode])
                self.assertEqual(result, [n,d])

    def test_parser_invalid(self):
        cases = [
            ('12+3+4', [1,2,3,4], 'basic'),
            ('1+2+3', [1,2,3,4], 'basic'),
            ('1+2+3+3', [1,2,3,4], 'basic'),
            ('(1+2+3+4', [1,2,3,4], 'basic'),
            ('1+2+3+4)', [1,2,3,4], 'basic'),
            ('1+2;3+4', [1,2,3,4], 'basic'),
            ('1/(2-2)+3', [1,2,2,3], 'basic'),
            ('-3+9+9+9', [-3,9,9,9], 'basic'),
            ('√2+1+3+4', [2,1,3,4], 'advanced'),
            ('√(-1)+2+3+4', [-1,2,3,4], 'advanced'),
            ('7!+1+2+3', [7,1,2,3], 'advanced'),
            ('(-1)!+2+3+4', [-1,2,3,4], 'advanced'),
            ('(1/2)!+3+4', [1,2,3,4], 'advanced'),
            ('2^5+1+3', [2,5,1,3], 'advanced'),
            ('2^(1/2)+3', [2,1,2,3], 'advanced'),
            ('0^(1-1)+2', [0,1,1,2], 'advanced'),
            ('√1+√4+2+3', [1,4,2,3], 'advanced'),
            ('1!+2!+3+4', [1,2,3,4], 'advanced'),
            ('1^2+3^4', [1,2,3,4], 'advanced'),
        ]
        cases += [(f, ns, 'basic') for f,ns in [('√9+1+2+3',[9,1,2,3]), ('4!+1+2+3',[4,1,2,3]), ('2^3+1+4',[2,3,1,4])]]
        for formula, nums, mode in cases:
            with self.subTest(formula=formula, mode=mode):
                error = self.page.evaluate('([f,ns,m])=>{try {calculateAnswer(f,ns,m); return null;} catch(e) {return e.message;}}', [formula,nums,mode])
                self.assertIsInstance(error, str)
                self.assertTrue(error)

    def test_score_boundaries(self):
        for difficulty, base in [('easy',10),('medium',20),('hard',30)]:
            for duration, bonus in [(0,10),(30000,10),(30001,5),(60000,5),(60001,0)]:
                with self.subTest(difficulty=difficulty, duration=duration):
                    self.puzzle(difficulty)
                    before = self.js('stats.score')
                    self.page.clock.run_for(duration)
                    self.solve()
                    self.assertEqual(self.js('stats.score')-before, base+bonus)
                    self.assertEqual(self.js('stoppedElapsedMs'), duration)

    def test_hints_limits_costs_and_reset(self):
        for difficulty, limit, charge in [('easy',2,5),('medium',1,10),('hard',0,0)]:
            with self.subTest(difficulty=difficulty):
                self.puzzle(difficulty)
                before = self.js('stats.score')
                for _ in range(4):
                    self.js('showHint()')
                self.assertEqual(self.js('hintStage'), limit)
                self.assertEqual(self.js('hintPenalty'), limit*charge)
                self.assertEqual(self.js('stats.score'), before)
                self.page.clock.run_for(60001)
                self.solve()
                self.assertEqual(self.js('stats.score')-before, {'easy':10,'medium':20,'hard':30}[difficulty]-limit*charge)
                self.puzzle(difficulty)
                self.assertEqual(self.js('[hintStage,hintPenalty]'), [0,0])

    def test_duplicate_and_revealed_answers_no_extra_points(self):
        self.solve()
        snapshot = self.js('JSON.stringify(stats)')
        self.solve()
        self.assertEqual(self.js('awardPoints()'), 0)
        self.assertEqual(self.js('JSON.stringify(stats)'), snapshot)
        self.puzzle()
        self.js('showSolution()')
        snapshot = self.js('JSON.stringify(stats)')
        self.solve()
        self.assertEqual(self.js('JSON.stringify(stats)'), snapshot)

    def test_practice_timer_freezes_and_restarts(self):
        self.page.clock.run_for(12345)
        self.assertEqual(self.js('elapsedMs()'),12345)
        self.assertEqual(self.page.locator('#timer').inner_text(),'00:12')
        self.solve()
        self.page.clock.run_for(5000)
        self.assertEqual(self.js('elapsedMs()'),12345)
        self.puzzle()
        self.assertEqual(self.js('elapsedMs()'),0)

    def test_quit_preserves_active_puzzle_elapsed_time(self):
        self.contest()
        self.page.clock.run_for(4321)
        self.js("finishCompetition('quit')")
        self.assertEqual(self.js('stoppedElapsedMs'),4321)
        self.assertEqual(self.js('[competition.completed,competition.skipped]'),[0,0])
        self.assertTrue(self.js('resultDialog.open'))
        finished = self.js('competition.finishedAt')
        self.page.clock.run_for(2000)
        self.js("finishCompetition('time')")
        self.assertEqual(self.js('competition.finishedAt'),finished)
        self.assertEqual(self.js('elapsedMs()'),4321)

    def test_timeout_and_late_answer(self):
        self.contest()
        duration = self.js('competition.endsAt-Date.now()')
        self.page.clock.run_for(duration-1)
        self.assertTrue(self.js('competition.active'))
        self.page.clock.run_for(1)
        self.assertEqual(self.js('competition.reason'),'time')
        self.assertEqual(self.js('elapsedMs()'),duration)
        self.assertEqual(self.js('contestTimeLeft()'),0)
        self.solve()
        self.assertEqual(self.js('[competition.score,competition.solved,competition.skipped]'),[0,0,0])

    def test_ten_questions_finish_and_practice_stats_isolated(self):
        before = self.js('JSON.stringify(stats)')
        self.contest()
        for i in range(10):
            self.page.clock.run_for(1000)
            self.solve()
            self.assertEqual(self.js('competition.completed'),i+1)
            score = self.js('competition.score')
            self.solve()
            self.assertEqual(self.js('competition.score'),score)
            if i < 9:
                self.js('newQuestion()')
        self.assertEqual(self.js('[competition.active,competition.ended,competition.reason,competition.solved]'),[False,True,'complete',10])
        self.assertEqual(self.js('JSON.stringify(stats)'),before)
        self.assertEqual(self.js('stoppedElapsedMs'),1000)
        self.assertEqual(self.page.locator('#contest-final-score').inner_text(),str(score))

    def test_skip_and_competition_hint(self):
        self.contest()
        self.js('showHint()')
        self.solve()
        self.assertEqual(self.js('competition.score'),15)
        self.js('newQuestion(); newQuestion()')
        self.assertEqual(self.js('[competition.completed,competition.solved,competition.skipped]'),[2,1,1])

    def test_ui_mobile_and_desktop(self):
        for width in [360,1280]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.assertEqual(self.page.locator('#numbers .tile').count(),4)
            self.assertFalse(self.js('document.documentElement.scrollWidth > innerWidth'))
            self.page.locator('#open-rules').click()
            self.assertTrue(self.js('rulesDialog.open'))
            self.page.locator('#close-rules').click()


if __name__ == '__main__':
    unittest.main()
