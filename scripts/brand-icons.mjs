// Generates raster icons from the original penguin (assets/brand/penguin-original.svg).
// Usage: node scripts/brand-icons.mjs   (sharp is a root devDependency)
// Output: apps/site/{favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png}
//         apps/web/src/app/{favicon.ico, icon.svg, apple-icon.png}
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const sharp = require('sharp');

const original = readFileSync(new URL('assets/brand/penguin-original.svg', root), 'utf8');
const paths = [...original.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

// Penguin centered on a square tile with padding.
// bg = null → transparent; fg = penguin color.
function tile(size, { bg, fg, pad }) {
  const vb = { x: 190.257, y: -0.286, w: 465.206, h: 520.464 };
  const side = Math.max(vb.w, vb.h) / (1 - 2 * pad);
  const x = vb.x - (side - vb.w) / 2;
  const y = vb.y - (side - vb.h) / 2;
  const rect = bg ? `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="${bg}"/>` : '';
  const body = paths.map((d) => `<path d="${d}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${side} ${side}" width="${size}" height="${size}">${rect}<g fill="${fg}">${body}</g></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ICO container with embedded PNGs (supported by all modern browsers).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const dark = '#0a0e12';
const white = '#ffffff';

// favicon.ico: white tile with dark penguin — readable on both light and dark tab bars.
const icoPngs = [];
for (const size of [16, 32, 48]) {
  icoPngs.push({ size, data: await tile(size, { bg: white, fg: dark, pad: 0.08 }) });
}
const favicon = ico(icoPngs);

const appleTouch = await tile(180, { bg: white, fg: dark, pad: 0.14 });
const icon192 = await tile(192, { bg: white, fg: dark, pad: 0.14 });
const icon512 = await tile(512, { bg: white, fg: dark, pad: 0.14 });

const out = (p, data) => writeFileSync(new URL(p, root), data);
out('apps/site/favicon.ico', favicon);
out('apps/site/apple-touch-icon.png', appleTouch);
out('apps/site/icon-192.png', icon192);
out('apps/site/icon-512.png', icon512);

out('apps/web/src/app/favicon.ico', favicon);
out('apps/web/src/app/apple-icon.png', appleTouch);
copyFileSync(new URL('apps/site/favicon.svg', root), new URL('apps/web/src/app/icon.svg', root));

console.log('brand icons generated');
