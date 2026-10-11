import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea, getAsset } from 'node:sea';
import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { Engine, InputError, PROVIDERS, validateConfig } from './engine.js';
import { YouTubePublicConnector } from './youtube-public.js';
import { YouTubeConnector } from './youtube.js';
import { Sounds, MAX_AUDIO_BYTES } from './sounds.js';
import { Connections, validateSources } from './connections.js';
import { ChzzkPublicConnector } from './chzzk-public.js';
import { ChzzkConnector } from './chzzk.js';
import { SoopConnector } from './soop.js';
import { ToonationConnector } from './toonation.js';

const ROOT = isSea() ? dirname(process.execPath) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function sendAudio(req, res, file) {
  const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' };
  let start = 0, end = file.length - 1, status = 200;
  if (req.headers.range) {
    const range = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (!range || (!range[1] && !range[2])) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.length}` }); res.end(); return; }
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end; }
    else { const count = Number(range[2]); start = Math.max(0, file.length - count); if (!count) start = file.length; }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= file.length || end < start) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${file.length}` }); res.end(); return; }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${file.length}`;
  }
  res.writeHead(status, { ...headers, 'Content-Length': end - start + 1 });
  res.end(req.method === 'HEAD' ? undefined : file.subarray(start, end + 1));
}
function loadKeys(dataDir) {
  const file = resolve(dataDir, 'keys.json');
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = { admin: randomBytes(32).toString('hex'), overlay: randomBytes(24).toString('hex'), webhook: randomBytes(32).toString('hex') };
  writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600, flag: 'wx' });
  return keys;
}

export function createApp({ dataDir = resolve(ROOT, 'data'), keys, env = process.env, engine: suppliedEngine, connectorOptions = {}, onShutdown } = {}) {
  keys ||= loadKeys(dataDir);
  keys = { admin: env.ADMIN_TOKEN || keys.admin, overlay: env.OVERLAY_TOKEN || keys.overlay, webhook: env.WEBHOOK_SECRET || keys.webhook };
  const engine = suppliedEngine || new Engine(resolve(dataDir, 'state.json'));
  const connections = new Connections(dataDir, env);
  const sounds = new Sounds(dataDir);
  let shuttingDown = false;
  const checkSoundReferences = config => {
    for (const r of config.roulettes) {
      if (!sounds.has(r.sound.source)) throw new InputError(`${r.name}: 선택한 알림음 파일을 찾을 수 없습니다.`);
      const uploaded = sounds.uploads.find(s => s.id === r.sound.source);
      if (uploaded && (r.sound.startMs >= uploaded.durationMs || (r.sound.endMs !== null && r.sound.endMs > uploaded.durationMs))) throw new InputError(`${r.name}: 재생 구간이 파일 길이를 벗어납니다.`);
    }
    return config;
  };
  const makeConnector = {
    youtube: () => connections.data.youtube.mode === 'oauth' ? new YouTubeConnector(engine, { env: connections.runtime(), ...connectorOptions.youtube }) : new YouTubePublicConnector(engine, connections, connectorOptions.youtubePublic),
    chzzk: () => connections.data.chzzk.mode === 'oauth' ? new ChzzkConnector(engine, connections, connectorOptions.chzzk) : new ChzzkPublicConnector(engine, connections, connectorOptions.chzzkPublic),
    soop: () => new SoopConnector(engine, connections, connectorOptions.soop),
    toonation: () => new ToonationConnector(engine, connections, connectorOptions.toonation)
  };
  const connectors = Object.fromEntries(PROVIDERS.map(provider => [provider, makeConnector[provider]() ]));
  const restartProvider = provider => { connectors[provider].stop(); connectors[provider] = makeConnector[provider](); connectors[provider].start(); };
  const stopProviders = () => { for (const connector of Object.values(connectors)) connector.stop(); };
  const clients = new Set();
  const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const admin = req => sameSecret(req.headers.authorization, `Bearer ${keys.admin}`);
  const viewer = (req, url) => admin(req) || sameSecret(url.searchParams.get('token'), keys.overlay);
  const viewerState = () => {
    const state = engine.snapshot();
    // OBS clients only need the currently displayed spin and the balance.
    return { balance: state.balance, active: state.active, queueLength: state.queue.length, serverTime: state.serverTime, sound: state.config.sound, overlay: state.config.overlay, latestChange: state.history[0] ?? null, previewRoulette: state.config.roulettes[0] };
  };
  const send = () => {
    for (const client of clients) {
      const state = client.admin ? engine.snapshot() : viewerState();
      client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };
  engine.on('state', send);
  async function body(req, limit = 128_000) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new InputError('요청이 너무 큽니다.'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (shuttingDown) return json(res, 503, { error: '프로그램 종료 중입니다.' });
      if (url.pathname.startsWith('/sounds/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'GET만 지원합니다.' });
        if (!viewer(req, url)) return json(res, 401, { error: '인증이 필요합니다.' });
        const id = url.pathname.match(/^\/sounds\/([a-f0-9-]{36})\.wav$/)?.[1];
        if (!id || !sounds.has(id)) return json(res, 404, { error: '음성 파일을 찾을 수 없습니다.' });
        const file = sounds.read(id);
        sendAudio(req, res, file); return;
      }
      if (url.pathname === '/oauth/youtube/callback' && req.method === 'GET') {
        await connections.callback(url.searchParams); restartProvider('youtube');
        res.writeHead(303, { Location: '/?youtube=connected', 'Cache-Control': 'no-store' }); res.end(); return;
      }
      if (url.pathname === '/oauth/chzzk/callback' && req.method === 'GET') {
        await connections.callbackChzzk(url.searchParams); restartProvider('chzzk');
        res.writeHead(303, { Location: '/?connected=chzzk', 'Cache-Control': 'no-store' }); res.end(); return;
      }
      if (url.pathname === '/api/health'  && req.method === 'GET') return json(res, 200, { ok: true });
      if (url.pathname.startsWith('/webhooks/')) {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST만 지원합니다.' });
        const provider = url.pathname.slice('/webhooks/'.length);
        if (!PROVIDERS.includes(provider)) return json(res, 404, { error: '지원하지 않는 플랫폼입니다.' });
        const raw = await body(req), timestamp = req.headers['x-webhook-timestamp'];
        if (typeof timestamp !== 'string' || !/^\d{10,13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300_000) return json(res, 401, { error: '유효한 밀리초 타임스탬프가 필요합니다.' });
        const signature = createHmac('sha256', keys.webhook).update(timestamp + '.').update(raw).digest('hex');
        if (!sameSecret(req.headers['x-webhook-signature'], signature)) return json(res, 401, { error: '후원 요청 서명이 유효하지 않습니다.' });
        return json(res, 200, engine.receive(provider, JSON.parse(raw.toString('utf8'))));
      }
      if (url.pathname === '/api/events' && req.method === 'GET') {
        if (!viewer(req, url)) return json(res, 401, { error: '인증이 필요합니다.' });
        if (clients.size >= 100) return json(res, 503, { error: '연결 수가 너무 많습니다.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const client = { res, admin: admin(req) }; clients.add(client);
        res.write(`event: state\ndata: ${JSON.stringify(client.admin ? engine.snapshot() : viewerState())}\n\n`);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000); heartbeat.unref();
        req.on('close', () => { clearInterval(heartbeat); clients.delete(client); }); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (!admin(req)) return json(res, 401, { error: '관리자 키를 확인하세요.' });
        if (url.pathname === '/api/sounds' && req.method === 'GET') return json(res, 200, { sounds: sounds.list() });
        if (url.pathname === '/api/sounds/upload' && req.method === 'POST') return json(res, 200, sounds.upload(await body(req, MAX_AUDIO_BYTES), url.searchParams.get('name')));
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, engine.snapshot());
        if (url.pathname === '/api/connection' && req.method === 'GET') return json(res, 200, {
          overlayToken: keys.overlay, sources: connections.data.sources, youtube: connections.metadata(), chzzk: connections.chzzkMetadata(), soop: { enabled: connections.data.soop.enabled }, toonation: { widgetConfigured: Boolean(connections.data.toonation.widgetUrl) },
          providers: PROVIDERS.map(provider => ({ provider, ...connectors[provider].status, configured: connectors[provider].configured(),
            mode: ({ chzzk: connections.data.chzzk.mode === 'oauth' ? 'official_oauth' : 'public_chat', soop: 'public_chat', youtube: connections.data.youtube.mode === 'oauth' ? 'official_oauth' : 'public_chat', toonation: 'alert_widget' })[provider] }))
        });
        if (req.method === 'POST') {
          const value = JSON.parse((await body(req)).toString('utf8'));
          if (url.pathname === '/api/sources') { const previous = { ...connections.data.sources }; connections.setSources(value); for (const provider of PROVIDERS) if (previous[provider] !== connections.data.sources[provider]) restartProvider(provider); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/youtube/connection') { connections.setYouTubePublicEnabled(value.enabled); restartProvider('youtube'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/youtube/app') { connections.setApp(value); restartProvider('youtube'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/youtube/authorize') return json(res, 200, { url: connections.authorize() });
          if (url.pathname === '/api/youtube/disconnect') { connections.disconnect(); restartProvider('youtube'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/chzzk/connection') { connections.setChzzkPublicEnabled(value.enabled); restartProvider('chzzk'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/chzzk/app') { connections.setChzzkApp(value); restartProvider('chzzk'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/chzzk/authorize') return json(res, 200, { url: connections.authorizeChzzk() });
          if (url.pathname === '/api/chzzk/disconnect') { connections.disconnectChzzk(); restartProvider('chzzk'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/soop/connection') { connections.setSoopEnabled(value.enabled); restartProvider('soop'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/toonation/widget') { connections.setToonationWidget(value.widgetUrl); restartProvider('toonation'); return json(res, 200, { saved: true }); }
          if (url.pathname === '/api/provider/reconnect') { if (!PROVIDERS.includes(value.provider)) throw new InputError('플랫폼을 확인하세요.'); restartProvider(value.provider); return json(res, 200, { restarted: true }); }
          if (url.pathname === '/api/sounds/delete') {
            if (engine.data.config.roulettes.some(r => r.sound.source === value.id) || engine.data.active?.roulette.sound?.source === value.id || engine.data.queue.some(item => item.roulette.sound?.source === value.id)) throw new InputError('룰렛에서 사용 중인 소리는 먼저 다른 알림음으로 변경하고 저장하세요.');
            sounds.remove(value.id); return json(res, 200, { deleted: true });
          }
          if (url.pathname === '/api/shutdown') {
            const config = checkSoundReferences(validateConfig(value.config));
            const sources = value.sources === undefined ? undefined : validateSources(value.sources);
            engine.updateConfig(config);
            if (sources) connections.setSources(sources);
            engine.save(); connections.save(); shuttingDown = true;
            res.once('finish', () => setImmediate(() => { close(); onShutdown?.(); }));
            return json(res, 200, { saved: true, shutdown: true });
          }
          if (url.pathname === '/api/config') return json(res, 200, engine.updateConfig(checkSoundReferences(validateConfig(value))));
          if (url.pathname === '/api/balance/adjust') return json(res, 200, engine.adjustBalance(value.delta, value.note));
          if (url.pathname === '/api/balance') return json(res, 200, engine.setBalance(value.balance));
          if (url.pathname === '/api/test-donation') return json(res, 200, engine.receive(value.provider, {
            eventId: `test-${randomUUID()}`, nickname: value.nickname, amount: value.amount, unit: value.unit
          }, { test: true }));
        }
        return json(res, 404, { error: '경로를 찾지 못했습니다.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '지원하지 않는 요청입니다.' });
      const allowed = new Set(['/', '/index.html', '/overlay.html', '/meso.html', '/styles.css', '/dashboard.js', '/overlay.js', '/presentation.js', '/sound-player.js', '/alert.wav', '/chime.wav', '/bell.wav']);
      if (!allowed.has(url.pathname)) return json(res, 404, { error: '경로를 찾지 못했습니다.' });
      const path = resolve(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const file = isSea() ? Buffer.from(getAsset(`public/${url.pathname === '/' ? 'index.html' : url.pathname.slice(1)}`)) : readFileSync(path);
      if (extname(path) === '.wav') { sendAudio(req, res, file); return; }
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : file);
    } catch (error) {
      if (error instanceof InputError || error instanceof SyntaxError) return json(res, 400, { error: error instanceof InputError ? error.message : 'JSON 형식을 확인하세요.' });
      console.error('Request failed:', error.code || error.name);
      return json(res, 500, { error: '서버 오류가 발생했습니다. 서버 로그를 확인하세요.' });
    }
  });
  engine.start(); for (const connector of Object.values(connectors)) connector.start();
  server.on('close', () => { engine.close(); stopProviders(); engine.off('state', send); });
  const close = () => { engine.close(); stopProviders(); for (const client of clients) client.res.end(); server.close(); };
  return { server, engine, sounds, get youtube() { return connectors.youtube; }, connectors, keys, close };
}

if (!isSea() && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  const app = createApp({ dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : undefined, onShutdown: () => setTimeout(() => process.exit(0), 250) });
  app.server.listen(port, host, () => {
    console.log(`메소 라이브 룰렛 서버 시작 (${host}:${port})`);
    console.log('관리자 키: data/keys.json의 admin 항목 또는 ADMIN_TOKEN 환경 변수. 로그에는 키를 출력하지 않습니다.');
    console.log('OBS 주소는 관리자 대시보드에서 복사하세요.');
  });
  const shutdown = () => { app.close(); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
