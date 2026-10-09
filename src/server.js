import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { Engine, InputError, PROVIDERS } from './engine.js';
import { YouTubeConnector } from './youtube.js';
import { Connections } from './connections.js';
import { ChzzkPublicConnector } from './chzzk-public.js';
import { ChzzkConnector } from './chzzk.js';
import { SoopConnector } from './soop.js';
import { ToonationConnector } from './toonation.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function loadKeys(dataDir) {
  const file = resolve(dataDir, 'keys.json');
  mkdirSync(dataDir, { recursive: true });
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const keys = { admin: randomBytes(32).toString('hex'), overlay: randomBytes(24).toString('hex'), webhook: randomBytes(32).toString('hex') };
  writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600, flag: 'wx' });
  return keys;
}

export function createApp({ dataDir = resolve(ROOT, 'data'), keys, env = process.env, engine: suppliedEngine, connectorOptions = {} } = {}) {
  keys ||= loadKeys(dataDir);
  keys = { admin: env.ADMIN_TOKEN || keys.admin, overlay: env.OVERLAY_TOKEN || keys.overlay, webhook: env.WEBHOOK_SECRET || keys.webhook };
  const engine = suppliedEngine || new Engine(resolve(dataDir, 'state.json'));
  const connections = new Connections(dataDir, env);
  const makeConnector = {
    youtube: () => new YouTubeConnector(engine, { env: connections.runtime(), ...connectorOptions.youtube }),
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
    return { balance: state.balance, active: state.active, queueLength: state.queue.length, serverTime: state.serverTime };
  };
  const send = () => {
    for (const client of clients) {
      const state = client.admin ? engine.snapshot() : viewerState();
      client.res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
    }
  };
  engine.on('state', send);
  async function body(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 128_000) throw new InputError('요청이 너무 큽니다.'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
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
        if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, engine.snapshot());
        if (url.pathname === '/api/connection' && req.method === 'GET') return json(res, 200, {
          overlayToken: keys.overlay, sources: connections.data.sources, youtube: connections.metadata(), chzzk: connections.chzzkMetadata(), soop: { enabled: connections.data.soop.enabled }, toonation: { widgetConfigured: Boolean(connections.data.toonation.widgetUrl) },
          providers: PROVIDERS.map(provider => ({ provider, ...connectors[provider].status, configured: connectors[provider].configured(),
            mode: ({ chzzk: connections.data.chzzk.mode === 'oauth' ? 'official_oauth' : 'public_chat', soop: 'public_chat', youtube: 'official_oauth', toonation: 'alert_widget' })[provider] }))
        });
        if (req.method === 'POST') {
          const value = JSON.parse((await body(req)).toString('utf8'));
          if (url.pathname === '/api/sources') { const previous = { ...connections.data.sources }; connections.setSources(value); for (const provider of PROVIDERS) if (previous[provider] !== connections.data.sources[provider]) restartProvider(provider); return json(res, 200, { saved: true }); }
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
          if (url.pathname === '/api/config') return json(res, 200, engine.updateConfig(value));
          if (url.pathname === '/api/balance') return json(res, 200, engine.setBalance(value.balance));
          if (url.pathname === '/api/test-donation') return json(res, 200, engine.receive(value.provider, {
            eventId: `test-${randomUUID()}`, nickname: value.nickname, amount: value.amount, unit: value.unit
          }, { test: true }));
        }
        return json(res, 404, { error: '경로를 찾지 못했습니다.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: '지원하지 않는 요청입니다.' });
      const allowed = new Set(['/', '/index.html', '/overlay.html', '/meso.html', '/styles.css', '/dashboard.js', '/overlay.js']);
      if (!allowed.has(url.pathname)) return json(res, 404, { error: '경로를 찾지 못했습니다.' });
      const path = resolve(ROOT, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
      const file = readFileSync(path);
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
  return { server, engine, get youtube() { return connectors.youtube; }, connectors, keys, close: () => { engine.close(); stopProviders(); for (const client of clients) client.res.end(); server.close(); } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  const app = createApp({ dataDir: process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : undefined });
  app.server.listen(port, host, () => {
    console.log(`메소 라이브 룰렛 서버 시작 (${host}:${port})`);
    console.log('관리자 키: data/keys.json의 admin 항목 또는 ADMIN_TOKEN 환경 변수. 로그에는 키를 출력하지 않습니다.');
    console.log('OBS 주소는 관리자 대시보드에서 복사하세요.');
  });
  const shutdown = () => { app.close(); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
