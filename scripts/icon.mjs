// ICO can embed the original PNG losslessly (Windows Vista and newer).
export function pngToIco(png) {
  if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || png.toString('ascii',12,16) !== 'IHDR') throw new Error('메소 아이콘 PNG 파일을 확인하세요.');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  if (!width || !height || width > 256 || height > 256) throw new Error('메소 아이콘은 가로·세로 256px 이하 PNG여야 합니다.');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1,2); header.writeUInt16LE(1,4);
  header[6] = width === 256 ? 0 : width; header[7] = height === 256 ? 0 : height;
  header.writeUInt16LE(1,10); header.writeUInt16LE(32,12);
  header.writeUInt32LE(png.length,14); header.writeUInt32LE(22,18);
  return Buffer.concat([header,png]);
}
