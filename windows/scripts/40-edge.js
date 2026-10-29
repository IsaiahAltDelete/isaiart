/* ===========================================================================
   Microsoft Edge.

   Tabs live in the title bar. Pages come from four places:
   - edge:// pages (new tab, settings, history, downloads, favorites, about)
   - a small catalogue of fictional sites on .example domains
   - live Wikipedia articles and search results from Wikipedia's public API,
     rebuilt from an allowlist so nothing from the response can run
   - local files from Win.FS (PDF viewer, text, folder listings)
   Every non-local navigation first asks Win.Network.webReason() whether the
   PC could reach the web, so Settings changes show up as real browser errors.
   =========================================================================== */

(function (Win) {
  'use strict';

  Win.DefaultState.edge = {
    favorites: [
      { title: 'Sablewave Help Center', url: 'https://support.example/' },
      { title: 'Contoso Electronics', url: 'https://contoso.example/' },
      { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
      { title: 'Example Domain', url: 'https://example.com/' },
    ],
    history: [],
    homepage: 'edge://newtab',
    downloads: [],
    collections: [],
    favBar: 'always',         // 'always' | 'newtab' | 'never'
    showHome: false,
    askDownload: false,
    startupBoost: true,
  };

  const VERSION = '141.0.3537.71';
  const NEWTAB = 'edge://newtab';
  const E = () => Win.state.edge;
  const esc = Win.esc;
  const hash = value => [...String(value)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  /* ----------------------------------------------------------- URL helpers */

  /** Turn address-bar text into a URL, or a search when it isn't one. */
  function normalize(input) {
    const raw = String(input ?? '').trim();
    if (!raw) return null;
    if (/^about:blank$/i.test(raw)) return 'about:blank';
    if (/^(edge|about):\/{0,2}/i.test(raw)) return `edge://${raw.replace(/^(edge|about):\/{0,2}/i, '').replace(/\/$/, '').toLowerCase() || 'newtab'}`;
    if (/^file:\/\//i.test(raw)) return raw;
    if (/^[a-z]:[\\/]/i.test(raw)) return `file:///${raw.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/i, ':')}`;
    if (/^https?:\/\//i.test(raw)) {
      try { return new URL(raw).href; } catch { return searchUrl(raw); }
    }
    if (!/\s/.test(raw) && (/^localhost(:\d+)?(\/|$)/i.test(raw) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(raw) && /\.[a-z]{2,}(:\d+)?(\/|$)|^\d+\.\d+\.\d+\.\d+/i.test(raw))) {
      try { return new URL(`https://${raw}`).href; } catch { return searchUrl(raw); }
    }
    return searchUrl(raw);
  }

  const searchUrl = q => `https://search.example/search?q=${encodeURIComponent(q)}`;
  const parse = url => { try { return new URL(url); } catch { return null; } };
  const hostOf = url => parse(url)?.hostname || '';
  const isWiki = host => /(^|\.)wikipedia\.org$/i.test(host);

  function filePath(url) {
    const u = parse(url);
    if (!u) return '';
    return decodeURIComponent(u.pathname.replace(/^\//, '')).replace(/\//g, '\\');
  }

  function fileUrl(id) {
    const parts = [];
    let node = Win.FS.get(id);
    while (node) {
      if (node.kind === 'drive') { parts.unshift(`${node.letter}:`); break; }
      parts.unshift(encodeURIComponent(node.name));
      node = Win.FS.get(node.parent);
    }
    return `file:///${parts.join('/')}`;
  }

  /* --------------------------------------------------------------- errors */

  const OFFLINE = ['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'];

  /**
   * Describe the error page for a connectivity reason (from
   * Win.Network.webReason()) or a lookup failure.
   */
  function classify(reason, host = 'this site') {
    const h = host || 'this site';
    const diag = { label: 'Run Network troubleshooter', act: 'network' };
    if (OFFLINE.includes(reason)) {
      return {
        kind: 'offline', title: 'You\u2019re not connected', lead: 'Your device isn\u2019t connected to the internet. Let\u2019s get you back online.',
        tips: reason === 'airplane' ? ['Turning off Airplane mode', 'Reconnecting to Wi-Fi'] : reason === 'wifi-off' || reason === 'adapter-disabled' ? ['Turning on Wi-Fi', 'Reconnecting to Wi-Fi'] : ['Checking the network cables, modem, and router', 'Reconnecting to Wi-Fi'],
        code: 'ERR_INTERNET_DISCONNECTED', actions: [diag],
      };
    }
    if (reason === 'proxy') {
      return {
        kind: 'proxy', title: 'Hmmm\u2026 can\u2019t reach this page', lead: 'There is something wrong with the proxy server, or the address is incorrect.',
        tips: ['Contacting your system admin', 'Checking the proxy address'], code: 'ERR_PROXY_CONNECTION_FAILED',
        actions: [{ label: 'Check your proxy settings', act: 'proxy' }],
      };
    }
    if (reason === 'no-dns') {
      return {
        kind: 'dns', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `${h}\u2019s server IP address could not be found.`,
        tips: [`Check if there is a typo in ${h}.`, 'Checking the connection', 'Checking the proxy, firewall, and DNS configuration', 'Running Windows Network Diagnostics'],
        code: 'DNS_PROBE_FINISHED_NO_INTERNET', actions: [diag],
      };
    }
    if (reason === 'no-internet' || reason === 'apipa' || reason === 'no-gateway') {
      return {
        kind: 'nointernet', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `${h}\u2019s server IP address could not be found.`,
        tips: [reason === 'apipa' ? 'Your PC couldn\u2019t get a valid IP address from the network' : 'The network you\u2019re connected to has no internet access', 'Checking the network cables, modem, and router', 'Running Windows Network Diagnostics'],
        code: 'ERR_NAME_NOT_RESOLVED', actions: [diag],
      };
    }
    if (reason === 'nxdomain') {
      return {
        kind: 'nxdomain', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `Check if there is a typo in ${h}.`,
        tips: ['If spelling is correct, try running Windows Network Diagnostics.'], code: 'DNS_PROBE_FINISHED_NXDOMAIN', actions: [diag],
      };
    }
    if (reason === 'timeout') {
      return {
        kind: 'timeout', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `${h} took too long to respond.`,
        tips: ['Checking the connection', 'Checking the proxy, firewall, and DNS configuration'], code: 'ERR_CONNECTION_TIMED_OUT', actions: [diag],
      };
    }
    if (reason === 'file') {
      return { kind: 'file', title: 'Hmmm\u2026 can\u2019t find this file', lead: 'It may have been moved, edited, or deleted.', tips: [], code: 'ERR_FILE_NOT_FOUND', actions: [] };
    }
    if (reason === 'invalid') {
      return { kind: 'invalid', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `The webpage at ${h} might be temporarily down or it may have moved permanently to a new web address.`, tips: [], code: 'ERR_INVALID_URL', actions: [] };
    }
    return { kind: 'generic', title: 'Hmmm\u2026 can\u2019t reach this page', lead: `${h} refused to connect.`, tips: [], code: 'ERR_CONNECTION_REFUSED', actions: [] };
  }

  const SAD = `<svg class="edge-err-ico" width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><rect x="14" y="8" width="44" height="56" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="28" cy="30" r="2.6" fill="currentColor"/><circle cx="44" cy="30" r="2.6" fill="currentColor"/><path d="M26 46c5-5 15-5 20 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
  const UNPLUG = `<svg class="edge-err-ico" width="96" height="72" viewBox="0 0 96 72" aria-hidden="true"><path d="M8 54c14-2 18-14 30-14s14 12 28 12 18-10 22-14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><path d="M44 22c4-8 16-8 20 0M38 16c8-14 24-14 32 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".55"/><path d="M30 10l40 40" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

  function errorPage(info, url) {
    return {
      kind: 'error', title: hostOf(url) || url, cls: 'edge-internal', error: info,
      html: `<div class="edge-err">${info.kind === 'offline' ? UNPLUG : SAD}
        <h1>${esc(info.title)}</h1>
        <p class="edge-err-lead">${esc(info.lead)}</p>
        ${info.tips.length ? `<p class="edge-err-try">Try:</p><ul>${info.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <p class="edge-err-code">${esc(info.code)}</p>
        <div class="edge-err-actions"><button class="btn accent" data-act="reload">Refresh</button>${info.actions.map(a => `<button class="btn" data-act="${a.act}">${esc(a.label)}</button>`).join('')}</div>
      </div>`,
    };
  }

  /* ------------------------------------------------------------ sanitiser */

  const ALLOWED_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BLOCKQUOTE', 'BR', 'CAPTION', 'CITE', 'CODE', 'DD', 'DFN', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD', 'LI', 'MARK', 'OL', 'P', 'PRE', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP',
    'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'VAR', 'WBR', 'CENTER']);
  const UNWRAP = new Set(['SECTION', 'MAIN', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'NAV', 'DETAILS', 'SUMMARY', 'FONT', 'TT', 'BODY', 'LABEL']);
  const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'width', 'height', 'class', 'scope', 'lang', 'dir']);
  const DROP = 'script, style, link, meta, noscript, iframe, object, embed, form, input, button, textarea, select, svg, math, audio, video, ' +
    '.mw-editsection, .navbox, .vertical-navbox, .sidebar, .navbox-styles, .mw-references-wrap .mw-ref-follow, .sistersitebox, .noprint, .mw-empty-elt, .metadata, .ambox, .mbox-small, .hatnote.navigation-not-searchable, .side-box';

  function sanitize(html) {
    const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
    parsed.querySelectorAll(DROP).forEach(n => n.remove());
    const out = document.createElement('div');
    copyChildren(parsed.body, out);
    return out.innerHTML;
  }

  function copyChildren(source, dest) {
    source.childNodes.forEach(node => {
      if (node.nodeType === 3) { dest.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (!ALLOWED_TAGS.has(tag)) { if (UNWRAP.has(tag)) copyChildren(node, dest); return; }
      const clone = document.createElement(tag.toLowerCase());
      for (const attr of node.attributes) {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on') || !ALLOWED_ATTRS.has(name) || name === 'href' || name === 'src') continue;
        clone.setAttribute(name, attr.value);
      }
      const id = node.getAttribute('id');
      if (id) clone.id = `wk-${id}`;
      if (tag === 'A' && !rewriteLink(node, clone)) { copyChildren(node, dest); return; }
      if (tag === 'IMG' && !rewriteImage(node, clone)) return;
      copyChildren(node, clone);
      dest.appendChild(clone);
    });
  }

  function rewriteLink(source, clone) {
    const href = source.getAttribute('href') || '';
    if (href.startsWith('#')) { clone.setAttribute('href', href); clone.dataset.anchor = `wk-${decodeURIComponent(href.slice(1))}`; return true; }
    if (/[?&]redlink=1/.test(href)) { clone.className = 'new'; return true; }
    const wiki = href.match(/^(?:https?:)?(?:\/\/en\.wikipedia\.org)?(?:\.\/|\/wiki\/)([^?#]+)(#.*)?$/);
    if (wiki) { clone.setAttribute('href', `https://en.wikipedia.org/wiki/${wiki[1]}${wiki[2] || ''}`); return true; }
    if (/^\/\//.test(href)) { clone.setAttribute('href', `https:${href}`); return true; }
    if (/^https?:\/\//i.test(href)) { clone.setAttribute('href', href); clone.className = `${clone.className} external`.trim(); return true; }
    return false;
  }

  function rewriteImage(source, clone) {
    let src = source.getAttribute('src') || '';
    if (src.startsWith('//')) src = `https:${src}`;
    if (src.startsWith('/')) src = `https://en.wikipedia.org${src}`;
    if (!/^https:\/\/([a-z]+\.wikimedia\.org|en\.wikipedia\.org)\//.test(src)) return false;
    clone.setAttribute('src', src);
    clone.setAttribute('loading', 'lazy');
    clone.setAttribute('referrerpolicy', 'no-referrer');
    clone.setAttribute('decoding', 'async');
    return true;
  }

  const stripTags = html => {
    if (typeof DOMParser === 'undefined') return String(html || '').replace(/<[^>]*>/g, '');
    return (new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '').trim();
  };

  async function fetchJSON(url, signal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('timeout')), 12000);
    const relay = () => ctrl.abort(signal.reason);
    signal?.addEventListener('abort', relay, { once: true });
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  }

  const API = 'https://en.wikipedia.org/w/api.php';

  async function wikiPage(u, signal) {
    let title = 'Main_Page';
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (m) title = decodeURIComponent(m[1]);
    if (u.pathname === '/w/index.php' && u.searchParams.get('search')) return searchPage(new URL(searchUrl(u.searchParams.get('search'))), signal);
    if (/^Special:Search/i.test(title)) return searchPage(new URL(searchUrl(u.searchParams.get('search') || '')), signal);
    const params = new URLSearchParams({ action: 'parse', page: title, prop: 'text|displaytitle', formatversion: '2', redirects: '1', format: 'json', origin: '*', disableeditsection: '1' });
    let data;
    try { data = await fetchJSON(`${API}?${params}`, signal); } catch (error) {
      if (signal?.aborted) throw error;
      return errorPage(classify(typeof navigator !== 'undefined' && navigator.onLine === false ? 'disconnected' : 'timeout', u.hostname), u.href);
    }
    const shown = title.replace(/_/g, ' ');
    if (data.error) {
      return {
        kind: 'site', cls: 'edge-site edge-wiki', title: `${shown} - Wikipedia`, favicon: 'wiki',
        html: `${wikiHead()}<article class="wk-article"><h1 class="wk-title">${esc(shown)}</h1><div class="wk-from">From Wikipedia, the free encyclopedia</div>
          <div class="wk-missing"><p><b>Wikipedia does not have an article with this exact name.</b></p><p>Try <a href="${esc(searchUrl(shown))}">searching for ${esc(shown)}</a> to find similar articles.</p></div></article>`,
      };
    }
    const display = stripTags(data.parse.displaytitle) || shown;
    return {
      kind: 'site', cls: 'edge-site edge-wiki', title: `${display} - Wikipedia`, favicon: 'wiki',
      html: `${wikiHead()}<article class="wk-article"><h1 class="wk-title">${esc(display)}</h1>${data.parse.title === 'Main Page' ? '' : '<div class="wk-from">From Wikipedia, the free encyclopedia</div>'}
        <div class="wk-body">${sanitize(data.parse.text)}</div>
        <footer class="wk-foot">Text is available under the <a href="https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License">Creative Commons Attribution-ShareAlike 4.0 License</a>; additional terms may apply. Content retrieved live from en.wikipedia.org.</footer></article>`,
      anchor: u.hash ? `wk-${decodeURIComponent(u.hash.slice(1))}` : null,
    };
  }

  const wikiHead = () => `<header class="wk-head"><a class="wk-logo" href="https://en.wikipedia.org/wiki/Main_Page"><span class="wk-globe">W</span><span><b>Wikipedia</b><small>The Free Encyclopedia</small></span></a>
    <form class="wk-search" data-form="wiki"><input name="q" type="search" placeholder="Search Wikipedia" aria-label="Search Wikipedia"><button class="wk-go" type="submit">Search</button></form></header>`;

  /* --------------------------------------------------------- local sites */

  const ARTICLES = [
    { slug: 'connected-no-internet', cat: 'Wi-Fi & connectivity', title: 'Connected to Wi-Fi but there\u2019s no internet', updated: 'October 21, 2026',
      summary: 'Your PC shows "No internet" under the network name, or pages won\u2019t load even though Wi-Fi is connected.',
      body: `<p>When Windows shows <b>No internet</b> under your network name, your PC has joined the Wi-Fi network but can\u2019t reach the internet through it. The cause is usually the PC\u2019s IP or DNS settings, the router, or the service itself.</p>
        <h2>1. Check whether other devices are online</h2><p>If phones and other computers on the same network also can\u2019t browse, restart the router: unplug it for 30 seconds, plug it back in, and wait for the internet light to turn solid white.</p>
        <h2>2. Make sure Windows gets its settings automatically</h2><ol><li>Select <b>Start</b> &gt; <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Wi-Fi</b>.</li><li>Select your network\u2019s <b>properties</b>.</li><li>Next to <b>IP assignment</b> and <b>DNS server assignment</b>, select <b>Edit</b> and choose <b>Automatic (DHCP)</b>.</li></ol>
        <h2>3. Test from the command line</h2><p>Open <b>Terminal</b> and run these commands. Write down what you see; our support team may ask for it.</p>
        <pre>ipconfig /all\nping 192.168.1.1\nping 8.8.8.8\nping support.example</pre>
        <p>If <code>ping 8.8.8.8</code> replies but <code>ping support.example</code> says it could not find the host, the problem is DNS. See <a href="https://support.example/articles/change-dns">Change DNS server settings</a>.</p>`,
    },
    { slug: 'change-dns', cat: 'Internet & DNS', title: 'Change DNS server settings in Windows 11', updated: 'October 9, 2026',
      summary: 'Use automatic DNS from your router, or enter a preferred and alternate DNS server.',
      body: `<p>DNS turns names like <b>support.example</b> into addresses your PC can connect to. If the DNS server your PC uses stops answering, websites won\u2019t load even though the connection itself works.</p>
        <h2>Use automatic DNS (recommended)</h2><ol><li>Open <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Wi-Fi</b> &gt; <b>[your network] properties</b>.</li><li>Next to <b>DNS server assignment</b>, select <b>Edit</b>.</li><li>Choose <b>Automatic (DHCP)</b> and select <b>Save</b>.</li></ol>
        <h2>Enter DNS servers manually</h2><p>Choose <b>Manual</b>, turn on <b>IPv4</b>, and enter a <b>Preferred DNS</b> address such as <code>1.1.1.1</code> or <code>8.8.8.8</code>. Addresses in the <code>192.0.2.x</code>, <code>198.51.100.x</code> and <code>203.0.113.x</code> ranges are reserved for documentation and will never answer.</p>
        <h2>Check your change</h2><pre>nslookup support.example\nipconfig /flushdns</pre>`,
    },
    { slug: 'proxy-settings', cat: 'Internet & DNS', title: 'Pages won\u2019t load: check your proxy settings', updated: 'September 30, 2026',
      summary: 'A leftover manual proxy makes browsers fail while ping and other tools still work.',
      body: `<p>A proxy server sits between your browser and the web. If a proxy is set but no longer exists, Microsoft Edge shows <code>ERR_PROXY_CONNECTION_FAILED</code> while command-line tools such as <code>ping</code> keep working.</p>
        <ol><li>Open <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Proxy</b>.</li><li>Under <b>Manual proxy setup</b>, select <b>Edit</b> next to <b>Use a proxy server</b>.</li><li>Turn <b>Use a proxy server</b> off unless your workplace gave you an address, then select <b>Save</b>.</li><li>Leave <b>Automatically detect settings</b> on.</li></ol>
        <p>If your organisation uses <b>proxy.support.example</b>, enter it exactly with the port your IT department provided.</p>`,
    },
    { slug: 'apipa-169-254', cat: 'Wi-Fi & connectivity', title: 'Your PC has a 169.254.x.x address', updated: 'August 14, 2026',
      summary: 'An address starting with 169.254 means Windows couldn\u2019t get one from the router.',
      body: `<p>When <code>ipconfig</code> shows an <b>Autoconfiguration IPv4 Address</b> that starts with <code>169.254</code>, Windows assigned itself an address because it couldn\u2019t get one from the router (DHCP). You\u2019ll see <b>No internet</b> until this is fixed.</p>
        <ol><li>If you typed an IP address by hand, open the network\u2019s properties and set <b>IP assignment</b> back to <b>Automatic (DHCP)</b>, or correct the address so it\u2019s on your router\u2019s network (for Sablewave routers, <code>192.168.1.2</code> to <code>192.168.1.254</code> with gateway <code>192.168.1.1</code>).</li>
        <li>From an administrator Terminal, run <code>ipconfig /release</code> and then <code>ipconfig /renew</code>.</li><li>Restart the router if the address doesn\u2019t change.</li></ol>`,
    },
    { slug: 'find-wifi-password', cat: 'Security', title: 'Find the password for a saved Wi-Fi network', updated: 'July 2, 2026',
      summary: 'See the key for a network this PC has connected to before.',
      body: `<h2>In Settings</h2><ol><li>Open <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Wi-Fi</b> &gt; <b>Manage known networks</b>.</li><li>Select the network, then next to <b>View Wi-Fi security key</b>, select <b>View</b>.</li></ol>
        <h2>From Terminal</h2><pre>netsh wlan show profiles\nnetsh wlan show profile name="Sablewave Home" key=clear</pre><p>The password appears next to <b>Key Content</b>.</p>`,
    },
    { slug: 'reset-network', cat: 'Wi-Fi & connectivity', title: 'Reset network settings in Windows 11', updated: 'June 18, 2026',
      summary: 'Network reset removes and reinstalls adapters and returns networking components to their defaults.',
      body: `<p>Try this after other steps haven\u2019t worked. You\u2019ll need to reconnect to Wi-Fi and re-enter passwords afterwards.</p>
        <ol><li>Open <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Advanced network settings</b> &gt; <b>Network reset</b>.</li><li>Select <b>Reset now</b> and confirm. Your PC restarts.</li></ol>
        <h2>Command-line alternative</h2><p>From Terminal (Admin):</p><pre>netsh winsock reset\nnetsh int ip reset\nipconfig /flushdns</pre><p>Restart the PC when the commands finish.</p>`,
    },
    { slug: 'wifi-missing', cat: 'Wi-Fi & connectivity', title: 'The Wi-Fi option is missing or turned off', updated: 'May 27, 2026',
      summary: 'Airplane mode, a disabled adapter, or the Wi-Fi switch can hide your networks.',
      body: `<ol><li>Select the network icon on the taskbar. Make sure <b>Airplane mode</b> is off and <b>Wi-Fi</b> is on.</li><li>If the Wi-Fi tile is missing, open <b>Settings</b> &gt; <b>Network &amp; internet</b> &gt; <b>Advanced network settings</b> and make sure the <b>Wi-Fi</b> adapter is <b>Enabled</b>.</li><li>Run <code>netsh wlan show interfaces</code> to check the radio status.</li></ol>`,
    },
  ];

  const DOWNLOADS = [
    { file: 'SablewaveConnectSetup.exe', label: 'Sablewave Connect for Windows', note: 'Version 4.2.1 \u00b7 Windows 11 \u00b7 24.6 MB', size: 25_794_560 },
    { file: 'Wi-Fi troubleshooting checklist.pdf', label: 'Wi-Fi troubleshooting checklist', note: 'PDF \u00b7 412 KB', size: 421_888 },
    { file: 'Router quick start guide.pdf', label: 'AX3000 router quick start guide', note: 'PDF \u00b7 1.8 MB', size: 1_887_436 },
  ];

  const supportShell = (inner, q = '') => `<div class="sw">
    <header class="sw-top"><a class="sw-brand" href="https://support.example/"><span class="sw-mark">S</span>Sablewave <b>Help Center</b></a>
      <nav><a href="https://support.example/">Home</a><a href="https://support.example/articles">Articles</a><a href="https://support.example/downloads">Downloads</a><a href="https://support.example/contact">Contact us</a></nav></header>
    ${inner}
    <footer class="sw-foot">\u00a9 2026 Sablewave Communications (fictional). <a href="https://support.example/contact">Contact</a> \u00b7 <a href="https://support.example/articles">All articles</a></footer></div>`;

  const supportSearch = (q = '') => `<form class="sw-search" data-form="support"><input name="q" type="search" value="${esc(q)}" placeholder="Describe your problem" aria-label="Search help articles"><button class="sw-btn" type="submit">Search</button></form>`;
  const articleLink = a => `<a class="sw-card" href="https://support.example/articles/${a.slug}"><b>${esc(a.title)}</b><span>${esc(a.summary)}</span><small>${esc(a.cat)}</small></a>`;

  function supportSite(u) {
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (path === '/') {
      return { title: 'Sablewave Help Center', html: supportShell(`<section class="sw-hero"><h1>How can we help?</h1>${supportSearch()}</section>
        <section class="sw-sec"><h2>Popular articles</h2><div class="sw-grid">${ARTICLES.slice(0, 6).map(articleLink).join('')}</div></section>
        <section class="sw-sec"><h2>Downloads</h2><p>Get the Sablewave Connect app and printable guides. <a href="https://support.example/downloads">See all downloads</a></p></section>`) };
    }
    if (path === '/articles') return { title: 'All articles - Sablewave Help Center', html: supportShell(`<section class="sw-sec"><h1>All articles</h1>${supportSearch()}<div class="sw-grid">${ARTICLES.map(articleLink).join('')}</div></section>`) };
    const art = path.match(/^\/articles\/([\w-]+)$/);
    if (art) {
      const a = ARTICLES.find(x => x.slug === art[1]);
      if (!a) return null;
      return { title: `${a.title} - Sablewave Help Center`, html: supportShell(`<article class="sw-article"><p class="sw-crumb"><a href="https://support.example/">Help Center</a> \u203a ${esc(a.cat)}</p><h1>${esc(a.title)}</h1><p class="sw-meta">Updated ${esc(a.updated)}</p>${a.body}
        <aside class="sw-related"><h3>Related articles</h3>${ARTICLES.filter(x => x !== a && x.cat === a.cat).slice(0, 3).map(x => `<a href="https://support.example/articles/${x.slug}">${esc(x.title)}</a>`).join('') || '<span>No related articles.</span>'}</aside></article>`) };
    }
    if (path === '/downloads') {
      return { title: 'Downloads - Sablewave Help Center', html: supportShell(`<section class="sw-sec"><h1>Downloads</h1><div class="sw-dl">${DOWNLOADS.map(d => `<div class="sw-dl-row"><span class="sw-dl-ico">${Win.appIcon(/\.pdf$/.test(d.file) ? 'pdf' : 'exe', 32)}</span><span><b>${esc(d.label)}</b><small>${esc(d.note)}</small></span>
        <a class="sw-btn" href="https://support.example/files/${encodeURIComponent(d.file)}" data-download="${esc(d.file)}" data-size="${d.size}">Download</a></div>`).join('')}</div></section>`) };
    }
    if (path === '/contact') {
      return { title: 'Contact us - Sablewave Help Center', html: supportShell(`<section class="sw-sec"><h1>Contact us</h1><div class="sw-grid"><div class="sw-card"><b>Call</b><span>1-555-0142 (7 AM \u2013 11 PM ET, every day)</span></div><div class="sw-card"><b>Chat</b><span>Chat is available in the Sablewave Connect app.</span></div><div class="sw-card"><b>Service status</b><span>All systems operating normally.</span></div></div></section>`) };
    }
    if (path === '/search') {
      const q = (u.searchParams.get('q') || '').trim();
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = ARTICLES.filter(a => words.some(w => `${a.title} ${a.summary} ${a.body}`.toLowerCase().includes(w)));
      return { title: `${q} - Search - Sablewave Help Center`, html: supportShell(`<section class="sw-sec"><h1>Results for \u201c${esc(q)}\u201d</h1>${supportSearch(q)}${hits.length ? `<div class="sw-grid">${hits.map(articleLink).join('')}</div>` : '<p>No articles matched. Try different words.</p>'}</section>`) };
    }
    const file = path.match(/^\/files\/(.+)$/);
    if (file) {
      const d = DOWNLOADS.find(x => x.file === decodeURIComponent(file[1]));
      if (d) return { title: d.file, html: supportShell(`<section class="sw-sec"><h1>Your download is ready</h1><p><a class="sw-btn" href="${esc(u.href)}" data-download="${esc(d.file)}" data-size="${d.size}">Download ${esc(d.file)}</a></p></section>`) };
    }
    return null;
  }

  const PRODUCTS = [
    { id: 'hub', name: 'USB-C 7-in-1 Hub', price: 49.99, hue: 210, glyph: 'usb', blurb: 'HDMI 4K60, two USB-A ports, SD and microSD readers, 100 W pass-through charging.' },
    { id: 'stand', name: 'Aluminum Laptop Stand', price: 34.99, hue: 30, glyph: 'pc', blurb: 'Raises the screen to eye level and folds flat for travel.' },
    { id: 'mouse', name: 'Quiet Wireless Mouse', price: 24.99, hue: 280, glyph: 'mouse', blurb: 'Silent clicks, Bluetooth 5.3 and up to 18 months on one AA battery.' },
    { id: 'buds', name: 'Noise-Cancelling Earbuds', price: 129.0, hue: 160, glyph: 'headphones', blurb: 'Adaptive noise cancellation and 30 hours with the case.' },
    { id: 'router', name: 'Wi-Fi 7 Mesh Router', price: 249.0, hue: 0, glyph: 'wifi4', blurb: 'Tri-band Wi-Fi 7 coverage for homes up to 3,000 sq ft.' },
    { id: 'ssd', name: '1 TB Portable SSD', price: 89.99, hue: 330, glyph: 'drive', blurb: 'USB 3.2 Gen 2 with read speeds up to 1,050 MB/s.' },
  ];
  const cart = [];
  const money = n => `$${n.toFixed(2)}`;

  function shopShell(inner) {
    const count = cart.reduce((s, c) => s + c.qty, 0);
    return `<div class="ct"><header class="ct-top"><a class="ct-brand" href="https://contoso.example/">Contoso <b>Electronics</b></a>
      <form class="ct-search" data-form="shop"><input name="q" type="search" placeholder="Search products" aria-label="Search products"></form>
      <a class="ct-cart" href="https://contoso.example/cart">Cart (${count})</a></header>${inner}
      <footer class="ct-foot">Contoso Electronics is a fictional store. Prices shown in USD.</footer></div>`;
  }

  const productTile = p => `<div class="ct-art" style="--hue:${p.hue}">${Win.glyph(p.glyph, 56)}</div>`;

  function shopSite(u) {
    const path = u.pathname.replace(/\/$/, '') || '/';
    const card = p => `<a class="ct-card" href="https://contoso.example/product/${p.id}">${productTile(p)}<b>${esc(p.name)}</b><span>${money(p.price)}</span></a>`;
    if (path === '/') return { title: 'Contoso Electronics', html: shopShell(`<section class="ct-hero"><h1>Fall tech sale</h1><p>Free shipping on orders over $35.</p></section><section class="ct-grid">${PRODUCTS.map(card).join('')}</section>`) };
    if (path === '/search') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const hits = PRODUCTS.filter(p => `${p.name} ${p.blurb}`.toLowerCase().includes(q));
      return { title: `Search - Contoso Electronics`, html: shopShell(`<section class="ct-sec"><h1>${hits.length} results</h1><div class="ct-grid">${hits.map(card).join('')}</div></section>`) };
    }
    const prod = path.match(/^\/product\/(\w+)$/);
    if (prod) {
      const p = PRODUCTS.find(x => x.id === prod[1]);
      if (!p) return null;
      return { title: `${p.name} - Contoso Electronics`, html: shopShell(`<section class="ct-product">${productTile(p)}<div><h1>${esc(p.name)}</h1><p class="ct-price">${money(p.price)}</p><p>${esc(p.blurb)}</p><p class="ct-stock">In stock \u00b7 Ships in 1\u20132 business days</p>
        <button class="ct-btn" data-act="cart-add" data-id="${p.id}">Add to cart</button></div></section>`) };
    }
    if (path === '/cart') {
      const sub = cart.reduce((s, c) => s + c.qty * PRODUCTS.find(p => p.id === c.id).price, 0);
      const tax = Math.round(sub * 0.065 * 100) / 100;
      return { title: 'Cart - Contoso Electronics', html: shopShell(`<section class="ct-sec"><h1>Your cart</h1>${cart.length ? `<table class="ct-table"><tbody>${cart.map(c => { const p = PRODUCTS.find(x => x.id === c.id); return `<tr><td>${esc(p.name)}</td><td>Qty ${c.qty}</td><td>${money(p.price * c.qty)}</td><td><button class="ct-link" data-act="cart-remove" data-id="${p.id}">Remove</button></td></tr>`; }).join('')}</tbody></table>
        <p class="ct-total">Subtotal ${money(sub)} \u00b7 Estimated tax ${money(tax)} \u00b7 <b>Total ${money(sub + tax)}</b></p><a class="ct-btn" href="https://contoso.example/checkout">Check out</a>` : '<p>Your cart is empty.</p><p><a href="https://contoso.example/">Continue shopping</a></p>'}</section>`) };
    }
    if (path === '/checkout') return { title: 'Checkout - Contoso Electronics', html: shopShell('<section class="ct-sec"><h1>Checkout</h1><p>Online checkout is temporarily unavailable. Your cart has been saved. Please try again later.</p></section>') };
    return null;
  }

  function exampleSite() {
    return { title: 'Example Domain', html: '<div class="exd"><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://www.iana.org/help/example-domains">Learn more</a></p></div></div>' };
  }

  async function searchPage(u, signal) {
    const q = (u.searchParams.get('q') || '').trim();
    const box = `<form class="sx-box" data-form="search"><input name="q" type="search" value="${esc(q)}" aria-label="Search"><button type="submit" aria-label="Search">${Win.glyph('search', 18)}</button></form>`;
    const local = ARTICLES.filter(a => q && q.toLowerCase().split(/\s+/).some(w => w.length > 2 && `${a.title} ${a.summary}`.toLowerCase().includes(w))).slice(0, 2);
    let results = [];
    let failed = false;
    if (q) {
      const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srlimit: '10', srprop: 'snippet|timestamp', format: 'json', formatversion: '2', origin: '*' });
      try {
        const data = await fetchJSON(`${API}?${params}`, signal);
        results = (data.query?.search || []).map(r => ({ title: r.title, snippet: stripTags(r.snippet) }));
      } catch (error) {
        if (signal?.aborted) throw error;
        failed = true;
      }
    }
    const item = (url, title, crumb, text) => `<div class="sx-hit"><span class="sx-crumb">${esc(crumb)}</span><a href="${esc(url)}">${esc(title)}</a><p>${esc(text)}</p></div>`;
    return {
      kind: 'site', cls: 'edge-site', title: q ? `${q} - Search` : 'Search', favicon: 'search',
      html: `<div class="sx"><header class="sx-top"><a class="sx-brand" href="https://search.example/">Search</a>${box}</header>
        <div class="sx-results">${q ? `<p class="sx-count">${failed ? 'Some results couldn\u2019t be loaded right now.' : `About ${results.length + local.length} results`}</p>` : '<p class="sx-count">Type something to search the web.</p>'}
        ${local.map(a => item(`https://support.example/articles/${a.slug}`, a.title, `support.example \u203a articles`, a.summary)).join('')}
        ${results.map(r => item(`https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`, `${r.title} - Wikipedia`, 'en.wikipedia.org \u203a wiki', r.snippet)).join('')}</div></div>`,
    };
  }

  const SITES = {
    'support.example': { fn: supportSite, favicon: 'support' },
    'contoso.example': { fn: shopSite, favicon: 'shop' },
    'www.contoso.example': { fn: shopSite, favicon: 'shop' },
    'example.com': { fn: exampleSite, favicon: 'globe' },
    'www.example.com': { fn: exampleSite, favicon: 'globe' },
  };

  /* ---------------------------------------------------------------- PDFs */

  function pdfDoc(node) {
    const name = node.name.replace(/\.pdf$/i, '');
    const date = new Date(node.modified || Date.now());
    const d = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const P = Win.PERSONA;
    const n = name.toLowerCase();
    const table = rows => `<table class="pdf-t">${rows.map((r, i) => `<tr${i === 0 ? ' class="h"' : ''}>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    if (/receipt|invoice/.test(n)) {
      return [`<h1>Contoso Electronics</h1><p class="pdf-sub">Order receipt</p><p>Order number: CE-2026-${(hash(name) % 900000) + 100000}<br>Order date: ${d}<br>Sold to: ${esc(P.name)}</p>
        ${table([['Item', 'Qty', 'Price'], ['Surface Laptop (Fictional), 13.8-inch, Intel Core Ultra 7, 32 GB, 512 GB', '1', '$1,499.99'], ['Microsoft 365 Personal, 12-month subscription', '1', '$99.99'], ['Accidental damage protection, 2 years', '1', '$149.00']])}
        <p class="pdf-right">Subtotal $1,748.98<br>Sales tax (6.5%) $113.68<br><b>Total $1,862.66</b></p><p>Paid by credit card on ${d}.</p><h2>Returns</h2><p>Most items can be returned within 30 days of delivery in their original packaging. Keep this receipt for warranty service.</p>`];
    }
    if (/bill|statement/.test(n)) {
      return [`<h1>Sablewave Mobile</h1><p class="pdf-sub">Monthly statement \u2014 ${esc(name.replace(/^phone bill\s*/i, '') || 'September')}</p><p>Account holder: ${esc(P.name)}<br>Account number: 4471-${(hash(name) % 9000) + 1000}<br>Statement date: ${d}</p>
        <h2>Summary</h2>${table([['Description', 'Amount'], ['Previous balance', '$78.39'], ['Payment received \u2014 thank you', '\u2212$78.39'], ['Unlimited Plus plan', '$45.00'], ['Device installment 14 of 24', '$27.08'], ['Taxes, fees and surcharges', '$6.31'], ['<b>Amount due</b>', '<b>$78.39</b>']])}
        <p>Autopay will charge your saved payment method on the 21st.</p>`,
      `<h2>Usage details</h2>${table([['Line', 'Talk', 'Text', 'Data'], ['(555) 010-4417', '312 min', '1,204', '11.4 GB'], ['Hotspot', '\u2014', '\u2014', '0.8 GB']])}<p>Data used on Wi-Fi isn\u2019t counted. Visit support.example for ways to manage your plan.</p>`];
    }
    if (/manual|guide|quick start/.test(n)) {
      return [`<h1>Sablewave AX3000 Router</h1><p class="pdf-sub">${esc(name)}</p><h2>In the box</h2><ul><li>AX3000 dual-band router</li><li>Power adapter</li><li>Ethernet cable</li></ul><h2>Set up</h2><ol><li>Connect the WAN port to your modem with the Ethernet cable.</li><li>Plug in the power adapter. The light pulses blue while starting up and turns solid white when online.</li><li>Join the network printed on the label, or open <b>http://192.168.1.1</b> to change the name and password.</li></ol>`,
        `<h2>Default settings</h2>${table([['Setting', 'Default'], ['Router address', '192.168.1.1'], ['Subnet mask', '255.255.255.0'], ['DHCP range', '192.168.1.40 \u2013 192.168.1.250'], ['DNS', 'Provided by the router'], ['Security', 'WPA3-Personal / WPA2 mixed']])}<h2>Status light</h2>${table([['Light', 'Meaning'], ['Solid white', 'Connected to the internet'], ['Pulsing blue', 'Starting up'], ['Solid amber', 'No internet from the modem'], ['Flashing amber', 'Firmware update in progress']])}`,
        `<h2>Troubleshooting</h2><p><b>Devices show \u201cNo internet\u201d.</b> Check the status light. If it\u2019s amber, restart the modem, then the router.</p><p><b>A PC shows a 169.254.x.x address.</b> The PC isn\u2019t receiving an address from the router. Set the PC to obtain an IP address automatically.</p><h2>Reset to factory settings</h2><p>With the router on, press and hold the Reset button for 10 seconds until the light flashes amber. All settings return to the defaults listed on page 2.</p>`];
    }
    if (/tax/.test(n)) {
      return [`<h1>2025 Tax Summary</h1><p class="pdf-sub">Prepared for ${esc(P.name)}</p>${table([['Item', 'Amount'], ['Wages (Fabrikam, Inc.)', '$84,200.00'], ['Federal income tax withheld', '$10,912.00'], ['State income tax withheld', '$3,154.00'], ['Interest income', '$212.48'], ['Charitable contributions', '$1,150.00']])}
        <p>Keep this summary with your records for at least three years.</p>`];
    }
    if (/checklist/.test(n)) {
      return [`<h1>Wi-Fi troubleshooting checklist</h1><p class="pdf-sub">Sablewave Help Center</p><ol><li>Is Airplane mode off and Wi-Fi on?</li><li>Does the network show <b>Connected, secured</b>?</li><li>Run <b>ipconfig</b>. Does the IPv4 address start with 192.168.1?</li><li>Can you <b>ping 192.168.1.1</b> (the router)?</li><li>Can you <b>ping 8.8.8.8</b>? If yes but websites fail, check DNS.</li><li>Run <b>nslookup support.example</b>. A timeout points to the DNS server.</li><li>Check <b>Settings &gt; Network &amp; internet &gt; Proxy</b> for an old proxy.</li><li>Still stuck? Restart the router and call 1-555-0142.</li></ol>`];
    }
    return [`<h1>${esc(name)}</h1><p class="pdf-sub">Saved ${d}</p><h2>Summary</h2><p>This document, \u201c${esc(name)},\u201d is stored in ${esc(Win.FS.get(node.parent)?.name || 'your files')}. It was last modified on ${d}.</p><h2>Details</h2>${table([['Field', 'Value'], ['File name', esc(node.name)], ['Size', esc(Win.bytes(Win.FS.size(node.id)))], ['Owner', esc(P.name)]])}`];
  }

  function pdfPage(node, url) {
    const pages = pdfDoc(node);
    return {
      kind: 'pdf', cls: 'edge-pdf', title: node.name, favicon: 'pdf', fileId: node.id,
      html: `<div class="pdf-bar" role="toolbar" aria-label="PDF toolbar">
          <button class="pdf-b" aria-label="Table of contents" title="Table of contents">${Win.glyph('list', 16)}</button>
          <span class="pdf-sep"></span>
          <span class="pdf-pages"><input class="pdf-pg" value="1" aria-label="Page number" size="2"> of ${pages.length}</span>
          <span class="pdf-sep"></span>
          <button class="pdf-b" data-pdf="out" aria-label="Zoom out" title="Zoom out (Ctrl+Minus)">${Win.glyph('zoomout', 16)}</button>
          <button class="pdf-b" data-pdf="in" aria-label="Zoom in" title="Zoom in (Ctrl+Plus)">${Win.glyph('zoomin', 16)}</button>
          <button class="pdf-b" data-pdf="fit" aria-label="Fit to page" title="Fit to page">${Win.glyph('maximize', 14)}</button>
          <button class="pdf-b" data-pdf="rotate" aria-label="Rotate" title="Rotate (Ctrl+])">${Win.glyph('rotate', 16)}</button>
          <span class="pdf-sep"></span>
          <button class="pdf-b txt" disabled title="Draw">${Win.glyph('brush', 16)}<span>Draw</span></button>
          <button class="pdf-b txt" disabled title="Highlight">${Win.glyph('edit', 16)}<span>Highlight</span></button>
          <button class="pdf-b" disabled aria-label="Erase">${Win.glyph('eraser', 16)}</button>
          <span class="pdf-fill"></span>
          <button class="pdf-b" data-pdf="print" aria-label="Print" title="Print (Ctrl+P)">${Win.glyph('printer', 16)}</button>
          <button class="pdf-b" data-pdf="save" aria-label="Save" title="Save (Ctrl+S)">${Win.glyph('download', 16)}</button>
        </div>
        <div class="pdf-scroll"><div class="pdf-stack">${pages.map((p, i) => `<div class="pdf-page" data-page="${i + 1}">${p}<span class="pdf-no">${i + 1}</span></div>`).join('')}</div></div>`,
    };
  }

  function filePage(url) {
    const path = filePath(url);
    const id = Win.FS.resolve(path, 'c');
    const node = id && Win.FS.get(id);
    if (!node) return errorPage(classify('file'), url);
    if (node.ext === 'pdf') return pdfPage(node, url);
    if (Win.FS.isFolder(node)) {
      const kids = Win.FS.children(id, { hidden: false }).sort((a, b) => (Win.FS.isFolder(b) - Win.FS.isFolder(a)) || a.name.localeCompare(b.name));
      const shown = path.replace(/\\$/, '');
      return { kind: 'file', cls: 'edge-site edge-index', title: `Index of ${shown}\\`, favicon: 'file',
        html: `<h1>Index of ${esc(shown)}\\</h1><p><a href="${esc(node.kind === 'drive' ? url : fileUrl(node.parent))}">[parent directory]</a></p>
          <table><thead><tr><th>Name</th><th>Size</th><th>Date modified</th></tr></thead><tbody>${kids.map(k => `<tr><td><a href="${esc(fileUrl(k.id))}">${esc(k.name)}${Win.FS.isFolder(k) ? '/' : ''}</a></td><td>${Win.FS.isFolder(k) ? '' : esc(Win.bytes(Win.FS.size(k.id)))}</td><td>${k.modified ? esc(Win.formatDateTime(k.modified)) : ''}</td></tr>`).join('')}</tbody></table>` };
    }
    if (typeof node.content === 'string') return { kind: 'file', cls: 'edge-site edge-text', title: node.name, favicon: 'file', html: `<pre>${esc(node.content)}</pre>` };
    return { kind: 'file', cls: 'edge-internal', title: node.name, favicon: 'file', html: `<div class="edge-err">${SAD}<h1>This file can\u2019t be shown here</h1><p class="edge-err-lead">${esc(node.name)}</p><div class="edge-err-actions"><button class="btn accent" data-act="openfile" data-id="${esc(node.id)}">Open with default app</button></div></div>` };
  }

  /* ---------------------------------------------------------- edge pages */

  const QUICK = [
    { title: 'Help Center', url: 'https://support.example/' },
    { title: 'Contoso', url: 'https://contoso.example/' },
    { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Main_Page' },
    { title: 'Example', url: 'https://example.com/' },
  ];

  /* Microsoft Bing mark, drawn from simple shapes (no external artwork). */
  const BING_MARK = `<svg class="ntp-bing-mark" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="ntp-bing-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#37bdff"/><stop offset=".55" stop-color="#1b8fe6"/><stop offset="1" stop-color="#0c59a4"/></linearGradient></defs><path fill="url(#ntp-bing-g)" d="M5 2l4.3 1.5v13.1l5.8-3.3-2.8-1.4-1.8-4.4 9.2 3.2v4.8L9.3 22 5 19.6z"/></svg>`;
  const MIC = '<path d="M10 2.5a2.5 2.5 0 0 0-2.5 2.5v5a2.5 2.5 0 0 0 5 0V5A2.5 2.5 0 0 0 10 2.5z"/><path d="M5 9.5a5 5 0 0 0 10 0M10 14.5v3"/>';
  const LENS = '<path d="M3 7V5a2 2 0 0 1 2-2h2M13 3h2a2 2 0 0 1 2 2v2M17 13v2a2 2 0 0 1-2 2h-2M7 17H5a2 2 0 0 1-2-2v-2"/><circle cx="10" cy="10" r="3"/>';
  const line = (d, size = 18) => `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

  function newTabPage(priv) {
    if (priv) {
      return { kind: 'edge', cls: 'edge-internal edge-ntp private', title: 'New InPrivate tab', html: `<div class="ntp-private"><div class="ntp-pv-card">
        <h1>${Win.glyph('eye', 28)} InPrivate browsing</h1>
        <p>InPrivate browsing doesn\u2019t save your browsing data, like your history, temporary internet files, and cookies, on this device once you close all InPrivate windows.</p>
        <div class="ntp-pv-cols"><div><h2>What InPrivate does</h2><ul><li>Deletes browsing data on this device after you close all InPrivate windows</li><li>Saves favorites and downloaded files so you can use them next time</li></ul></div>
        <div><h2>What InPrivate doesn\u2019t do</h2><ul><li>Hide your browsing from your school, employer, or internet service provider</li><li>Give you additional protection from tracking by default</li></ul></div></div>
        <form class="ntp-search" data-form="omni"><span>${Win.glyph('search', 18)}</span><input name="q" placeholder="Search the web" aria-label="Search the web"></form></div></div>` };
    }
    const tiles = [...E().favorites.slice(0, 6), ...QUICK].filter((t, i, all) => all.findIndex(x => x.url === t.url) === i).slice(0, 8);
    return { kind: 'edge', cls: 'edge-internal edge-ntp', title: 'New tab', html: `<div class="ntp">
      <div class="ntp-head"><span class="ntp-sp"></span>
        <button class="ntp-ic" data-act="ntp-settings" aria-label="Page settings" title="Page settings">${Win.glyph('gear', 18)}</button></div>
      <div class="ntp-gap"></div>
      <div class="ntp-hero">
        <div class="ntp-bing">${BING_MARK}<span>Microsoft Bing</span></div>
        <form class="ntp-search" data-form="omni">
          <span class="ntp-s-ico">${Win.glyph('search', 18)}</span>
          <input name="q" placeholder="Search the web" aria-label="Search the web" autocomplete="off">
          <button type="button" class="ntp-s-btn" aria-label="Search using voice" title="Search using voice">${line(MIC)}</button>
          <button type="button" class="ntp-s-btn" aria-label="Visual search" title="Visual search">${line(LENS)}</button>
          <button type="button" class="ntp-s-btn" data-act="copilot-open" aria-label="Copilot" title="Copilot">${Win.appIcon('copilot', 20)}</button>
        </form>
        <div class="ntp-tiles" role="list" aria-label="Quick links">${tiles.map(t => `<a class="ntp-tile" role="listitem" href="${esc(t.url)}" title="${esc(t.url)}"><span class="ntp-fav">${favicon(t.url)}</span><span class="ntp-tl">${esc(t.title)}</span></a>`).join('')}
          <button class="ntp-tile add" data-act="add-quick" aria-label="Add a site" title="Add a site"><span class="ntp-fav">${Win.glyph('plus', 18)}</span><span class="ntp-tl">Add site</span></button></div>
      </div>
      <div class="ntp-gap wide"></div>
      <div class="ntp-foot"><span class="ntp-credit">${Win.glyph('picture', 14)}<span>Windows 11 lock screen image</span></span></div>
    </div>` };
  }

  const SETTINGS_NAV = [
    ['profiles', 'Profiles', 'person'], ['privacy', 'Privacy, search, and services', 'privacy'], ['appearance', 'Appearance', 'palette'],
    ['start', 'Start, home, and new tab page', 'home'], ['downloads', 'Downloads', 'download'], ['system', 'System and performance', 'system'],
    ['reset', 'Reset settings', 'undo'], ['help', 'About Microsoft Edge', 'edge'],
  ];

  function settingsPage(section) {
    const s = E();
    const sec = SETTINGS_NAV.some(([id]) => id === section) ? section : 'profiles';
    const row = (title, desc, control) => `<div class="es-row"><span><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</span><span>${control}</span></div>`;
    const P = Win.PERSONA;
    const bodies = {
      profiles: `<h2>Your profile</h2><div class="es-card es-profile"><span class="es-avatar">${esc(P.initials)}</span><span><b>Personal</b><small>${esc(P.email)}</small><small>Sync is on</small></span><button class="btn" disabled>Sign out</button></div>
        ${row('Sync', 'Favorites, settings, passwords, and history are syncing.', '<span class="muted">On</span>')}${row('Passwords', 'No saved passwords.', '')}`,
      privacy: `<h2>Clear browsing data</h2>${row('Clear browsing data now', 'This includes history, cookies, and cached files.', '<button class="btn" data-act="clear-data">Choose what to clear</button>')}
        <h2>Tracking prevention</h2>${row('Tracking prevention', 'Balanced (recommended)', Win.toggle(true, 'disabled', 'Tracking prevention'))}
        <h2>Security</h2>${row('Microsoft Defender SmartScreen', 'Help protect me from malicious sites and downloads.', Win.toggle(true, 'disabled', 'SmartScreen'))}${row('Use secure DNS', 'Use the current service provider.', Win.toggle(false, 'disabled', 'Secure DNS'))}`,
      appearance: `<h2>Customize toolbar</h2>${row('Show favorites bar', '', Win.select([['always', 'Always'], ['never', 'Never'], ['newtab', 'Only on new tabs']], s.favBar, 'data-es="favBar"'))}
        ${row('Show home button', 'Set what the home button opens below.', Win.toggle(s.showHome, 'data-es="showHome"', 'Show home button'))}`,
      start: `<h2>Home button</h2>${row('Home button opens', '', `<input class="input" data-es="homepage" value="${esc(s.homepage)}" aria-label="Home page" style="width:260px">`)}
        <h2>New tab page</h2>${row('Quick links', 'Your favorites appear first.', '<span class="muted">On</span>')}`,
      downloads: `<h2>Downloads</h2>${row('Location', `C:\\Users\\${esc(P.user)}\\Downloads`, '<button class="btn" data-act="open-downloads-folder">Open folder</button>')}
        ${row('Ask me what to do with each download', '', Win.toggle(s.askDownload, 'data-es="askDownload"', 'Ask what to do with each download'))}`,
      system: `<h2>System</h2>${row('Startup boost', 'Get to browsing quicker. When this is on, it helps Microsoft Edge open faster.', Win.toggle(s.startupBoost, 'data-es="startupBoost"', 'Startup boost'))}
        ${row('Use graphics acceleration when available', '', Win.toggle(true, 'disabled', 'Graphics acceleration'))}${row('Proxy settings', 'Microsoft Edge uses your computer\u2019s proxy settings.', '<button class="btn" data-act="proxy">Open your computer\u2019s proxy settings</button>')}`,
      reset: `<h2>Reset settings</h2>${row('Restore settings to their default values', 'This resets your startup page, new tab page, and favorites bar choice.', '<button class="btn" data-act="reset-settings">Reset</button>')}`,
      help: `<h2>About</h2><div class="es-card es-about"><span>${Win.appIcon('edge', 40)}</span><span><b>Microsoft Edge</b><small>Version ${VERSION} (Official build) (64-bit)</small>
        <span class="es-update" data-update><span class="ring sm"></span> Checking for updates</span></span></div>
        <p class="muted">Microsoft Edge<br>\u00a9 2026 Microsoft Corporation. All rights reserved.</p>`,
    };
    return { kind: 'edge', cls: 'edge-internal edge-settings', title: 'Settings', url: `edge://settings/${sec}`, section: sec,
      html: `<div class="es"><nav class="es-nav"><h1>Settings</h1><div class="es-find">${Win.glyph('search', 14)}<input placeholder="Search settings" aria-label="Search settings" data-es-find></div>
        ${SETTINGS_NAV.map(([id, label, g]) => `<a href="edge://settings/${id}" class="${id === sec ? 'active' : ''}">${id === 'help' ? Win.appIcon('edge', 16) : Win.glyph(g, 16)}<span>${label}</span></a>`).join('')}</nav>
        <section class="es-main">${bodies[sec]}</section></div>` };
  }

  function historyPage(q = '') {
    const items = E().history.filter(h => !q || `${h.title} ${h.url}`.toLowerCase().includes(q.toLowerCase()));
    const groups = {};
    items.forEach(h => {
      const d = new Date(h.time);
      const key = d.toDateString() === new Date().toDateString() ? 'Today' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      (groups[key] ||= []).push(h);
    });
    return { kind: 'edge', cls: 'edge-internal edge-list', title: 'History', html: `<div class="el"><header><h1>History</h1><div class="es-find">${Win.glyph('search', 14)}<input placeholder="Search history" value="${esc(q)}" data-hist-find aria-label="Search history"></div><button class="btn" data-act="clear-data">Clear browsing data</button></header>
      ${Object.keys(groups).length ? Object.entries(groups).map(([day, list]) => `<h2>${esc(day)}</h2><div class="el-card">${list.map(h => `<div class="el-row"><span class="el-time">${esc(Win.formatTime(new Date(h.time)))}</span><span class="el-fav">${favicon(h.url)}</span><a href="${esc(h.url)}">${esc(h.title)}</a><span class="el-host">${esc(hostOf(h.url))}</span><button class="icon-btn" data-act="hist-del" data-time="${h.time}" aria-label="Delete">${Win.glyph('close', 12)}</button></div>`).join('')}</div>`).join('') : '<p class="muted el-empty">Your history will show up here.</p>'}</div>` };
  }

  function downloadsPage() {
    const list = E().downloads;
    return { kind: 'edge', cls: 'edge-internal edge-list', title: 'Downloads', html: `<div class="el"><header><h1>Downloads</h1><button class="btn" data-act="open-downloads-folder">Open downloads folder</button></header>
      ${list.length ? `<div class="el-card">${list.map(d => { const exists = d.fileId && Win.FS.get(d.fileId); return `<div class="el-row tall"><span class="el-fav">${Win.fileIcon(exists || { kind: 'file', ext: d.name.split('.').pop() }, 24)}</span><span class="el-main"><b>${esc(d.name)}</b><small>${exists ? '' : 'Deleted \u00b7 '}${esc(hostOf(d.url))} \u00b7 ${esc(Win.bytes(d.size))}</small>${exists ? `<button class="link" data-act="dl-open" data-id="${esc(d.fileId)}">Open file</button>` : ''}</span><button class="icon-btn" data-act="dl-folder" data-id="${esc(d.fileId || '')}" aria-label="Show in folder" ${exists ? '' : 'disabled'}>${Win.glyph('folder', 16)}</button><button class="icon-btn" data-act="dl-del" data-id="${esc(d.id)}" aria-label="Remove from list">${Win.glyph('close', 12)}</button></div>`; }).join('')}</div>` : '<p class="muted el-empty">No downloads yet.</p>'}</div>` };
  }

  function favoritesPage() {
    const list = E().favorites;
    return { kind: 'edge', cls: 'edge-internal edge-list', title: 'Favorites', html: `<div class="el"><header><h1>Favorites</h1><button class="btn" data-act="fav-add-current">Add this page</button></header>
      <h2>Favorites bar</h2>${list.length ? `<div class="el-card">${list.map((f, i) => `<div class="el-row"><span class="el-fav">${favicon(f.url)}</span><a href="${esc(f.url)}">${esc(f.title)}</a><span class="el-host">${esc(f.url)}</span><button class="icon-btn" data-act="fav-edit" data-i="${i}" aria-label="Edit">${Win.glyph('edit', 14)}</button><button class="icon-btn" data-act="fav-del" data-i="${i}" aria-label="Delete">${Win.glyph('trash', 14)}</button></div>`).join('')}</div>` : '<p class="muted el-empty">You don\u2019t have any favorites.</p>'}</div>` };
  }

  function versionPage() {
    return { kind: 'edge', cls: 'edge-internal edge-list', title: 'About Version', html: `<div class="el"><header><h1>Microsoft Edge</h1></header><div class="el-card el-kv">
      ${[['Microsoft Edge', `${VERSION} (Official build) (64-bit)`], ['Revision', 'c3f0a5e1b2d94c7a8e6f1b0d2a9c4e7f5b3d1a08'], ['OS', `Windows 11 Version 26H2 (Build ${Win.OS.build})`], ['JavaScript', 'V8 14.1.146.11'], ['User agent', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/${VERSION}`], ['Profile path', `C:\\Users\\${esc(Win.PERSONA.user)}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default`]].map(([k, v]) => `<div class="el-row"><b>${k}</b><span>${v}</span></div>`).join('')}</div></div>` };
  }

  function edgePage(url, tab) {
    const rest = url.replace(/^edge:\/\//, '');
    const [path, query] = rest.split('?');
    const [page, sub] = path.split('/');
    if (page === 'newtab' || page === '') return newTabPage(tab.priv);
    if (page === 'settings') return settingsPage(sub || 'profiles');
    if (page === 'about') return settingsPage('help');
    if (page === 'history') return historyPage(new URLSearchParams(query || '').get('q') || '');
    if (page === 'downloads') return downloadsPage();
    if (page === 'favorites') return favoritesPage();
    if (page === 'version') return versionPage();
    return errorPage(classify('invalid', url), url);
  }

  /* -------------------------------------------------------------- icons */

  function favicon(url, page) {
    const u = String(url || '');
    if (page?.favicon === 'pdf' || /\.pdf$/i.test(u)) return Win.appIcon('pdf', 16);
    if (/^edge:/.test(u) || u === NEWTAB) return Win.appIcon('edge', 16);
    if (/^file:/.test(u)) return `<span class="fav-gl">${Win.glyph('document', 14)}</span>`;
    const host = hostOf(u);
    if (isWiki(host)) return '<span class="fav-l fav-wiki">W</span>';
    if (/support\.example$/.test(host)) return '<span class="fav-l fav-sw">S</span>';
    if (/contoso\.example$/.test(host)) return '<span class="fav-l fav-ct">C</span>';
    if (/search\.example$/.test(host)) return `<span class="fav-l fav-sx">${Win.glyph('search', 10)}</span>`;
    return `<span class="fav-gl">${Win.glyph('globe', 14)}</span>`;
  }

  /* ------------------------------------------------------------- loading */

  /** Produce the page for a URL. Throws only when aborted. */
  async function resolvePage(url, tab, signal) {
    if (url === 'about:blank') return { kind: 'edge', cls: 'edge-site', title: 'about:blank', html: '' };
    if (/^edge:/.test(url)) return edgePage(url, tab);
    if (/^file:/i.test(url)) return filePage(url);
    const u = parse(url);
    if (!u || !/^https?:$/.test(u.protocol)) return errorPage(classify('invalid', url), url);
    const host = u.hostname.toLowerCase();
    const reason = Win.Network.webReason();
    if (reason) return errorPage(classify(reason, host), url);
    const r = Win.Network.resolve(host);
    if (!r.ok) return errorPage(classify(r.error === 'nxdomain' || r.error === 'invalid' ? 'nxdomain' : r.error, host), url);
    Win.Terminal?.noteDns?.(host, r.ip);
    await Win.wait(120 + (hash(url) % 240));
    if (signal.aborted) throw new Error('aborted');
    if (host === 'search.example') return searchPage(u, signal);
    if (isWiki(host)) {
      if (host !== 'en.wikipedia.org') return wikiPage(new URL(`https://en.wikipedia.org${u.pathname === '/' ? '/wiki/Main_Page' : u.pathname}${u.search}${u.hash}`), signal);
      return wikiPage(u, signal);
    }
    const site = SITES[host];
    if (site) {
      const page = site.fn(u);
      if (!page) return { kind: 'site', cls: 'edge-site', title: '404 Not Found', favicon: site.favicon, html: `<div class="exd"><div><h1>404</h1><p>The page you\u2019re looking for can\u2019t be found on ${esc(host)}.</p><p><a href="https://${esc(host)}/">Go to the home page</a></p></div></div>` };
      return { kind: 'site', cls: 'edge-site', favicon: site.favicon, ...page };
    }
    return {
      kind: 'blocked', cls: 'edge-internal', title: host,
      html: `<div class="edge-err">${SAD}<h1>This page can\u2019t be shown in this window</h1>
        <p class="edge-err-lead">${esc(host)} doesn\u2019t allow itself to be displayed inside another page.</p>
        <p class="muted">You can open it in your own browser instead.</p>
        <p class="edge-err-code">ERR_BLOCKED_BY_RESPONSE</p>
        <div class="edge-err-actions"><button class="btn accent" data-act="external" data-url="${esc(u.href)}">Open in a new browser tab</button><button class="btn" data-act="back">Go back</button></div></div>`,
    };
  }

  /* -------------------------------------------------------------- window */

  function create(win, args = {}) {
    const priv = !!args.private;
    const st = win.state;
    st.tabs = [];
    st.active = null;
    st.priv = priv;
    st.closed = [];
    win.el.classList.add('edge-win');
    if (priv) win.el.classList.add('edge-private', 't-dark');

    win.titleContent.innerHTML = `${priv ? '' : `<button class="edge-profile" data-nodrag aria-label="Profile: ${esc(Win.PERSONA.name)}" title="Personal\n${esc(Win.PERSONA.email)}"><span>${esc(Win.PERSONA.initials)}</span></button>`}<div class="edge-strip" role="tablist" aria-label="Tabs"></div>
      <button class="edge-newtab" aria-label="New tab" title="New tab (Ctrl+T)">${Win.glyph('plus', 14)}</button><div class="edge-drag"></div>`;
    win.body.innerHTML = `<div class="edge">
      <div class="edge-toolbar" role="toolbar" aria-label="App bar">
        <button class="eb" data-b="back" aria-label="Back" title="Click to go back (Alt+Left arrow)">${Win.glyph('back', 16)}</button>
        <button class="eb" data-b="forward" aria-label="Forward" title="Click to go forward (Alt+Right arrow)">${Win.glyph('forward', 16)}</button>
        <button class="eb" data-b="reload" aria-label="Refresh" title="Refresh (Ctrl+R)">${Win.glyph('refresh', 16)}</button>
        <button class="eb" data-b="home" aria-label="Home" title="Home (Alt+Home)">${Win.glyph('home', 16)}</button>
        <div class="edge-omni">
          <button class="edge-siteinfo" data-b="info" aria-label="View site information"></button>
          <input class="edge-url" type="text" spellcheck="false" autocomplete="off" aria-label="Address and search bar" placeholder="Search or enter web address">
          <button class="eb sm" data-b="star" aria-label="Add this page to favorites" title="Add this page to favorites (Ctrl+D)">${Win.glyph('star', 16)}</button>
        </div>
        <div class="edge-tools">
          ${priv ? '<span class="edge-pill">InPrivate</span>' : ''}
          <button class="eb" data-b="favorites" aria-label="Favorites" title="Favorites (Ctrl+Shift+O)">${Win.glyph('star', 16)}<i class="eb-lines"></i></button>
          <button class="eb" data-b="collections" aria-label="Collections" title="Collections (Ctrl+Shift+Y)">${Win.glyph('collection', 16)}</button>
          <button class="eb" data-b="downloads" aria-label="Downloads" title="Downloads (Ctrl+J)">${Win.glyph('download', 16)}</button>
          <button class="eb" data-b="more" aria-label="Settings and more" title="Settings and more (Alt+F)">${Win.glyph('more', 16)}</button>
          ${priv ? '' : `<button class="eb eb-copilot" data-b="copilot" aria-label="Copilot" title="Copilot">${Win.appIcon('copilot', 20)}</button>`}
        </div>
      </div>
      <div class="edge-favbar" role="toolbar" aria-label="Favorites bar"></div>
      <div class="edge-view"><div class="edge-progress"><i></i></div><div class="edge-doc" tabindex="-1"></div></div>
      <div class="edge-status" aria-hidden="true"></div>
      <div class="edge-fly hidden" role="dialog"></div>
    </div>`;

    const root = win.body.querySelector('.edge');
    const strip = win.titleContent.querySelector('.edge-strip');
    const urlInput = root.querySelector('.edge-url');
    const doc = root.querySelector('.edge-doc');
    const view = root.querySelector('.edge-view');
    const favbar = root.querySelector('.edge-favbar');
    const fly = root.querySelector('.edge-fly');
    const statusEl = root.querySelector('.edge-status');
    const btn = name => root.querySelector(`[data-b="${name}"]`);

    const active = () => st.active;

    /* ------------------------------------------------------- chrome */

    const isFav = url => E().favorites.some(f => f.url === url);

    const renderTabs = () => {
      strip.innerHTML = st.tabs.map(t => `<div class="edge-tab ${t === st.active ? 'active' : ''}" role="tab" data-nodrag data-tab="${t.id}" aria-selected="${t === st.active}" tabindex="0" title="${esc(t.title)}">
        <span class="edge-tab-fav">${t.loading ? '<span class="ring xs"></span>' : favicon(t.url, t.page)}</span>
        <span class="edge-tab-title">${esc(t.title)}</span>
        <button class="edge-tab-x" aria-label="Close tab" title="Close tab (Ctrl+W)">${Win.glyph('close', 10)}</button></div>`).join('');
      const t = active();
      if (t) win.setTitle(`${t.title}${st.tabs.length > 1 ? ` and ${st.tabs.length - 1} more page${st.tabs.length > 2 ? 's' : ''}` : ''} - ${priv ? '[InPrivate] - ' : 'Personal - '}Microsoft Edge`);
    };

    const renderToolbar = () => {
      const t = active();
      if (!t) return;
      btn('back').disabled = t.index <= 0;
      btn('forward').disabled = t.index >= t.stack.length - 1;
      const r = btn('reload');
      r.innerHTML = Win.glyph(t.loading ? 'close' : 'refresh', t.loading ? 14 : 16);
      r.setAttribute('aria-label', t.loading ? 'Stop' : 'Refresh');
      r.title = t.loading ? 'Stop loading this page (Esc)' : 'Refresh (Ctrl+R)';
      btn('home').classList.toggle('hidden', !E().showHome);
      if (document.activeElement !== urlInput) {
        let shown = t.url;
        try { shown = decodeURI(t.url); } catch { /* malformed escape */ }
        urlInput.value = t.url === NEWTAB ? '' : shown;
      }
      const info = btn('info');
      const scheme = t.url.split(':')[0];
      info.className = 'edge-siteinfo';
      if (t.url === NEWTAB) { info.innerHTML = Win.glyph('search', 14); info.classList.add('plain'); }
      else if (scheme === 'edge') { info.innerHTML = `${Win.appIcon('edge', 14)}<span>Edge</span>`; info.classList.add('chip'); }
      else if (scheme === 'file') { info.innerHTML = `${Win.glyph('info', 14)}<span>File</span>`; info.classList.add('chip'); }
      else if (t.page?.kind === 'error' || t.page?.kind === 'blocked') { info.innerHTML = Win.glyph('info', 14); }
      else if (scheme === 'http') { info.innerHTML = `${Win.glyph('warning', 14)}<span>Not secure</span>`; info.classList.add('chip', 'warn'); }
      else info.innerHTML = Win.glyph('lock', 14);
      const star = btn('star');
      const fav = isFav(t.url);
      star.classList.toggle('on', fav);
      star.setAttribute('aria-label', fav ? 'Edit favorite for this page' : 'Add this page to favorites');
      star.disabled = t.url === NEWTAB;
      root.querySelector('.edge-progress').classList.toggle('on', !!t.loading);
      renderFavbar();
    };

    const renderFavbar = () => {
      const t = active();
      const mode = E().favBar;
      const show = mode === 'always' || (mode === 'newtab' && t?.url === NEWTAB);
      favbar.classList.toggle('hidden', !show);
      if (!show) return;
      favbar.innerHTML = E().favorites.length
        ? E().favorites.map((f, i) => `<button class="edge-favitem" data-fav="${i}" title="${esc(`${f.title}\n${f.url}`)}">${favicon(f.url)}<span>${esc(f.title)}</span></button>`).join('')
        : '<span class="edge-favempty">For quick access, place your favorites here on the favorites bar.</span>';
    };

    const renderPage = () => {
      const t = active();
      if (!t) return;
      const page = t.page;
      doc.className = `edge-doc ${page?.cls || ''}`;
      doc.innerHTML = page?.html || '';
      doc.style.zoom = t.zoom === 1 ? '' : String(t.zoom);
      if (page?.kind === 'pdf') wirePdf(t);
      if (page?.section === 'help') checkUpdates();
      requestAnimationFrame(() => {
        if (page?.anchor && !t.anchored) {
          t.anchored = true;
          doc.querySelector(`#${CSS.escape(page.anchor)}`)?.scrollIntoView();
        } else doc.scrollTop = t.scroll || 0;
      });
    };

    const renderAll = () => { renderTabs(); renderToolbar(); renderPage(); };

    /* ---------------------------------------------------- navigation */

    const record = (t, page) => {
      if (priv || !page || /^edge:|^about:/.test(t.url) || page.kind === 'error' || page.kind === 'blocked') return;
      const h = E().history;
      if (h[0]?.url === t.url) { h[0].time = Date.now(); h[0].title = page.title || t.url; }
      else h.unshift({ url: t.url, title: page.title || t.url, time: Date.now() });
      E().history = h.slice(0, 400);
      Win.save('edge');
    };

    const load = async (t, url, { push = true } = {}) => {
      t.controller?.abort();
      const ctrl = new AbortController();
      t.controller = ctrl;
      if (push) {
        t.stack = t.stack.slice(0, t.index + 1);
        t.stack.push(url);
        t.index = t.stack.length - 1;
      }
      t.url = url;
      t.loading = true;
      t.scroll = 0;
      t.anchored = false;
      if (!t.title || t.title === 'New tab') t.title = url === NEWTAB ? 'New tab' : hostOf(url) || url;
      if (t === active()) { renderTabs(); renderToolbar(); }
      let page;
      try { page = await resolvePage(url, t, ctrl.signal); } catch (error) {
        if (ctrl.signal.aborted) return;
        console.error(error);
        page = errorPage(classify('timeout', hostOf(url)), url);
      }
      if (ctrl.signal.aborted || win.closed) return;
      if (page.url && page.url !== url) { t.url = page.url; t.stack[t.index] = page.url; }
      t.page = page;
      t.title = page.title || hostOf(url) || url;
      t.loading = false;
      t.controller = null;
      record(t, page);
      if (t === active()) renderAll(); else renderTabs();
    };

    const navigate = (input, t = active()) => {
      const url = normalize(input);
      if (!url || !t) return;
      closeFly();
      load(t, url);
      doc.focus({ preventScroll: true });
    };

    const go = delta => {
      const t = active();
      const i = t.index + delta;
      if (i < 0 || i >= t.stack.length) return;
      t.index = i;
      load(t, t.stack[i], { push: false });
    };

    const reload = () => {
      const t = active();
      if (t.loading) { t.controller?.abort(); t.loading = false; renderTabs(); renderToolbar(); return; }
      t.scroll = doc.scrollTop;
      load(t, t.url, { push: false });
    };

    /* ------------------------------------------------------------ tabs */

    const newTab = (url = NEWTAB, { background = false, after = null } = {}) => {
      const t = { id: Win.uid('et'), url: NEWTAB, title: 'New tab', stack: [], index: -1, zoom: 1, page: null, loading: false, priv };
      const at = after ? st.tabs.indexOf(after) + 1 : st.tabs.length;
      st.tabs.splice(at, 0, t);
      if (!background) { activate(t, false); doc.innerHTML = ''; doc.className = 'edge-doc'; }
      load(t, normalize(url) || NEWTAB);
      if (!background && url === NEWTAB) requestAnimationFrame(() => { urlInput.focus(); });
      renderTabs();
      return t;
    };

    const activate = (t, render = true) => {
      const prev = st.active;
      if (prev && prev !== t) prev.scroll = doc.scrollTop;
      st.active = t;
      closeFly();
      if (render) renderAll();
    };

    const closeTab = t => {
      t.controller?.abort();
      const i = st.tabs.indexOf(t);
      st.tabs.splice(i, 1);
      if (t.url !== NEWTAB) st.closed.unshift({ url: t.url, title: t.title });
      if (!st.tabs.length) { win.close({ force: true }); return; }
      if (st.active === t) { st.active = null; activate(st.tabs[Math.min(i, st.tabs.length - 1)]); } else renderTabs();
    };

    /* ---------------------------------------------------- favorites */

    const toggleFavorite = () => {
      const t = active();
      if (!t || t.url === NEWTAB) return;
      const list = E().favorites;
      const existing = list.findIndex(f => f.url === t.url);
      if (existing < 0) list.push({ title: t.title, url: t.url });
      Win.save('edge');
      renderToolbar();
      const i = list.findIndex(f => f.url === t.url);
      openFly('star', `<h3>${existing < 0 ? 'Favorite added' : 'Edit favorite'}</h3>
        <label class="field"><span>Name</span><input class="input" data-fav-name value="${esc(list[i].title)}"></label>
        <label class="field"><span>Folder</span>${Win.select(['Favorites bar'], 'Favorites bar', 'disabled')}</label>
        <div class="edge-fly-actions"><button class="btn accent" data-act="fav-done" data-i="${i}">Done</button><button class="btn" data-act="fav-remove" data-i="${i}">Remove</button></div>`, btn('star'));
      requestAnimationFrame(() => fly.querySelector('[data-fav-name]')?.select());
    };

    /* ------------------------------------------------------ flyouts */

    let flyKind = null;
    function closeFly() { fly.classList.add('hidden'); fly.innerHTML = ''; flyKind = null; }
    function openFly(kind, html, anchor) {
      if (flyKind === kind && kind !== 'downloads-live') { closeFly(); return; }
      flyKind = kind;
      fly.innerHTML = html;
      fly.classList.remove('hidden');
      const r = anchor.getBoundingClientRect();
      const host = root.getBoundingClientRect();
      const width = fly.offsetWidth || 360;
      fly.style.left = `${Math.max(8, Math.min(host.width - width - 8, r.right - host.left - width + 8))}px`;
      fly.style.top = `${r.bottom - host.top + 4}px`;
      fly.setAttribute('aria-label', kind);
    }

    const copilotFly = () => openFly('copilot', `<header class="edge-fly-head"><h3>${Win.appIcon('copilot', 20)} Copilot</h3></header>
      <p class="edge-cp-hi">Hi ${esc(Win.PERSONA.first)}, what\u2019s on your mind?</p>
      <div class="edge-fly-list">
        <button class="edge-fly-item" data-act="copilot-open">${Win.glyph('document', 16)}<span>Summarize this page</span></button>
        <button class="edge-fly-item" data-act="copilot-open">${Win.glyph('sparkle', 16)}<span>Ask about this page</span></button>
        <button class="edge-fly-item" data-act="copilot-open">${Win.glyph('open', 16)}<span>Open Copilot</span></button>
      </div>`, btn('copilot'));

    const profileFly = anchor => openFly('profile', `<div class="edge-prof">
        <span class="es-avatar">${esc(Win.PERSONA.initials)}</span>
        <span><b>Personal</b><small>${esc(Win.PERSONA.name)}</small><small>${esc(Win.PERSONA.email)}</small><small class="edge-prof-sync">${Win.glyph('check', 12)} Sync is on</small></span>
      </div>
      <div class="edge-fly-list">
        <button class="edge-fly-item" data-act="open-page" data-url="edge://settings/profiles">${Win.glyph('gear', 16)}<span>Manage profile settings</span></button>
        <button class="edge-fly-item" data-act="open-page" data-url="edge://favorites">${Win.glyph('star', 16)}<span>Favorites</span></button>
      </div>`, anchor);

    const favoritesFly = () => openFly('favorites', `<header class="edge-fly-head"><h3>Favorites</h3><span><button class="icon-btn" data-act="fav-add-current" aria-label="Add this page to favorites">${Win.glyph('star', 16)}</button><button class="icon-btn" data-act="open-page" data-url="edge://favorites" aria-label="Open favorites page">${Win.glyph('open', 16)}</button></span></header>
      <div class="edge-fly-list"><div class="edge-fly-folder">${Win.glyph('folder', 16)} Favorites bar</div>${E().favorites.map(f => `<a class="edge-fly-item" href="${esc(f.url)}">${favicon(f.url)}<span>${esc(f.title)}</span></a>`).join('') || '<p class="muted">No favorites yet.</p>'}</div>`, btn('favorites'));

    const historyFly = () => openFly('history', `<header class="edge-fly-head"><h3>History</h3><span><button class="icon-btn" data-act="open-page" data-url="edge://history" aria-label="Open history page">${Win.glyph('open', 16)}</button><button class="icon-btn" data-act="clear-data" aria-label="Clear browsing data">${Win.glyph('trash', 16)}</button></span></header>
      <div class="edge-fly-list">${priv ? '<p class="muted">InPrivate browsing doesn\u2019t save history.</p>' : ''}${E().history.slice(0, 14).map(h => `<a class="edge-fly-item" href="${esc(h.url)}">${favicon(h.url)}<span>${esc(h.title)}</span><small>${esc(Win.formatTime(new Date(h.time)))}</small></a>`).join('') || (priv ? '' : '<p class="muted">Nothing here yet.</p>')}</div>`, anchorMore());

    const collectionsFly = () => openFly('collections', `<header class="edge-fly-head"><h3>Collections</h3></header>
      <div class="edge-fly-list"><button class="edge-fly-item" data-act="coll-new">${Win.glyph('plus', 16)}<span>Create new collection</span></button>
      ${E().collections.map((c, i) => `<div class="edge-coll"><b>${esc(c.name)}</b><small>${c.items.length} item${c.items.length === 1 ? '' : 's'}</small>${c.items.map(x => `<a class="edge-fly-item" href="${esc(x.url)}">${favicon(x.url)}<span>${esc(x.title)}</span></a>`).join('')}<button class="link" data-act="coll-add" data-i="${i}">Add current page</button></div>`).join('')}</div>`, btn('collections'));

    const live = [];
    const downloadsFly = (force = false) => {
      const items = [...live, ...E().downloads.filter(d => !live.some(l => l.id === d.id))].slice(0, 8);
      const html = `<header class="edge-fly-head"><h3>Downloads</h3><span><button class="icon-btn" data-act="open-downloads-folder" aria-label="Open downloads folder">${Win.glyph('folder', 16)}</button><button class="icon-btn" data-act="open-page" data-url="edge://downloads" aria-label="Open downloads page">${Win.glyph('open', 16)}</button></span></header>
        <div class="edge-fly-list">${items.length ? items.map(d => {
          const exists = d.fileId && Win.FS.get(d.fileId);
          const icon = Win.fileIcon(exists || { kind: 'file', ext: d.name.split('.').pop() }, 24);
          if (d.state === 'progress') {
            const pctDone = Math.round((d.received / d.size) * 100);
            return `<div class="edge-dl">${icon}<span><b>${esc(d.name)}</b><small>${esc(Win.bytes(d.received))}/${esc(Win.bytes(d.size))}, ${Math.max(1, Math.ceil(d.left))} sec${Math.ceil(d.left) === 1 ? '' : 's'} left</small><span class="progress"><i style="width:${pctDone}%"></i></span></span><button class="icon-btn" data-act="dl-cancel" data-id="${d.id}" aria-label="Cancel">${Win.glyph('close', 12)}</button></div>`;
          }
          if (d.state === 'failed') return `<div class="edge-dl">${icon}<span><b>${esc(d.name)}</b><small class="bad">Failed - Network error</small><button class="link" data-act="dl-retry" data-id="${d.id}">Retry</button></span></div>`;
          if (d.state === 'cancelled') return `<div class="edge-dl">${icon}<span><b>${esc(d.name)}</b><small>Canceled</small></span></div>`;
          return `<div class="edge-dl">${icon}<span><b>${esc(d.name)}</b>${exists ? `<button class="link" data-act="dl-open" data-id="${esc(d.fileId)}">Open file</button>` : '<small>Deleted</small>'}</span>${exists ? `<button class="icon-btn" data-act="dl-folder" data-id="${esc(d.fileId)}" aria-label="Show in folder">${Win.glyph('folder', 16)}</button>` : ''}</div>`;
        }).join('') : '<p class="muted">No recent downloads</p>'}</div>`;
      if (force && flyKind === 'downloads') { fly.innerHTML = html; return; }
      openFly('downloads', html, btn('downloads'));
    };

    const startDownload = (name, size, url) => {
      const item = { id: Win.uid('dl'), name, size: Number(size) || 500000, url, received: 0, state: 'progress', left: 3, time: Date.now() };
      live.unshift(item);
      flyKind = null;
      downloadsFly();
      const total = Win.clamp(1.4 + item.size / 12e6, 1.4, 5);
      const started = performance.now();
      const timer = setInterval(() => {
        if (item.state !== 'progress') { clearInterval(timer); return; }
        if (Win.Network.webReason()) { item.state = 'failed'; clearInterval(timer); downloadsFly(true); return; }
        const p = Math.min(1, (performance.now() - started) / 1000 / total);
        item.received = Math.round(item.size * p);
        item.left = total * (1 - p);
        if (p >= 1) {
          clearInterval(timer);
          const node = Win.FS.create('downloads', name, 'file', { size: item.size, source: url });
          item.fileId = node.id;
          item.name = node.name;
          item.state = 'done';
          E().downloads.unshift({ id: item.id, name: node.name, url, size: item.size, time: Date.now(), fileId: node.id });
          E().downloads = E().downloads.slice(0, 60);
          Win.save('edge');
          btn('downloads').classList.add('pulse');
          setTimeout(() => btn('downloads').classList.remove('pulse'), 1200);
        }
        downloadsFly(true);
      }, 200);
      win.cleanup(() => clearInterval(timer));
    };

    function anchorMore() { return btn('more'); }

    /* ----------------------------------------------------------- menu */

    const zoomBy = step => {
      const t = active();
      const levels = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
      let i = levels.findIndex(l => Math.abs(l - t.zoom) < 0.001);
      if (i < 0) i = 7;
      t.zoom = step === 0 ? 1 : levels[Win.clamp(i + step, 0, levels.length - 1)];
      doc.style.zoom = t.zoom === 1 ? '' : String(t.zoom);
      const label = document.querySelector('.ctx [data-zoom-label]');
      if (label) label.textContent = `${Math.round(t.zoom * 100)}%`;
    };

    const moreMenu = () => {
      const b = btn('more');
      const r = b.getBoundingClientRect();
      const menu = Win.menu(r.right - 300, r.bottom + 4, [
        { label: 'New tab', glyph: 'tab', shortcut: 'Ctrl+T', action: () => newTab() },
        { label: 'New window', glyph: 'restore', shortcut: 'Ctrl+N', action: () => Win.wm.open('edge') },
        { label: 'New InPrivate window', glyph: 'eye', shortcut: 'Ctrl+Shift+N', action: () => Win.wm.open('edge', { private: true }) },
        { divider: true },
        { label: 'Favorites', glyph: 'star', shortcut: 'Ctrl+Shift+O', action: favoritesFly },
        { label: 'Collections', glyph: 'collection', shortcut: 'Ctrl+Shift+Y', action: collectionsFly },
        { label: 'History', glyph: 'history', shortcut: 'Ctrl+H', action: historyFly },
        { label: 'Downloads', glyph: 'download', shortcut: 'Ctrl+J', action: () => downloadsFly() },
        { divider: true },
        { label: 'Print', glyph: 'printer', shortcut: 'Ctrl+P', action: print },
        { label: 'Find on page', glyph: 'search', shortcut: 'Ctrl+F', action: findOnPage },
        { divider: true },
        { label: 'Settings', glyph: 'gear', action: () => newTab('edge://settings') },
        { label: 'Help and feedback', glyph: 'question', submenu: [{ label: 'About Microsoft Edge', glyph: 'info', action: () => newTab('edge://settings/help') }] },
        { label: 'Close Microsoft Edge', glyph: 'close', action: () => win.close() },
      ], { className: 'edge-menu' });
      const anchor = menu.querySelectorAll(':scope > button')[2];
      const row = Win.html(`<div class="ctx-zoom"><span class="ctx-ico">${Win.glyph('zoomin', 16)}</span><span class="ctx-label">Zoom</span>
        <button data-z="-1" aria-label="Zoom out">${Win.glyph('minimize', 14)}</button><span data-zoom-label>${Math.round(active().zoom * 100)}%</span><button data-z="1" aria-label="Zoom in">${Win.glyph('plus', 14)}</button></div>`);
      row.addEventListener('click', e => { const z = e.target.closest('[data-z]'); if (z) zoomBy(Number(z.dataset.z)); });
      anchor.after(Win.html('<div class="ctx-sep" role="separator"></div>'), row);
    };

    const findOnPage = () => {
      openFly('find', `<div class="edge-find"><input class="input" data-find placeholder="Find on page" aria-label="Find on page"><span class="muted" data-find-count></span><button class="icon-btn" data-act="find-close" aria-label="Close">${Win.glyph('close', 12)}</button></div>`, btn('more'));
      const input = fly.querySelector('[data-find]');
      input.focus();
      input.addEventListener('input', () => {
        doc.querySelectorAll('mark.edge-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
        doc.normalize();
        const term = input.value.trim().toLowerCase();
        let count = 0;
        if (term.length > 1) {
          const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
          const hits = [];
          while (walker.nextNode()) if (walker.currentNode.nodeValue.toLowerCase().includes(term)) hits.push(walker.currentNode);
          hits.slice(0, 200).forEach(node => {
            const i = node.nodeValue.toLowerCase().indexOf(term);
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, i + term.length);
            const mark = document.createElement('mark');
            mark.className = 'edge-hit';
            range.surroundContents(mark);
            count += 1;
          });
          doc.querySelector('mark.edge-hit')?.scrollIntoView({ block: 'center' });
        }
        fly.querySelector('[data-find-count]').textContent = term.length > 1 ? `${count} result${count === 1 ? '' : 's'}` : '';
      });
    };

    const print = async () => {
      const t = active();
      const printers = ['Microsoft Print to PDF', ...(Win.state.devices || []).filter(d => d.kind === 'printer').map(d => d.name), 'OneNote (Desktop)'];
      const result = await Win.dialog({
        owner: win, title: 'Print', width: 560,
        body: `<div class="edge-print"><div class="edge-print-prev"><div class="edge-print-sheet"><b>${esc(t.title)}</b><i></i><i></i><i class="s"></i><i></i><i class="s"></i></div><small>1 sheet of paper</small></div>
          <div class="edge-print-opts"><label class="field"><span>Printer</span>${Win.select(printers, printers[0], 'data-printer')}</label>
          <label class="field"><span>Copies</span><input class="input" type="number" min="1" max="99" value="1" data-copies></label>
          <label class="field"><span>Layout</span>${Win.select(['Portrait', 'Landscape'], 'Portrait')}</label>
          <label class="field"><span>Pages</span>${Win.select(['All', 'Odd pages only', 'Even pages only'], 'All')}</label></div></div>`,
        buttons: [{ label: 'Print', primary: true, value: box => ({ printer: box.querySelector('[data-printer]').value, copies: box.querySelector('[data-copies]').value }) }, { label: 'Cancel', value: null }],
      });
      if (!result) return;
      if (result.printer === 'Microsoft Print to PDF') {
        const name = await Win.prompt('Save Print Output As', 'File name', `${t.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'Document'}.pdf`, { owner: win, ok: 'Save', validate: v => Win.FS.validName(v) });
        if (!name) return;
        const node = Win.FS.create('documents', /\.pdf$/i.test(name) ? name : `${name}.pdf`, 'file', { size: 84_000 + (hash(t.url) % 200_000) });
        Win.toast({ app: 'Microsoft Edge', icon: 'edge', title: 'Saved', body: `${node.name} was saved to Documents.`, transient: true });
        return;
      }
      Win.toast({ app: result.printer, glyph: 'printer', title: 'Printing', body: `\u201c${t.title}\u201d was sent to the printer.`, transient: true });
    };

    /* --------------------------------------------------- page actions */

    const clearData = async () => {
      const res = await Win.dialog({
        owner: win, title: 'Clear browsing data',
        body: `<label class="field"><span>Time range</span>${Win.select(['Last hour', 'Last 24 hours', 'Last 7 days', 'Last 4 weeks', 'All time'], 'All time', 'data-range')}</label>
          <label class="check"><input type="checkbox" checked data-c="history"> Browsing history</label><br><label class="check"><input type="checkbox" checked data-c="downloads"> Download history</label><br>
          <label class="check"><input type="checkbox" checked disabled> Cookies and other site data</label><br><label class="check"><input type="checkbox" checked disabled> Cached images and files</label>`,
        buttons: [{ label: 'Clear now', primary: true, value: box => ({ range: box.querySelector('[data-range]').value, history: box.querySelector('[data-c=history]').checked, downloads: box.querySelector('[data-c=downloads]').checked }) }, { label: 'Cancel', value: null }],
      });
      if (!res) return;
      const span = { 'Last hour': 3600e3, 'Last 24 hours': 86400e3, 'Last 7 days': 7 * 86400e3, 'Last 4 weeks': 28 * 86400e3, 'All time': Infinity }[res.range];
      const cutoff = Date.now() - span;
      if (res.history) E().history = E().history.filter(h => h.time < cutoff);
      if (res.downloads) E().downloads = E().downloads.filter(d => d.time < cutoff);
      Win.save('edge');
      closeFly();
      if (/^edge:\/\/(history|downloads)/.test(active().url)) reload();
    };

    const openSettings = page => {
      if (Win.Settings?.open) Win.Settings.open(page);
      else Win.wm.open('settings', { page });
    };

    const checkUpdates = () => {
      const el = doc.querySelector('[data-update]');
      if (!el) return;
      setTimeout(() => {
        if (!el.isConnected) return;
        if (Win.Network.webReason()) {
          el.className = 'es-update bad';
          el.innerHTML = `${Win.glyph('error', 14)} An error occurred while checking for updates: Unable to connect to the Internet. If you use a firewall, please allowlist MicrosoftEdgeUpdate.exe. (error code 3: 0x800704C6: -- system level)`;
        } else {
          el.className = 'es-update ok';
          el.innerHTML = `${Win.glyph('check', 14)} Microsoft Edge is up to date.`;
        }
      }, 1600);
    };

    const handleAct = async (el, e) => {
      const act = el.dataset.act;
      const t = active();
      switch (act) {
        case 'reload': reload(); break;
        case 'back': go(-1); break;
        case 'proxy': openSettings('proxy'); break;
        case 'network': if (Win.troubleshoot) Win.troubleshoot(win); else openSettings('network'); break;
        case 'external': try { window.open(el.dataset.url, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked */ } break;
        case 'openfile': Win.openFile ? Win.openFile(el.dataset.id) : Win.wm.open('explorer', { path: Win.FS.get(el.dataset.id)?.parent }); break;
        case 'cart-add': {
          const item = cart.find(c => c.id === el.dataset.id);
          if (item) item.qty += 1; else cart.push({ id: el.dataset.id, qty: 1 });
          el.textContent = 'Added to cart';
          el.disabled = true;
          doc.querySelector('.ct-cart').textContent = `Cart (${cart.reduce((s, c) => s + c.qty, 0)})`;
          break;
        }
        case 'cart-remove': { const i = cart.findIndex(c => c.id === el.dataset.id); if (i >= 0) cart.splice(i, 1); reload(); break; }
        case 'ntp-settings': navigate('edge://settings/start'); break;
        case 'copilot-open': closeFly(); Win.wm.open('copilot'); break;
        case 'add-quick': {
          const url = await Win.prompt('Add a site', 'URL', 'https://', { owner: win, ok: 'Add' });
          const n = url && normalize(url);
          if (n && !/search\.example/.test(n)) { E().favorites.push({ title: hostOf(n) || n, url: n }); Win.save('edge'); reload(); }
          break;
        }
        case 'clear-data': clearData(); break;
        case 'hist-del': E().history = E().history.filter(h => String(h.time) !== el.dataset.time); Win.save('edge'); reload(); break;
        case 'dl-open': closeFly(); Win.openFile ? Win.openFile(el.dataset.id) : (Win.FS.get(el.dataset.id)?.ext === 'pdf' ? newTab(fileUrl(el.dataset.id)) : Win.wm.open('explorer', { path: 'downloads', select: el.dataset.id })); break;
        case 'dl-folder': closeFly(); Win.wm.open('explorer', { path: 'downloads', select: el.dataset.id }); break;
        case 'dl-del': E().downloads = E().downloads.filter(d => d.id !== el.dataset.id); Win.save('edge'); reload(); break;
        case 'dl-cancel': { const d = live.find(x => x.id === el.dataset.id); if (d) d.state = 'cancelled'; downloadsFly(true); break; }
        case 'dl-retry': { const d = live.find(x => x.id === el.dataset.id); if (d) { live.splice(live.indexOf(d), 1); startDownload(d.name, d.size, d.url); } break; }
        case 'open-downloads-folder': closeFly(); Win.wm.open('explorer', { path: 'downloads' }); break;
        case 'open-page': closeFly(); newTab(el.dataset.url); break;
        case 'fav-add-current': if (t.url !== NEWTAB && !isFav(t.url)) { E().favorites.push({ title: t.title, url: t.url }); Win.save('edge'); } closeFly(); renderToolbar(); if (t.url === 'edge://favorites') reload(); break;
        case 'fav-del': E().favorites.splice(Number(el.dataset.i), 1); Win.save('edge'); reload(); break;
        case 'fav-edit': {
          const f = E().favorites[Number(el.dataset.i)];
          const name = await Win.prompt('Edit favorite', 'Name', f.title, { owner: win, ok: 'Save' });
          if (name) { f.title = name; Win.save('edge'); reload(); }
          break;
        }
        case 'fav-done': {
          const f = E().favorites[Number(el.dataset.i)];
          const name = fly.querySelector('[data-fav-name]')?.value.trim();
          if (f && name) f.title = name;
          Win.save('edge');
          closeFly();
          renderToolbar();
          break;
        }
        case 'fav-remove': E().favorites.splice(Number(el.dataset.i), 1); Win.save('edge'); closeFly(); renderToolbar(); break;
        case 'coll-new': {
          const name = await Win.prompt('New collection', 'Name', 'New collection', { owner: win, ok: 'Create' });
          if (name) { E().collections.push({ name, items: [] }); Win.save('edge'); flyKind = null; collectionsFly(); }
          break;
        }
        case 'coll-add': {
          const c = E().collections[Number(el.dataset.i)];
          if (c && t.url !== NEWTAB && !c.items.some(x => x.url === t.url)) { c.items.push({ title: t.title, url: t.url }); Win.save('edge'); }
          flyKind = null;
          collectionsFly();
          break;
        }
        case 'find-close': doc.querySelectorAll('mark.edge-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent))); closeFly(); break;
        case 'reset-settings': {
          const ok = await Win.confirm('Reset settings', 'This will reset your startup page, new tab page, favorites bar and home button settings.', { ok: 'Reset', cancel: 'Cancel', owner: win });
          if (ok) { Object.assign(E(), { favBar: 'always', showHome: false, homepage: NEWTAB, askDownload: false }); Win.save('edge'); renderToolbar(); reload(); }
          break;
        }
        default: void e;
      }
    };

    /* ----------------------------------------------------------- PDF */

    const wirePdf = t => {
      const scroll = doc.querySelector('.pdf-scroll');
      const stack = doc.querySelector('.pdf-stack');
      const pg = doc.querySelector('.pdf-pg');
      t.pdfZoom ||= 1;
      t.pdfRotate ||= 0;
      const apply = () => { stack.style.setProperty('--pz', t.pdfZoom); stack.style.transform = t.pdfRotate ? `rotate(${t.pdfRotate}deg)` : ''; };
      apply();
      doc.querySelector('.pdf-bar').addEventListener('click', e => {
        const a = e.target.closest('[data-pdf]')?.dataset.pdf;
        if (a === 'in') t.pdfZoom = Math.min(3, t.pdfZoom + 0.25);
        if (a === 'out') t.pdfZoom = Math.max(0.5, t.pdfZoom - 0.25);
        if (a === 'fit') t.pdfZoom = 1;
        if (a === 'rotate') t.pdfRotate = (t.pdfRotate + 90) % 360;
        if (a === 'print') print();
        if (a === 'save') Win.toast({ app: 'Microsoft Edge', icon: 'edge', title: 'Saved', body: `${t.title} is saved on this device.`, transient: true });
        apply();
      });
      scroll.addEventListener('scroll', () => {
        const pages = [...stack.children];
        const top = scroll.getBoundingClientRect().top;
        const current = pages.findIndex(p => p.getBoundingClientRect().bottom > top + 40);
        if (document.activeElement !== pg) pg.value = String(current + 1 || 1);
      });
      pg.addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        const n = Win.clamp(parseInt(pg.value, 10) || 1, 1, stack.children.length);
        stack.children[n - 1].scrollIntoView({ block: 'start' });
      });
    };

    /* --------------------------------------------------------- events */

    strip.addEventListener('click', e => {
      const el = e.target.closest('[data-tab]');
      if (!el) return;
      const t = st.tabs.find(x => x.id === el.dataset.tab);
      if (e.target.closest('.edge-tab-x')) { e.stopPropagation(); closeTab(t); return; }
      if (t !== st.active) activate(t);
    });
    strip.addEventListener('auxclick', e => {
      const el = e.target.closest('[data-tab]');
      if (e.button === 1 && el) closeTab(st.tabs.find(x => x.id === el.dataset.tab));
    });
    strip.addEventListener('keydown', e => {
      const el = e.target.closest('[data-tab]');
      if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(st.tabs.find(x => x.id === el.dataset.tab)); }
      if (el && e.key === 'Delete') closeTab(st.tabs.find(x => x.id === el.dataset.tab));
    });
    strip.addEventListener('contextmenu', e => {
      const el = e.target.closest('[data-tab]');
      if (!el) return;
      e.preventDefault();
      const t = st.tabs.find(x => x.id === el.dataset.tab);
      Win.menu(e.clientX, e.clientY, [
        { label: 'New tab to the right', glyph: 'plus', action: () => newTab(NEWTAB, { after: t }) },
        { label: 'Refresh', glyph: 'refresh', action: () => { activate(t); reload(); } },
        { label: 'Duplicate tab', glyph: 'copy', action: () => newTab(t.url, { after: t }) },
        { divider: true },
        { label: 'Close tab', glyph: 'close', shortcut: 'Ctrl+W', action: () => closeTab(t) },
        { label: 'Close other tabs', disabled: st.tabs.length < 2, action: () => st.tabs.filter(x => x !== t).forEach(closeTab) },
        { label: 'Reopen closed tab', disabled: !st.closed.length, shortcut: 'Ctrl+Shift+T', action: () => { const c = st.closed.shift(); if (c) newTab(c.url); } },
      ]);
    });
    win.titleContent.querySelector('.edge-newtab').addEventListener('click', () => newTab());
    const profileBtn = win.titleContent.querySelector('.edge-profile');
    profileBtn?.addEventListener('click', () => profileFly(profileBtn));

    root.querySelector('.edge-toolbar').addEventListener('click', e => {
      const b = e.target.closest('[data-b]');
      if (!b || b.disabled) return;
      const name = b.dataset.b;
      if (name === 'back') go(-1);
      if (name === 'forward') go(1);
      if (name === 'reload') reload();
      if (name === 'home') navigate(E().homepage || NEWTAB);
      if (name === 'star') toggleFavorite();
      if (name === 'favorites') favoritesFly();
      if (name === 'collections') collectionsFly();
      if (name === 'downloads') downloadsFly();
      if (name === 'more') moreMenu();
      if (name === 'copilot') copilotFly();
      if (name === 'info') {
        const t = active();
        const secure = /^https:/.test(t.url) && t.page?.kind === 'site';
        openFly('info', `<div class="edge-info"><h3>${secure ? `${Win.glyph('lock', 16)} Connection is secure` : /^edge:/.test(t.url) ? 'You\u2019re viewing a secure Microsoft Edge page' : /^file:/.test(t.url) ? 'You\u2019re viewing a local or shared file' : 'Your connection to this site isn\u2019t secure'}</h3>
          <p class="muted">${secure ? 'Your information (for example, passwords or credit card numbers) is private when it is sent to this site.' : 'Information you enter on this page can be viewed by others.'}</p>
          ${secure ? `<p class="muted">Certificate issued to ${esc(hostOf(t.url))}</p>` : ''}</div>`, b);
      }
    });

    urlInput.addEventListener('focus', () => { urlInput.select(); root.querySelector('.edge-omni').classList.add('focus'); });
    urlInput.addEventListener('blur', () => { root.querySelector('.edge-omni').classList.remove('focus'); setTimeout(renderToolbar, 0); });
    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); const v = urlInput.value; urlInput.blur(); navigate(v); }
      if (e.key === 'Escape') { urlInput.value = active().url === NEWTAB ? '' : active().url; urlInput.select(); }
    });

    favbar.addEventListener('click', e => {
      const b = e.target.closest('[data-fav]');
      if (!b) return;
      const f = E().favorites[Number(b.dataset.fav)];
      if (e.ctrlKey) newTab(f.url, { background: true }); else navigate(f.url);
    });
    favbar.addEventListener('contextmenu', e => {
      const b = e.target.closest('[data-fav]');
      if (!b) return;
      e.preventDefault();
      const i = Number(b.dataset.fav);
      const f = E().favorites[i];
      Win.menu(e.clientX, e.clientY, [
        { label: 'Open in new tab', glyph: 'tab', action: () => newTab(f.url, { background: true }) },
        { label: 'Open in new window', glyph: 'restore', action: () => Win.wm.open('edge', { url: f.url }) },
        { label: 'Open in new InPrivate window', glyph: 'eye', action: () => Win.wm.open('edge', { url: f.url, private: true }) },
        { divider: true },
        { label: 'Edit', glyph: 'edit', action: async () => { const n = await Win.prompt('Edit favorite', 'Name', f.title, { owner: win, ok: 'Save' }); if (n) { f.title = n; Win.save('edge'); renderFavbar(); } } },
        { label: 'Delete', glyph: 'trash', action: () => { E().favorites.splice(i, 1); Win.save('edge'); renderToolbar(); } },
      ]);
    });

    const linkTarget = a => {
      const href = a.getAttribute('href');
      if (!href) return null;
      if (/^(edge|file|https?):/i.test(href)) return href;
      try { return new URL(href, active().url).href; } catch { return null; }
    };

    const onLink = (e, middle = false) => {
      const act = e.target.closest('[data-act]');
      if (act && doc.contains(act) && !middle) { e.preventDefault(); handleAct(act, e); return; }
      const a = e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.download != null) { startDownload(a.dataset.download, a.dataset.size, linkTarget(a)); return; }
      if (a.dataset.anchor) { doc.querySelector(`#${CSS.escape(a.dataset.anchor)}`)?.scrollIntoView({ behavior: 'smooth' }); return; }
      const url = linkTarget(a);
      if (!url) return;
      if (middle || e.ctrlKey || e.metaKey) newTab(url, { background: true, after: active() });
      else if (e.shiftKey) Win.wm.open('edge', { url });
      else navigate(url);
    };
    doc.addEventListener('click', e => onLink(e));
    doc.addEventListener('auxclick', e => { if (e.button === 1) onLink(e, true); });
    fly.addEventListener('click', e => {
      const act = e.target.closest('[data-act]');
      if (act) { e.preventDefault(); handleAct(act, e); return; }
      const a = e.target.closest('a[href]');
      if (a) { e.preventDefault(); closeFly(); if (e.ctrlKey) newTab(a.getAttribute('href'), { background: true }); else navigate(a.getAttribute('href')); }
    });
    doc.addEventListener('submit', e => {
      e.preventDefault();
      const form = e.target;
      const q = form.querySelector('input[name=q]')?.value.trim() || '';
      const kind = form.dataset.form;
      if (!q) return;
      if (kind === 'support') navigate(`https://support.example/search?q=${encodeURIComponent(q)}`);
      else if (kind === 'shop') navigate(`https://contoso.example/search?q=${encodeURIComponent(q)}`);
      else if (kind === 'wiki') navigate(`https://en.wikipedia.org/wiki/${encodeURIComponent(q.replace(/ /g, '_'))}`);
      else if (kind === 'search') navigate(searchUrl(q));
      else navigate(q);
    });
    doc.addEventListener('change', e => {
      const key = e.target.dataset.es;
      if (!key) return;
      E()[key] = e.target.type === 'checkbox' ? e.target.checked : (key === 'homepage' ? normalize(e.target.value) || NEWTAB : e.target.value);
      Win.save('edge');
    });
    doc.addEventListener('input', Win.debounce(e => {
      if (e.target.matches('[data-hist-find]')) { const t = active(); const q = e.target.value; t.page = historyPage(q); renderPage(); const inp = doc.querySelector('[data-hist-find]'); inp.focus(); inp.setSelectionRange(q.length, q.length); }
      if (e.target.matches('[data-es-find]')) {
        const q = e.target.value.toLowerCase();
        doc.querySelectorAll('.es-row').forEach(r => r.classList.toggle('hidden', !!q && !r.textContent.toLowerCase().includes(q)));
      }
    }, 150));
    doc.addEventListener('mouseover', e => {
      const a = e.target.closest('a[href]');
      statusEl.textContent = a ? (linkTarget(a) || '') : '';
      statusEl.classList.toggle('on', !!a);
    });
    doc.addEventListener('mouseleave', () => statusEl.classList.remove('on'));
    doc.addEventListener('scroll', () => { if (active()) active().scroll = doc.scrollTop; }, { passive: true });
    doc.addEventListener('contextmenu', e => {
      const a = e.target.closest('a[href]');
      e.preventDefault();
      const t = active();
      const items = a ? [
        { label: 'Open link in new tab', glyph: 'tab', action: () => newTab(linkTarget(a), { background: true, after: t }) },
        { label: 'Open link in new window', glyph: 'restore', action: () => Win.wm.open('edge', { url: linkTarget(a) }) },
        { label: 'Open link in InPrivate window', glyph: 'eye', action: () => Win.wm.open('edge', { url: linkTarget(a), private: true }) },
        { divider: true },
        { label: 'Copy link', glyph: 'copy', action: () => { try { navigator.clipboard.writeText(linkTarget(a)); } catch { /* blocked */ } } },
      ] : [
        { label: 'Back', glyph: 'back', disabled: t.index <= 0, action: () => go(-1) },
        { label: 'Forward', glyph: 'forward', disabled: t.index >= t.stack.length - 1, action: () => go(1) },
        { label: 'Refresh', glyph: 'refresh', action: reload },
        { divider: true },
        { label: 'Print', glyph: 'printer', action: print },
        { label: 'Add page to Collections', glyph: 'collection', action: collectionsFly },
      ];
      Win.menu(e.clientX, e.clientY, items);
    });

    root.addEventListener('pointerdown', e => {
      if (!fly.classList.contains('hidden') && !fly.contains(e.target) && !e.target.closest('[data-b]')) closeFly();
    });

    win.el.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const t = active();
      if (e.key === 'Escape' && !fly.classList.contains('hidden')) { closeFly(); return; }
      if (e.key === 'Escape' && t?.loading && document.activeElement !== urlInput) { reload(); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); go(-1); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); go(1); return; }
      if (e.altKey && e.key === 'Home') { e.preventDefault(); navigate(E().homepage || NEWTAB); return; }
      if (e.altKey && k === 'f') { e.preventDefault(); moreMenu(); return; }
      if (e.key === 'F5') { e.preventDefault(); reload(); return; }
      if (e.key === 'F6') { e.preventDefault(); urlInput.focus(); return; }
      if (!ctrl) return;
      if (k === 't' && e.shiftKey) { e.preventDefault(); const c = st.closed.shift(); if (c) newTab(c.url); return; }
      if (k === 't') { e.preventDefault(); newTab(); return; }
      if (k === 'w' || k === 'f4') { e.preventDefault(); if (t) closeTab(t); return; }
      if (k === 'l' || k === 'e') { e.preventDefault(); urlInput.focus(); urlInput.select(); return; }
      if (k === 'r') { e.preventDefault(); reload(); return; }
      if (k === 'n' && e.shiftKey) { e.preventDefault(); Win.wm.open('edge', { private: true }); return; }
      if (k === 'n') { e.preventDefault(); Win.wm.open('edge'); return; }
      if (k === 'd') { e.preventDefault(); toggleFavorite(); return; }
      if (k === 'h') { e.preventDefault(); historyFly(); return; }
      if (k === 'j') { e.preventDefault(); downloadsFly(); return; }
      if (k === 'o' && e.shiftKey) { e.preventDefault(); favoritesFly(); return; }
      if (k === 'y' && e.shiftKey) { e.preventDefault(); collectionsFly(); return; }
      if (k === 'p') { e.preventDefault(); print(); return; }
      if (k === 'f') { e.preventDefault(); findOnPage(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); zoomBy(1); return; }
      if (k === '-') { e.preventDefault(); zoomBy(-1); return; }
      if (k === '0') { e.preventDefault(); zoomBy(0); return; }
      if (k === 'tab') {
        e.preventDefault();
        const i = st.tabs.indexOf(t);
        activate(st.tabs[(i + (e.shiftKey ? -1 : 1) + st.tabs.length) % st.tabs.length]);
        return;
      }
      if (/^[1-9]$/.test(k)) { e.preventDefault(); const n = Number(k); activate(n === 9 ? st.tabs[st.tabs.length - 1] : st.tabs[Math.min(n, st.tabs.length) - 1]); }
    });

    /* Offline error pages reload themselves when the connection comes back. */
    win.listen('network', () => {
      const t = active();
      if (t?.page?.kind === 'error' && !Win.Network.webReason()) setTimeout(() => { if (!win.closed && t.page?.kind === 'error') load(t, t.url, { push: false }); }, 600);
    });
    win.listen('edge', () => { if (!win.closed) { renderFavbar(); renderToolbar(); } });

    win.api = { newTab, navigate, startDownload };

    /* -------------------------------------------------------- startup */

    let first = NEWTAB;
    if (args.fileId && Win.FS.get(args.fileId)) first = fileUrl(args.fileId);
    else if (args.url) first = normalize(args.url) || NEWTAB;
    newTab(first);
  }

  Win.apps.register({
    id: 'edge', name: 'Microsoft Edge', icon: 'edge', customTitle: true,
    width: 1080, height: 700, minWidth: 500, minHeight: 320, category: 'Internet',
    keywords: ['browser', 'web', 'internet', 'msedge', 'pdf'],
    create,
  });

  Win.Edge = {
    VERSION,
    classify,
    normalize,
    sanitize,
    fileUrl,
    /** Open a URL in the most recent normal Edge window, or a new one. */
    open(url) {
      const w = Win.wm.byApp('edge').filter(x => !x.state.priv).sort((a, b) => b.z - a.z)[0];
      if (w?.api) { w.api.newTab(url); Win.wm.focus(w); return w; }
      return Win.wm.open('edge', { url });
    },
  };
})(window.Win);
