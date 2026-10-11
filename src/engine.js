import { randomInt, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';

export const PROVIDERS = ['chzzk', 'soop', 'youtube', 'toonation'];
export const MAX_MESO = 10_000_000;
export const MAX_TOTAL = 1_000_000_000_000;
const safeInteger = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
export class InputError extends Error {}
const requireInput = (ok, message) => { if (!ok) throw new InputError(message); };

export function defaultConfig() {
  const amounts = Array.from({ length: 11 }, (_, i) => i * 1_000_000);
  const weights = amounts.map((_, i) => i === 0 ? 90 : 91);
  return {
    allowNegative: true, initialBalance: 30_000_000, sound: { volume: 50 },
    roulettes: ['attack', 'defense'].map((kind, i) => ({
      id: kind, name: i === 0 ? '공격 룰렛' : '방어 룰렛', kind,
      triggerKrw: i === 0 ? 1000 : 1100, durationMs: 1000, resultHoldMs: 1500,
      enabled: true,
      prizes: amounts.map((meso, j) => ({ id: `${kind}-${j}`, meso, weight: weights[j] }))
    }))
  };
}

export function validateConfig(value) {
  requireInput(value && typeof value === 'object', '설정이 필요합니다.');
  requireInput(typeof value.allowNegative === 'boolean', '음수 허용 설정을 확인하세요.');
  requireInput(Array.isArray(value.roulettes) && value.roulettes.length > 0 && value.roulettes.length <= 20, '룰렛은 1~20개까지 설정할 수 있습니다.');
  requireInput(safeInteger(value.initialBalance, value.allowNegative ? -MAX_TOTAL : 0, MAX_TOTAL), '시작 메소 잔액 범위를 확인하세요.');
  const sound = value.sound === undefined ? { volume: 50 } : value.sound;
  requireInput(sound && safeInteger(sound.volume, 0, 100), '알림음 음량은 0~100의 정수입니다.');
  const ids = new Set(), amounts = new Set();
  const roulettes = value.roulettes.map(r => {
    requireInput(r && typeof r.id === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(r.id) && !ids.has(r.id), '룰렛 ID가 유효하지 않거나 중복입니다.'); ids.add(r.id);
    requireInput(typeof r.name === 'string' && r.name.trim().length > 0 && r.name.length <= 50, '룰렛 이름은 1~50자입니다.');
    requireInput(['attack', 'defense'].includes(r.kind), '공격 또는 방어 룰렛을 선택하세요.');
    requireInput(typeof r.enabled === 'boolean', '활성화 설정을 확인하세요.');
    requireInput(safeInteger(r.triggerKrw, 100, 100_000_000), '후원 조건은 100~100,000,000원의 정수여야 합니다.');
    if (r.enabled) { requireInput(!amounts.has(r.triggerKrw), '활성 룰렛의 후원 조건 금액은 서로 달라야 합니다.'); amounts.add(r.triggerKrw); }
    requireInput(safeInteger(r.durationMs, 100, 60_000), '애니메이션 시간은 0.1~60초입니다.');
    requireInput(safeInteger(r.resultHoldMs, 0, 30_000), '결과 표시 시간은 0~30초입니다.');
    requireInput(Array.isArray(r.prizes) && r.prizes.length > 0 && r.prizes.length <= 100, '결과 항목은 1~100개입니다.');
    const prizeIds = new Set();
    const prizes = r.prizes.map(p => {
      requireInput(p && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(p.id) && !prizeIds.has(p.id), '결과 ID가 유효하지 않거나 중복입니다.'); prizeIds.add(p.id);
      requireInput(safeInteger(p.meso, 0, MAX_MESO), '메소 결과는 0~10,000,000의 정수입니다.');
      requireInput(safeInteger(p.weight, 0, 1000), '확률은 0.1% 단위로 설정하세요.');
      return { id: p.id, meso: p.meso, weight: p.weight };
    });
    requireInput(prizes.reduce((sum, p) => sum + p.weight, 0) === 1000, '룰렛 확률 합계가 정확히 100%여야 합니다.');
    return { id: r.id, name: r.name.trim(), kind: r.kind, triggerKrw: r.triggerKrw, durationMs: r.durationMs, resultHoldMs: r.resultHoldMs, enabled: r.enabled, prizes };
  });
  return { allowNegative: value.allowNegative, initialBalance: value.initialBalance, sound: { volume: sound.volume }, roulettes };
}

export function normalizeDonation(provider, body) {
  requireInput(PROVIDERS.includes(provider), '지원하지 않는 플랫폼입니다.');
  requireInput(body && typeof body === 'object', '후원 데이터가 필요합니다.');
  requireInput(typeof body.eventId === 'string' && body.eventId.length > 0 && body.eventId.length <= 200, '고유한 eventId가 필요합니다.');
  requireInput(typeof body.nickname === 'string' && body.nickname.trim().length > 0 && body.nickname.length <= 100, '후원자 닉네임이 필요합니다.');
  requireInput(['KRW', 'STAR'].includes(body.unit), '단위는 KRW 또는 STAR입니다.');
  requireInput(safeInteger(body.amount, 1, 100_000_000), '후원 금액은 양의 정수여야 합니다.');
  requireInput(body.unit !== 'STAR' || provider === 'soop', '별풍선 단위는 SOOP에서만 사용할 수 있습니다.');
  const amountKrw = body.amount * (body.unit === 'STAR' ? 100 : 1);
  requireInput(amountKrw <= 100_000_000, '후원 환산 금액이 너무 큽니다.');
  return { key: `${provider}:${body.eventId}`, eventId: body.eventId, provider, nickname: body.nickname.trim(), amountKrw, amount: body.amount, unit: body.unit };
}

export function choosePrize(prizes, ticket = randomInt(1000)) {
  let edge = 0;
  for (let i = 0; i < prizes.length; i++) { edge += prizes[i].weight; if (ticket < edge) return { index: i, ...prizes[i] }; }
  throw new Error('Invalid probability distribution');
}

export class Engine extends EventEmitter {
  constructor(file, { now = Date.now, pick = choosePrize } = {}) {
    super(); this.file = file; this.now = now; this.pick = pick; this.timer = null;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
      version: 2, config: defaultConfig(), balance: 30_000_000, donations: [], history: [], queue: [], active: null, seen: [],
      youtubeCursor: null
    };
    // Upgrade only untouched legacy prize tables/prices. Custom rules and
    // queued spin snapshots retain their original settings and outcomes.
    if (this.data.version === 1) {
      const legacyAmounts = [0, 100_000, 500_000, 1_000_000, 3_000_000, 5_000_000, 10_000_000];
      const legacyWeights = [300, 250, 200, 150, 60, 30, 10];
      for (const replacement of defaultConfig().roulettes) {
        const r = this.data.config.roulettes.find(row => row.id === replacement.id && row.kind === replacement.kind);
        if (r && r.triggerKrw === (r.kind === 'attack' ? 1000 : 2000) && r.prizes.length === 7 && r.prizes.every((p, i) => p.meso === legacyAmounts[i] && p.weight === legacyWeights[i])) {
          r.triggerKrw = replacement.triggerKrw; r.prizes = replacement.prizes;
        }
      }
      this.data.version = 2;
    }
    this.data.config = validateConfig(this.data.config);
    // Persisted in-flight spins retain their chosen result and settle at most once.
    this.save();
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  snapshot() {
    return structuredClone({ config: this.data.config, balance: this.data.balance, active: this.data.active,
      queue: this.data.queue, history: this.data.history.slice(0, 50), donations: this.data.donations.slice(0, 100), serverTime: this.now() });
  }
  change() { this.save(); this.emit('state', this.snapshot()); }
  start() { this.pump(); }
  close() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  updateConfig(config) {
    this.data.config = validateConfig(config);
    if (!config.allowNegative && this.data.balance < 0) this.data.balance = 0;
    this.change(); return this.snapshot();
  }
  setBalance(balance) {
    requireInput(!this.data.active && this.data.queue.length === 0, '룰렛이 모두 끝난 후 잔액을 변경하세요.');
    requireInput(safeInteger(balance, this.data.config.allowNegative ? -MAX_TOTAL : 0, MAX_TOTAL), '메소 잔액 범위를 확인하세요.');
    this.data.balance = balance; this.change(); return this.snapshot();
  }
  receive(provider, body, { test = false } = {}) {
    const donation = normalizeDonation(provider, body);
    if (this.data.seen.includes(donation.key)) return { duplicate: true };
    const roulette = this.data.config.roulettes.find(r => r.enabled && r.triggerKrw === donation.amountKrw);
    requireInput(!roulette || this.data.queue.length < 1000, '대기열이 가득 찼습니다. 잠시 후 같은 eventId로 재시도하세요.');
    // Do not silently evict deduplication IDs: retain them across restarts.
    this.data.seen.push(donation.key);
    const entry = { ...donation, test, receivedAt: this.now(), matched: Boolean(roulette), rouletteName: roulette?.name || null };
    this.data.donations.unshift(entry); this.data.donations = this.data.donations.slice(0, 500);
    if (roulette) this.data.queue.push({ id: randomUUID(), donation: entry, roulette: structuredClone(roulette) });
    this.change(); this.pump(); return { duplicate: false, matched: Boolean(roulette) };
  }
  pump() {
    this.close();
    if (!this.data.active && this.data.queue.length) {
      const item = this.data.queue.shift();
      const prize = this.pick(item.roulette.prizes);
      this.data.active = { ...item, prize, startedAt: this.now(), endsAt: this.now() + item.roulette.durationMs, settled: false };
      this.change();
    }
    const active = this.data.active;
    if (!active) return;
    if (!active.settled && this.now() >= active.endsAt) {
      const delta = active.prize.meso * (active.roulette.kind === 'attack' ? 1 : -1);
      const previous = this.data.balance;
      const lower = this.data.config.allowNegative ? -MAX_TOTAL : 0;
      this.data.balance = Math.max(lower, Math.min(MAX_TOTAL, previous + delta));
      active.settled = true;
      active.result = { id: active.id, nickname: active.donation.nickname, provider: active.donation.provider, test: active.donation.test,
        rouletteName: active.roulette.name, kind: active.roulette.kind, meso: active.prize.meso, delta,
        actualDelta: this.data.balance - previous, balance: this.data.balance, endedAt: active.endsAt };
      this.data.history.unshift(active.result); this.data.history = this.data.history.slice(0, 500);
      this.change();
    }
    if (this.now() >= active.endsAt + active.roulette.resultHoldMs) {
      this.data.active = null; this.change(); this.pump(); return;
    }
    const next = active.settled ? active.endsAt + active.roulette.resultHoldMs : active.endsAt;
    this.timer = setTimeout(() => this.pump(), Math.max(1, next - this.now()));
    this.timer.unref();
  }
  cursor() { return this.data.youtubeCursor; }
  setCursor(cursor) { this.data.youtubeCursor = cursor; this.save(); }
}
