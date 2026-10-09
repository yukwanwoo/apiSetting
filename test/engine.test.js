import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, defaultConfig, validateConfig, normalizeDonation, choosePrize, InputError } from '../src/engine.js';
function fixture(t, ticket = 999) {
  const dir = mkdtempSync(join(tmpdir(), 'meso-engine-')); let clock = 1_000_000;
  const engine = new Engine(join(dir, 'state.json'), { now: () => clock, pick: prizes => choosePrize(prizes, ticket) });
  t.after(() => { engine.close(); rmSync(dir, { recursive: true, force: true }); });
  return { engine, file: join(dir, 'state.json'), advance: ms => { clock += ms; engine.pump(); }, now: () => clock };
}
const donation = (id = 'a', amount = 1000, unit = 'KRW') => ({ eventId: id, nickname: '시청자 <script>', amount, unit });
test('defaults: 30 million starting mesos, negative allowed, separate exact amounts', () => { const c = validateConfig(defaultConfig()); assert.equal(c.initialBalance, 30000000); assert.equal(c.allowNegative, true); assert.equal(c.roulettes[0].triggerKrw, 1000); assert.equal(c.roulettes[1].triggerKrw, 2000); });
test('probability boundary and zero weight: all 1000 tickets follow integer tenths', () => { const prizes = [{ meso: 0, weight: 0 }, { meso: 1, weight: 1 }, { meso: 2, weight: 999 }]; assert.equal(choosePrize(prizes, 0).index, 1); for (let i = 1; i < 1000; i++) assert.equal(choosePrize(prizes, i).index, 2); });
test('invalid totals, sub 0.1% weights and duplicated enabled amounts are rejected', () => {
  const c = defaultConfig(); c.roulettes[0].prizes[0].weight = 299; assert.throws(() => validateConfig(c), InputError);
  c.roulettes[0].prizes[0].weight = 300.5; assert.throws(() => validateConfig(c), InputError);
  c.roulettes[0].prizes[0].weight = 300; c.roulettes[1].triggerKrw = 1000; assert.throws(() => validateConfig(c), InputError);
  c.roulettes[1].enabled = false; assert.doesNotThrow(() => validateConfig(c));
});
test('meso range and integer amounts are enforced', () => { const c = defaultConfig(); c.roulettes[0].prizes[0].meso = 10000001; assert.throws(() => validateConfig(c), InputError); assert.throws(() => normalizeDonation('soop', donation('a', 1.5, 'STAR')), InputError); });
test('STAR converts 1 to 100 KRW; only SOOP accepts STAR', () => { assert.equal(normalizeDonation('soop', donation('x', 10, 'STAR')).amountKrw, 1000); assert.throws(() => normalizeDonation('youtube', donation('x', 10, 'STAR')), InputError); });
test('exact match only: 999 ignored, 1000 attack, 2000 defense, never multiple spins', t => {
  const { engine } = fixture(t); assert.equal(engine.data.balance, 30000000);
  assert.equal(engine.receive('chzzk', donation('x', 999)).matched, false); assert.equal(engine.data.active, null);
  assert.equal(engine.receive('chzzk', donation('y', 1000)).matched, true); assert.equal(engine.data.active.roulette.kind, 'attack');
  engine.receive('soop', donation('z', 20, 'STAR')); assert.equal(engine.data.queue.length, 1); assert.equal(engine.data.queue[0].roulette.kind, 'defense');
});
test('spin settles only after duration; attack increments and defense decrements in FIFO order', t => {
  const { engine, advance } = fixture(t);
  engine.receive('chzzk', donation('a')); engine.receive('soop', donation('b', 20, 'STAR'));
  advance(999); assert.equal(engine.data.balance, 30000000); assert.equal(engine.data.history.length, 0);
  advance(1); assert.equal(engine.data.balance, 40000000); assert.equal(engine.data.history.length, 1);
  advance(1500); assert.equal(engine.data.active.roulette.kind, 'defense'); advance(1000); assert.equal(engine.data.balance, 30000000);
  assert.equal(engine.data.history.length, 2); advance(1500); assert.equal(engine.data.active, null);
});
test('dedup is provider-scoped, persisted, and preserves IDs over restart', t => {
  const { engine, file, now } = fixture(t); engine.receive('chzzk', donation('a')); assert.equal(engine.receive('chzzk', donation('a')).duplicate, true);
  engine.close(); const restarted = new Engine(file, { now }); t.after(() => restarted.close());
  assert.equal(restarted.receive('chzzk', donation('a')).duplicate, true); assert.equal(restarted.receive('soop', donation('a')).duplicate, false);
});
test('restart of unfinished/settled spin awards exactly once', t => {
  const { engine, file, now, advance } = fixture(t); engine.receive('chzzk', donation('a')); engine.close(); advance(1000); engine.close();
  const restored = new Engine(file, { now }); t.after(() => restored.close()); restored.start(); assert.equal(restored.data.balance, 40000000); assert.equal(restored.data.history.length, 1); restored.pump(); assert.equal(restored.data.balance, 40000000);
});
test('unfinished spin resumes chosen result after a real restart', t => {
  const { engine, file, now } = fixture(t); engine.receive('chzzk', donation('a')); engine.close();
  const restored = new Engine(file, { now: () => now() + 4000 }); t.after(() => restored.close()); restored.start();
  assert.equal(restored.data.balance, 40000000); assert.equal(restored.data.history.length, 1); assert.equal(restored.data.active, null);
});
test('negative balance allowed; configurable floor reports actual delta', t => {
  const { engine, advance } = fixture(t); engine.setBalance(0); engine.receive('soop', donation('a', 2000)); advance(1000); assert.equal(engine.data.balance, -10000000); advance(1500);
  const config = defaultConfig(); config.allowNegative = false; engine.updateConfig(config); assert.equal(engine.data.balance, 0);
  engine.setBalance(5000000); engine.receive('soop', donation('b', 2000)); advance(1000); assert.equal(engine.data.balance, 0); assert.equal(engine.data.history[0].actualDelta, -5000000); assert.equal(engine.data.history[0].delta, -10000000);
});
test('queued events retain old settings while new donations use updated amounts', t => {
  const { engine, advance } = fixture(t); engine.receive('chzzk', donation('a')); engine.receive('chzzk', donation('b'));
  const config = defaultConfig(); config.roulettes[0].triggerKrw = 3000; config.roulettes[0].durationMs = 2000; engine.updateConfig(config);
  assert.equal(engine.receive('chzzk', donation('c')).matched, false); engine.receive('chzzk', donation('d', 3000));
  advance(2500); assert.equal(engine.data.active.donation.eventId, 'b'); assert.equal(engine.data.active.roulette.durationMs, 1000);
  advance(2500); assert.equal(engine.data.active.donation.eventId, 'd'); assert.equal(engine.data.active.roulette.durationMs, 2000);
});
test('balance reset blocked during active spin; changing initial amount does not reset balance', t => { const { engine } = fixture(t); const config = defaultConfig(); config.initialBalance = 50000000; engine.updateConfig(config); assert.equal(engine.data.balance, 30000000); engine.receive('chzzk', donation('a')); assert.throws(() => engine.setBalance(0), InputError); });
test('test donations are clearly marked and count as real demo balance changes', t => { const { engine, advance } = fixture(t); engine.receive('youtube', donation('test'), { test: true }); advance(1000); assert.equal(engine.data.history[0].test, true); assert.equal(engine.data.balance, 40000000); });
