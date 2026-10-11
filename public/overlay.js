import { DEFAULT_COMMENTS, BUILTIN_SOUNDS, formatComment } from './presentation.js';
import { SoundPlayer } from './sound-player.js';
const $ = id => document.getElementById(id);
const fmt = n => Number(n).toLocaleString('ko-KR');
const mesoView = document.body.dataset.view === 'meso';
const params = new URLSearchParams(location.search);
const token = params.get('token');
const preview = params.get('preview') === '1';
if (preview) document.body.classList.add('preview-mode');
const providers = { chzzk: '치지직', soop: 'SOOP', youtube: 'YouTube', toonation: '투네이션' };
const colors = ['#7260b8', '#354763', '#497758', '#54649a', '#74608b', '#9c744c', '#a4bc57'];
let state, receivedState, previewDraft, offset = 0, frame, lastBalance, hideTimer, lastSoundId;
const samplePrizes = Array.from({ length: 11 }, (_, i) => ({ meso: i * 1000000, weight: i === 0 ? 90 : 91 }));
const alertSound = new SoundPlayer();
function hideRoulette() { alertSound.stop(); cancelAnimationFrame(frame); document.querySelector('.roulette-overlay').hidden = true; }
function short(n) { return n === 0 ? '0 메소' : n >= 10000 ? `${fmt(n / 10000)}만` : fmt(n); }
function draw(prizes, angle = 0, defense = false) {
  const canvas = $('wheel'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); const center = 360, radius = 340;
  ctx.clearRect(0, 0, 720, 720); ctx.save(); ctx.translate(center, center); ctx.rotate(angle);
  let start = -Math.PI / 2;
  prizes.forEach((p, index) => {
    if (!p.weight) return;
    const arc = p.weight / 1000 * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, radius, start, start + arc); ctx.closePath(); ctx.fillStyle = colors[index % colors.length]; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#151a2b'; ctx.stroke();
    if (p.weight >= 25) {
      ctx.save(); ctx.rotate(start + arc / 2); ctx.translate(radius * .72, 0); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = '#f4f5fa'; ctx.font = `700 ${p.weight < 50 ? 17 : 24}px system-ui`;
      ctx.fillText(`${defense && p.meso ? '−' : ''}${short(p.meso)}`, 0, 0); ctx.font = '500 16px system-ui'; ctx.fillStyle = '#f4f5fab0'; ctx.fillText(`${(p.weight / 10).toFixed(1)}%`, 0, 26); ctx.restore();
    }
    start += arc;
  });
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.strokeStyle = '#c2c7e340'; ctx.lineWidth = 10; ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, radius + 11, 0, Math.PI * 2); ctx.strokeStyle = '#22273b'; ctx.lineWidth = 10; ctx.stroke(); ctx.restore();
}
function spinAngle(active, now) {
  const progress = Math.max(0, Math.min(1, (now - active.startedAt) / active.roulette.durationMs));
  const before = active.roulette.prizes.slice(0, active.prize.index).reduce((sum, p) => sum + p.weight, 0);
  const target = (before + active.prize.weight / 2) / 1000 * Math.PI * 2;
  return (Math.PI * 2 * 6 + (Math.PI * 2 - target)) * (1 - (1 - progress) ** 4);
}
function animate() { if (!state?.active || mesoView) return; draw(state.active.roulette.prizes, spinAngle(state.active, Date.now() + offset), state.active.roulette.kind === 'defense'); if (Date.now() + offset < state.active.endsAt) frame = requestAnimationFrame(animate); }
function update(next) {
  receivedState = next;
  if (preview && !mesoView && previewDraft) {
    const active = next.active?.roulette.id === previewDraft.roulette.id ? { ...next.active, roulette: { ...next.active.roulette, comments: previewDraft.roulette.comments } } : null;
    next = { ...next, active, overlay: previewDraft.overlay, previewRoulette: previewDraft.roulette };
  }
  offset = next.serverTime - Date.now(); state = next;
  if (mesoView) {
    $('meso-balance').replaceChildren(document.createTextNode(`${fmt(state.balance)} `)); const small = document.createElement('small'); small.textContent = '메소'; $('meso-balance').append(small);
    const result = state.latestChange ?? state.active?.result;
    if (result) { $('meso-change').textContent = `${result.actualDelta < 0 ? '−' : '+'}${fmt(Math.abs(result.actualDelta))} 메소 · ${result.nickname}${result.test ? ' (테스트)' : ''}`; $('meso-change').className = result.actualDelta < 0 ? 'negative' : 'positive'; }
    if (lastBalance !== undefined && lastBalance !== state.balance) { const panel = document.querySelector('.meso-overlay'); panel.classList.remove('pulse'); void panel.offsetWidth; panel.classList.add('pulse'); }
    lastBalance = state.balance; return;
  }
  cancelAnimationFrame(frame);
  clearTimeout(hideTimer);
  const active = state.active;
  const panel = document.querySelector('.roulette-overlay');
  document.querySelector('.wheel-wrap').style.setProperty('--wheel-scale', String((state.overlay?.scalePercent ?? 100) / 100));
  panel.hidden = !active && !preview;
  if (!active) {
    alertSound.stop();
    const sample = state.previewRoulette;
    if (preview && sample) {
      const fake = { roulette: sample, donation: { nickname: '행운의 시청자', provider: 'chzzk', amountKrw: sample.triggerKrw, unit: 'KRW', test: false } };
      for (const [key, id] of [['heading', 'overlay-kind'], ['donor', 'overlay-donor'], ['donation', 'overlay-donation']]) { $(id).textContent = formatComment(sample.comments?.[key] ?? DEFAULT_COMMENTS[key], fake); $(id).hidden = !$(id).textContent; }
      $('result-label').textContent = 'READY FOR YOUR LUCK'; $('result-amount').textContent = '행운을 돌려보세요'; $('result-note').textContent = ''; $('overlay-result').className = 'overlay-result'; draw(sample.prizes, 0, sample.kind === 'defense'); return;
    }
    $('overlay-kind').textContent = 'MESO LIVE'; $('overlay-donor').textContent = '다음 행운을 기다리는 중'; $('overlay-donation').textContent = '후원이 도착하면 룰렛이 돌아갑니다'; $('result-label').textContent = 'READY FOR YOUR LUCK'; $('result-amount').textContent = '행운을 돌려보세요'; $('result-note').textContent = ''; $('overlay-result').className = 'overlay-result'; draw(samplePrizes); return;
  }
  const remaining = active.endsAt + active.roulette.resultHoldMs - (Date.now() + offset);
  if (remaining <= 0) { hideRoulette(); return; }
  hideTimer = setTimeout(hideRoulette, remaining);
  if (active.id !== lastSoundId) {
    lastSoundId = active.id;
    if (!preview && !active.settled && Date.now() + offset - active.startedAt < 1500 && (state.sound?.volume ?? 50) > 0) {
      const sound = active.roulette.sound ?? { source: 'default', startMs: 0, endMs: null };
      const builtin = BUILTIN_SOUNDS.find(s => s.id === sound.source);
      const url = builtin?.url ?? `/sounds/${encodeURIComponent(sound.source)}.wav?token=${encodeURIComponent(token)}`;
      alertSound.play(url, sound, active.roulette, state.sound?.volume ?? 50, remaining).catch(() => {});
    }
  }
  for (const [key, id] of [['heading', 'overlay-kind'], ['donor', 'overlay-donor'], ['donation', 'overlay-donation']]) { $(id).textContent = formatComment(active.roulette.comments?.[key] ?? DEFAULT_COMMENTS[key], active); $(id).hidden = !$(id).textContent; }
  $('overlay-result').className = `overlay-result${active.roulette.kind === 'defense' ? ' defense' : ''}`;
  if (active.settled) {
    $('result-label').textContent = 'YOUR RESULT'; $('result-amount').textContent = `${active.roulette.kind === 'defense' ? '−' : '+'}${fmt(active.prize.meso)} 메소`;
    $('result-note').textContent = active.result.actualDelta !== active.result.delta ? `잔액 한도 적용 · 실제 ${active.result.actualDelta < 0 ? '−' : '+'}${fmt(Math.abs(active.result.actualDelta))} 메소` : `현재 ${fmt(state.balance)} 메소`;
  } else { $('result-label').textContent = 'GOOD LUCK'; $('result-amount').textContent = '행운을 뽑는 중…'; $('result-note').textContent = state.queueLength ? `다음 ${state.queueLength}건 대기 중` : ''; }
  animate();
}
if (preview && !mesoView) window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'meso-preview-draft') return;
  const { roulette, overlay } = event.data;
  if (!roulette || !Array.isArray(roulette.prizes) || !roulette.comments || !['heading', 'donor', 'donation'].every(key => typeof roulette.comments[key] === 'string') || !Number.isInteger(overlay?.scalePercent) || overlay.scalePercent < 25 || overlay.scalePercent > 150) return;
  previewDraft = { roulette, overlay };
  if (receivedState) update({ ...receivedState, serverTime: Date.now() + offset });
});
if (!mesoView) { document.querySelector('.roulette-overlay').hidden = !preview; draw(samplePrizes); }
if (!token) { $('overlay-connection').textContent = '관리자 대시보드에서 OBS 주소를 복사하세요.'; }
else {
  const stream = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  stream.addEventListener('state', event => { update(JSON.parse(event.data)); $('overlay-connection').hidden = true; });
  stream.onopen = () => { $('overlay-connection').hidden = true; };
  stream.onerror = () => { $('overlay-connection').hidden = false; $('overlay-connection').textContent = '연결이 끊겼습니다. 서버·오버레이 키를 확인하세요. 재연결 중…'; };
}
