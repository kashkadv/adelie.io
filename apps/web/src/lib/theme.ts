export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'adelie-theme';

/**
 * Runs inline in <head> before first paint: applies the saved theme or the system one,
 * and follows system changes while the user hasn't chosen explicitly.
 */
export const themeInitScript = `(function(){
  var k='${THEME_STORAGE_KEY}', r=document.documentElement, m=window.matchMedia('(prefers-color-scheme: dark)');
  function saved(){ try { return localStorage.getItem(k); } catch (e) { return null; } }
  function apply(){ var s=saved(); r.dataset.theme = (s==='light'||s==='dark') ? s : (m.matches ? 'dark' : 'light'); }
  apply();
  m.addEventListener('change', function(){ if (!saved()) apply(); });
})();`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode etc.): the theme still applies for this session.
  }
}
