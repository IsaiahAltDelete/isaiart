/* ===========================================================================
   Core primitives: namespace, helpers, persistence, events.

   Everything hangs off the single global `Win`. Modules load as classic
   scripts (no ES modules) so the desktop also runs from a file:// URL with no
   build step and no network access.
   =========================================================================== */

window.Win = window.Win || {};

(function (Win) {
  'use strict';

  /**
   * The invented person this simulated PC belongs to. Shared with the Mac and
   * iPhone recreations so the three devices read as one household. Every
   * address is `.example` (RFC 2606) and can never reach a real inbox.
   */
  Win.PERSONA = {
    name: 'Isaiah Souf',
    first: 'Isaiah',
    initials: 'IS',
    user: 'isaiah',
    email: 'isaiah.souf@outlook.example',
    computer: 'ISAIAH-LAPTOP',
    model: 'Surface Laptop (Fictional)',
  };

  Win.OS = {
    name: 'Windows 11 Home',
    version: '26H2',
    build: '26300.7019',
    researched: '2026-10-28',
  };

  Win.STORAGE_KEY = 'windows11-desktop-v1';
  Win.PIN = '1234';

  /* ----------------------------------------------------------------- helpers */

  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  Win.esc = value => String(value ?? '').replace(/[&<>"']/g, c => escapeMap[c]);

  Win.clone = value => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  Win.uid = (prefix = 'id') =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  Win.clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  Win.wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  Win.$ = (selector, scope = document) => scope.querySelector(selector);
  Win.$$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  Win.cls = (...parts) => parts.flat().filter(Boolean).join(' ');

  Win.debounce = (fn, wait = 160) => {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); };
  };

  /** Build an element from an HTML string; returns the first element. */
  Win.html = markup => {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstElementChild;
  };

  Win.bytes = value => {
    if (!Number.isFinite(value)) return '';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    let size = value;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    if (index === 0) return `${Math.round(size)} bytes`;
    return `${size >= 100 ? Math.round(size) : Math.round(size * 10) / 10} ${units[index]}`;
  };

  Win.formatTime = (date = new Date()) => date.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: !Win.state?.settings?.time24,
  });

  Win.formatDate = (date = new Date()) => date.toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: 'numeric',
  });

  Win.formatDateTime = timestamp => {
    const d = new Date(timestamp);
    return `${Win.formatDate(d)} ${Win.formatTime(d)}`;
  };

  /* ------------------------------------------------------------------ events */

  const listeners = {};
  /** Tiny pub/sub. Topics in use: state, theme, fs, network, windows, sound. */
  Win.on = (topic, fn) => { (listeners[topic] ||= []).push(fn); return () => Win.off(topic, fn); };
  Win.off = (topic, fn) => { listeners[topic] = (listeners[topic] || []).filter(f => f !== fn); };
  Win.emit = (topic, detail) => {
    for (const fn of listeners[topic] || []) {
      try { fn(detail); } catch (error) { console.error(error); }
    }
  };

  /* ------------------------------------------------------------- persistence */

  Win.Store = {
    load() {
      try {
        const raw = localStorage.getItem(Win.STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && data.schema === Win.DefaultState.schema ? data : null;
      } catch { return null; }
    },
    save() {
      try { localStorage.setItem(Win.STORAGE_KEY, JSON.stringify(Win.state)); } catch { /* private mode */ }
    },
    reset() {
      try { localStorage.removeItem(Win.STORAGE_KEY); } catch { /* ignore */ }
      Win.state = Win.clone(Win.DefaultState);
    },
  };

  const queueSave = Win.debounce(() => Win.Store.save(), 250);

  /** Persist and tell every surface the shared state changed. */
  Win.save = (topic = 'state') => {
    queueSave();
    Win.emit(topic);
    if (topic !== 'state') Win.emit('state');
  };

  /** Merge a saved document over defaults so new keys appear after updates. */
  Win.merge = (base, saved) => {
    if (Array.isArray(base) || Array.isArray(saved)) return saved ?? base;
    if (base && typeof base === 'object' && saved && typeof saved === 'object') {
      const out = { ...base };
      for (const key of Object.keys(saved)) out[key] = Win.merge(base[key], saved[key]);
      return out;
    }
    return saved === undefined ? base : saved;
  };
})(window.Win);
