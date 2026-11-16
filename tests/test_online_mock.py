"""OFFLINE integration: real Chromium + HTTP + server engine, fake Auth/repository.

No Supabase requests/database/production CAPTCHA. Not a real-online E2E pass.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import threading
import unittest
from urllib.parse import urlencode
from urllib.request import urlopen, Request
import uuid
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SDK_FIXTURE = r"""
globalThis.MATH24_SDK_FACTORY = () => {
  const key='offline-fixture-session';
  const read=()=>JSON.parse(localStorage.getItem(key)||'null');
  return {auth:{
    getSession:async()=>({data:{session:read()}}),
    getUser:async()=>({data:{user:read()?.user}}),
    onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
    signOut:async()=>{localStorage.removeItem(key);return {error:null};},
    signInAnonymously:async()=>{
      const id=crypto.randomUUID(),session={access_token:'offline:'+id,user:{id}};
      localStorage.setItem(key,JSON.stringify(session));
      localStorage.setItem('offline-fixture-signups',String(Number(localStorage.getItem('offline-fixture-signups')||0)+1));
      return {data:{session}};
    }
  },realtime:{setAuth:async()=>{}},
    channel:()=>{const channel={on(){return channel;},subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return channel;}};return channel;},
    removeChannel:async()=>{}
  };
};
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class OfflineOnlineFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.web = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT.parent)))
        cls.thread = threading.Thread(target=cls.web.serve_forever, daemon=True)
        cls.thread.start()
        origin = f'http://127.0.0.1:{cls.web.server_port}'
        cls.url = origin + '/' + ROOT.name + '/multiplayer/online.html'
        cls.process = subprocess.Popen([shutil.which('node'), str(ROOT/'tests/server/mock-http.mjs')],
                                      cwd=ROOT, env={'PATH': os.environ['PATH'], 'MATH24_TEST_ORIGIN': origin},
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if not select.select([cls.process.stdout], [], [], 10)[0]:
            cls.process.terminate()
            raise RuntimeError('Offline gateway fixture did not start')
        line = cls.process.stdout.readline()
        if not line:
            raise RuntimeError('Offline gateway fixture failed to start')
        cls.api = 'http://127.0.0.1:' + str(json.loads(line)['port'])
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.process.stdout.close()
        cls.process.stderr.close()
        cls.web.shutdown()
        cls.web.server_close()
        cls.thread.join()

    def setUp(self):
        self.contexts, self.errors = [], []

    def tearDown(self):
        self.control('rate', deny='0')
        for context in self.contexts:
            context.close()
        self.assertEqual(self.errors, [])

    def page(self, width=390, configured=True):
        context = self.browser.new_context(viewport={'width': width, 'height': 850})
        self.contexts.append(context)
        context.add_init_script(SDK_FIXTURE)
        if configured:
            config = json.dumps({'gatewayUrl': self.api, 'supabaseUrl': self.api, 'publishableKey': 'sb_publishable_offline_fixture', 'turnstileSiteKey': ''})
            context.route('**/multiplayer/config.js', lambda route: route.fulfill(content_type='text/javascript', body='globalThis.MATH24_ONLINE_CONFIG='+config+';'))
        page = context.new_page()
        page.on('pageerror', lambda error: self.errors.append(str(error)))
        page.goto(self.url)
        if configured:
            page.locator('#connect').click()
            expect(page.locator('#create-submit')).to_be_enabled()
            expect(page.locator('#mode-label')).to_contain_text('Mock API')
        return page

    def identity(self, page):
        return page.evaluate("JSON.parse(localStorage.getItem('offline-fixture-session'))")

    def room_id(self, page):
        return page.evaluate("localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('math24-online-room:')))")

    def control(self, path, **params):
        with urlopen(self.api+'/_test/'+path+'?'+urlencode(params)) as response:
            return json.load(response)

    def create(self, host, ranking='live', count='5'):
        host.locator('#room-name').fill('ห้องทดสอบ Offline')
        host.locator('#question-count').select_option(count)
        host.locator('#duration').fill('1')
        host.locator('#ranking-mode').select_option(ranking)
        host.locator('#create-submit').click()
        expect(host.locator('#room-panel')).to_be_visible()
        return host.locator('#lobby-code').inner_text()

    def pair(self, ranking='live', count='5'):
        host, peer = self.page(360), self.page(1280)
        code = self.create(host, ranking, count)
        peer.locator('#nickname').fill('<img src=x>เพื่อน')
        peer.locator('#room-code').fill(code)
        peer.locator('#join-submit').click()
        expect(peer.locator('#room-panel')).to_be_visible()
        expect(host.locator('#players li')).to_have_count(2)
        expect(host.locator('#start-button')).to_be_disabled()
        peer.locator('#ready-button').click()
        expect(host.locator('#start-button')).to_be_enabled()
        host.locator('#start-button').click()
        for page in (host, peer):
            expect(page.locator('#match-panel')).to_be_visible()
            expect(page.locator('#submit-answer')).to_be_enabled()
        self.assertEqual(host.locator('#numbers').inner_text(), peer.locator('#numbers').inner_text())
        return host, peer

    def solve(self, page):
        formula = self.control('solution', room=self.room_id(page), actor=self.identity(page)['user']['id'])['solution']
        page.locator('#answer').fill(formula)
        path = '/answer/'+self.room_id(page)
        with page.expect_request(lambda request: request.url.endswith(path)) as captured:
            page.locator('#submit-answer').click()
        expect(page.locator('#feedback')).to_contain_text('ถูกต้อง')
        expect(page.locator('#submit-answer')).to_be_disabled()
        return captured.value.post_data_json

    def test_default_configuration_blocks_signup_and_shows_no_fake_online_data(self):
        page = self.page(configured=False)
        page.locator('#connect').click()
        expect(page.locator('#feedback')).to_contain_text('ยังไม่ได้ตั้งค่า')
        expect(page.locator('#create-submit')).to_be_disabled()
        self.assertIsNone(page.evaluate("localStorage.getItem('offline-fixture-signups')"))
        for width in [360, 390, 740, 1280]:
            page.set_viewport_size({'width': width, 'height': 850})
            self.assertFalse(page.evaluate('document.documentElement.scrollWidth>innerWidth'))

    def test_mock_http_two_sessions_complete_shared_match_and_reject_tampering(self):
        host, peer = self.pair('final', count='10')
        expect(host.locator('#ranking-status')).to_contain_text('ซ่อนอันดับ')
        first = self.solve(host)
        identity = self.identity(host)
        repeated = host.request.post(self.api+'/answer/'+self.room_id(host), headers={'authorization':'Bearer '+identity['access_token']}, data=first)
        self.assertEqual(repeated.status, 200)
        self.assertEqual(repeated.json()['snapshot']['me']['score'], 20)
        forged = host.request.post(self.api+'/answer/'+self.room_id(host), headers={'authorization':'Bearer '+identity['access_token']}, data={**first, 'requestId':str(uuid.uuid4()), 'score':999999})
        self.assertEqual(forged.status, 409)
        foreign = host.request.get(self.api+'/snapshot/'+self.room_id(host), headers={'authorization':'Bearer offline:'+str(uuid.uuid4())})
        self.assertEqual(foreign.status, 403)
        illegal_start = peer.request.post(self.api+'/start/'+self.room_id(peer), headers={'authorization':'Bearer '+self.identity(peer)['access_token']}, data={'requestId':str(uuid.uuid4())})
        self.assertEqual(illegal_start.status, 403)
        self.solve(peer)
        for _ in range(9):
            for page in (host, peer):
                page.locator('#next-button').click()
                expect(page.locator('#skip-dialog')).not_to_be_visible()
                expect(page.locator('#submit-answer')).to_be_enabled()
                self.solve(page)
        for page in (host, peer):
            expect(page.locator('#match-title')).to_have_text('จบการแข่งขัน')
            expect(page.locator('#score')).to_have_text('200')
            expect(page.locator('#rankings li')).to_have_count(2)
            self.assertEqual(page.locator('#rankings img').count(), 0)
        self.assertIn('<img src=x>เพื่อน', host.locator('#rankings').inner_text())

    def test_mock_cancel_skip_mobile_layout_and_disconnect_recovery(self):
        host, peer = self.pair()
        directory = Path('/tmp/math24-online-screens'); directory.mkdir(exist_ok=True)
        for width in [360, 390, 740, 1280]:
            host.set_viewport_size({'width': width, 'height': 850})
            self.assertFalse(host.evaluate('document.documentElement.scrollWidth>innerWidth'))
            self.assertEqual(host.locator('#numbers span').count(), 4)
            self.assertTrue(host.locator('#keypad').evaluate('e=>[...e.children].every(b=>{const r=b.getBoundingClientRect();return r.width>=44&&r.height>=44})'))
            host.screenshot(path=str(directory/f'online-{width}.png'), full_page=True)
        host.set_viewport_size({'width': 360, 'height': 850})
        host.get_by_role('button', name='(−', exact=True).click()
        host.get_by_role('button', name='3', exact=True).click()
        expect(host.locator('#answer')).to_have_value('(-3)')
        host.get_by_role('button', name='C', exact=True).click()
        host.locator('#answer').fill('1+')
        cards = host.locator('#numbers').inner_text()
        host.locator('#next-button').click()
        self.assertTrue(host.locator('#skip-dialog').evaluate('e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth}'))
        host.screenshot(path=str(directory/'dialog-360.png'), full_page=True)
        host.locator('#skip-cancel').click()
        expect(host.locator('#answer')).to_have_value('1+')
        self.assertEqual(host.locator('#numbers').inner_text(), cards)
        expect(host.locator('#score')).to_have_text('0')
        host.locator('#next-button').click()
        host.locator('#skip-confirm').click()
        expect(host.locator('#progress')).to_contain_text('ข้าม 1')
        self.solve(host)
        expect(host.locator('#score')).to_have_text('20')
        host.locator('#next-button').click()
        expect(host.locator('#submit-answer')).to_be_enabled()
        host.locator('#next-button').click(); host.locator('#skip-confirm').click()
        expect(host.locator('#progress')).to_contain_text('ข้าม 2')
        expect(host.locator('#score')).to_have_text('20')
        before = self.identity(peer)['user']['id']
        peer.context.set_offline(True)
        expect(peer.locator('#submit-answer')).to_be_disabled()
        peer.context.set_offline(False)
        peer.evaluate("window.dispatchEvent(new Event('online'))")
        expect(peer.locator('#submit-answer')).to_be_enabled()
        peer.reload(); peer.locator('#connect').click()
        expect(peer.locator('#match-panel')).to_be_visible()
        self.assertEqual(self.identity(peer)['user']['id'], before)
        self.assertEqual(peer.evaluate("localStorage.getItem('offline-fixture-signups')"), '1')
        peer.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));")
        expect(peer.locator('#submit-answer')).to_be_enabled()
        host.locator('#leave-button').click();host.locator('#leave-confirm').click()
        expect(host.locator('#room-panel')).not_to_be_visible()
        expect(peer.locator('#feedback')).to_contain_text('ห้องปิดแล้ว')
        expect(peer.locator('#room-panel')).not_to_be_visible()

    def test_mock_room_full_error_does_not_enter_or_expose_roster(self):
        host, peer = self.page(), self.page()
        code = self.create(host)
        self.control('full', room=self.room_id(host))
        peer.locator('#nickname').fill('คนที่ 51'); peer.locator('#room-code').fill(code)
        peer.locator('#join-submit').click()
        expect(peer.locator('#feedback')).to_contain_text('เข้าห้องไม่ได้')
        expect(peer.locator('#room-panel')).not_to_be_visible()
        self.assertEqual(peer.locator('#players li').count(), 0)

    def test_mock_rate_limit_is_reported_without_creating_a_room(self):
        page = self.page()
        self.control('rate', deny='1')
        page.locator('#room-name').fill('Rate limit fixture')
        page.locator('#create-submit').click()
        expect(page.locator('#feedback')).to_contain_text('ทำรายการถี่เกินไป')
        expect(page.locator('#room-panel')).not_to_be_visible()
        self.assertIsNone(self.room_id(page))

    def test_vendored_sdk_loads_and_initializes_without_cdn_or_auth_signup(self):
        page = self.page(configured=False)
        result = page.evaluate("""async()=>{
          const {createClient}=await import('./vendor/supabase.mjs');
          const client=createClient('http://127.0.0.1:1','sb_publishable_offline_fixture',
            {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
          const result=await client.auth.getSession();
          await client.auth.stopAutoRefresh();
          return {factory:typeof createClient,session:result.data.session,signup:typeof client.auth.signInAnonymously};
        }""")
        self.assertEqual(result, {'factory':'function','session':None,'signup':'function'})

    def test_lost_fixture_session_requires_explicit_new_identity(self):
        page = self.page()
        first_id = self.identity(page)['user']['id']
        page.evaluate("localStorage.removeItem('offline-fixture-session')")
        page.reload(); page.locator('#connect').click()
        expect(page.locator('#feedback')).to_contain_text('เซสชันหมดอายุ')
        self.assertEqual(page.evaluate("localStorage.getItem('offline-fixture-signups')"), '1')
        page.locator('#new-session').click()
        expect(page.locator('#create-submit')).to_be_enabled()
        self.assertNotEqual(self.identity(page)['user']['id'], first_id)
        self.assertEqual(page.evaluate("localStorage.getItem('offline-fixture-signups')"), '2')

    def test_mock_server_expiry_finishes_without_client_finish_command(self):
        host, peer = self.pair('final')
        self.control('expire')
        for page in (host, peer):
            page.evaluate("window.dispatchEvent(new Event('online'))")
            expect(page.locator('#match-title')).to_have_text('จบการแข่งขัน')
            expect(page.locator('#timer')).to_have_text('00:00')
            expect(page.locator('#rankings li')).to_have_count(2)
            expect(page.locator('#next-button')).not_to_be_visible()


if __name__ == '__main__':
    unittest.main()
