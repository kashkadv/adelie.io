// Site behaviour: theme (system by default, explicit choice stored per browser)
// and the footer language dropdown.
// Loaded in <head> (blocking) so the saved theme applies before first paint.
(function () {
  var KEY = 'adelie-theme';
  var root = document.documentElement;

  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function current() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var initial = saved();
  if (initial === 'light' || initial === 'dark') root.setAttribute('data-theme', initial);

  document.addEventListener('DOMContentLoaded', function () {
    // Language dropdown in the footer: option values are the page URLs per language.
    var lang = document.querySelector('[data-lang-select]');
    if (lang) {
      lang.addEventListener('change', function () {
        window.location.href = lang.value;
      });
    }

    var button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    button.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        /* storage unavailable: theme still switches for this page view */
      }
    });
  });
})();
