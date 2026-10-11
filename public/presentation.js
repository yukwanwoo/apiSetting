export const DEFAULT_COMMENTS = {
  heading: '{kind} ROULETTE{test}',
  donor: '{nickname}님의 {roulette}',
  donation: '{platform} · {amount}원 후원{stars}'
};
export const BUILTIN_SOUNDS = [
  { id: 'default', name: '기본 알림음', url: '/alert.wav' },
  { id: 'chime', name: '띠리링', url: '/chime.wav' },
  { id: 'bell', name: '맑은 벨', url: '/bell.wav' }
];
export function formatComment(template, active) {
  const d = active.donation, r = active.roulette;
  const fmt = n => Number(n).toLocaleString('ko-KR');
  const values = { kind: r.kind === 'attack' ? 'ATTACK' : 'DEFENSE', nickname: d.nickname, roulette: r.name,
    platform: ({ chzzk: '치지직', soop: 'SOOP', youtube: 'YouTube', toonation: '투네이션' })[d.provider],
    amount: fmt(d.amountKrw), stars: d.unit === 'STAR' ? ` (별풍선 ${fmt(d.amount)}개)` : '', test: d.test ? ' · TEST' : '' };
  return template.replace(/\{(kind|nickname|roulette|platform|amount|stars|test)\}/g, (_, key) => values[key]);
}
export function soundWindow(sound, roulette, durationMs = Infinity) {
  const startMs = sound?.startMs ?? 0;
  const endMs = Math.min(sound?.endMs ?? roulette.durationMs + roulette.resultHoldMs, durationMs);
  return { startMs, endMs };
}
