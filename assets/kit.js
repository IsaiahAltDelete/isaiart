/* ============================================================================
   KIT — theme and small helpers for pages on kit.css
   Load in <head> (not deferred) so the stored theme lands before first paint.
   Any element with [data-theme-toggle] flips light / dark; the choice is kept
   under the site's shared 'isa.theme' key, so every page agrees.
   ========================================================================= */
(function () {
    'use strict';
    var KEY = 'isa.theme';
    var root = document.documentElement;
    var stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) {}
    if (stored) root.setAttribute('data-theme', stored);

    function current() {
        var set = root.getAttribute('data-theme');
        if (set) return set;
        return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function toggle() {
        var next = current() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
        document.dispatchEvent(new CustomEvent('kit:theme', { detail: next }));
    }

    var toastEl, toastT;
    function toast(msg, ms) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'kit-toast';
            toastEl.setAttribute('role', 'status');
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add('up');
        clearTimeout(toastT);
        toastT = setTimeout(function () { toastEl.classList.remove('up'); }, ms || 1800);
    }

    /* keep a range's filled run (--p) in step with its value */
    function paintRange(r) {
        var min = +r.min || 0, max = r.max === '' ? 100 : +r.max, v = +r.value;
        r.style.setProperty('--p', ((v - min) / ((max - min) || 1) * 100) + '%');
    }

    document.addEventListener('click', function (e) {
        var t = e.target.closest && e.target.closest('[data-theme-toggle]');
        if (t) { e.preventDefault(); toggle(); }
    });
    document.addEventListener('input', function (e) {
        if (e.target.matches && e.target.matches('input[type="range"].range')) paintRange(e.target);
    });
    function paintAll() { document.querySelectorAll('input[type="range"].range').forEach(paintRange); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintAll);
    else paintAll();

    window.Kit = { theme: current, toggleTheme: toggle, toast: toast, paintRange: paintRange, paintAll: paintAll };
})();
