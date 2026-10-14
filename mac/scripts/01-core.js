/* ===========================================================================
   Core primitives: namespace, helpers, persistence.

   Everything hangs off the single global `Mac`. Modules load as classic
   scripts (no ES modules) so the simulator also runs from a file:// URL with
   no build step and no network access.
   =========================================================================== */

window.Mac = window.Mac || {};

(function (Mac) {
  'use strict';

  /**
   * The invented person this simulated Mac belongs to.
   *
   * Everything here is fictional and everything is `.example`, which is
   * reserved by RFC 2606 and can never be registered — no address in this
   * project can reach a real inbox, and no name belongs to a real person.
   *
   * Centralised because it was not: the same name and addresses were typed
   * out in more than twenty places across both simulators, so changing the
   * persona meant a find-and-replace across seed data, and the variants had
   * already started to differ. The seeded mail bodies still spell the name
   * out — a signature at the foot of a message is prose, and threading a
   * variable through it would read worse and gain nothing.
   */
  Mac.PERSONA = {
    name: 'Alex Rivera',
    first: 'Alex',
    initials: 'AR',
    shortName: 'alex',          // the Unix account, and the home folder
    personal: 'alex.rivera@icloud.example',
    work: 'alex.rivera@support.example',
    computer: "Alex's MacBook Pro",
    phone: "Alex's iPhone",
  };

  Mac.VERSION = '8.0';
  Mac.OS_NAME = 'Golden Gate';
  Mac.RESEARCH_DATE = '2026-10-12';
  Mac.OS_VERSION = '27.0.1';
  Mac.OS_BUILD = 'SIMULATED-BUILD';
  Mac.STORAGE_KEY = 'macos-golden-gate-desktop-v3';
  /* Older keys are removed rather than left orphaned in the browser — v7 and
     earlier also carried a different, real-looking identity. */
  Mac.RETIRED_KEYS = ['macos-tahoe-simulator', 'macos-tahoe-simulator-v6', 'macos-tahoe-simulator-v7',
    'macos-tahoe-simulator-v8'];

  /* ----------------------------------------------------------------- helpers */

  const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** HTML-escape any value for safe interpolation into a template string. */
  Mac.esc = value => String(value ?? '').replace(/[&<>"']/g, c => escapeMap[c]);

  Mac.clone = value => (typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)));

  Mac.uid = (prefix = 'id') =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  Mac.getPath = (object, path) =>
    String(path).split('.').reduce((value, key) => (value == null ? value : value[key]), object);

  Mac.setPath = (object, path, value) => {
    const keys = String(path).split('.');
    const last = keys.pop();
    let target = object;
    for (const key of keys) {
      if (target[key] == null || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    target[last] = value;
    return object;
  };

  Mac.debounce = (fn, wait = 160) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  Mac.wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  Mac.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  Mac.$ = (selector, scope = document) => scope.querySelector(selector);
  Mac.$$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

  /** Build a class attribute from a map of `class: condition` pairs. */
  Mac.cls = (...parts) => parts.flat().filter(Boolean).join(' ');

  Mac.plural = (count, word, plural = `${word}s`) => `${count} ${count === 1 ? word : plural}`;

  Mac.bytes = value => {
    if (!Number.isFinite(value)) return '--';
    const units = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    let index = 0;
    let size = value;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    const rounded = index === 0 ? Math.round(size) : Math.round(size * 10) / 10;
    return `${rounded} ${units[index]}`;
  };

  Mac.timeAgo = timestamp => {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 45) return 'now';
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  };

  Mac.formatTime = (date = new Date()) => date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !Mac.state?.settings?.time24,
  });

  /** Deterministic color for an avatar / chart series from arbitrary text. */
  Mac.tint = text => {
    const palette = ['#2f7cf6', '#6c5ce7', '#e0455f', '#ef8b2c', '#0f9d58',
                     '#0aa3c2', '#9b3ec4', '#c2185b', '#4c6ef5', '#2f9e6f'];
    let hash = 0;
    for (let i = 0; i < String(text).length; i += 1) hash = (hash * 31 + String(text).charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % palette.length];
  };

  Mac.initials = name => String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join('');

  /* ------------------------------------------------------------------- events */

  const listeners = new Map();

  Mac.on = (topic, handler) => {
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(handler);
    return () => listeners.get(topic)?.delete(handler);
  };

  Mac.emit = (topic, payload) => {
    listeners.get(topic)?.forEach(handler => {
      try { handler(payload); } catch (error) { console.error(`[${topic}]`, error); }
    });
  };

  /* -------------------------------------------------------------- persistence */

  /**
   * Merge stored state over the defaults so a saved profile keeps working when
   * new keys are introduced. Arrays are taken wholesale from the saved copy
   * (they are user data), objects are merged key by key.
   */
  function mergeDefaults(defaults, saved) {
    if (Array.isArray(defaults)) return Array.isArray(saved) ? saved : Mac.clone(defaults);
    if (defaults && typeof defaults === 'object') {
      if (!saved || typeof saved !== 'object') return Mac.clone(defaults);
      const result = {};
      for (const key of new Set([...Object.keys(defaults), ...Object.keys(saved)])) {
        result[key] = key in defaults
          ? mergeDefaults(defaults[key], saved[key])
          : saved[key];
      }
      return result;
    }
    return saved === undefined ? defaults : saved;
  }

  Mac.Store = {
    available: true,
    /** Set when localStorage is unavailable, so the UI can explain why. */
    reason: '',

    load() {
      try {
        Mac.RETIRED_KEYS.forEach(key => localStorage.removeItem(key));
        const raw = localStorage.getItem(Mac.STORAGE_KEY);
        if (!raw) return Mac.clone(Mac.DefaultState);
        const saved = JSON.parse(raw);
        if (saved?.schema !== Mac.DefaultState.schema) return Mac.clone(Mac.DefaultState);
        return mergeDefaults(Mac.DefaultState, saved);
      } catch (error) {
        this.available = false;
        this.reason = error.message;
        return Mac.clone(Mac.DefaultState);
      }
    },

    save() {
      try {
        localStorage.setItem(Mac.STORAGE_KEY, JSON.stringify(Mac.state));
        this.available = true;
      } catch (error) {
        this.available = false;
        this.reason = error.message;
      }
    },

    clear() {
      try { localStorage.removeItem(Mac.STORAGE_KEY); } catch (error) { /* private mode */ }
    },
  };

  /* Persisting is also the moment to re-check scenario goals: every fix a
     trainee applies ends in a save, whereas only some of them end in a sync. */
  Mac.save = () => {
    Mac.Store.save();
    Mac.Scenarios?.evaluate();
  };

  /** Write a value at `path` and refresh whatever depends on it. */
  Mac.set = (path, value, { silent = false } = {}) => {
    Mac.setPath(Mac.state, path, value);
    Mac.save();
    if (!silent) Mac.sync();
    return value;
  };

  Mac.toggle = (path, { silent = false } = {}) =>
    Mac.set(path, !Mac.getPath(Mac.state, path), { silent });

  /* -------------------------------------------------- transient session state */

  /** Runtime-only state: never persisted, reset on reload. */
  Mac.session = {
    activeApp: 'finder',
    zIndex: 40,
    surface: null,
    space: 0,
    networkAttempt: 0,
    fullscreenWindow: null,
    lastFocus: null,
    booted: false,
    safeMode: false,
    installing: {},
    hudTimer: null,
  };
}(window.Mac));
