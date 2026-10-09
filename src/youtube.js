// YouTube Data API v3: authenticated broadcast discovery + liveChatMessages polling.
// OAuth credentials are injected only through the environment; never returned to browsers.
export class YouTubeConnector {
  constructor(engine, { fetchImpl = fetch, env = process.env } = {}) {
    this.engine = engine; this.fetch = fetchImpl; this.env = env; this.timer = null; this.running = false;
    this.abortController = new AbortController();
    this.status = { state: 'not_configured', detail: 'OAuth 설정 후 연결할 수 있습니다.', skippedCurrency: 0 };
    this.accessToken = env.YOUTUBE_ACCESS_TOKEN || ''; this.expiresAt = this.accessToken ? Infinity : 0;
  }
  configured() { return Boolean(this.accessToken || (this.env.YOUTUBE_CLIENT_ID && this.env.YOUTUBE_CLIENT_SECRET && this.env.YOUTUBE_REFRESH_TOKEN)); }
  async token() {
    if (this.accessToken && Date.now() < this.expiresAt - 60_000) return this.accessToken;
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', body: new URLSearchParams({ client_id: this.env.YOUTUBE_CLIENT_ID || '', client_secret: this.env.YOUTUBE_CLIENT_SECRET || '', refresh_token: this.env.YOUTUBE_REFRESH_TOKEN || '', grant_type: 'refresh_token' }),
      signal: AbortSignal.any([AbortSignal.timeout(15_000), this.abortController.signal])
    });
    if (!response.ok) throw new Error(`YouTube OAuth HTTP ${response.status}`);
    const data = await response.json();
    if (!data.access_token) throw new Error('YouTube OAuth 응답에 access_token이 없습니다.');
    this.accessToken = data.access_token; this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.accessToken;
  }
  async api(resource, params) {
    const token = await this.token();
    const response = await this.fetch(`https://www.googleapis.com/youtube/v3/${resource === 'liveChatMessages' ? 'liveChat/messages' : resource}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.any([AbortSignal.timeout(15_000), this.abortController.signal])
    });
    if (response.status === 401 && this.env.YOUTUBE_REFRESH_TOKEN) this.expiresAt = 0;
    if (!response.ok) throw new Error(`YouTube API HTTP ${response.status}`);
    return response.json();
  }
  async poll() {
    let chatId = this.env.YOUTUBE_LIVE_CHAT_ID;
    if (!chatId && this.env.YOUTUBE_VIDEO_ID) {
      const videos = await this.api('videos', { part: 'liveStreamingDetails', id: this.env.YOUTUBE_VIDEO_ID });
      chatId = videos.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) throw new Error('해당 YouTube URL에 진행 중인 라이브 채팅이 없습니다.');
    }
    if (!chatId) {
      const broadcasts = await this.api('liveBroadcasts', { part: 'snippet', broadcastStatus: 'active', maxResults: '50' });
      const active = (broadcasts.items || []).filter(i => i.snippet?.liveChatId);
      if (active.length !== 1) throw new Error(active.length ? '방송이 여러 개입니다. YOUTUBE_LIVE_CHAT_ID를 지정하세요.' : '현재 진행 중인 YouTube 방송을 찾지 못했습니다.');
      chatId = active[0].snippet.liveChatId;
    }
    const cursor = this.engine.cursor();
    const params = { part: 'snippet,authorDetails', liveChatId: chatId, maxResults: '200' };
    if (cursor?.chatId === chatId && cursor.pageToken) params.pageToken = cursor.pageToken;
    const data = await this.api('liveChatMessages', params);
    for (const item of data.items || []) {
      const details = item.snippet?.superChatDetails || item.snippet?.superStickerDetails;
      if (!details) continue;
      if (details.currency !== 'KRW') { this.status.skippedCurrency++; continue; }
      const amount = Number(details.amountMicros) / 1_000_000;
      this.engine.receive('youtube', { eventId: item.id, nickname: item.authorDetails?.displayName || 'YouTube 후원자', unit: 'KRW', amount });
    }
    if (data.nextPageToken) this.engine.setCursor({ chatId, pageToken: data.nextPageToken });
    this.status.state = data.offlineAt ? 'offline' : 'connected';
    this.status.detail = data.offlineAt ? '방송이 종료되었습니다.' : 'Super Chat·Super Sticker 수신 중';
    return Math.max(1000, Number(data.pollingIntervalMillis) || 5000);
  }
  start() {
    if (!this.configured() || this.running) return;
    this.running = true;
    const run = async () => {
      if (!this.running) return;
      let delay = 15_000;
      try { delay = await this.poll(); }
      catch (error) { this.status.state = 'error'; this.status.detail = error.message.startsWith('YouTube') || error.message.includes('방송') ? error.message : 'YouTube 연결에 실패했습니다. 네트워크와 인증을 확인하세요.'; }
      if (this.running) { this.timer = setTimeout(run, delay); this.timer.unref(); }
    };
    void run();
  }
  stop() { this.running = false; this.abortController.abort(); clearTimeout(this.timer); }
}
