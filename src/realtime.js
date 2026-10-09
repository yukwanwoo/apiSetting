import { randomUUID } from 'node:crypto';

// Source protocols do not always carry a transaction ID. Never deduplicate by
// nickname, amount, fan order or payload hash: two identical donations are valid.
export class Receiver {
  constructor(engine, provider) {
    this.engine = engine; this.provider = provider; this.running = false;
    this.deliverySession = randomUUID(); this.sequence = 0; this.retryTimer = null;
    this.status = { state: 'not_configured', detail: '연결 정보를 설정하세요.', received: 0, ignored: 0, lastReceivedAt: null };
  }
  deliveryId(prefix = 'live') { return `${prefix}-${this.deliverySession}-${++this.sequence}`; }
  accept(donation, options = {}) {
    if (!this.running) return false;
    try {
      this.engine.receive(this.provider, donation, options);
      this.status.received++; this.status.lastReceivedAt = Date.now();
      this.status.state = 'connected'; this.status.detail = '후원 이벤트 수신 중'; return true;
    } catch {
      // Do not echo external payloads/URLs/tokens in errors.
      this.status.state = 'error'; this.status.detail = '후원 처리 실패: 금액 형식·룰렛 대기열·저장 공간을 확인하세요.';
      return false;
    }
  }
  retry(fn, detail = '연결이 끊겼습니다. 10초 후 다시 연결합니다.') {
    if (!this.running || this.retryTimer) return;
    this.status.state = 'reconnecting'; this.status.detail = detail;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.running) void fn(); }, 10_000);
    this.retryTimer.unref();
  }
  stop() { this.running = false; clearTimeout(this.retryTimer); this.retryTimer = null; }
}
