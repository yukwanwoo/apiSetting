import test from 'node:test';
import assert from 'node:assert/strict';
import { formatComment, soundWindow } from '../public/presentation.js';
test('comment templates replace only known placeholders once and preserve literal donor text', () => {
  const active = { roulette: { name: '공격 룰렛', kind: 'attack' }, donation: { nickname: '<img>{amount}', provider: 'soop', amountKrw: 1000, amount: 10, unit: 'STAR', test: true } };
  assert.equal(formatComment('{nickname} · {roulette} · {platform} {amount}원{stars}{test}', active), '<img>{amount} · 공격 룰렛 · SOOP 1,000원 (별풍선 10개) · TEST');
  assert.equal(formatComment('', active), '');
});
test('automatic audio ends at total roulette duration or file end; custom trims remain explicit', () => {
  const r = { durationMs: 1000, resultHoldMs: 1500 };
  assert.deepEqual(soundWindow({ startMs: 0, endMs: null }, r, 5000), { startMs: 0, endMs: 2500 });
  assert.deepEqual(soundWindow({ startMs: 0, endMs: null }, r, 800), { startMs: 0, endMs: 800 });
  assert.deepEqual(soundWindow({ startMs: 1000, endMs: 3500 }, r, 5000), { startMs: 1000, endMs: 3500 });
});
