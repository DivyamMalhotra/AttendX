/*
 * Generates the PWA icons (public/icons/*.png) without any image library: a rounded navy square with a white tick.
 *   node scripts/make-icons.js
 * The icons are committed, so this only needs to run when the design changes.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NAVY = [0x31, 0x5b, 0x46]; const WHITE = [255, 255, 255];

function crc32(buf) {
  let c; let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/** maskable icons keep the artwork inside the central safe zone and fill the whole square. */
function render(size, { maskable = false } = {}) {
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.62 : 0.8;
  const cx = size / 2; const cy = size / 2;
  const pts = [[-0.28, 0.02], [-0.07, 0.24], [0.3, -0.22]].map(([x, y]) => [cx + x * size * scale, cy + y * size * scale]);
  const stroke = size * 0.075 * scale * 1.4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      // rounded-corner coverage (anti-aliased by 1px)
      const qx = Math.max(Math.abs(x + 0.5 - cx) - (cx - radius), 0); const qy = Math.max(Math.abs(y + 0.5 - cy) - (cy - radius), 0);
      const outside = Math.hypot(qx, qy) - radius;
      const alpha = radius === 0 ? 1 : Math.max(0, Math.min(1, 0.5 - outside));
      const d = Math.min(distToSegment(x + 0.5, y + 0.5, ...pts[0], ...pts[1]), distToSegment(x + 0.5, y + 0.5, ...pts[1], ...pts[2]));
      const ink = Math.max(0, Math.min(1, stroke / 2 + 0.5 - d));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i += 1) raw[o + i] = Math.round(NAVY[i] * (1 - ink) + WHITE[i] * ink);
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const out = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-192.png'), render(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), render(512));
fs.writeFileSync(path.join(out, 'icon-maskable-512.png'), render(512, { maskable: true }));
fs.writeFileSync(path.join(out, 'apple-touch-icon.png'), render(180, { maskable: true }));
console.log('Icons written to', out);
