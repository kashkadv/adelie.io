export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'adelie-theme';
export const SIDEBAR_STORAGE_KEY = 'adelie-sidebar';

/**
 * Runs inline in <head> before first paint: applies the saved theme or the system one
 * (and follows system changes while the user hasn't chosen explicitly), and the sidebar state.
 */
export const themeInitScript = `(function(){
  var k='${THEME_STORAGE_KEY}', r=document.documentElement, m=window.matchMedia('(prefers-color-scheme: dark)');
  function saved(){ try { return localStorage.getItem(k); } catch (e) { return null; } }
  function apply(){ var s=saved(); r.dataset.theme = (s==='light'||s==='dark') ? s : (m.matches ? 'dark' : 'light'); }
  apply();
  try { if (localStorage.getItem('${SIDEBAR_STORAGE_KEY}') === 'collapsed') r.dataset.sidebar = 'collapsed'; } catch (e) {}
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

/** Sidebar state lives on <html data-sidebar> (CSS-driven, no hydration mismatch). */
export function isSidebarCollapsed(): boolean {
  return document.documentElement.dataset.sidebar === 'collapsed';
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const root = document.documentElement;
  if (collapsed) root.dataset.sidebar = 'collapsed';
  else delete root.dataset.sidebar;
  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Storage unavailable: the state still applies for this session.
  }
}
