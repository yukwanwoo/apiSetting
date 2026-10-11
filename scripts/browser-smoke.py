import json, wave, math, struct
from pathlib import Path
import os, socket, subprocess, tempfile, time, urllib.request, shutil
from playwright.sync_api import sync_playwright

def smoke(base, data_dir, artifacts):
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome'), headless=True, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
  page=browser.new_page(viewport={'width':1440,'height':1100},device_scale_factor=1)
  errors=[]
  browser_play = """(() => {
    window.audioPlays=[];
    const original=HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play=function(){
      window.audioPlays.push({volume:this.volume,src:this.src,start:this.currentTime}); window.lastAudio=this;
      return original.call(this);
    };
  })();"""
  page.add_init_script(browser_play)
  page.on('pageerror', lambda e: errors.append(str(e)))
  page.goto(base)
  key=json.loads(Path(data_dir, 'keys.json').read_text())['admin']
  launch_context=browser.new_context()
  launch_page=launch_context.new_page()
  launch_page.goto(base+'/#admin='+key)
  launch_page.locator('#app').wait_for(state='visible')
  assert launch_page.evaluate('location.hash')==''
  assert launch_page.evaluate("sessionStorage.getItem('meso-admin')")==key
  launch_context.close()
  page.locator('#admin-key').fill(key)
  page.locator('#login-form button').click()
  page.locator('#app').wait_for(state='visible')
  page.wait_for_function("() => document.getElementById('server-status').textContent === '실시간 연결됨'")
  assert page.locator('#balance').inner_text()=='30,000,000'
  obs_context=browser.new_context()
  obs_context.add_init_script(browser_play)
  obs=obs_context.new_page()
  obs.on('pageerror',lambda e: errors.append(str(e)))
  obs.goto(page.locator('#roulette-url').input_value())
  assert obs.locator('.roulette-overlay').is_hidden()
  page.frame_locator('#preview').locator('#wheel').wait_for()
  assert page.locator('#tab-studio #comment-donor').count()==1
  assert page.locator('#tab-studio #overlay-scale').count()==1
  assert page.locator('#tab-studio #balance-form').count()==1
  preview_frame=page.frame_locator('#preview')
  baseline=preview_frame.locator('.wheel-wrap').bounding_box()['width']
  donor_font=preview_frame.locator('#overlay-donor').evaluate('el=>getComputedStyle(el).fontSize')
  result_font=preview_frame.locator('#result-amount').evaluate('el=>getComputedStyle(el).fontSize')
  page.locator('#overlay-scale').fill('50')
  page.locator('#comment-donor').fill('{nickname} 즉시 미리보기 · {roulette}')
  preview_frame.locator('#overlay-donor').get_by_text('행운의 시청자 즉시 미리보기 · 공격 룰렛',exact=True).wait_for()
  assert abs(preview_frame.locator('.wheel-wrap').bounding_box()['width']/baseline-.5)<.02
  assert preview_frame.locator('#overlay-donor').evaluate('el=>getComputedStyle(el).fontSize')==donor_font
  assert preview_frame.locator('#result-amount').evaluate('el=>getComputedStyle(el).fontSize')==result_font
  assert json.loads(Path(data_dir,'state.json').read_text())['config']['overlay']['scalePercent']==100
  assert obs.locator('.wheel-wrap').evaluate("el=>el.style.getPropertyValue('--wheel-scale')")=='1'
  page.locator('#appearance-select').select_option('defense')
  preview_frame.locator('#overlay-donor').get_by_text('행운의 시청자님의 방어 룰렛',exact=True).wait_for()
  page.locator('#appearance-select').select_option('attack')
  page.locator('#preview').evaluate('el=>el.contentWindow.location.reload()')
  preview_frame.locator('#overlay-donor').get_by_text('행운의 시청자 즉시 미리보기 · 공격 룰렛',exact=True).wait_for()

  page.screenshot(path=str(Path(artifacts, 'studio-desktop.png')),full_page=True)
  page.locator('[data-tab=settings]').click()
  assert page.locator('#sound-end').input_value()=='2.5'
  audio_path=Path(artifacts,'five-seconds.wav')
  with wave.open(str(audio_path),'wb') as wav:
   wav.setparams((1,2,24000,0,'NONE','not compressed'))
   wav.writeframes(b''.join(struct.pack('<h',int(math.sin(i/24000*2*math.pi*440)*5000)) for i in range(24000*5)))
  page.locator('#sound-upload').set_input_files(str(audio_path))
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('음성 파일을 추가했습니다')")
  uploaded_id=page.locator('#sound-source').input_value()
  assert uploaded_id not in ['default','chime','bell']
  assert page.locator('#sound-start').input_value()=='0'
  assert page.locator('#sound-end').input_value()=='2.5'
  page.locator('#test-sound').click()
  page.wait_for_function('() => audioPlays.length>=1 && window.lastAudio.duration>4.9')
  page.wait_for_function('() => window.lastAudio.paused')
  assert 2.3 <= page.evaluate('window.lastAudio.currentTime') <= 2.75
  page.locator('#sound-auto-end').uncheck()
  page.locator('#sound-start').fill('1')
  page.locator('#sound-end').fill('1.5')
  page.locator('#test-sound').click()
  page.wait_for_function('() => audioPlays.length>=2')
  assert page.evaluate('audioPlays.at(-1).start')==1
  page.wait_for_function('() => window.lastAudio.paused')
  assert 1.35 <= page.evaluate('window.lastAudio.currentTime') <= 1.75
  page.locator('#sound-source').select_option('chime')
  assert page.locator('#sound-auto-end').is_checked()
  assert page.locator('#sound-start').input_value()=='0'
  page.locator('#test-sound').click()
  page.wait_for_function("() => audioPlays.at(-1).src.endsWith('/chime.wav')")
  page.locator('#stop-sound').click()
  assert page.evaluate('window.lastAudio.paused')
  page.locator('#sound-source').select_option(uploaded_id)
  page.locator('#sound-auto-end').uncheck()
  page.locator('#sound-start').fill('1')
  page.locator('#sound-end').fill('1.5')
  page.locator('[data-tab=studio]').click()
  page.locator('#overlay-scale').fill('50')
  page.locator('#comment-donor').fill('{nickname} 등장! {roulette}')
  page.locator('#comment-donation').fill('{platform} {amount}원{stars}')
  page.locator('[data-tab=settings]').click()
  page.locator('#roulette-amount').fill('3300')
  page.locator('#roulette-duration').fill('0.6')
  page.locator('#roulette-hold').fill('3')
  page.locator('#sound-volume').evaluate("el=>{el.value='35';el.dispatchEvent(new Event('input',{bubbles:true}));}")
  assert page.locator('#sound-volume-label').inner_text()=='35%'
  page.locator('#test-sound').click()
  page.wait_for_function('() => audioPlays.at(-1).volume===0.35')
  assert page.evaluate('audioPlays.at(-1).volume')==0.35
  while page.locator('.remove-prize').count()>1: page.locator('.remove-prize').last.click()
  page.locator('#prize-rows input').nth(0).fill('1000000')
  page.locator('#prize-rows input').nth(1).fill('99.9')
  page.locator('#save-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('100%')")
  page.locator('#prize-rows input').nth(1).fill('100')
  page.locator('[data-tab=studio]').click()
  page.locator('#save-studio-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent === '룰렛 설정을 저장했습니다.'")
  assert page.locator('#allow-negative').is_checked()
  assert page.locator('#initial-balance').input_value()=='30000000'
  page.screenshot(path=str(Path(artifacts, 'settings-desktop.png')),full_page=True)
  page.locator('[data-tab=studio]').click()
  page.locator('#test-provider').select_option('soop')
  page.locator('#test-unit').select_option('STAR')
  page.locator('#test-amount').fill('33')
  page.locator('#test-form button').click()
  obs.locator('.roulette-overlay').wait_for(state='visible')
  obs.wait_for_function('() => audioPlays.length===1')
  assert obs.evaluate('audioPlays[0].volume')==0.35
  assert '/sounds/'+uploaded_id in obs.evaluate('audioPlays[0].src')
  assert obs.evaluate('audioPlays[0].start')==1, obs.evaluate('audioPlays')
  assert '행운의 시청자 등장! 공격 룰렛' in obs.locator('#overlay-donor').inner_text()
  assert 'SOOP 3,300원' in obs.locator('#overlay-donation').inner_text()
  assert obs.locator('.roulette-overlay').evaluate('el=>getComputedStyle(el).transform')=='none'
  assert abs(obs.locator('.wheel-wrap').bounding_box()['width']-220)<1
  assert obs.locator('#overlay-donor').evaluate('el=>getComputedStyle(el).fontSize')=='23px'
  assert obs.locator('#result-amount').evaluate('el=>getComputedStyle(el).fontSize')=='25px'
  obs.wait_for_function('() => window.lastAudio.paused')
  assert 1.3 <= obs.evaluate('window.lastAudio.currentTime') <= 1.8
  page.wait_for_function("() => document.getElementById('balance').textContent === '31,000,000'")
  assert '테스트' in page.locator('#history').inner_text()
  assert '+1,000,000' in page.frame_locator('#preview').locator('#result-amount').inner_text()
  meso=browser.new_page(viewport={'width':640,'height':220})
  meso.goto(page.locator('#meso-url').input_value())
  meso.wait_for_function("() => document.getElementById('meso-balance').textContent.includes('31,000,000')")
  meso.screenshot(path=str(Path(artifacts, 'meso-overlay.png')),omit_background=True)
  page.screenshot(path=str(Path(artifacts, 'spin-desktop.png')),full_page=True)
  page.wait_for_function("() => document.getElementById('spin-status').textContent === 'STANDBY'")
  obs.locator('.roulette-overlay').wait_for(state='hidden')
  assert obs.evaluate('audioPlays.length')==1
  assert page.frame_locator('#preview').locator('.roulette-overlay').is_visible()
  assert page.frame_locator('#preview').locator('body').evaluate('()=>audioPlays.length')==0
  assert meso.locator('.meso-overlay').is_visible()
  page.locator('#adjust-amount').fill('500')
  page.locator('#adjust-note').fill('수동 추가 확인')
  page.locator('#adjust-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '31,000,500'")
  meso.wait_for_function("() => document.getElementById('meso-change').textContent.includes('수동 추가 확인')")
  page.locator('#adjust-direction').select_option('subtract')
  page.locator('#adjust-amount').fill('500')
  page.locator('#adjust-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '31,000,000'")
  assert '수동 메소 감소' in page.locator('#history').inner_text()
  page.locator('#initial-balance').fill('30000001')
  with page.expect_response(lambda r:r.url.endswith('/api/config') and r.request.method=='POST') as saved_balance:
   page.locator('#save-balance-config').click()
  assert saved_balance.value.json()['config']['initialBalance']==30000001
  assert page.locator('#balance').inner_text()=='31,000,000'
  page.locator('#initial-balance').fill('30000000')
  with page.expect_response(lambda r:r.url.endswith('/api/config') and r.request.method=='POST'):
   page.locator('#save-balance-config').click()
  page.locator('[data-tab=settings]').click()
  page.locator('#roulette-select').select_option('defense')
  page.locator('#roulette-amount').fill('2200')
  page.locator('#roulette-duration').fill('0.1')
  page.locator('#roulette-hold').fill('1')
  page.locator('#sound-volume').evaluate("el=>{el.value='0';el.dispatchEvent(new Event('input',{bubbles:true}));}")
  while page.locator('.remove-prize').count()>1: page.locator('.remove-prize').last.click()
  page.locator('#prize-rows input').nth(0).fill('10000000')
  page.locator('#prize-rows input').nth(1).fill('100')
  page.locator('#save-config').click()
  page.wait_for_function("() => document.getElementById('notice').textContent === '룰렛 설정을 저장했습니다.'")
  page.locator('[data-tab=studio]').click()
  page.locator('#balance-input').fill('0')
  page.locator('#balance-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '0'")
  page.locator('[data-tab=studio]').click()
  page.locator('#test-amount').fill('22')
  page.locator('#test-form button').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '-10,000,000'")
  assert obs.evaluate('audioPlays.length')==1
  meso.wait_for_function("() => document.getElementById('meso-balance').textContent.includes('-10,000,000')")
  page.wait_for_function("() => document.getElementById('spin-status').textContent === 'STANDBY'")
  page.reload()
  page.locator('#app').wait_for(state='visible')
  assert page.locator('#balance').inner_text()=='-10,000,000'
  page.locator('[data-tab=studio]').click()
  page.locator('#reset-balance').click()
  page.wait_for_function("() => document.getElementById('balance').textContent === '30,000,000'")
  page.locator('[data-tab=connections]').click()
  page.locator('#source-youtube').fill('https://www.youtube.com/live_chat?is_popout=1&v=9CAhQOG6fxM')
  page.locator('#source-form button').click()
  page.wait_for_function("() => document.getElementById('notice').textContent.includes('방송 URL을 저장')")
  assert '연결 필요' in page.locator('#provider-cards').inner_text()
  assert page.locator('#chzzk-connect').is_disabled()
  assert page.locator('#chzzk-url-connect').is_disabled()
  assert page.locator('#youtube-connect').is_disabled()
  assert page.locator('#youtube-url-connect').is_enabled()
  assert page.locator('#youtube-url-disconnect').is_disabled()
  assert '비공식 공개 채팅' in page.locator('#youtube-app-status').inner_text()
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
  page.locator('[data-tab=studio]').click()
  page.locator('#overlay-scale').fill('60')
  page.once('dialog',lambda d:d.dismiss())
  page.locator('#shutdown').click()
  assert page.locator('#app').is_visible()
  page.once('dialog',lambda d:d.accept())
  page.locator('#shutdown').click()
  page.wait_for_function("() => document.getElementById('server-status').textContent === '프로그램 종료됨'")
  saved=json.loads(Path(data_dir,'state.json').read_text())
  assert saved['config']['overlay']['scalePercent']==60
  assert saved['config']['roulettes'][0]['sound']['source']==uploaded_id
  assert saved['balance']==30000000
  assert not errors, errors
  print('Browser smoke passed: login, preview, probabilities, custom amount, SOOP conversion, attack, defense, negative balance, persistence, initial reset, URL settings, OBS balance, mobile layout, immediate unsaved preview, wheel-only scaling with unchanged text/result, studio appearance and balance controls, comment templates, audio upload/automatic trim/custom trim/chime, manual adjustments, cancel/confirm save-and-exit; no JS exceptions.')
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
