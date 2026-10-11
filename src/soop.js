import { SoopChat } from 'soop-chat';
import { Receiver } from './realtime.js';
import { InputError } from './engine.js';

export function soopStreamerId(raw) {
  if (!raw) return '';
  const url = new URL(raw);
  if (!['play.sooplive.co.kr', 'www.sooplive.co.kr', 'sooplive.co.kr', 'play.sooplive.com', 'www.sooplive.com', 'sooplive.com'].includes(url.hostname)) throw new InputError('SOOP 방송 URL을 확인하세요.');
  const id = url.pathname.split('/').filter(Boolean)[0] || '';
  if (!/^[a-zA-Z0-9_]{2,50}$/.test(id)) throw new InputError('방송인 ID가 포함된 SOOP 방송 URL을 입력하세요.');
  return id;
}
export function parseSoopDonation(event, eventId, expectedStreamer) {
  if (!['sendBalloon', 'sendBalloonSub', 'videoBalloon'].includes(event?.type)) return null;
  const data = event.data;
  if (!data || data.streamerId !== expectedStreamer) throw new InputError('SOOP 후원 방송인 ID가 다릅니다.');
  const amount = event.type === 'videoBalloon' ? data.balloonCount : data.count;
  if (!Number.isSafeInteger(amount) || amount < 1) throw new InputError('SOOP 별풍선 개수를 확인하세요.');
  return { eventId, nickname: data.senderNickname || '익명의 후원자', amount, unit: 'STAR' };
}
// Metadata after the amount (fan ranking, TTS, signature image, etc.) is not
// needed for roulette. Only use this fallback when the SDK rejects a packet;
// successful SDK events continue through the existing path exactly once.
export function parseSoopFallback(raw, eventId, expectedStreamer) {
  const layout = ({ '0018': [0, 2, 3], '0033': [1, 4, 5], '0105': [1, 3, 4] })[raw?.opcode];
  if (!layout) return null;
  const fields = raw.fields;
  if (!Array.isArray(fields) || fields.length <= Math.max(...layout)) throw new InputError('SOOP 후원 필수 필드가 없습니다.');
  const [recipient, name, count] = layout.map(i => fields[i]);
  if (recipient !== expectedStreamer) throw new InputError('SOOP 후원 방송인 ID가 다릅니다.');
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof count !== 'string' || !/^\d+$/.test(count)) throw new InputError('SOOP 후원 필수 필드 형식이 다릅니다.');
  const amount = Number(count);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) throw new InputError('SOOP 별풍선 개수를 확인하세요.');
  return { eventId, nickname: name, amount, unit: 'STAR' };
}
export class SoopConnector extends Receiver {
  constructor(engine, connections, { chatFactory = options => new SoopChat(options) } = {}) {
    super(engine, 'soop'); this.connections = connections; this.chatFactory = chatFactory; this.chat = null;
    this.status.detail = 'SOOP 방송 URL 저장 후 연결하세요.';
    this.status.diagnostics = { packets: 0, chatMessages: 0, donationPackets: 0, protocolErrors: 0, fallbackDonations: 0, lastPacketAt: null, lastProtocolError: null, opcodes: {} };
  }
  configured() { return Boolean(this.connections.data.soop?.enabled && this.connections.data.sources.soop); }
  start() { if (!this.configured() || this.running) return; this.running = true; void this.connect(); }
  async connect() {
    if (!this.running) return;
    try {
      const streamerId = soopStreamerId(this.connections.data.sources.soop);
      const chat = this.chat = this.chatFactory({ streamerId, reconnect: true });
      this.status.state = 'connecting'; this.status.detail = 'SOOP 공개 방송에 연결 중';
      const current = () => this.running && this.chat === chat;
      chat.on('raw', raw => {
        if (!current()) return;
        const d = this.status.diagnostics; d.packets++; d.lastPacketAt = Date.now();
        if (/^\d{4}$/.test(raw.opcode)) {
          if (Object.keys(d.opcodes).length < 64 || d.opcodes[raw.opcode]) d.opcodes[raw.opcode] = (d.opcodes[raw.opcode] || 0) + 1;
          if (['0018', '0033', '0105'].includes(raw.opcode)) d.donationPackets++;
        }
      });
      chat.on('protocolError', event => {
        if (!current()) return;
        const d = this.status.diagnostics;
        d.protocolErrors++; d.lastProtocolError = { opcode: /^\d{4}$/.test(event.raw?.opcode) ? event.raw.opcode : null, fieldCount: Array.isArray(event.raw?.fields) ? event.raw.fields.length : null };
        try {
          const donation = parseSoopFallback(event.raw, this.deliveryId('compat'), streamerId);
          if (donation && this.accept(donation)) { d.fallbackDonations++; this.status.detail = 'SOOP 후원 수신 중 · 필수 필드 호환 처리'; return; }
          if (!donation) return;
        } catch {
          this.status.state = 'error'; this.status.detail = 'SOOP 별풍선 메시지 해석 실패 · 아래 수신 진단을 확인하세요.';
        }
      });
      chat.on('stateChange', event => {
        if (!this.running || this.chat !== chat) return;
        if (event.current === 'connected') { this.status.state = 'listening'; this.status.detail = 'SOOP 공개 채팅 연결 · 별풍선 후원을 기다리는 중'; }
        else if (event.current === 'reconnecting') { this.status.state = 'reconnecting'; this.status.detail = 'SOOP 방송 재연결 중'; }
      });
      chat.on('event', event => { if (!current()) return; if (event.type === 'chatMessage') this.status.diagnostics.chatMessages++; try { const donation = parseSoopDonation(event, this.deliveryId(), streamerId); if (donation) this.accept(donation); } catch { this.status.state = 'error'; this.status.detail = 'SOOP 후원 이벤트 형식을 확인하세요.'; } });
      chat.on('error', () => { if (this.running && this.chat === chat) { this.status.state = 'error'; this.status.detail = 'SOOP 연결 오류. 공개 방송 여부·네트워크·프로토콜 변경을 확인하세요.'; } });
      chat.on('ended', event => {
        if (!this.running || this.chat !== chat) return;
        if (event.reason === 'restricted') { this.status.state = 'auth_required'; this.status.detail = '성인·구독·비밀번호 제한 방송입니다. 현재 URL 연결은 공개 방송만 지원합니다.'; }
        else { this.status.state = 'offline'; this.status.detail = 'SOOP 방송 종료 · 방송 시작 여부를 다시 확인합니다.'; this.retry(() => this.reconnect()); }
      });
      await chat.connect();
    } catch { if (this.running && this.status.state !== 'auth_required') this.retry(() => this.reconnect(), 'SOOP 방송이 없거나 연결에 실패했습니다. 10초 후 다시 확인합니다.'); }
  }
  async reconnect() { const chat = this.chat; this.chat = null; if (chat) await chat.disconnect(); if (this.running) await this.connect(); }
  stop() { super.stop(); const chat = this.chat; this.chat = null; if (chat) void chat.disconnect().catch(() => {}); }
}
