import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputError } from './engine.js';
import { BUILTIN_SOUNDS } from '../public/presentation.js';
export const MAX_AUDIO_BYTES = 44 + 24000 * 2 * 180;
export class Sounds {
  constructor(dataDir) {
    this.dir = join(dataDir, 'sounds'); this.index = join(this.dir, 'uploads.json');
    this.uploads = existsSync(this.index) ? JSON.parse(readFileSync(this.index, 'utf8')) : [];
  }
  list() { return [...BUILTIN_SOUNDS, ...this.uploads.map(s => ({ ...s, url: `/sounds/${s.id}.wav` }))]; }
  has(id) { return this.list().some(s => s.id === id); }
  upload(bytes, name) {
    if (this.uploads.length >= 30) throw new InputError('업로드한 소리는 30개까지 보관할 수 있습니다. 사용하지 않는 소리를 삭제하세요.');
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new InputError('음성 파일 이름을 확인하세요.');
    if (bytes.length <= 44 || bytes.length > MAX_AUDIO_BYTES || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.toString('ascii', 12, 16) !== 'fmt ' || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(4) !== bytes.length - 8 || bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 24000 || bytes.readUInt32LE(28) !== 48000 || bytes.readUInt16LE(32) !== 2 || bytes.readUInt16LE(34) !== 16 || bytes.readUInt32LE(40) !== bytes.length - 44 || (bytes.length - 44) % 2) throw new InputError('올바른 업로드 음성 파일이 아닙니다. 관리 화면에서 파일을 다시 선택하세요.');
    const sound = { id: randomUUID(), name: name.trim(), durationMs: Math.ceil((bytes.length - 44) / 48) };
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, `${sound.id}.wav`); writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    const next = [...this.uploads, sound];
    try { this.save(next); } catch (error) { unlinkSync(file); throw error; }
    return { ...sound, url: `/sounds/${sound.id}.wav` };
  }
  save(next) { writeFileSync(`${this.index}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 }); renameSync(`${this.index}.tmp`, this.index); this.uploads = next; }
  remove(id) {
    if (!this.uploads.some(s => s.id === id)) throw new InputError('업로드한 소리를 선택하세요.');
    this.save(this.uploads.filter(s => s.id !== id));
    unlinkSync(join(this.dir, `${id}.wav`));
  }
  read(id) {
    if (!this.uploads.some(s => s.id === id)) throw new InputError('음성 파일을 찾을 수 없습니다.');
    return readFileSync(join(this.dir, `${id}.wav`));
  }
}
