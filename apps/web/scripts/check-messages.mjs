// Verifies every messages/<locale>.json has exactly the same keys as messages/en.json.
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../messages/', import.meta.url);
const load = (file) => JSON.parse(readFileSync(new URL(file, dir), 'utf8'));

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const source = new Set(keys(load('en.json')));
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
  const target = new Set(keys(load(file)));
  const missing = [...source].filter((k) => !target.has(k));
  const extra = [...target].filter((k) => !source.has(k));
  if (missing.length || extra.length) {
    failed = true;
    if (missing.length) console.error(`${file}: missing keys:\n  ${missing.join('\n  ')}`);
    if (extra.length) console.error(`${file}: extra keys:\n  ${extra.join('\n  ')}`);
  }
}

if (failed) process.exit(1);
console.log('messages: all locales match en.json');
