// Builds Flipper: src/flipper.ts → dist/flipper.js, one small minified script for browsers that
// are not modern-only (ES2018), with no dependencies.
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/flipper.ts'],
  outfile: 'dist/flipper.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2018'],
  legalComments: 'none',
  banner: { js: '/* Flipper — Adelie tracker */' },
});
console.log(`flipper.js: ${statSync('dist/flipper.js').size} bytes`);
