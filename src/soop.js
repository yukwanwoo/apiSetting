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
export class SoopConnector extends Receiver {
  constructor(engine, connections, { chatFactory = options => new SoopChat(options) } = {}) {
    super(engine, 'soop'); this.connections = connections; this.chatFactory = chatFactory; this.chat = null;
    this.status.detail = 'SOOP 방송 URL 저장 후 연결하세요.';
  }
  configured() { return Boolean(this.connections.data.soop?.enabled && this.connections.data.sources.soop); }
  start() { if (!this.configured() || this.running) return; this.running = true; void this.connect(); }
  async connect() {
    if (!this.running) return;
    try {
      const streamerId = soopStreamerId(this.connections.data.sources.soop);
      const chat = this.chat = this.chatFactory({ streamerId, reconnect: true });
      this.status.state = 'connecting'; this.status.detail = 'SOOP 공개 방송에 연결 중';
      chat.on('stateChange', event => {
        if (!this.running || this.chat !== chat) return;
        if (event.current === 'connected') { this.status.state = 'listening'; this.status.detail = 'SOOP 공개 채팅 연결 · 별풍선 후원을 기다리는 중'; }
        else if (event.current === 'reconnecting') { this.status.state = 'reconnecting'; this.status.detail = 'SOOP 방송 재연결 중'; }
      });
      chat.on('event', event => { if (!this.running || this.chat !== chat) return; try { const donation = parseSoopDonation(event, this.deliveryId(), streamerId); if (donation) this.accept(donation); } catch { this.status.state = 'error'; this.status.detail = 'SOOP 후원 이벤트 형식을 확인하세요.'; } });
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
