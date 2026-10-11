import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { createApp } from './server.js';

const dataDir = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'MesoLiveRoulette', 'data');
let app;
function fail(error) {
  console.error(error.code === 'EADDRINUSE' ? '이미 실행 중이거나 3000번 포트를 다른 프로그램이 사용 중입니다. 기존 실행 창을 확인하세요.' : `실행 실패: ${error.code || error.message}`);
  app?.close();
  process.exitCode = 1;
  if (process.platform === 'win32') {
    console.error('Enter 키를 누르면 종료합니다.');
    process.stdin.resume(); process.stdin.once('data', () => process.exit(1));
  }
}
try {
  app = createApp({ dataDir });
  app.server.once('error', fail);
  app.server.listen(3000, '127.0.0.1', () => {
    console.log('메소 라이브 룰렛 — http://127.0.0.1:3000');
    console.log(`설정·잔액 저장 위치: ${dataDir}`);
    console.log('이 창을 열어 둔 채 방송하세요. 종료: Ctrl+C');
    console.log('브라우저를 다시 열 때 관리자 키는 저장 위치의 keys.json > admin 항목을 사용하세요.');
    if (!process.argv.includes('--no-browser')) {
      const url = `http://127.0.0.1:3000/#admin=${app.keys.admin}`;
      const browser = spawn(process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { stdio: 'ignore', detached: true });
      browser.on('error', () => console.error('브라우저를 자동으로 열지 못했습니다. http://127.0.0.1:3000 을 직접 여세요.'));
      browser.unref();
    }
  });
  const stop = () => { app.close(); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) { fail(error); }
