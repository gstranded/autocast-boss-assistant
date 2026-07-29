import fs from "fs";
import zlib from "zlib";

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function makePng(size, draw) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const line = Buffer.alloc(1 + size * 4);
    line[0] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const i = 1 + x * 4;
      line[i] = r;
      line[i + 1] = g;
      line[i + 2] = b;
      line[i + 3] = a;
    }
    rows.push(line);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}
function roundedMask(x, y, s, r) {
  const m = r;
  if (x >= m && x <= s - 1 - m && y >= m && y <= s - 1 - m) return 1;
  if (x >= m && x <= s - 1 - m && y >= 0 && y <= s - 1) return 1;
  if (y >= m && y <= s - 1 - m && x >= 0 && x <= s - 1) return 1;
  const cx = x < m ? m : s - 1 - m;
  const cy = y < m ? m : s - 1 - m;
  const d = Math.hypot(x - cx, y - cy);
  if (d <= m) return 1;
  if (d >= m + 1.2) return 0;
  return m + 1.2 - d;
}
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function drawLogo(x, y, s) {
  const mask = roundedMask(x, y, s, s * 0.18);
  if (mask <= 0) return [0, 0, 0, 0];
  const t = y / (s - 1);
  let r = Math.round(37 + t * 12);
  let g = Math.round(99 + t * 18);
  let b = Math.round(235 - t * 30);
  const nx = (x + 0.5) / s;
  const ny = (y + 0.5) / s;
  const dx = nx - 0.34;
  const dy = ny - 0.3;
  if (dx * dx + dy * dy < 0.045) {
    r = Math.min(255, r + 28);
    g = Math.min(255, g + 28);
    b = Math.min(255, b + 12);
  }
  const plane = [
    [0.22, 0.48],
    [0.78, 0.28],
    [0.55, 0.5],
    [0.72, 0.72],
    [0.48, 0.55]
  ];
  let a = Math.round(255 * Math.min(1, mask));
  if (inPoly(nx, ny, plane)) return [255, 255, 255, a];
  if ((nx - 0.28) ** 2 + (ny - 0.62) ** 2 < 0.0018) return [255, 214, 102, a];
  if ((nx - 0.22) ** 2 + (ny - 0.68) ** 2 < 0.001) return [255, 214, 102, Math.round(a * 0.85)];
  return [r, g, b, a];
}

const svg = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Boss HaiTou Assistant">',
  '  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">',
  '    <stop offset="0%" stop-color="#3B82F6"/><stop offset="100%" stop-color="#1D4ED8"/>',
  "  </linearGradient></defs>",
  '  <rect x="16" y="16" width="480" height="480" rx="96" fill="url(#g)"/>',
  '  <path d="M120 250 L390 150 L280 260 L360 365 L245 285 Z" fill="#FFFFFF"/>',
  '  <circle cx="145" cy="330" r="14" fill="#FFD666"/>',
  '  <circle cx="118" cy="355" r="9" fill="#FFD666" opacity="0.85"/>',
  "</svg>"
].join("\n");

fs.mkdirSync("docs/assets", { recursive: true });
fs.mkdirSync("assets", { recursive: true });
fs.mkdirSync("extension/assets/icons", { recursive: true });
fs.writeFileSync("docs/assets/logo.svg", svg);
fs.writeFileSync("assets/logo.svg", svg);
fs.writeFileSync("docs/assets/logo.png", makePng(512, drawLogo));
fs.writeFileSync("assets/logo.png", makePng(512, drawLogo));
for (const s of [16, 32, 48, 128, 256]) {
  fs.writeFileSync(`extension/assets/icons/icon${s}.png`, makePng(s, drawLogo));
}
console.log("logo ok", fs.statSync("docs/assets/logo.png").size, fs.statSync("docs/assets/logo.svg").size);