const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('ko-KR');
const names = { chzzk: '치지직', soop: 'SOOP', youtube: 'YouTube', toonation: '투네이션' };
const launchKey = new URLSearchParams(location.hash.slice(1)).get('admin');
if (launchKey && /^[a-f0-9]{64}$/.test(launchKey)) {
  sessionStorage.setItem('meso-admin', launchKey);
  history.replaceState(null, '', location.pathname + location.search);
}
let token = sessionStorage.getItem('meso-admin') || '', state, draft, currentId, dirty = false, streamController;
let noticeTimer, retryTimer, statusTimer, sourcesLoaded = false;
const newId = prefix => `${prefix}-${crypto.randomUUID()}`;
function notice(message, bad = false) { clearTimeout(noticeTimer); $('notice').textContent = message; $('notice').className = `notice${bad ? ' bad' : ''}`; $('notice').hidden = false; noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 8000); }
async function api(path, value) {
  const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '요청에 실패했습니다.'); return data;
}
function textCell(text, small) { const td = document.createElement('td'); td.textContent = text; if (small) { const el = document.createElement('small'); el.textContent = small; td.append(el); } return td; }
function empty(tbody, text) { const tr = document.createElement('tr'), td = textCell(text); td.colSpan = 3; td.className = 'empty'; tr.append(td); tbody.replaceChildren(tr); }
function renderState(next) {
  state = next; $('balance').textContent = fmt(state.balance); $('queue-count').replaceChildren(document.createTextNode(`${state.queue.length} `)); const small = document.createElement('small'); small.textContent = '건'; $('queue-count').append(small);
  $('active-summary').textContent = state.active ? `${state.active.donation.nickname}님의 ${state.active.roulette.name}` : '다음 후원을 기다리는 중';
  $('spin-status').textContent = state.active ? state.active.settled ? 'RESULT' : 'SPINNING' : 'STANDBY'; $('spin-status').className = `pill${state.active ? ' good' : ''}`;
  const last = state.history[0]; $('latest-result').textContent = last ? `${last.kind === 'defense' ? '−' : '+'}${fmt(last.meso)}` : '—'; $('latest-result').className = `latest ${last?.kind === 'defense' ? 'negative' : 'positive'}`;
  $('latest-donor').textContent = last ? `${last.nickname} · ${last.test ? '테스트 · ' : ''}${last.rouletteName}` : '행운은 어느 쪽으로?';
  const donations = $('donations'); donations.replaceChildren();
  for (const d of state.donations) { const tr = document.createElement('tr'); tr.append(textCell(d.nickname, `${names[d.provider]}${d.test ? ' · 테스트' : ''} · ${new Date(d.receivedAt).toLocaleTimeString('ko-KR')}`), textCell(`${fmt(d.amountKrw)}원`, d.unit === 'STAR' ? `별풍선 ${fmt(d.amount)}개` : ''), textCell(d.matched ? d.rouletteName : '금액 불일치')); donations.append(tr); }
  if (!state.donations.length) empty(donations, '아직 도착한 후원이 없습니다.');
  const history = $('history'); history.replaceChildren();
  for (const h of state.history) { const tr = document.createElement('tr'); const change = textCell(`${h.kind === 'defense' ? '−' : '+'}${fmt(h.meso)}`, `실제 ${h.actualDelta < 0 ? '−' : '+'}${fmt(Math.abs(h.actualDelta))} 메소`); change.className = h.kind === 'defense' ? 'negative' : 'positive'; tr.append(textCell(h.rouletteName, `${h.nickname}${h.test ? ' · 테스트' : ''}`), change, textCell(fmt(h.balance))); history.append(tr); }
  if (!state.history.length) empty(history, '첫 번째 룰렛을 기다리고 있습니다.');
  if (!draft || !dirty) { draft = structuredClone(state.config); if (!draft.roulettes.some(r => r.id === currentId)) currentId = draft.roulettes[0].id; renderEditor(); }
}
function roulette() { return draft.roulettes.find(r => r.id === currentId); }
function fillSelect() { $('roulette-select').replaceChildren(...draft.roulettes.map(r => { const option = document.createElement('option'); option.value = r.id; option.textContent = r.name + (r.enabled ? '' : ' · 비활성'); return option; })); $('roulette-select').value = currentId; }
function renderEditor() {
  const r = roulette(); fillSelect(); $('roulette-name').value = r.name; $('roulette-kind').value = r.kind; $('roulette-enabled').checked = r.enabled;
  $('roulette-unit').value = 'KRW'; $('roulette-amount').value = r.triggerKrw; $('roulette-duration').value = r.durationMs / 1000; $('roulette-hold').value = r.resultHoldMs / 1000;
  $('sound-volume').value = draft.sound.volume; $('sound-volume-label').textContent = `${draft.sound.volume}%`;
  $('allow-negative').checked = draft.allowNegative; $('initial-balance').value = draft.initialBalance; renderPrizes(); ruleConversion(); $('save-config').textContent = dirty ? '변경사항 저장' : '설정 저장';
}
function renderPrizes() {
  $('prize-rows').replaceChildren(...roulette().prizes.map(p => {
    const row = document.createElement('div'); row.className = 'prize-row';
    const amountLabel = document.createElement('label'); amountLabel.textContent = '메소'; const amount = document.createElement('input'); amount.type = 'number'; amount.min = '0'; amount.max = '10000000'; amount.step = '1'; amount.value = p.meso; amount.required = true; amountLabel.append(amount);
    const weightLabel = document.createElement('label'); weightLabel.textContent = '확률 (%)'; const weight = document.createElement('input'); weight.type = 'number'; weight.min = '0'; weight.max = '100'; weight.step = '0.1'; weight.value = p.weight / 10; weight.required = true; weightLabel.append(weight);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'remove-prize'; remove.textContent = '×'; remove.setAttribute('aria-label', `${fmt(p.meso)} 메소 항목 삭제`);
    amount.addEventListener('input', () => { p.meso = amount.value === '' ? NaN : Number(amount.value); markDirty(); });
    weight.addEventListener('input', () => { const value = Number(weight.value) * 10; p.weight = weight.value !== '' && Math.abs(value - Math.round(value)) < 0.000001 ? Math.round(value) : NaN; markDirty(); probability(); });
    remove.addEventListener('click', () => { if (roulette().prizes.length === 1) return notice('결과 항목은 최소 한 개 필요합니다.', true); roulette().prizes = roulette().prizes.filter(prize => prize.id !== p.id); markDirty(); renderPrizes(); });
    row.append(amountLabel, weightLabel, remove); return row;
  })); probability();
}
function probability() { const total = roulette().prizes.reduce((sum, p) => sum + p.weight, 0); $('probability-total').textContent = Number.isFinite(total) ? `합계 ${(total / 10).toFixed(1)}%` : '0.1% 단위로 입력하세요'; $('probability-total').className = `pill ${total === 1000 ? 'good' : 'bad'}`; }
function markDirty() { dirty = true; $('save-config').textContent = '변경사항 저장'; }
function ruleConversion() { const amount = Number($('roulette-amount').value), krw = amount * ($('roulette-unit').value === 'STAR' ? 100 : 1); roulette().triggerKrw = krw; $('rule-conversion').textContent = `${fmt(krw)}원 = 별풍선 ${fmt(krw / 100)}개 · 정확히 이 금액만 1회 실행`; }
function tab(name) { document.querySelectorAll('.tab-section').forEach(el => { el.hidden = el.id !== `tab-${name}`; }); document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === name)); const titles = { studio: ['라이브 스튜디오', '후원의 순간을 메소로 연결하세요.'], settings: ['룰렛 설정', '확률부터 후원 조건까지, 방송에 맞게 설계하세요.'], connections: ['연결 & OBS', '후원을 연결하고, 방송 화면에 행운을 띄우세요.'] }; $('page-title').textContent = titles[name][0]; $('page-subtitle').textContent = titles[name][1]; }
async function connections() {
  const info = await api('/api/connection');
  if (!sourcesLoaded) { for (const [provider, source] of Object.entries(info.sources)) $(`source-${provider}`).value = source; sourcesLoaded = true; }
  $('youtube-redirect').value = info.youtube.redirectUri;
  $('youtube-app-status').textContent = `OAuth 앱: ${info.youtube.appConfigured ? '설정됨' : '미설정'} · 계정 인증: ${info.youtube.authConfigured ? '설정됨' : '미설정'}`;
  $('youtube-connect').disabled = !info.youtube.appConfigured;
  $('chzzk-connect').disabled = !info.chzzk.appConfigured; $('chzzk-url-connect').disabled = !info.sources.chzzk;
  $('chzzk-redirect').value = info.chzzk.redirectUri;
  $('chzzk-app-status').textContent = `개발자 앱: ${info.chzzk.appConfigured ? '설정됨' : '운영자 설정 필요'} · 계정: ${info.chzzk.authConfigured ? '인증됨' : '연결 필요'}`;
  $('soop-connect').disabled = !info.sources.soop; $('soop-disconnect').disabled = !info.soop.enabled;
  $('toonation-widget-status').textContent = info.toonation.widgetConfigured ? '위젯 URL이 안전하게 저장되어 있습니다. 수신 상태를 확인하세요.' : '알림 위젯 URL을 입력하세요.';
  const rouletteUrl = new URL('/overlay.html', location.origin); rouletteUrl.searchParams.set('token', info.overlayToken);
  const mesoUrl = new URL('/meso.html', location.origin); mesoUrl.searchParams.set('token', info.overlayToken);
  $('roulette-url').value = rouletteUrl.href; $('meso-url').value = mesoUrl.href;
  const previewUrl = new URL(rouletteUrl); previewUrl.searchParams.set('preview', '1');
  if (!$('preview').src || new URL($('preview').src).href !== previewUrl.href) $('preview').src = previewUrl.href;
  $('provider-cards').replaceChildren(...info.providers.map(provider => {
    const card = document.createElement('div'); card.className = 'provider-card'; const icon = document.createElement('div'); icon.className = 'provider-icon'; icon.textContent = names[provider.provider].slice(0, 1);
    const title = document.createElement('h3'); title.textContent = names[provider.provider]; const badge = document.createElement('span'); badge.className = `pill ${['connected', 'listening'].includes(provider.state) ? 'good' : provider.state === 'error' ? 'bad' : ''}`;
    badge.textContent = ({ connected: '후원 수신 확인', listening: '수신 대기', connecting: '연결 중', reconnecting: '재연결 중', auth_required: '권한 필요', not_configured: '연결 필요', error: '연결 오류', offline: '방송 종료' })[provider.state] || '대기';
    const detail = document.createElement('p'); detail.textContent = provider.detail + (provider.skippedCurrency ? ` · 외화 후원 ${provider.skippedCurrency}건 제외` : ''); card.append(icon, title, badge, detail); if (provider.diagnostics) {
      const d = provider.diagnostics, stats = document.createElement('p'); stats.className = 'helper';
      stats.textContent = `수신 진단 · 패킷 ${d.packets} · 채팅 ${d.chatMessages} · 별풍선 패킷 ${d.donationPackets} · 처리 ${provider.received} · 해석 오류 ${d.protocolErrors} · 호환 처리 ${d.fallbackDonations}`;
      if (d.lastProtocolError) stats.textContent += ` · 최근 오류 코드 ${d.lastProtocolError.opcode || '프레임'}, 필드 ${d.lastProtocolError.fieldCount ?? '알 수 없음'}`;
      card.append(stats);
      const copy = document.createElement('button'); copy.className = 'text-button'; copy.textContent = 'SOOP 진단 복사';
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(JSON.stringify({ provider: 'soop', state: provider.state, received: provider.received, diagnostics: d }, null, 2)); notice('SOOP 진단을 복사했습니다. 키·채팅 내용·후원자 닉네임은 포함하지 않습니다.'); } catch { notice('진단을 복사할 수 없습니다. 화면의 진단 숫자를 알려주세요.', true); } }); card.append(copy);
    }
    if (provider.configured) { const retry = document.createElement('button'); retry.className = 'text-button'; retry.textContent = '다시 연결'; retry.addEventListener('click', async () => { try { await api('/api/provider/reconnect', { provider: provider.provider }); await connections(); } catch (error) { notice(error.message, true); } }); card.append(retry); } return card;
  }));
}
async function stream() {
  streamController?.abort(); streamController = new AbortController();
  try {
    const response = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal: streamController.signal });
    if (!response.ok) throw new Error('stream failed');
    $('server-status').textContent = '실시간 연결됨'; const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (true) { const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); let edge;
      while ((edge = buffer.indexOf('\n\n')) !== -1) { const block = buffer.slice(0, edge); buffer = buffer.slice(edge + 2); const data = block.split('\n').find(line => line.startsWith('data: ')); if (data) renderState(JSON.parse(data.slice(6))); }
    }
  } catch (error) { if (error.name === 'AbortError') return; }
  $('server-status').textContent = '재연결 중…'; retryTimer = setTimeout(stream, 2500);
}
async function login() {
  renderState(await api('/api/state')); sessionStorage.setItem('meso-admin', token); $('login').hidden = true; $('app').hidden = false; await connections(); if (new URLSearchParams(location.search).has('connected') || new URLSearchParams(location.search).has('youtube')) { tab('connections'); notice('계정 인증을 저장했습니다. 플랫폼의 실제 수신 상태를 확인하세요.'); history.replaceState(null, '', '/'); } void stream(); clearInterval(statusTimer); statusTimer = setInterval(() => { connections().catch(() => {}); }, 15_000);
}
$('login-form').addEventListener('submit', async event => { event.preventDefault(); token = $('admin-key').value.trim(); try { await login(); $('admin-key').value = ''; } catch (error) { $('login-error').textContent = error.message; } });
$('logout').addEventListener('click', () => { token = ''; sessionStorage.removeItem('meso-admin'); streamController?.abort(); clearTimeout(retryTimer); clearInterval(statusTimer); location.reload(); });
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => tab(button.dataset.go)));
$('test-provider').addEventListener('change', () => { $('test-unit').options[1].disabled = $('test-provider').value !== 'soop'; if ($('test-provider').value !== 'soop') $('test-unit').value = 'KRW'; testConversion(); });
function testConversion() { const amount = Number($('test-amount').value) * ($('test-unit').value === 'STAR' ? 100 : 1); $('test-conversion').textContent = `${fmt(amount)}원 · 조건 금액과 정확히 일치할 때 1회 실행`; }
$('test-amount').addEventListener('input', testConversion); $('test-unit').addEventListener('change', testConversion);
$('test-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const result = await api('/api/test-donation', { provider: $('test-provider').value, nickname: $('test-nickname').value, amount: Number($('test-amount').value), unit: $('test-unit').value }); notice(result.matched ? '테스트 후원을 접수했습니다. 룰렛이 순서대로 실행됩니다.' : '후원을 수신했지만 정확히 일치하는 활성 룰렛이 없습니다.'); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } });
$('roulette-select').addEventListener('change', () => { currentId = $('roulette-select').value; renderEditor(); });
$('roulette-name').addEventListener('input', () => { roulette().name = $('roulette-name').value; markDirty(); });
$('roulette-kind').addEventListener('change', () => { roulette().kind = $('roulette-kind').value; markDirty(); });
$('roulette-enabled').addEventListener('change', () => { roulette().enabled = $('roulette-enabled').checked; markDirty(); });
$('roulette-amount').addEventListener('input', () => { ruleConversion(); markDirty(); });
$('roulette-unit').addEventListener('change', () => { const amount = roulette().triggerKrw; $('roulette-amount').value = amount / ($('roulette-unit').value === 'STAR' ? 100 : 1); ruleConversion(); });
$('roulette-duration').addEventListener('input', () => { roulette().durationMs = Math.round(Number($('roulette-duration').value) * 1000); markDirty(); });
$('roulette-hold').addEventListener('input', () => { roulette().resultHoldMs = Math.round(Number($('roulette-hold').value) * 1000); markDirty(); });
const soundPreview = new Audio('/alert.wav');
$('sound-volume').addEventListener('input', () => { draft.sound.volume = Number($('sound-volume').value); $('sound-volume-label').textContent = `${draft.sound.volume}%`; markDirty(); });
$('test-sound').addEventListener('click', () => { soundPreview.volume = draft.sound.volume / 100; soundPreview.currentTime = 0; soundPreview.play().catch(() => notice('알림음을 재생할 수 없습니다. 브라우저 소리 설정을 확인하세요.', true)); });
$('initial-balance').addEventListener('input', () => { draft.initialBalance = Number($('initial-balance').value); markDirty(); });
$('reset-balance').addEventListener('click', async () => { try { renderState(await api('/api/balance', { balance: state.config.initialBalance })); notice('저장된 시작 메소로 초기화했습니다.'); } catch (error) { notice(error.message, true); } });
$('allow-negative').addEventListener('change', () => { draft.allowNegative = $('allow-negative').checked; markDirty(); });
$('add-prize').addEventListener('click', () => { if (roulette().prizes.length >= 100) return notice('항목은 100개까지 가능합니다.', true); roulette().prizes.push({ id: newId('prize'), meso: 0, weight: 0 }); markDirty(); renderPrizes(); });
$('add-roulette').addEventListener('click', () => { if (draft.roulettes.length >= 20) return notice('룰렛은 20개까지 가능합니다.', true); currentId = newId('roulette'); draft.roulettes.push({ id: currentId, name: '새 룰렛', kind: 'attack', enabled: false, triggerKrw: 3000, durationMs: 1000, resultHoldMs: 1500, prizes: [{ id: newId('prize'), meso: 0, weight: 1000 }] }); markDirty(); renderEditor(); });
$('delete-roulette').addEventListener('click', () => { if (draft.roulettes.length === 1) return notice('룰렛은 최소 한 개 필요합니다.', true); draft.roulettes = draft.roulettes.filter(r => r.id !== currentId); currentId = draft.roulettes[0].id; markDirty(); renderEditor(); });
$('save-config').addEventListener('click', async () => { const invalid = document.querySelector('#tab-settings input:invalid'); if (invalid) { invalid.reportValidity(); return; } const button = $('save-config'); button.disabled = true; try { const next = await api('/api/config', draft); dirty = false; renderState(next); notice('룰렛 설정을 저장했습니다.'); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } });
$('balance-form').addEventListener('submit', async event => { event.preventDefault(); try { renderState(await api('/api/balance', { balance: Number($('balance-input').value) })); notice('메소 잔액을 변경했습니다.'); } catch (error) { notice(error.message, true); } });
$('refresh-connections').addEventListener('click', () => { connections().catch(error => notice(error.message, true)); });
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => { const input = $(button.dataset.copy); try { await navigator.clipboard.writeText(input.value); notice('OBS 주소를 복사했습니다.'); } catch { input.select(); notice('주소를 선택했습니다. Ctrl+C 또는 Cmd+C로 복사하세요.'); } }));
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
if (token) login().catch(() => { sessionStorage.removeItem('meso-admin'); $('login-error').textContent = '관리자 키를 다시 입력하세요.'; });

$('source-form').addEventListener('submit', async event => { event.preventDefault(); try { const sources = Object.fromEntries(Object.keys(names).map(provider => [provider, $(`source-${provider}`).value])); await api('/api/sources', sources); await connections(); notice('방송 URL을 저장했습니다. 아래에서 플랫폼 연결을 진행하세요.'); } catch (error) { notice(error.message, true); } });
$('youtube-app-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/youtube/app', { clientId: $('youtube-client-id').value.trim(), clientSecret: $('youtube-client-secret').value }); $('youtube-client-secret').value = ''; await connections(); notice('OAuth 앱 설정을 저장했습니다. 리디렉션 URI를 확인한 뒤 계정을 연결하세요.'); } catch (error) { notice(error.message, true); } });
$('youtube-connect').addEventListener('click', async () => { try { const result = await api('/api/youtube/authorize', {}); location.assign(result.url); } catch (error) { notice(error.message, true); } });
$('youtube-disconnect').addEventListener('click', async () => { try { await api('/api/youtube/disconnect', {}); await connections(); notice('로컬 YouTube 인증을 삭제했습니다. Google 계정의 앱 접근 권한은 계정 설정에서 해제할 수 있습니다.'); } catch (error) { notice(error.message, true); } });

$('chzzk-app-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/chzzk/app', { clientId: $('chzzk-client-id').value.trim(), clientSecret: $('chzzk-client-secret').value }); $('chzzk-client-secret').value = ''; await connections(); notice('치지직 앱 설정을 저장했습니다. 등록할 리디렉션 URI와 권한을 확인하세요.'); } catch (error) { notice(error.message, true); } });
$('chzzk-connect').addEventListener('click', async () => { try { const result = await api('/api/chzzk/authorize', {}); location.assign(result.url); } catch (error) { notice(error.message, true); } });
$('chzzk-disconnect').addEventListener('click', async () => { try { await api('/api/chzzk/disconnect', {}); await connections(); notice('로컬 치지직 연결을 해제했습니다. 계정의 앱 권한은 치지직 계정 설정에서도 해제할 수 있습니다.'); } catch (error) { notice(error.message, true); } });
$('soop-connect').addEventListener('click', async () => { try { await api('/api/soop/connection', { enabled: true }); await connections(); notice('SOOP 연결을 시작했습니다. 방송이 진행 중인지 확인하세요.'); } catch (error) { notice(error.message, true); } });
$('soop-disconnect').addEventListener('click', async () => { try { await api('/api/soop/connection', { enabled: false }); await connections(); notice('SOOP 연결을 해제했습니다.'); } catch (error) { notice(error.message, true); } });
$('toonation-widget-form').addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/toonation/widget', { widgetUrl: $('toonation-widget-url').value.trim() }); $('toonation-widget-url').value = ''; await connections(); notice('투네이션 위젯 연결을 시작했습니다. 수신 상태를 확인하세요.'); } catch (error) { notice(error.message, true); } });
$('toonation-disconnect').addEventListener('click', async () => { try { await api('/api/toonation/widget', { widgetUrl: '' }); await connections(); notice('투네이션 위젯 연결 정보를 삭제했습니다.'); } catch (error) { notice(error.message, true); } });

$('chzzk-url-connect').addEventListener('click', async () => { try { await api('/api/chzzk/connection', { enabled: true }); await connections(); notice('치지직 공개 방송 연결을 시작했습니다. 방송 상태를 확인하세요.'); } catch (error) { notice(error.message, true); } });
