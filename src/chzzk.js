import WebSocket from 'ws';
import { Receiver } from './realtime.js';
import { InputError } from './engine.js';

const API = 'https://openapi.chzzk.naver.com';
export function chzzkSocketUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.nchat\.naver\.com$/.test(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid CHZZK session URL');
  url.protocol = 'wss:'; url.pathname = '/socket.io/';
  url.searchParams.set('EIO', '3'); url.searchParams.set('transport', 'websocket');
  return url.href;
}
export function parseChzzkDonation(raw, eventId, expectedChannel) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || !['CHAT', 'VIDEO'].includes(data.donationType)) return null;
  if (expectedChannel && data.channelId !== expectedChannel) throw new InputError('치지직 후원 채널이 연결한 계정과 다릅니다.');
  if (typeof data.payAmount !== 'number' && typeof data.payAmount !== 'string') throw new InputError('치지직 후원 금액이 없습니다.');
  const amount = Number(data.payAmount);
  if (!Number.isSafeInteger(amount) || amount < 1) throw new InputError('치지직 후원 금액을 확인하세요.');
  return { eventId: typeof data.donationId === 'string' ? data.donationId : eventId, nickname: data.donatorNickname || '익명의 후원자', unit: 'KRW', amount };
}

// CHZZK specifies Socket.IO <=2.0.3 / Engine.IO v3. Implement its small
// WebSocket-only subset without introducing obsolete Socket.IO dependencies.
export class ChzzkConnector extends Receiver {
  constructor(engine, connections, { fetchImpl = fetch, socketFactory = url => new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 1_048_576 }) } = {}) {
    super(engine, 'chzzk'); this.connections = connections; this.fetch = fetchImpl; this.socketFactory = socketFactory;
    this.socket = null; this.pingTimer = null; this.pongTimer = null; this.readyTimer = null; this.controller = new AbortController();
    this.status.detail = '치지직 계정을 연결하세요.';
  }
  configured() { const c = this.connections.chzzkCredentials(); return Boolean(c.clientId && c.clientSecret && (c.accessToken || c.refreshToken)); }
  async token() {
    const credentials = this.connections.chzzkCredentials();
    if (credentials.accessToken && Date.now() < credentials.expiresAt - 60_000) return credentials.accessToken;
    if (!credentials.refreshToken) throw new Error('auth');
    const response = await this.fetch(`${API}/auth/v1/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grantType: 'refresh_token', clientId: credentials.clientId, clientSecret: credentials.clientSecret, refreshToken: credentials.refreshToken }), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); if (!this.running) throw new Error('stopped');
    this.connections.setChzzkTokens(data.content || data); return this.connections.chzzkCredentials().accessToken;
  }
  async api(path, method = 'GET') {
    const token = await this.token();
    const response = await this.fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) { if (response.status === 401) this.connections.expireChzzkToken(); throw new Error(`HTTP ${response.status}`); }
    const data = await response.json(); if (data.code && String(data.code) !== '200') throw new Error('API error'); return data.content || data;
  }
  start() { if (!this.configured() || this.running) return; this.running = true; void this.connect(); }
  async connect() {
    if (!this.running) return;
    this.clearSocket(); this.status.state = 'connecting'; this.status.detail = '치지직 후원 이벤트 구독 중';
    try {
      const user = await this.api('/open/v1/users/me');
      if (!this.running) return;
      this.channelId = user.channelId;
      const source = this.connections.data.sources.chzzk;
      const sourceChannel = source ? new URL(source).pathname.split('/').filter(Boolean).at(-1) : '';
      if (!this.channelId || (sourceChannel && sourceChannel !== this.channelId)) throw new Error('channel mismatch');
      const session = await this.api('/open/v1/sessions/auth');
      if (!this.running) return;
      const socket = this.socket = this.socketFactory(chzzkSocketUrl(session.url));
      this.readyTimer = setTimeout(() => { if (this.socket === socket) this.failed(); }, 20_000); this.readyTimer.unref();
      socket.on('message', data => { if (this.running && this.socket === socket) void this.frame(data.toString()); });
      socket.on('error', () => { if (this.socket === socket) this.failed(); });
      socket.on('close', () => { if (this.socket === socket) this.failed(); });
    } catch (error) {
      if (!this.running) return;
      this.failed(error.message === 'channel mismatch' ? '입력한 치지직 방송 URL과 인증 계정이 다릅니다. URL 또는 계정을 확인하세요.' : '치지직 연결 실패. 앱의 후원 조회·유저 정보 조회 권한, 계정 인증과 네트워크를 확인하세요.');
    }
  }
  async frame(frame) {
    try {
      if (frame.startsWith('0')) {
        const info = JSON.parse(frame.slice(1));
        const interval = Math.max(1000, Math.min(120_000, Number(info.pingInterval) || 25_000));
        const timeout = Math.max(1000, Math.min(120_000, Number(info.pingTimeout) || 60_000));
        this.socket.send('40');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => { if (this.socket?.readyState === WebSocket.OPEN && !this.pongTimer) { this.socket.send('2'); this.pongTimer = setTimeout(() => this.failed(), timeout); this.pongTimer.unref(); } }, interval); this.pingTimer.unref();
      } else if (frame === '3') { clearTimeout(this.pongTimer); this.pongTimer = null; }
      else if (frame === '2') this.socket.send('3');
      else if (frame.startsWith('42')) {
        const [event, raw] = JSON.parse(frame.slice(2));
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (event === 'SYSTEM' && data.type === 'connected') {
          const socket = this.socket;
          if (typeof data.data?.sessionKey !== 'string') throw new Error('session key');
          await this.api(`/open/v1/sessions/events/subscribe/donation?sessionKey=${encodeURIComponent(data.data.sessionKey)}`, 'POST');
          if (!this.running || this.socket !== socket) return;
          clearTimeout(this.readyTimer); this.status.state = 'listening'; this.status.detail = '치지직 후원 구독 완료 · 첫 후원을 기다리는 중';
        } else if (event === 'SYSTEM' && data.type === 'revoked') {
          this.clearSocket(); this.status.state = 'auth_required'; this.status.detail = '치지직 권한이 해제되었습니다. 계정을 다시 연결하세요.';
        } else if (event === 'DONATION') {
          const donation = parseChzzkDonation(data, this.deliveryId(), this.channelId);
          if (donation) this.accept(donation); else this.status.ignored++;
        }
      }
    } catch { if (this.running) { this.status.state = 'error'; this.status.detail = '치지직 이벤트 또는 구독 응답 처리 실패. 권한과 API 변경 여부를 확인하세요.'; } }
  }
  failed(detail) { this.clearSocket(); this.retry(() => this.connect(), detail); }
  clearSocket() {
    clearInterval(this.pingTimer); clearTimeout(this.pongTimer); clearTimeout(this.readyTimer); this.pongTimer = null;
    const socket = this.socket; this.socket = null; if (socket) socket.terminate();
  }
  stop() { super.stop(); this.controller.abort(); this.clearSocket(); }
}
