import { build } from 'esbuild';
import { inject } from 'postject';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64에서 빌드하세요. GitHub Actions Windows 빌드도 사용할 수 있습니다.');
if (process.version !== 'v24.19.0') throw new Error('재현 가능한 빌드를 위해 Node.js 24.19.0을 사용하세요.');
const root = resolve(import.meta.dirname, '..');
process.chdir(root);
const version = JSON.parse(readFileSync('package.json')).version;
mkdirSync('dist', { recursive: true });
const packageDir = resolve(`dist/MesoLiveRoulette-${version}-win-x64`);
mkdirSync(resolve(packageDir, 'data'), { recursive: true });
await build({
  entryPoints: ['src/desktop.js'], outfile: 'dist/desktop.cjs', bundle: true,
  platform: 'node', target: 'node24', format: 'cjs',
  // Only the standard library remains external. WS native speedups are optional.
  external: ['bufferutil', 'utf-8-validate'],
  define: { 'import.meta.url': '__entryUrl', 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
  banner: { js: "const __entryUrl = require('node:url').pathToFileURL(__filename).href;" }
});
const assets = Object.fromEntries(readdirSync('public').map(name => [`public/${name}`, resolve('public', name)]));
writeFileSync('dist/sea-config.json', JSON.stringify({ main: resolve('dist/desktop.cjs'), output: resolve('dist/sea.blob'), disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }));
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json'], { stdio: 'inherit' });
const exe = resolve(packageDir, `MesoLiveRoulette-${version}-win-x64.exe`);
copyFileSync(process.execPath, exe);
// Modifying a signed Node executable invalidates its Authenticode signature.
// Clear the PE32+ security directory and remove the trailing certificate table
// before injection (equivalent to signtool remove /s, without an SDK dependency).
const peFile = readFileSync(exe);
const peOffset = peFile.readUInt32LE(0x3c), optionalHeader = peOffset + 24;
if (peFile.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' || peFile.readUInt16LE(peOffset + 4) !== 0x8664 || peFile.readUInt16LE(optionalHeader) !== 0x20b) throw new Error('Expected Windows x64 PE32+ executable');
const securityDirectory = optionalHeader + 112 + 4 * 8;
const certificateOffset = peFile.readUInt32LE(securityDirectory), certificateSize = peFile.readUInt32LE(securityDirectory + 4);
peFile.fill(0, securityDirectory, securityDirectory + 8);
writeFileSync(exe, certificateOffset > 0 && certificateOffset + certificateSize === peFile.length ? peFile.subarray(0, certificateOffset) : peFile);
await inject(exe, 'NODE_SEA_BLOB', readFileSync('dist/sea.blob'), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
const finalPe = readFileSync(exe), finalOptional = finalPe.readUInt32LE(0x3c) + 24;
if (finalPe.readBigUInt64LE(finalOptional + 112 + 4 * 8) !== 0n) throw new Error('Executable still contains an invalid signing certificate');
copyFileSync('docs/WINDOWS.txt', resolve(packageDir, '사용설명서.txt'));
writeFileSync(resolve(packageDir, 'data/안내.txt'), '설정·메소 잔액·인증 키는 첫 실행 시 이 폴더에 저장됩니다. 폴더 전체를 보관하고 공유하지 마세요.\n');
// Upstream v24.19.0 license is vendored; packaging needs no extra downloads.
writeFileSync(resolve(packageDir, 'THIRD-PARTY-NOTICES.txt'), ['Node.js 24.19.0', readFileSync('docs/NODE-LICENSE.txt', 'utf8'), '\nsoop-chat 0.6.0', readFileSync('node_modules/soop-chat/LICENSE', 'utf8'), '\nws 8.21.3', readFileSync('node_modules/ws/LICENSE', 'utf8')].join('\n'));
const sha = createHash('sha256').update(readFileSync(exe)).digest('hex');
writeFileSync(resolve(packageDir, 'SHA256SUMS.txt'), `${sha}  MesoLiveRoulette-${version}-win-x64.exe\n`);
console.log(`Built ${exe}`);
