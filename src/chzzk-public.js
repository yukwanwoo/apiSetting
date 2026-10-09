import WebSocket from 'ws';
import { Receiver } from './realtime.js';
import { InputError } from './engine.js';

export function chzzkChannelId(raw) {
  if (!raw) return '';
  const url = new URL(raw);
  const match = url.pathname.match(/^\/(?:live\/)?([a-f0-9]{32})\/?$/);
  if (url.protocol !== 'https:' || url.hostname !== 'chzzk.naver.com' || !match || url.username || url.password || url.port) throw new InputError('치지직 방송 URL을 확인하세요.');
  return match[1];
}
export function parsePublicChzzkFrame(frame, nextId) {
  // Never request/replay the recent-chat backlog as new paid donations.
  if (![93101, 93102].includes(frame?.cmd)) return [];
  const messages = frame.bdy?.messageList || frame.bdy;
  if (!Array.isArray(messages)) throw new InputError('치지직 채팅 메시지 배열이 없습니다.');
  const result = [];
  for (const message of messages) {
    if ((message.msgTypeCode || message.messageTypeCode) !== 10) continue;
    const extras = typeof message.extras === 'string' ? JSON.parse(message.extras) : message.extras;
    const profile = typeof message.profile === 'string' ? JSON.parse(message.profile) : message.profile;
    // Mission notifications can be state updates rather than completed payments.
    if (!extras || !['CHAT', 'VIDEO'].includes(extras.donationType)) continue;
    const amount = Number(extras.payAmount);
    if (!Number.isSafeInteger(amount) || amount < 1) throw new InputError('치지직 후원 금액 형식을 확인하세요.');
    result.push({ eventId: nextId(), nickname: extras.isAnonymous ? '익명의 후원자' : profile?.nickname || extras.nickname || '익명의 후원자', amount, unit: 'KRW' });
  }
  return result;
}

// Public, read-only chat protocol, as documented by kimcore/chzzk 1.10.4.
// This mode does not log in, send chat, extract cookies or bypass restricted rooms.
export class ChzzkPublicConnector extends Receiver {
  constructor(engine, connections, { fetchImpl = fetch, socketFactory = url => new WebSocket(url, { handshakeTimeout: 15_000, maxPayload: 1_048_576 }) } = {}) {
    super(engine, 'chzzk'); this.connections = connections; this.fetch = fetchImpl; this.socketFactory = socketFactory;
    this.controller = new AbortController(); this.socket = null; this.pingTimer = null; this.pongTimer = null; this.pollTimer = null; this.readyTimer = null;
    this.status.detail = '치지직 공개 방송 URL 저장 후 연결하세요.';
  }
  configured() { return Boolean(this.connections.data.chzzk.enabled && this.connections.data.sources.chzzk); }
  async api(url) {
    const response = await this.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15_000)]) });
    if (!response.ok) throw new Error('HTTP error');
    const data = await response.json();
    if (data.code === 42601) throw new Error('restricted');
    if (data.code && data.code !== 200) throw new Error('API error');
    return data.content;
  }
  start() { if (!this.configured() || this.running) return; this.running = true; void this.connect(); }
  async connect() {
    if (!this.running) return;
    this.clearSocket(); this.status.state = 'connecting'; this.status.detail = '치지직 공개 방송 연결 중';
    try {
      const id = chzzkChannelId(this.connections.data.sources.chzzk);
      const live = await this.api(`https://api.chzzk.naver.com/polling/v2/channels/${id}/live-status`);
      if (!this.running) return;
      if (live?.adult) throw new Error('restricted');
      if (!live?.chatChannelId || live.status !== 'OPEN') throw new Error('offline');
      const cid = live.chatChannelId;
      const token = await this.api(`https://comm-api.game.naver.com/nng_main/v1/chats/access-token?${new URLSearchParams({ channelId: cid, chatType: 'STREAMING' })}`);
      if (!this.running) return;
      if (!token?.accessToken) throw new Error('token');
      const serverId = [...cid].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9 + 1;
      const socket = this.socket = this.socketFactory(`wss://kr-ss${serverId}.chat.naver.com/chat`);
      this.readyTimer = setTimeout(() => this.failed(), 20_000); this.readyTimer.unref();
      socket.on('open', () => { if (this.running && this.socket === socket) socket.send(JSON.stringify({ cmd: 100, tid: 1, cid, svcid: 'game', ver: '2', bdy: { accTkn: token.accessToken, auth: 'READ', devType: 2001, uid: null } })); });
      socket.on('message', raw => {
        if (!this.running || this.socket !== socket) return;
        try {
          const frame = JSON.parse(raw.toString());
          if (frame.cmd === 10100) {
            if (!frame.bdy?.sid) throw new Error('handshake');
            clearTimeout(this.readyTimer); this.status.state = 'listening'; this.status.detail = '치지직 공개 방송 연결 · 후원을 기다리는 중';
            clearInterval(this.pingTimer);
            this.pingTimer = setInterval(() => { if (socket.readyState === WebSocket.OPEN && !this.pongTimer) { socket.send(JSON.stringify({ cmd: 0, ver: '2' })); this.pongTimer = setTimeout(() => this.failed(), 30_000); this.pongTimer.unref(); } }, 20_000); this.pingTimer.unref();
          } else if (frame.cmd === 0) socket.send(JSON.stringify({ cmd: 10000, ver: '2' }));
          else if (frame.cmd === 10000) { clearTimeout(this.pongTimer); this.pongTimer = null; }
          else if ([94005, 94006].includes(frame.cmd)) { this.clearSocket(); this.status.state = 'auth_required'; this.status.detail = '치지직 공개 채팅 접근이 제한되었습니다. 공식 계정 연결을 확인하세요.'; }
          else { if (frame.cid && frame.cid !== cid) throw new Error('wrong chat'); for (const donation of parsePublicChzzkFrame(frame, () => this.deliveryId())) this.accept(donation); }
        } catch { this.status.state = 'error'; this.status.detail = '치지직 공개 채팅 이벤트 형식 처리 실패'; }
      });
      socket.on('error', () => { if (this.socket === socket) this.failed(); }); socket.on('close', () => { if (this.socket === socket) this.failed(); });
      const poll = async () => {
        if (!this.running || this.socket !== socket) return;
        try { const latest = await this.api(`https://api.chzzk.naver.com/polling/v2/channels/${id}/live-status`); if (!this.running || this.socket !== socket) return; if (latest?.chatChannelId !== cid || latest?.status !== 'OPEN') { this.failed('치지직 방송 상태가 변경되었습니다. 다시 확인합니다.'); return; } } catch { if (!this.running || this.socket !== socket) return; }
        this.pollTimer = setTimeout(poll, 30_000); this.pollTimer.unref();
      };
      this.pollTimer = setTimeout(poll, 30_000); this.pollTimer.unref();
    } catch (error) {
      if (!this.running) return;
      if (error.message === 'restricted') { this.status.state = 'auth_required'; this.status.detail = '제한 방송은 공개 URL 모드에서 지원하지 않습니다. 공식 계정 연결을 사용하세요.'; return; }
      this.failed(error.message === 'offline' ? '치지직 방송이 종료되어 있습니다. 방송 시작을 다시 확인합니다.' : '치지직 공개 방송 연결 실패. 네트워크·채팅 프로토콜 변경을 확인하세요.');
    }
  }
  failed(detail) { this.clearSocket(); this.retry(() => this.connect(), detail); }
  clearSocket() { clearInterval(this.pingTimer); clearTimeout(this.pongTimer); clearTimeout(this.pollTimer); clearTimeout(this.readyTimer); this.pongTimer = null; const socket = this.socket; this.socket = null; if (socket) socket.terminate(); }
  stop() { super.stop(); this.controller.abort(); this.clearSocket(); }
}
