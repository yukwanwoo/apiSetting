import { InputError } from './engine.js';
import { youtubeVideoId } from './connections.js';
const ORIGIN = 'https://www.youtube.com';
const MAX_RESPONSE = 8 * 1024 * 1024;
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' };
class PublicChatError extends Error {
  constructor(message, state = 'error') { super(message); this.state = state; }
}
function text(value) { return value?.simpleText ?? (Array.isArray(value?.runs) ? value.runs.map(r => r.text ?? '').join('') : ''); }
function find(object, key) {
  const queue = [object]; let visited = 0;
  while (queue.length && visited++ < 30000) {
    const item = queue.shift(); if (!item || typeof item !== 'object') continue;
    if (Object.hasOwn(item, key)) return item[key];
    for (const child of Object.values(item)) if (child && typeof child === 'object') queue.push(child);
  }
}
// Extract only JSON literals, never execute remote page scripts.
function jsonAt(source, offset) {
  while (/\s/.test(source[offset] || '') && offset < source.length) offset++;
  if (source[offset] !== '{') return;
  let depth = 0, quoted = false, escaped = false;
  for (let i = offset; i < source.length; i++) {
    const c = source[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(source.slice(offset, i + 1)); } catch { return; } }
  }
}
export function extractChatPage(html) {
  let initial;
  for (const match of html.matchAll(/(?:\bytInitialData\s*=|window\[\s*["']ytInitialData["']\s*\]\s*=)\s*/g)) { initial = jsonAt(html, match.index + match[0].length); if (initial) break; }
  const config = Object.create(null);
  for (const match of html.matchAll(/\bytcfg\.set\(\s*/g)) Object.assign(config, jsonAt(html, match.index + match[0].length));
  return { initial, config };
}
export function krwAmount(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.normalize('NFKC').trim();
  const match = value.match(/^(?:₩|￦|KRW)\s*([0-9][0-9,]*)\s*(?:원)?$/i) || value.match(/^([0-9][0-9,]*)\s*(?:원|KRW)$/i);
  if (!match) return null;
  const digits = match[1];
  if (!/^\d+$/.test(digits) && !/^\d{1,3}(?:,\d{3})+$/.test(digits)) return null;
  const amount = Number(digits.replaceAll(',', ''));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000 ? amount : null;
}
function continuation(chat) {
  for (const row of chat?.continuations ?? []) {
    const value = row.invalidationContinuationData ?? row.timedContinuationData ?? row.reloadContinuationData;
    if (typeof value?.continuation === 'string' && value.continuation.length > 0 && value.continuation.length <= 50000) return { token: value.continuation, delay: Math.max(1000, Math.min(30000, Number(value.timeoutMs) || 5000)) };
  }
  return null;
}
export function paidRenderers(actions) {
  const result = [];
  for (const action of actions ?? []) {
    // Replay/history/ticker/banner duplicates are deliberately excluded.
    const item = action.addChatItemAction?.item ?? action.replaceChatItemAction?.replacementItem;
    const renderer = item?.liveChatPaidMessageRenderer ?? item?.liveChatPaidStickerRenderer;
    if (renderer) result.push(renderer);
  }
  return result;
}
export class YouTubePublicConnector {
  constructor(engine, connections, { fetchImpl = fetch, now = Date.now } = {}) {
    this.engine = engine; this.connections = connections; this.fetch = fetchImpl; this.now = now; this.timer = null; this.running = false;
    this.abortController = new AbortController(); this.session = null; this.startedAt = 0;
    this.status = { state: 'not_configured', detail: 'YouTube 팝업 채팅 URL을 저장하고 연결하세요.', received: 0, skippedCurrency: 0,
      diagnostics: { polls: 0, chatMessages: 0, donationPackets: 0, ignoredHistory: 0, malformedDonations: 0, duplicates: 0, lastPacketAt: null } };
    this.sessionSeen = new Set();
  }
  configured() { return Boolean(this.connections.data.youtube.enabled && youtubeVideoId(this.connections.data.sources.youtube)); }
  async request(url, options = {}) {
    const response = await this.fetch(url, { ...options, redirect: 'manual', headers: { ...headers, ...options.headers }, signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(15000)]) });
    if (this.abortController.signal.aborted) throw new Error('Stopped');
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) throw new PublicChatError('YouTube 공개 채팅에 접근할 수 없습니다. 로그인·동의·제한 여부를 확인하세요.', 'auth_required');
    if (response.status === 429) throw new PublicChatError('YouTube 요청 제한입니다. 잠시 후 다시 연결하세요.');
    if (!response.ok) throw new PublicChatError(`YouTube 공개 채팅 HTTP ${response.status}`);
    let body;
    if (response.body?.getReader) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_RESPONSE) { await reader.cancel(); throw new PublicChatError('YouTube 공개 채팅 응답이 너무 큽니다.'); } chunks.push(Buffer.from(value)); }
      body = Buffer.concat(chunks).toString('utf8');
    } else body = await response.text();
    if (Buffer.byteLength(body) > MAX_RESPONSE) throw new PublicChatError('YouTube 공개 채팅 응답이 너무 큽니다.');
    if (this.abortController.signal.aborted) throw new Error('Stopped');
    return body;
  }
  async initialize() {
    const videoId = youtubeVideoId(this.connections.data.sources.youtube);
    if (!videoId) throw new PublicChatError('YouTube 팝업 채팅 URL을 확인하세요.');
    const html = await this.request(`${ORIGIN}/live_chat?${new URLSearchParams({ is_popout: '1', v: videoId, hl: 'ko', gl: 'KR' })}`);
    let { initial, config } = extractChatPage(html);
    let chat = initial?.continuationContents?.liveChatContinuation ?? find(initial, 'liveChatRenderer');
    if (find(initial, 'liveChatReplayRenderer') || (chat?.continuations ?? []).some(r => r.liveChatReplayContinuationData)) throw new PublicChatError('YouTube 채팅 다시보기는 지원하지 않습니다. 현재 진행 중인 방송을 연결하세요.', 'offline');
    let next = continuation(chat);
    const menus = find(chat, 'sortFilterSubMenuRenderer')?.subMenuItems;
    const unfiltered = menus?.[1]?.continuation?.reloadContinuationData?.continuation;
    if (typeof unfiltered === 'string' && unfiltered.length <= 50000 && unfiltered) next = { token: unfiltered, delay: 1000 };
    if (chat?.isReplay) throw new PublicChatError('YouTube 채팅 다시보기는 지원하지 않습니다.', 'offline');
    if (!initial?.continuationContents?.liveChatContinuation && next) {
      const boot = extractChatPage(await this.request(`${ORIGIN}/live_chat?${new URLSearchParams({ continuation: next.token, hl: 'ko', gl: 'KR' })}`));
      initial = boot.initial; config = { ...config, ...boot.config };
      chat = initial?.continuationContents?.liveChatContinuation;
      if (chat?.isReplay || (chat?.continuations ?? []).some(r => r.liveChatReplayContinuationData)) throw new PublicChatError('YouTube 채팅 다시보기는 지원하지 않습니다.', 'offline');
      next = continuation(chat);
    }
    const client = config.INNERTUBE_CONTEXT?.client;
    if (!initial || !chat || !next || !client || typeof client.clientVersion !== 'string' || typeof config.INNERTUBE_API_KEY !== 'string' || !/^[a-zA-Z0-9_-]{10,200}$/.test(config.INNERTUBE_API_KEY)) throw new PublicChatError('공개 라이브 채팅 접속 정보를 찾지 못했습니다. 방송 종료·채팅 비활성·로그인 제한 또는 YouTube 형식 변경을 확인하세요.');
    const timestamp = this.now();
    this.session = { videoId, apiKey: config.INNERTUBE_API_KEY, context: structuredClone(config.INNERTUBE_CONTEXT), clientName: String(config.INNERTUBE_CONTEXT_CLIENT_NAME ?? '1'), continuation: next.token };
    this.startedAt = this.startedAt || timestamp;
    // Seed initial page IDs, but never replay their paid messages.
    this.consume(chat.actions, true);
    this.status.state = 'listening'; this.status.detail = 'YouTube 공개 채팅 연결 · KRW Super Chat·Super Sticker 후원을 기다리는 중';
    return 1000;
  }
  remember(id) { this.sessionSeen.add(id); if (this.sessionSeen.size > 10000) this.sessionSeen.delete(this.sessionSeen.values().next().value); }
  consume(actions, history = false) {
    const d = this.status.diagnostics;
    for (const action of actions ?? []) if (action.addChatItemAction?.item?.liveChatTextMessageRenderer) d.chatMessages++;
    for (const renderer of paidRenderers(actions)) {
      d.donationPackets++;
      const id = renderer.id, nickname = text(renderer.authorName), rawAmount = text(renderer.purchaseAmountText);
      if (typeof id !== 'string' || !id || id.length > 180 || !nickname.trim() || nickname.length > 100) { d.malformedDonations++; continue; }
      const timestamp = Number(renderer.timestampUsec) / 1000;
      if (history || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp < this.startedAt) { d.ignoredHistory++; this.remember(id); continue; }
      if (timestamp > this.now() + 300000 || !rawAmount.trim()) { d.malformedDonations++; continue; }
      if (this.sessionSeen.has(id)) { d.duplicates++; continue; }
      const amount = krwAmount(rawAmount);
      if (amount === null) { this.remember(id); if (/₩|￦|KRW|원/i.test(rawAmount)) d.malformedDonations++; else this.status.skippedCurrency++; continue; }
      const result = this.engine.receive('youtube', { eventId: `public-${id}`, nickname, amount, unit: 'KRW' });
      this.remember(id);
      if (result.duplicate) d.duplicates++;
      else { this.status.received++; this.status.state = 'connected'; this.status.detail = 'YouTube 공개 채팅 · KRW Super Chat·Super Sticker 후원 수신 확인'; }
    }
  }
  async poll() {
    if (!this.session) return this.initialize();
    const session = this.session;
    const body = JSON.stringify({ context: session.context, continuation: session.continuation });
    const html = await this.request(`${ORIGIN}/youtubei/v1/live_chat/get_live_chat?${new URLSearchParams({ key: session.apiKey, prettyPrint: 'false' })}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Referer: `${ORIGIN}/live_chat?is_popout=1&v=${session.videoId}`, 'X-Youtube-Client-Name': session.clientName, 'X-Youtube-Client-Version': session.context.client.clientVersion, ...(session.context.client.visitorData ? { 'X-Goog-Visitor-Id': session.context.client.visitorData } : {}) }, body
    });
    let data; try { data = JSON.parse(html); } catch { throw new PublicChatError('YouTube 공개 채팅 응답 형식을 확인할 수 없습니다.'); }
    const chat = data.continuationContents?.liveChatContinuation;
    if (!chat) throw new PublicChatError('YouTube 라이브 채팅이 종료됐거나 접속 정보를 갱신해야 합니다.');
    if ((chat.continuations ?? []).some(r => r.liveChatReplayContinuationData)) throw new PublicChatError('YouTube 채팅 다시보기는 지원하지 않습니다.', 'offline');
    this.status.diagnostics.polls++; this.status.diagnostics.lastPacketAt = this.now();
    // Continuations can include backlog: accept only timestamped events since connection.
    this.consume(chat.actions);
    const next = continuation(chat);
    if (!next) { this.status.state = 'offline'; this.status.detail = 'YouTube 라이브 채팅이 종료되었습니다.'; this.session = null; return 30000; }
    session.continuation = next.token;
    if (this.status.state !== 'connected') { this.status.state = this.status.received ? 'connected' : 'listening'; this.status.detail = this.status.received ? 'YouTube 공개 채팅 · 후원 수신 확인' : 'YouTube 공개 채팅 연결 · 후원을 기다리는 중'; }
    return next.delay;
  }
  start() {
    if (!this.configured() || this.running) return;
    this.running = true; this.startedAt = this.now(); this.status.state = 'connecting'; this.status.detail = 'YouTube 공개 채팅 연결 중…';
    const run = async () => {
      if (!this.running) return;
      let delay = 15000;
      try { delay = await this.poll(); }
      catch (error) { if (!this.running) return; if (!(error instanceof InputError)) this.session = null; this.status.state = error instanceof PublicChatError ? error.state : 'error'; this.status.detail = error instanceof PublicChatError || error instanceof InputError ? error.message : 'YouTube 공개 채팅 연결에 실패했습니다. 네트워크와 방송 상태를 확인하세요.'; }
      if (this.running) { this.timer = setTimeout(run, delay); this.timer.unref(); }
    };
    void run();
  }
  stop() { this.running = false; this.session = null; this.abortController.abort(); clearTimeout(this.timer); }
}
