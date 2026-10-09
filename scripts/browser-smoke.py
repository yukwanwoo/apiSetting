import json
from pathlib import Path
import os, socket, subprocess, tempfile, time, urllib.request, shutil
from playwright.sync_api import sync_playwright

def smoke(base, data_dir, artifacts):
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
  errors=[]
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(base)
  key=json.loads(Path(data_dir, 'keys.json').read_text())['admin']
  page.locator('#admin-key').fill(key)
  page.locator('#login-form button').click()
  page.locator('#app').wait_for(state='visible')
  page.wait_for_function("() => document.getElementById('server-status').textContent === '실시간 연결됨'")
  assert page.locator('#balance').inner_text()=='30,000,000'
  page.frame_locator('#preview').locator('#wheel').wait_for()
  page.screenshot(path=str(Path(artifacts, 'studio-desktop.png')),full_page=True)
  page.locator('[data-tab=settings]').click()
  page.locator('#roulette-amount').fill('3300')
  page.locator('#roulette-duration').fill('0.6')
  page.locator('#roulette-hold').fill('3')
  while page.locator('.remove-prize').count()>1: page.locator('.remove-prize').last.click()
  page.locator('#prize-rows input').nth(0).fill('1000000')
  page.locator('#prize-rows input').nth(1).fill('99.9')
  page.locator('#save-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('100%')")
  page.locator('#prize-rows input').nth(1).fill('100')
  page.locator('#save-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent === '룰렛 설정을 저장했습니다.'")
  assert page.locator('#allow-negative').is_checked()
  assert page.locator('#initial-balance').input_value()=='30000000'
  page.screenshot(path=str(Path(artifacts, 'settings-desktop.png')),full_page=True)
  page.locator('[data-tab=studio]').click()
  page.locator('#test-provider').select_option('soop')
  page.locator('#test-unit').select_option('STAR')
  page.locator('#test-amount').fill('33')
  page.locator('#test-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '31,000,000'")
  assert '테스트' in page.locator('#history').inner_text()
  assert '+1,000,000' in page.frame_locator('#preview').locator('#result-amount').inner_text()
  meso=browser.new_page(viewport={'width':640,'height':220})
  meso.goto(page.locator('#meso-url').input_value())
  meso.wait_for_function("() => document.getElementById('meso-balance').textContent.includes('31,000,000')")
  meso.screenshot(path=str(Path(artifacts, 'meso-overlay.png')),omit_background=True)
  page.screenshot(path=str(Path(artifacts, 'spin-desktop.png')),full_page=True)
  page.wait_for_function("() => document.getElementById('spin-status').textContent === 'STANDBY'")
  page.locator('[data-tab=settings]').click()
  page.locator('#roulette-select').select_option('defense')
  page.locator('#roulette-amount').fill('2200')
  page.locator('#roulette-duration').fill('0.1')
  page.locator('#roulette-hold').fill('1')
  while page.locator('.remove-prize').count()>1: page.locator('.remove-prize').last.click()
  page.locator('#prize-rows input').nth(0).fill('10000000')
  page.locator('#prize-rows input').nth(1).fill('100')
  page.locator('#save-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent === '룰렛 설정을 저장했습니다.'")
  page.locator('#balance-input').fill('0')
  page.locator('#balance-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '0'")
  page.locator('[data-tab=studio]').click()
  page.locator('#test-amount').fill('22')
  page.locator('#test-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '-10,000,000'")
  meso.wait_for_function("() => document.getElementById('meso-balance').textContent.includes('-10,000,000')")
  page.wait_for_function("() => document.getElementById('spin-status').textContent === 'STANDBY'")
  page.reload()
  page.locator('#app').wait_for(state='visible')
  assert page.locator('#balance').inner_text()=='-10,000,000'
  page.locator('[data-tab=settings]').click()
  page.locator('#reset-balance').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '30,000,000'")
  page.locator('[data-tab=connections]').click()
  page.locator('#source-youtube').fill('https://www.youtube.com/watch?v=abcdefghijk')
  page.locator('#source-form button').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('방송 URL을 저장')")
  assert '연결 필요' in page.locator('#provider-cards').inner_text()
  assert page.locator('#chzzk-connect').is_disabled()
  assert page.locator('#chzzk-url-connect').is_disabled()
  assert page.locator('#youtube-connect').is_disabled()
  page.locator('#toonation-widget-url').fill('https://toon.at/donate/abcdefghijk')
  page.locator('#toonation-widget-form button').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('알림 위젯 URL')")
  page.locator('#toonation-widget-url').fill('')
  assert '연결 필요' in page.locator('#provider-cards').inner_text()
  page.locator('#operator-settings summary').click()
  page.locator('#chzzk-client-id').fill('browser-fixture-client-id')
  page.locator('#chzzk-client-secret').fill('browser-fixture-secret')
  page.locator('#chzzk-app-form button').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('치지직 앱 설정을 저장')")
  assert page.locator('#chzzk-client-secret').input_value() == ''
  assert page.locator('#chzzk-connect').is_enabled()
  assert '/oauth/chzzk/callback' in page.locator('#chzzk-redirect').input_value()
  page.locator('#operator-settings summary').click()
  # Screenshots must not expose read-only overlay keys.
  page.locator('#roulette-url').evaluate("el=>el.value='OBS에서 사용할 읽기 전용 주소'")
  page.locator('#meso-url').evaluate("el=>el.value='OBS에서 사용할 읽기 전용 주소'")
  page.screenshot(path=str(Path(artifacts, 'connections-desktop.png')),full_page=True)
  page.locator('[data-tab=studio]').click()
  page.set_viewport_size({'width':390,'height':844})
  page.screenshot(path=str(Path(artifacts, 'studio-mobile.png')),full_page=True)
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
  assert not errors, errors
  print('Browser smoke passed: login, preview, probabilities, custom amount, SOOP conversion, attack, defense, negative balance, persistence, initial reset, URL settings, OBS balance, mobile layout; no JS exceptions.')
  browser.close()

if __name__ == '__main__':
 root=Path(__file__).resolve().parents[1]
 artifacts=os.environ.get('MESO_SCREENSHOTS_DIR') or tempfile.mkdtemp(prefix='meso-screenshots-')
 Path(artifacts).mkdir(parents=True,exist_ok=True)
 with socket.socket() as probe:
  probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
 with tempfile.TemporaryDirectory(prefix='meso-ui-') as data_dir:
  runtime={k:v for k,v in os.environ.items() if not k.startswith(('YOUTUBE_', 'CHZZK_')) and k not in ['PUBLIC_BASE_URL','ADMIN_TOKEN','OVERLAY_TOKEN','WEBHOOK_SECRET']}
  runtime.update(HOST='127.0.0.1',PORT=str(port),DATA_DIR=data_dir)
  server=subprocess.Popen(['node','src/server.js'],cwd=root,env=runtime,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  base=f'http://127.0.0.1:{port}'
  try:
   for attempt in range(50):
    try:
     with urllib.request.urlopen(base+'/api/health',timeout=1) as response: assert response.status==200
     break
    except Exception:
     if server.poll() is not None: raise RuntimeError('Test server failed to start.')
     time.sleep(.1)
   else: raise RuntimeError('Test server readiness timeout.')
   smoke(base,data_dir,artifacts)
   print('Screenshots:',artifacts)
  finally:
   server.terminate()
   try: server.wait(timeout=5)
   except subprocess.TimeoutExpired: server.kill(); server.wait()
