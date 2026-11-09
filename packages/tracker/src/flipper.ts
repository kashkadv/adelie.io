import { init } from './runtime.js';

// The script tag that loaded this file: it carries the site id and the options.
const script =
  (document.currentScript as HTMLScriptElement | null) ??
  (document.querySelector('script[data-site-id]') as HTMLScriptElement | null);

try {
  init({ win: window, doc: document, script });
} catch {
  // A tracker must never break the site it is on.
}
