import WebSocket from 'ws';
import { Receiver } from './realtime.js';
import { InputError } from './engine.js';

export function validateToonationWidget(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) throw new InputError('투네이션 알림 위젯 URL을 확인하세요.');
  if (!raw.trim()) return '';
  let url; try { url = new URL(raw.trim()); } catch { throw new InputError('올바른 투네이션 알림 위젯 URL을 입력하세요.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'toon.at' || url.username || url.password || url.port || !/^\/widget\/alertbox\/[A-Za-z0-9_-]{16,200}\/?$/.test(url.pathname) || url.search || url.hash) throw new InputError('https://toon.at/widget/alertbox/… 형식의 알림 위젯 URL을 입력하세요. 일반 후원 페이지는 사용할 수 없습니다.');
  return url.href;
}
export function toonationPayload(html) {
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Invalid widget page');
  // Parse a JSON string literal only. Do not evaluate remote JavaScript.
  const match = html.match(/["']payload["']\s*:\s*"([A-Za-z0-9_-]{8,2048})"/);
  if (!match) throw new Error('Widget credentials not found');
  return match[1];
}
export function parseToonationDonation(raw, eventId) {
  const event = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (event?.code !== 101 || !event.content || typeof event.content !== 'object') return null;
  const content = event.content;
  const amount = typeof content.amount === 'string' || typeof content.amount === 'number' ? Number(content.amount) : NaN;
  const nickname = content.name || content.nickname;
  if (!Number.isSafeInteger(amount) || amount < 1 || typeof nickname !== 'string' || !nickname.trim()) throw new InputError('투네이션 후원 필드(name/amount)를 확인하세요.');
  // UID/account identify the donor in some widget versions, not a payment.
  // Never use them as a transaction ID or collapse equal-value donations.
  return { donation: { eventId, nickname, amount, unit: 'KRW' }, test: content.is_test === true || content.is_test === 1 };
}
export class ToonationConnector extends Receiver {
  constructor(engine, connections, { fetchImpl = fetch, socketFactory = url => new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 1_048_576 }) } = {}) {
    super(engine, 'toonation'); this.connections = connections; this.fetch = fetchImpl; this.socketFactory = socketFactory;
    this.controller = new AbortController(); this.socket = null; this.pingTimer = null; this.pongTimer = null;
    this.status.detail = '투네이션 알림 위젯 URL을 입력하세요.';
  }
  configured() { return Boolean(this.connections.data.toonation?.widgetUrl); }
  start() { if (!this.configured() || this.running) return; this.running = true; void this.connect(); }
  async connect() {
    if (!this.running) return;
    this.clearSocket(); this.status.state = 'connecting'; this.status.detail = '투네이션 알림 위젯 연결 중';
    try {
      const url = validateToonationWidget(this.connections.data.toonation.widgetUrl);
      // Never follow redirects carrying a private widget URL to arbitrary hosts.
      const response = await this.fetch(url, { redirect: 'error', headers: { 'User-Agent': 'MesoLive/1.0', Accept: 'text/html' }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error('Widget HTTP error');
      if (Number(response.headers?.get('content-length')) > 2_000_000) throw new Error('Widget page too large');
      const payload = toonationPayload(await response.text());
      if (!this.running) return;
      const socket = this.socket = this.socketFactory(`wss://ws.toon.at/${encodeURIComponent(payload)}`);
      socket.on('open', () => {
        if (!this.running || this.socket !== socket) return;
        this.status.state = 'listening'; this.status.detail = '투네이션 위젯 연결 · 첫 후원을 기다리는 중';
        this.pingTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN && !this.pongTimer) { socket.ping('#ping'); this.pongTimer = setTimeout(() => this.failed(), 20_000); this.pongTimer.unref(); } }, 12_000); this.pingTimer.unref();
      });
      socket.on('pong', () => { clearTimeout(this.pongTimer); this.pongTimer = null; });
      socket.on('message', raw => {
        if (!this.running || this.socket !== socket) return;
        try {
          const parsed = parseToonationDonation(raw.toString(), this.deliveryId());
          if (!parsed) { this.status.ignored++; return; }
          // Provider test alerts must never mutate the production balance.
          if (parsed.test) { this.status.ignored++; this.status.detail = '투네이션 테스트 알림 수신 확인 · 실제 잔액에는 반영하지 않음'; return; }
          this.accept(parsed.donation);
        } catch { this.status.state = 'error'; this.status.detail = '투네이션 알림 형식 처리 실패. 위젯 버전·후원 필드를 확인하세요.'; }
      });
      socket.on('error', () => { if (this.socket === socket) this.failed(); });
      socket.on('close', () => { if (this.socket === socket) this.failed(); });
    } catch { if (this.running) this.failed('투네이션 위젯 연결 실패. 위젯 URL 유효성·접근 권한·서비스 형식 변경을 확인하세요.'); }
  }
  failed(detail) { this.clearSocket(); this.retry(() => this.connect(), detail); }
  clearSocket() { clearInterval(this.pingTimer); clearTimeout(this.pongTimer); this.pongTimer = null; const socket = this.socket; this.socket = null; if (socket) socket.terminate(); }
  stop() { super.stop(); this.controller.abort(); this.clearSocket(); }
}
