import { soundWindow } from './presentation.js';
export class SoundPlayer {
  constructor() { this.audio = new Audio(); this.audio.preload = 'auto'; this.generation = 0; }
  stop() { this.generation++; clearTimeout(this.timer); this.audio.pause(); }
  async play(url, sound, roulette, volume, remainingMs = Infinity) {
    this.stop();
    const requestedAt = performance.now();
    if (!volume) return;
    const generation = this.generation, audio = this.audio;
    audio.src = url; audio.volume = volume / 100;
    await new Promise((resolve, reject) => {
      const clean = () => { audio.removeEventListener('loadedmetadata', ready); audio.removeEventListener('error', failed); clearTimeout(timeout); };
      const ready = () => { clean(); resolve(); };
      const failed = () => { clean(); reject(new Error('알림음을 재생할 수 없습니다. 파일과 브라우저 소리 설정을 확인하세요.')); };
      const timeout = setTimeout(failed, 5000);
      audio.addEventListener('loadedmetadata', ready, { once: true }); audio.addEventListener('error', failed, { once: true }); audio.load();
    });
    if (generation !== this.generation) return;
    const { startMs, endMs } = soundWindow(sound, roulette, audio.duration * 1000);
    if (startMs >= endMs) throw new Error('알림음 시작 지점이 파일 길이보다 깁니다. 재생 구간을 확인하세요.');
    audio.currentTime = startMs / 1000;
    await audio.play();
    if (generation !== this.generation) return;
    this.timer = setTimeout(() => this.stop(), Math.max(0, Math.min(endMs - startMs, remainingMs - (performance.now() - requestedAt))));
  }
}
export async function encodeUpload(file) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('음성 파일은 20MB 이하로 선택하세요.');
  const context = new AudioContext();
  let decoded;
  try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error('이 브라우저가 재생할 수 있는 WAV·MP3·OGG·M4A 파일을 선택하세요.'); }
  finally { await context.close(); }
  if (!decoded.duration || decoded.duration > 180) throw new Error('음성 파일은 3분 이하로 선택하세요.');
  const rate = 24000, offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  const buffer = new ArrayBuffer(44 + pcm.length * 2), view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true));
  return buffer;
}
