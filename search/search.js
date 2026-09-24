/* ============================================================================
   SEARCH — shared runtime for isaiart.com/search
   Vanilla, no dependencies. Each terminal supplies compile() → { q, url, ops };
   binding, the query bar, persistence, tips, theme and keyboard live here.
   ========================================================================= */
(function () {
    'use strict';

    var doc = document;
    var THEME_KEY = 'isa.theme';

    /* ── Theme ───────────────────────────────────────────────────────────────
       Follows the OS until the toggle is touched; applied before paint so the
       page never flashes the wrong one. */
    var theme = null;
    try { theme = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (theme) doc.documentElement.setAttribute('data-theme', theme);

    function currentTheme() {
        var set = doc.documentElement.getAttribute('data-theme');
        if (set) return set;
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }

    function toggleTheme() {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        doc.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    }

    /* ── Value readers (null-safe) ───────────────────────────────────────── */

    function el(id) { return doc.getElementById(id); }

    function v(id) {
        var n = el(id);
        return n ? n.value.trim() : '';
    }

    /* A non-negative integer string, or '' — min_faves:-5 is a typo, not a query. */
    function n(id) {
        var raw = v(id);
        if (!raw) return '';
        var num = Math.floor(Number(raw));
        if (!isFinite(num) || num < 0) return '';
        return String(num);
    }

    function c(id) {
        var node = el(id);
        return !!(node && node.checked);
    }

    function r(name) {
        var node = doc.querySelector('input[name="' + name + '"]:checked');
        return node ? node.value : '';
    }

    /* "alice, bob" and "alice bob" both mean two entries. */
    function list(id) {
        var raw = v(id);
        if (!raw) return [];
        return raw.split(/[,\s]+/).map(function (s) { return s.trim(); })
                  .filter(function (s) { return s.length > 0; });
    }

    function handles(id) {
        return list(id).map(function (s) { return s.replace(/^@+/, ''); });
    }

    function tags(id) {
        return list(id).map(function (s) { return '#' + s.replace(/^#+/, ''); });
    }

    function bareTags(id) {
        return list(id).map(function (s) { return s.replace(/^#+/, ''); });
    }

    /* Quote unless already quoted, so "x" never comes back as ""x"". */
    function phrase(id) {
        var raw = v(id);
        if (!raw) return '';
        if (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"' && raw.length > 1) {
            return raw;
        }
        return '"' + raw.replace(/"/g, '') + '"';
    }

    /* ── Toast ───────────────────────────────────────────────────────────── */

    var toastEl = null, toastTimer = null;

    function toast(msg) {
        if (!toastEl) {
            toastEl = doc.createElement('div');
            toastEl.className = 'toast';
            toastEl.setAttribute('role', 'status');
            doc.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.classList.add('up');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('up'); }, 1800);
    }

    /* ── Clipboard ───────────────────────────────────────────────────────── */

    function copy(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            var ta = doc.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            doc.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = doc.execCommand('copy'); } catch (e) {}
            doc.body.removeChild(ta);
            ok ? resolve() : reject(new Error('copy blocked'));
        });
    }

    /* ── Tips ────────────────────────────────────────────────────────────────
       Any element with a direct .tip child is a tip host. The .tip stays
       hidden in place; one floating bubble copies it in on hover (after a
       short delay, so sweeping the mouse across the form stays quiet) or on
       keyboard focus. Tapping an icon button pins its tip for touch screens. */

    var bubble = null, showTimer = null, activeHost = null, pinned = false;

    function hostTip(host) {
        for (var i = 0; i < host.children.length; i++) {
            if (host.children[i].classList.contains('tip')) return host.children[i];
        }
        return null;
    }

    function place(host) {
        var rect = host.getBoundingClientRect();
        var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
        var vw = doc.documentElement.clientWidth, vh = window.innerHeight;
        var gap = 10;
        var top = rect.bottom + gap;
        if (top + bh > vh - 8) top = rect.top - bh - gap;
        if (top < 8) top = 8;
        var left = rect.left;
        if (left + bw > vw - 8) left = vw - bw - 8;
        if (left < 8) left = 8;
        bubble.style.top = top + 'px';
        bubble.style.left = left + 'px';
    }

    function show(host) {
        var tip = hostTip(host);
        if (!tip || !tip.innerHTML.trim()) return;
        activeHost = host;
        bubble.innerHTML = tip.innerHTML;
        bubble.classList.toggle('wide', tip.classList.contains('wide'));
        bubble.classList.add('up');
        place(host);
    }

    function hide() {
        clearTimeout(showTimer);
        activeHost = null;
        pinned = false;
        bubble.classList.remove('up', 'pinned');
    }

    function initTips() {
        bubble = doc.createElement('div');
        bubble.className = 'tooltip';
        bubble.setAttribute('role', 'tooltip');
        doc.body.appendChild(bubble);

        var n = 0;
        doc.querySelectorAll('.tip').forEach(function (tip) {
            var host = tip.parentElement;
            host.setAttribute('data-tip-host', '');
            if (!tip.id) tip.id = 'tip' + (++n);
            var ctl = host.matches('button, a') ? host : host.querySelector('input, select');
            if (ctl) ctl.setAttribute('aria-describedby', tip.id);
        });

        doc.addEventListener('mouseover', function (e) {
            if (pinned) return;
            var host = e.target.closest && e.target.closest('[data-tip-host]');
            if (host === activeHost) return;
            clearTimeout(showTimer);
            if (!host) { hide(); return; }
            bubble.classList.remove('up');
            activeHost = host;
            showTimer = setTimeout(function () { show(host); }, host.matches('button, a') ? 150 : 450);
        });

        doc.addEventListener('focusin', function (e) {
            if (pinned) return;
            var host = e.target.closest && e.target.closest('[data-tip-host]');
            clearTimeout(showTimer);
            if (host && e.target.matches(':focus-visible, input, select')) show(host); else hide();
        });

        doc.addEventListener('click', function (e) {
            var host = e.target.closest && e.target.closest('.icon-btn[data-tip-host]');
            if (host && host.hasAttribute('data-pin-tip')) {
                if (pinned && activeHost === host) { hide(); return; }
                show(host);
                pinned = true;
                bubble.classList.add('pinned');
                return;
            }
            if (pinned && !bubble.contains(e.target)) hide();
        });

        doc.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
        window.addEventListener('scroll', function () { if (!pinned) hide(); else if (activeHost) place(activeHost); }, { passive: true });
    }

    /* ── file:// links ───────────────────────────────────────────────────────
       Directory links ("../x/") need index.html appended when opened off disk. */
    function fixFileLinks() {
        if (location.protocol !== 'file:') return;
        doc.querySelectorAll('a[href]').forEach(function (a) {
            var raw = a.getAttribute('href') || '';
            if (/^(https?:|mailto:|tel:|#)/i.test(raw)) return;
            if (raw.slice(-1) === '/') a.setAttribute('href', raw + 'index.html');
        });
    }

    /* ── Chrome shared by every page ─────────────────────────────────────── */

    function initPage() {
        fixFileLinks();
        initTips();
        var tb = el('themeBtn');
        if (tb) tb.addEventListener('click', toggleTheme);
    }

    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initPage);
    else initPage();

    /* ── Form state ──────────────────────────────────────────────────────── */

    function controls(root) {
        return Array.prototype.slice.call(
            (root || doc).querySelectorAll('input, select, textarea')
        ).filter(function (node) {
            return node.type !== 'button' && node.type !== 'submit' && !node.dataset.noSave;
        });
    }

    function snapshot(root) {
        var out = {};
        controls(root).forEach(function (node) {
            if (node.type === 'checkbox') {
                if (node.id) out['c:' + node.id] = node.checked;
            } else if (node.type === 'radio') {
                if (node.checked && node.name) out['r:' + node.name] = node.value;
            } else if (node.id) {
                out['v:' + node.id] = node.value;
            }
        });
        return out;
    }

    function apply(root, state) {
        if (!state) return;
        controls(root).forEach(function (node) {
            if (node.type === 'checkbox') {
                if (node.id && typeof state['c:' + node.id] === 'boolean') {
                    node.checked = state['c:' + node.id];
                }
            } else if (node.type === 'radio') {
                if (node.name && typeof state['r:' + node.name] === 'string') {
                    node.checked = node.value === state['r:' + node.name];
                }
            } else if (node.id && typeof state['v:' + node.id] === 'string') {
                node.value = state['v:' + node.id];
            }
        });
    }

    function load(key) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    function save(key, state) {
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
    }

    function drop(key) {
        try { localStorage.removeItem(key); } catch (e) {}
    }

    /* ── Terminal ────────────────────────────────────────────────────────── */

    function terminal(cfg) {
        var root = doc.querySelector('main') || doc.body;
        var qOut = el('qOut');
        var uOut = el('uOut');
        var goBtn = el('goBtn');
        var defaults = snapshot(root);
        var current = { q: '', url: '', ops: 0 };

        /* A shared ?q= link is deliberate; the last local session is not. */
        if (cfg.storeKey) apply(root, load(cfg.storeKey));

        if (cfg.prefill) {
            var incoming = '';
            try { incoming = new URL(location.href).searchParams.get('q') || ''; } catch (e) {}
            if (incoming) {
                var target = el(cfg.prefill);
                if (target) target.value = incoming;
            }
        }

        function paint() {
            var built;
            try { built = cfg.compile() || {}; }
            catch (e) { built = {}; }
            current = { q: built.q || '', url: built.url || '', ops: built.ops || 0 };

            if (qOut) {
                qOut.textContent = current.q || (cfg.emptyQuery || 'Start typing…');
                qOut.classList.toggle('empty', !current.q);
                qOut.title = current.q;
            }
            if (uOut) uOut.textContent = current.url || 'Nothing to link yet';
            if (goBtn) goBtn.disabled = !current.url;

            if (cfg.storeKey) save(cfg.storeKey, snapshot(root));
            if (cfg.onPaint) cfg.onPaint(current);
        }

        root.addEventListener('input', paint);
        root.addEventListener('change', paint);

        function run() {
            if (!current.url) { toast('Nothing to search yet'); return; }
            var win = window.open(current.url, '_blank', 'noopener');
            if (!win) toast('Popup blocked — copy the URL instead');
        }

        function bind(id, fn) {
            var node = el(id);
            if (node) node.addEventListener('click', fn);
        }

        bind('goBtn', run);

        bind('copyBtn', function () {
            if (!current.q) { toast('Query is empty'); return; }
            copy(current.q).then(function () { toast('Query copied'); },
                                 function () { toast('Copy blocked'); });
        });

        bind('copyUrlBtn', function () {
            if (!current.url) { toast('No URL yet'); return; }
            copy(current.url).then(function () { toast('URL copied'); },
                                   function () { toast('Copy blocked'); });
        });

        bind('resetBtn', function () {
            apply(root, defaults);
            controls(root).forEach(function (node) {
                if (node.type === 'checkbox' && typeof defaults['c:' + node.id] !== 'boolean') {
                    node.checked = false;
                }
            });
            if (cfg.storeKey) drop(cfg.storeKey);
            paint();
            toast('Cleared');
        });

        /* Enter runs from any single-line field; Ctrl/Cmd+Enter from anywhere. */
        root.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); run(); return; }
            var t = e.target;
            if (t && t.tagName === 'INPUT' && t.type !== 'checkbox' && t.type !== 'radio') {
                e.preventDefault();
                run();
            }
        });

        paint();
        return { paint: paint, run: run, state: function () { return current; } };
    }

    window.SRCH = {
        el: el, v: v, n: n, c: c, r: r,
        list: list, handles: handles, tags: tags, bareTags: bareTags, phrase: phrase,
        toast: toast, copy: copy,
        terminal: terminal
    };
})();
