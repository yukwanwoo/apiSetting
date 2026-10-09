import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { InputError, PROVIDERS } from './engine.js';

export function validateSources(sources) {
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) throw new InputError('플랫폼별 URL을 입력하세요.');
  const hosts = {
    chzzk: ['chzzk.naver.com'], soop: ['play.sooplive.co.kr', 'www.sooplive.co.kr', 'sooplive.co.kr'],
    youtube: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'], toonation: ['toon.at', 'www.toon.at']
  };
  return Object.fromEntries(PROVIDERS.map(provider => {
    const raw = sources[provider] ?? '';
    if (typeof raw !== 'string' || raw.length > 1000) throw new InputError('방송 URL을 확인하세요.');
    if (!raw.trim()) return [provider, ''];
    let url;
    try { url = new URL(raw.trim()); } catch { throw new InputError(`${provider}: 올바른 URL을 입력하세요.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[provider].includes(url.hostname)) throw new InputError(`${provider}: 공식 HTTPS 방송·후원 URL을 입력하세요.`);
    url.hash = '';
    if (provider === 'youtube' && !youtubeVideoId(url.href)) throw new InputError('YouTube 라이브 동영상 URL을 입력하세요. 채널 URL은 지원하지 않습니다.');
    return [provider, url.href];
  }));
}
export function youtubeVideoId(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:live|shorts)\/([^/]+)/)?.[1];
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
  } catch { return ''; }
}
export class Connections {
  constructor(dataDir, env = process.env, { fetchImpl = fetch } = {}) {
    this.file = resolve(dataDir, 'connections.json'); this.env = env; this.fetch = fetchImpl; this.pending = new Map();
    mkdirSync(dataDir, { recursive: true });
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { sources: Object.fromEntries(PROVIDERS.map(p => [p, ''])), youtube: {} };
    const base = env.PUBLIC_BASE_URL || `http://127.0.0.1:${env.PORT || 3000}`;
    const url = new URL(base);
    if (url.username || url.password || !['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('PUBLIC_BASE_URL must use HTTPS except on localhost.');
    this.redirectUri = `${url.origin}/oauth/youtube/callback`;
  }
  save() { const tmp = `${this.file}.tmp`; writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 }); renameSync(tmp, this.file); }
  runtime() {
    return {
      ...this.env,
      YOUTUBE_CLIENT_ID: this.env.YOUTUBE_CLIENT_ID || this.data.youtube.clientId || '',
      YOUTUBE_CLIENT_SECRET: this.env.YOUTUBE_CLIENT_SECRET || this.data.youtube.clientSecret || '',
      YOUTUBE_REFRESH_TOKEN: this.env.YOUTUBE_REFRESH_TOKEN || this.data.youtube.refreshToken || '',
      YOUTUBE_VIDEO_ID: youtubeVideoId(this.data.sources.youtube) || this.env.YOUTUBE_VIDEO_ID || ''
    };
  }
  metadata() { const runtime = this.runtime(); return { redirectUri: this.redirectUri, appConfigured: Boolean(runtime.YOUTUBE_CLIENT_ID && runtime.YOUTUBE_CLIENT_SECRET), authConfigured: Boolean(runtime.YOUTUBE_ACCESS_TOKEN || runtime.YOUTUBE_REFRESH_TOKEN) }; }
  setSources(sources) { this.data.sources = validateSources(sources); this.save(); }
  setApp({ clientId, clientSecret }) {
    if (this.env.YOUTUBE_CLIENT_ID || this.env.YOUTUBE_CLIENT_SECRET) throw new InputError('OAuth 앱이 환경 변수로 설정되어 있습니다. 서버 환경 설정에서 변경하세요.');
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9._-]{5,250}\.apps\.googleusercontent\.com$/.test(clientId)) throw new InputError('Google OAuth Client ID를 확인하세요.');
    if (typeof clientSecret !== 'string' || clientSecret.length > 500) throw new InputError('Client Secret을 확인하세요.');
    if (!clientSecret && (!this.data.youtube.clientSecret || clientId !== this.data.youtube.clientId)) throw new InputError('새 OAuth 앱의 Client Secret을 입력하세요.');
    if (clientId !== this.data.youtube.clientId || clientSecret) { delete this.data.youtube.refreshToken; delete this.data.youtube.accessToken; }
    this.data.youtube.clientId = clientId;
    if (clientSecret) this.data.youtube.clientSecret = clientSecret;
    this.save();
  }
  authorize() {
    if (!this.metadata().appConfigured) throw new InputError('Google OAuth 앱 설정이 필요합니다.');
    const now = Date.now();
    for (const [key, pending] of this.pending) if (pending.expiresAt < now) this.pending.delete(key);
    if (this.pending.size >= 10) throw new InputError('진행 중인 인증 요청을 마친 뒤 다시 시도하세요.');
    const state = randomBytes(32).toString('hex');
    this.pending.set(state, { expiresAt: now + 600_000 });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: this.runtime().YOUTUBE_CLIENT_ID, redirect_uri: this.redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state });
  }
  async callback(params) {
    const state = params.get('state'), pending = this.pending.get(state); this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now()) throw new InputError('인증 요청이 만료되었거나 유효하지 않습니다. 다시 연결하세요.');
    if (params.get('error')) throw new InputError('Google 계정 연결을 완료하지 않았습니다.');
    const code = params.get('code'); if (!code || code.length > 3000) throw new InputError('인증 코드가 없습니다.');
    const runtime = this.runtime();
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ code, client_id: runtime.YOUTUBE_CLIENT_ID, client_secret: runtime.YOUTUBE_CLIENT_SECRET, redirect_uri: this.redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw new InputError(`Google 인증 교환에 실패했습니다 (HTTP ${response.status}).`);
    const result = await response.json();
    if (!result.refresh_token) throw new InputError('오프라인 인증 토큰이 없습니다. Google 계정에서 기존 접근 권한 해제 후 다시 연결하세요.');
    this.data.youtube.refreshToken = result.refresh_token; this.save();
  }
  disconnect() {
    if (this.env.YOUTUBE_REFRESH_TOKEN || this.env.YOUTUBE_ACCESS_TOKEN) throw new InputError('환경 변수로 주입된 YouTube 인증은 서버 환경 설정에서 제거하세요.');
    delete this.data.youtube.refreshToken; this.pending.clear(); this.save();
  }
}
