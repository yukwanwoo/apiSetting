import { DEFAULT_COMMENTS, BUILTIN_SOUNDS, soundWindow } from './presentation.js';
import { SoundPlayer, encodeUpload } from './sound-player.js';
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('ko-KR');
const names = { chzzk: '치지직', soop: 'SOOP', youtube: 'YouTube', toonation: '투네이션' };
const launchKey = new URLSearchParams(location.hash.slice(1)).get('admin');
if (launchKey && /^[a-f0-9]{64}$/.test(launchKey)) {
  sessionStorage.setItem('meso-admin', launchKey);
  history.replaceState(null, '', location.pathname + location.search);
}
let token = sessionStorage.getItem('meso-admin') || '', state, draft, currentId, dirty = false, streamController;
let noticeTimer, retryTimer, statusTimer, sourcesLoaded = false, soundOptions = [...BUILTIN_SOUNDS], uploading = false, stopping = false;
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
  const last = state.history[0]; $('latest-result').textContent = last ? `${last.actualDelta < 0 ? '−' : '+'}${fmt(last.meso)}` : '—'; $('latest-result').className = `latest ${last?.actualDelta < 0 ? 'negative' : 'positive'}`;
  $('latest-donor').textContent = last ? `${last.nickname} · ${last.test ? '테스트 · ' : ''}${last.rouletteName}` : '행운은 어느 쪽으로?';
  const donations = $('donations'); donations.replaceChildren();
  for (const d of state.donations) { const tr = document.createElement('tr'); tr.append(textCell(d.nickname, `${names[d.provider]}${d.test ? ' · 테스트' : ''} · ${new Date(d.receivedAt).toLocaleTimeString('ko-KR')}`), textCell(`${fmt(d.amountKrw)}원`, d.unit === 'STAR' ? `별풍선 ${fmt(d.amount)}개` : ''), textCell(d.matched ? d.rouletteName : '금액 불일치')); donations.append(tr); }
  if (!state.donations.length) empty(donations, '아직 도착한 후원이 없습니다.');
  const history = $('history'); history.replaceChildren();
  for (const h of state.history) { const tr = document.createElement('tr'); const change = textCell(`${h.actualDelta < 0 ? '−' : '+'}${fmt(h.meso)}`, `실제 ${h.actualDelta < 0 ? '−' : '+'}${fmt(Math.abs(h.actualDelta))} 메소`); change.className = h.actualDelta < 0 ? 'negative' : 'positive'; tr.append(textCell(h.rouletteName, `${h.nickname}${h.test ? ' · 테스트' : ''}`), change, textCell(fmt(h.balance))); history.append(tr); }
  if (!state.history.length) empty(history, '첫 번째 룰렛을 기다리고 있습니다.');
  if (!draft || !dirty) { draft = structuredClone(state.config); if (!draft.roulettes.some(r => r.id === currentId)) currentId = draft.roulettes[0].id; renderEditor(); }
}
function roulette() { return draft.roulettes.find(r => r.id === currentId); }
function fillSelect() {
  for (const id of ['roulette-select', 'appearance-select']) {
    $(id).replaceChildren(...draft.roulettes.map(r => { const option = document.createElement('option'); option.value = r.id; option.textContent = r.name + (r.enabled ? '' : ' · 비활성'); return option; }));
    $(id).value = currentId;
  }
}
function updatePreview() {
  if (!draft || !$('preview').contentWindow) return;
  const r = structuredClone(roulette());
  if (!r.prizes.every(p => Number.isFinite(p.meso) && p.meso >= 0 && Number.isFinite(p.weight) && p.weight >= 0) || r.prizes.reduce((sum, p) => sum + p.weight, 0) !== 1000) r.prizes = structuredClone(state.config.roulettes.find(saved => saved.id === r.id)?.prizes ?? state.config.roulettes[0].prizes);
  const scalePercent = Number.isInteger(draft.overlay.scalePercent) && draft.overlay.scalePercent >= 25 && draft.overlay.scalePercent <= 150 ? draft.overlay.scalePercent : state.config.overlay.scalePercent;
  $('preview').style.height = `${180 + 260 * scalePercent / 100}px`;
  $('preview').contentWindow.postMessage({ type: 'meso-preview-draft', roulette: r, overlay: { scalePercent } }, location.origin);
}
$('preview').addEventListener('load', updatePreview);
function renderEditor() {
  const r = roulette(); fillSelect(); $('roulette-name').value = r.name; $('roulette-kind').value = r.kind; $('roulette-enabled').checked = r.enabled;
  $('roulette-unit').value = 'KRW'; $('roulette-amount').value = r.triggerKrw; $('roulette-duration').value = r.durationMs / 1000; $('roulette-hold').value = r.resultHoldMs / 1000;
  $('overlay-scale').value = draft.overlay.scalePercent;
  for (const key of ['heading', 'donor', 'donation']) $(`comment-${key}`).value = r.comments[key];
  renderSoundEditor();
  $('sound-volume').value = draft.sound.volume; $('sound-volume-label').textContent = `${draft.sound.volume}%`;
  $('allow-negative').checked = draft.allowNegative; $('initial-balance').value = draft.initialBalance; renderPrizes(); ruleConversion(); updateSaveLabels(); updatePreview();
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
function updateSaveLabels() { for (const id of ['save-config', 'save-studio-config']) $(id).textContent = dirty ? '변경사항 저장' : '설정 저장'; }
function markDirty() { dirty = true; updateSaveLabels(); updatePreview(); }
function ruleConversion() { const amount = Number($('roulette-amount').value), krw = amount * ($('roulette-unit').value === 'STAR' ? 100 : 1); roulette().triggerKrw = krw; $('rule-conversion').textContent = `${fmt(krw)}원 = 별풍선 ${fmt(krw / 100)}개 · 정확히 이 금액만 1회 실행`; }
function tab(name) { document.querySelectorAll('.tab-section').forEach(el => { el.hidden = el.id !== `tab-${name}`; }); document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === name)); const titles = { studio: ['라이브 스튜디오', '후원의 순간을 메소로 연결하세요.'], overlays: ['오버레이 설정', 'OBS 주소와 룰렛 표시를 설정하고 테스트하세요.'], settings: ['룰렛 설정', '확률부터 후원 조건까지, 방송에 맞게 설계하세요.'], connections: ['방송연결', '방송 URL과 계정을 연결해 후원을 수신하세요.'] }; $('page-title').textContent = titles[name][0]; $('page-subtitle').textContent = titles[name][1]; }
async function connections() {
  const info = await api('/api/connection');
  if (!sourcesLoaded) { for (const [provider, source] of Object.entries(info.sources)) $(`source-${provider}`).value = source; sourcesLoaded = true; }
  $('youtube-redirect').value = info.youtube.redirectUri;
  $('youtube-app-status').textContent = `연결 모드: ${info.youtube.mode === 'oauth' ? '공식 Google 계정' : '비공식 공개 채팅'} · OAuth 앱: ${info.youtube.appConfigured ? '설정됨' : '미설정'} · 계정 인증: ${info.youtube.authConfigured ? '설정됨' : '미설정'}`;
  $('youtube-connect').disabled = !info.youtube.appConfigured;
  $('youtube-url-connect').disabled = !info.sources.youtube;
  $('youtube-url-disconnect').disabled = info.youtube.mode !== 'public' || !info.youtube.publicEnabled;
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
      stats.textContent = `수신 진단 · 패킷 ${d.packets ?? d.polls} · 채팅 ${d.chatMessages} · 후원 패킷 ${d.donationPackets} · 처리 ${provider.received} · 해석 오류 ${d.protocolErrors ?? d.malformedDonations} · ${provider.provider === 'youtube' ? `과거 제외 ${d.ignoredHistory} · 중복 ${d.duplicates}` : `호환 처리 ${d.fallbackDonations}`}`;
      if (d.channel) stats.textContent += ` · 방송 ${d.channel.broadcastNo} / 채팅방 ${d.channel.chatNo} · 서버 ${d.channel.chatDomain}:${d.channel.chatPort + 1} · 입장 티켓 ${d.joinTicketSent ? '전달됨' : '없음'} · 재연결 ${d.reconnects}회`;
      if (d.lastPacketAt) stats.textContent += ` · 최근 수신 ${new Date(d.lastPacketAt).toLocaleTimeString('ko-KR')}`;
      if (d.lastProtocolError) stats.textContent += ` · 최근 오류 코드 ${d.lastProtocolError.opcode || '프레임'}, 필드 ${d.lastProtocolError.fieldCount ?? '알 수 없음'}`;
      card.append(stats);
      const copy = document.createElement('button'); copy.className = 'text-button'; copy.textContent = `${names[provider.provider]} 진단 복사`;
      copy.addEventListener('click', async () => { try { const fresh = (await api('/api/connection')).providers.find(p => p.provider === provider.provider); await navigator.clipboard.writeText(JSON.stringify({ provider: provider.provider, copiedAt: Date.now(), state: fresh.state, received: fresh.received, diagnostics: fresh.diagnostics }, null, 2)); notice(`${names[provider.provider]} 진단을 복사했습니다. 키·채팅 내용·후원자 닉네임은 포함하지 않습니다.`); } catch { notice('진단을 복사할 수 없습니다. 화면의 진단 숫자를 알려주세요.', true); } }); card.append(copy);
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
  if (stopping) return;
  $('server-status').textContent = '재연결 중…'; retryTimer = setTimeout(stream, 2500);
}
async function login() {
  soundOptions = (await api('/api/sounds')).sounds;
  renderState(await api('/api/state')); sessionStorage.setItem('meso-admin', token); $('login').hidden = true; $('app').hidden = false; await connections(); if (new URLSearchParams(location.search).has('connected') || new URLSearchParams(location.search).has('youtube')) { tab('connections'); notice('계정 인증을 저장했습니다. 플랫폼의 실제 수신 상태를 확인하세요.'); history.replaceState(null, '', '/'); } void stream(); clearInterval(statusTimer); statusTimer = setInterval(() => { connections().catch(() => {}); }, 15_000);
}
$('login-form').addEventListener('submit', async event => { event.preventDefault(); token = $('admin-key').value.trim(); try { await login(); $('admin-key').value = ''; } catch (error) { $('login-error').textContent = error.message; } });
async function shutdown() {
  if (uploading) return notice('음성 파일 업로드가 끝난 후 종료하세요.', true);
  if (stopping || !confirm('현재 값들을 저장하고 종료하겠습니까?\n후원 수신과 OBS 표시도 종료됩니다.')) return;
  const invalid = document.querySelector('#tab-settings input:invalid, .preview-controls input:invalid, .studio-balance-card input:invalid');
  if (invalid) { tab(invalid.closest('.tab-section').id.slice(4)); invalid.reportValidity(); return; }
  stopping = true;
  try {
    await api('/api/shutdown', { config: draft, sources: Object.fromEntries(Object.keys(names).map(provider => [provider, $(`source-${provider}`).value])) });
    dirty = false; streamController?.abort(); clearTimeout(retryTimer); clearInterval(statusTimer); soundPreview.stop();
    token = ''; sessionStorage.removeItem('meso-admin');
    $('server-status').textContent = '프로그램 종료됨';
    notice('설정을 저장하고 프로그램을 종료했습니다. 다시 사용하려면 EXE를 실행하세요.');
    document.querySelectorAll('#app button, #app input, #app select').forEach(el => { el.disabled = true; });
  } catch (error) { stopping = false; notice(error.message, true); }
}
$('logout').addEventListener('click', shutdown);
$('shutdown').addEventListener('click', shutdown);
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => tab(button.dataset.tab)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => tab(button.dataset.go)));
$('test-provider').addEventListener('change', () => { $('test-unit').options[1].disabled = $('test-provider').value !== 'soop'; if ($('test-provider').value !== 'soop') $('test-unit').value = 'KRW'; testConversion(); });
function testConversion() { const amount = Number($('test-amount').value) * ($('test-unit').value === 'STAR' ? 100 : 1); $('test-conversion').textContent = `${fmt(amount)}원 · 조건 금액과 정확히 일치할 때 1회 실행`; }
$('test-amount').addEventListener('input', testConversion); $('test-unit').addEventListener('change', testConversion);
$('test-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const result = await api('/api/test-donation', { provider: $('test-provider').value, nickname: $('test-nickname').value, amount: Number($('test-amount').value), unit: $('test-unit').value }); notice(result.matched ? '테스트 후원을 접수했습니다. 룰렛이 순서대로 실행됩니다.' : '후원을 수신했지만 정확히 일치하는 활성 룰렛이 없습니다.'); } catch (error) { notice(error.message, true); } finally { button.disabled = false; } });
for (const id of ['roulette-select', 'appearance-select']) $(id).addEventListener('change', () => { soundPreview.stop(); currentId = $(id).value; renderEditor(); });
$('roulette-name').addEventListener('input', () => { roulette().name = $('roulette-name').value; markDirty(); });
$('roulette-kind').addEventListener('change', () => { roulette().kind = $('roulette-kind').value; markDirty(); });
$('roulette-enabled').addEventListener('change', () => { roulette().enabled = $('roulette-enabled').checked; markDirty(); });
$('roulette-amount').addEventListener('input', () => { ruleConversion(); markDirty(); });
$('roulette-unit').addEventListener('change', () => { const amount = roulette().triggerKrw; $('roulette-amount').value = amount / ($('roulette-unit').value === 'STAR' ? 100 : 1); ruleConversion(); });
$('roulette-duration').addEventListener('input', () => { roulette().durationMs = Math.round(Number($('roulette-duration').value) * 1000); markDirty(); renderSoundClip(); });
$('roulette-hold').addEventListener('input', () => { roulette().resultHoldMs = Math.round(Number($('roulette-hold').value) * 1000); markDirty(); renderSoundClip(); });
const soundPreview = new SoundPlayer();
let previewObjectUrl;
function renderSoundEditor() {
  const r = roulette();
  $('sound-source').replaceChildren(...soundOptions.map(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = s.name; return option; }));
  if (!soundOptions.some(s => s.id === r.sound.source)) { const missing = document.createElement('option'); missing.value = r.sound.source; missing.textContent = '업로드 파일 없음 · 다시 선택하세요'; $('sound-source').append(missing); }
  $('sound-source').value = r.sound.source;
  $('delete-sound').hidden = BUILTIN_SOUNDS.some(s => s.id === r.sound.source);
  renderSoundClip();
}
function renderSoundClip() {
  const r = roulette(), file = soundOptions.find(s => s.id === r.sound.source);
  $('sound-auto-end').checked = r.sound.endMs === null;
  $('sound-start').value = r.sound.startMs / 1000;
  $('sound-end').disabled = r.sound.endMs === null;
  const window = soundWindow(r.sound, r, file?.durationMs);
  $('sound-end').value = (r.sound.endMs === null ? window.endMs : r.sound.endMs) / 1000;
  $('sound-clip-info').textContent = `${file?.durationMs ? `파일 길이 ${(file.durationMs / 1000).toFixed(3)}초 · ` : ''}룰렛 표시 시간 ${((r.durationMs + r.resultHoldMs) / 1000).toFixed(3)}초. 자동 구간은 파일이 더 짧으면 파일 끝까지입니다.`;
}
$('overlay-scale').addEventListener('input', () => { draft.overlay.scalePercent = Number($('overlay-scale').value); markDirty(); });
for (const key of ['heading', 'donor', 'donation']) $(`comment-${key}`).addEventListener('input', () => { roulette().comments[key] = $(`comment-${key}`).value; markDirty(); });
$('reset-comments').addEventListener('click', () => { roulette().comments = { ...DEFAULT_COMMENTS }; markDirty(); renderEditor(); });
$('sound-source').addEventListener('change', () => { soundPreview.stop(); roulette().sound = { source: $('sound-source').value, startMs: 0, endMs: null }; markDirty(); renderSoundEditor(); });
$('sound-auto-end').addEventListener('change', () => { roulette().sound.endMs = $('sound-auto-end').checked ? null : Math.round(Number($('sound-end').value) * 1000); markDirty(); renderSoundClip(); });
$('sound-start').addEventListener('input', () => { roulette().sound.startMs = Math.round(Number($('sound-start').value) * 1000); markDirty(); });
$('sound-end').addEventListener('input', () => { roulette().sound.endMs = Math.round(Number($('sound-end').value) * 1000); markDirty(); });
$('sound-upload').addEventListener('change', async () => {
  const file = $('sound-upload').files[0]; if (!file) return;
  const target = roulette(); markDirty(); uploading = true; $('sound-upload').disabled = true;
  try {
    const buffer = await encodeUpload(file);
    const response = await fetch(`/api/sounds/upload?name=${encodeURIComponent(file.name.slice(0, 100))}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'audio/wav' }, body: buffer });
    const uploaded = await response.json(); if (!response.ok) throw new Error(uploaded.error);
    soundOptions = (await api('/api/sounds')).sounds;
    target.sound = { source: uploaded.id, startMs: 0, endMs: null }; markDirty(); renderSoundEditor();
    notice('음성 파일을 추가했습니다. 앞부분 자동 구간이 설정됐습니다. 설정 저장으로 적용하세요.');
  } catch (error) { notice(error.message, true); }
  finally { uploading = false; $('sound-upload').disabled = false; $('sound-upload').value = ''; }
});
$('delete-sound').addEventListener('click', async () => { try { await api('/api/sounds/delete', { id: roulette().sound.source }); soundOptions = (await api('/api/sounds')).sounds; roulette().sound = { source: 'default', startMs: 0, endMs: null }; markDirty(); renderSoundEditor(); notice('업로드 파일을 삭제했습니다.'); } catch (error) { notice(error.message, true); } });
$('sound-volume').addEventListener('input', () => { draft.sound.volume = Number($('sound-volume').value); $('sound-volume-label').textContent = `${draft.sound.volume}%`; markDirty(); });
$('test-sound').addEventListener('click', async () => {
  try {
    const r = structuredClone(roulette()), source = soundOptions.find(s => s.id === r.sound.source);
    if (!source) throw new Error('알림음을 선택하세요.');
    soundPreview.stop(); if (previewObjectUrl) { URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = undefined; }
    let url = source.url;
    if (!BUILTIN_SOUNDS.some(s => s.id === source.id)) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('업로드 파일을 읽을 수 없습니다.');
      previewObjectUrl = URL.createObjectURL(await response.blob()); url = previewObjectUrl;
    }
    await soundPreview.play(url, r.sound, r, draft.sound.volume, r.durationMs + r.resultHoldMs);
  } catch (error) { notice(error.message, true); }
});
$('stop-sound').addEventListener('click', () => soundPreview.stop());
$('initial-balance').addEventListener('input', () => { draft.initialBalance = Number($('initial-balance').value); markDirty(); });
$('reset-balance').addEventListener('click', async () => { try { renderState(await api('/api/balance', { balance: state.config.initialBalance })); notice('저장된 시작 메소로 초기화했습니다.'); } catch (error) { notice(error.message, true); } });
$('allow-negative').addEventListener('change', () => { draft.allowNegative = $('allow-negative').checked; markDirty(); });
$('add-prize').addEventListener('click', () => { if (roulette().prizes.length >= 100) return notice('항목은 100개까지 가능합니다.', true); roulette().prizes.push({ id: newId('prize'), meso: 0, weight: 0 }); markDirty(); renderPrizes(); });
$('add-roulette').addEventListener('click', () => { if (draft.roulettes.length >= 20) return notice('룰렛은 20개까지 가능합니다.', true); currentId = newId('roulette'); draft.roulettes.push({ id: currentId, name: '새 룰렛', kind: 'attack', enabled: false, comments: { ...DEFAULT_COMMENTS }, sound: { source: 'default', startMs: 0, endMs: null }, triggerKrw: 3000, durationMs: 1000, resultHoldMs: 1500, prizes: [{ id: newId('prize'), meso: 0, weight: 1000 }] }); markDirty(); renderEditor(); });
$('delete-roulette').addEventListener('click', () => { if (draft.roulettes.length === 1) return notice('룰렛은 최소 한 개 필요합니다.', true); draft.roulettes = draft.roulettes.filter(r => r.id !== currentId); currentId = draft.roulettes[0].id; markDirty(); renderEditor(); });
async function saveConfig(event) {
  if (uploading) return notice('음성 파일 업로드가 끝난 후 저장하세요.', true);
  const invalid = document.querySelector('#tab-settings input:invalid, #preview input:invalid, .preview-controls input:invalid, .studio-balance-card input:invalid');
  if (invalid) { tab(invalid.closest('.tab-section').id.slice(4)); invalid.reportValidity(); return; }
  const button = event.currentTarget; button.disabled = true;
  try { const next = await api('/api/config', draft); dirty = false; renderState(next); notice('룰렛 설정을 저장했습니다.'); }
  catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
}
for (const id of ['save-config', 'save-studio-config', 'save-balance-config']) $(id).addEventListener('click', saveConfig);
$('adjust-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const amount = Number($('adjust-amount').value); renderState(await api('/api/balance/adjust', { delta: $('adjust-direction').value === 'subtract' ? -amount : amount, note: $('adjust-note').value })); notice('메소 증감을 반영했습니다.'); $('adjust-amount').value = ''; $('adjust-note').value = ''; } catch (error) { notice(error.message, true); } finally { button.disabled = false; } });
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

$('youtube-url-connect').addEventListener('click', async () => { try { await api('/api/youtube/connection', { enabled: true }); await connections(); notice('YouTube 공개 채팅 연결을 시작했습니다. 수신 대기와 실제 후원 수신 상태를 확인하세요.'); } catch (error) { notice(error.message, true); } });
$('youtube-url-disconnect').addEventListener('click', async () => { try { await api('/api/youtube/connection', { enabled: false }); await connections(); notice('YouTube 공개 채팅 연결을 해제했습니다.'); } catch (error) { notice(error.message, true); } });
