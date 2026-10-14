/* ===========================================================================
   Live web access for the simulated Safari.

   Two mechanisms, because the real web does not allow one:

   1. Wikipedia (and sister projects) are fetched through their CORS-enabled
      API and rendered natively inside the browser view. Wikipedia sends
      X-Frame-Options: DENY, so an iframe can never work — but the API is
      explicitly open to browsers, which gives us the real article, real
      search and working internal links.

   2. Everything else is attempted in a sandboxed iframe. Many sites refuse
      to be embedded, so failures fall back to a realistic
      "refused to connect" page with an escape hatch.

   Remote HTML is never assigned to innerHTML directly. It is parsed into an
   inert document, walked against a strict allowlist, and rebuilt.
   =========================================================================== */

(function (Mac) {
  'use strict';

  /* Sites that are known to reject framing. Going straight to the blocked page
     is faster and less confusing than watching an empty frame. */
  const NO_FRAME = [
    'google.', 'youtube.com', 'facebook.com', 'instagram.com', 'x.com',
    'twitter.com', 'github.com', 'amazon.', 'reddit.com', 'linkedin.com',
    'netflix.com', 'apple.com', 'microsoft.com', 'icloud.com', 'gmail.com',
    'wikipedia.org', 'openai.com', 'anthropic.com', 'claude.ai',
  ];

  const WIKI_HOSTS = {
    'wikipedia.org': 'wikipedia',
    'wiktionary.org': 'wiktionary',
    'wikiquote.org': 'wikiquote',
    'wikibooks.org': 'wikibooks',
  };

  /* Elements and attributes kept when rebuilding fetched article markup. */
  const ALLOWED_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BLOCKQUOTE', 'BR', 'CAPTION',
    'CITE', 'CODE', 'DD', 'DIV', 'DL', 'DT', 'EM', 'FIGCAPTION', 'FIGURE', 'H1', 'H2',
    'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'KBD', 'LI', 'OL', 'P', 'PRE', 'Q', 'S',
    'SAMP', 'SECTION', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TABLE', 'TBODY', 'TD',
    'TFOOT', 'TH', 'THEAD', 'TIME', 'TR', 'U', 'UL', 'VAR', 'WBR']);

  const ALLOWED_ATTRS = new Set(['alt', 'class', 'colspan', 'datetime', 'dir', 'height',
    'lang', 'rowspan', 'title', 'width']);

  /**
   * Prefix for ids carried over from a fetched page.
   *
   * `id` is deliberately not in ALLOWED_ATTRS, because the article is
   * rendered into the same document as the entire simulator — an article
   * containing id="settings" or id="desktop" would quietly break Mac.$()
   * everywhere. But dropping ids outright meant every section link on a
   * Wikipedia article was dead: the anchor handler and scrollToAnchor were
   * both wired up and had nothing to find. Ids are kept, namespaced, and the
   * anchors are rewritten to match.
   */
  const ANCHOR_PREFIX = 'wiki-anchor-';
  const anchorId = value => ANCHOR_PREFIX + String(value).replace(/\s+/g, '_');

  /* Wikipedia furniture that only makes sense with their own stylesheet. */
  const DROP_SELECTORS = ['.mw-editsection', '.mw-jump-link', '.mw-empty-elt', '.navbox',
    '.vertical-navbox', '.sistersitebox', '.metadata.plainlinks', '.ambox', '.mbox-small',
    '.hatnote.navigation-not-searchable', '.mw-references-columns .mw-cite-backlink',
    '.noprint', '.mw-collapsible-toggle', '.shortdescription', '.mw-file-element + .mw-valign-text-top'];

  const Web = Mac.Web = {
    /** Live access is a preference; off falls back to the simulated catalogue. */
    enabled() { return Mac.state.browser.liveWeb !== false; },

    /** The simulated Wi-Fi still gates real requests, so scenarios stay honest. */
    /* The simulated network gates the real one: a live fetch must not
       succeed on a Mac the simulator is describing as unreachable, or the
       whole exercise stops being reproducible. Delegated to Mac.Network so
       there is one definition — this copy used to check DNS but not the
       proxy, so a live page loaded through a proxy that Safari said was
       refusing connections. */
    simulatedOnline() { return Mac.Network.online(); },

    /**
     * Classify typed input.
     * @returns {null|{kind:'wiki',lang,project,title}|{kind:'frame',url,host}}
     */
    parse(input) {
      const raw = String(input || '').trim();
      if (!raw) return null;

      // Explicit shorthands: "wiki:Thing", "w Thing"
      const shorthand = raw.match(/^(?:wiki|w):\s*(.+)$/i);
      if (shorthand) return { kind: 'wiki', lang: 'en', project: 'wikipedia', title: shorthand[1].trim() };

      let url;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
      } catch (error) {
        return null;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

      const host = url.hostname.toLowerCase();
      if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.test')) return null;

      // Wikipedia and sister projects go through the API.
      const wikiHost = Object.keys(WIKI_HOSTS).find(suffix => host.endsWith(suffix));
      if (wikiHost) {
        const sub = host.slice(0, -wikiHost.length).replace(/\.$/, '');
        const lang = /^[a-z]{2,3}(-[a-z]+)?$/.test(sub) ? sub : 'en';
        const match = url.pathname.match(/^\/wiki\/(.+)$/);
        const title = match
          ? decodeURIComponent(match[1])
          : url.searchParams.get('search') || url.searchParams.get('title') || 'Main Page';
        return { kind: 'wiki', lang, project: WIKI_HOSTS[wikiHost], title, hash: url.hash.slice(1) };
      }

      return { kind: 'frame', url: url.href, host };
    },

    framable(host) {
      return !NO_FRAME.some(blocked => host.includes(blocked));
    },

    apiBase(target) {
      const project = target.project === 'wikipedia' ? 'wikipedia' : target.project;
      return `https://${target.lang}.${project}.org/w/api.php`;
    },

    /* A page that never answers is a real failure mode, and the browser had
       no defence against it: no timeout, so the tab spun forever, and no
       cancellation, so a slow response for a page you had already navigated
       away from still landed and replaced what you were reading. */
    TIMEOUT_MS: 12000,

    async request(url, { signal } = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        const reason = new Error('The server did not respond in time');
        reason.timedOut = true;
        controller.abort(reason);
      }, this.TIMEOUT_MS);
      // Cancelling the tab's load cancels this request too.
      const relay = () => controller.abort(signal.reason);
      if (signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else signal.addEventListener('abort', relay, { once: true });
      }
      try {
        const response = await fetch(url, {
          mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', relay);
      }
    },

    /** Fetch a parsed article. Redirects are followed by the API. */
    async article(target, options) {
      const params = new URLSearchParams({
        action: 'parse',
        page: target.title,
        prop: 'text|displaytitle',
        formatversion: '2',
        redirects: '1',
        format: 'json',
        origin: '*',
      });
      const data = await this.request(`${this.apiBase(target)}?${params}`, options);
      if (data.error) {
        const error = new Error(data.error.info || 'Page not found');
        error.code = data.error.code;
        throw error;
      }
      return {
        title: this.stripTags(data.parse.displaytitle) || target.title.replace(/_/g, ' '),
        html: this.sanitize(data.parse.text, target),
      };
    },

    async search(target, query, options) {
      const params = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: '10',
        formatversion: '2',
        format: 'json',
        origin: '*',
      });
      const data = await this.request(`${this.apiBase(target)}?${params}`, options);
      return (data.query?.search || []).map(hit => ({
        title: hit.title,
        snippet: this.stripTags(hit.snippet),
        words: hit.wordcount,
      }));
    },

    async randomTitle(target, options) {
      const params = new URLSearchParams({
        action: 'query',
        list: 'random',
        rnnamespace: '0',
        rnlimit: '1',
        formatversion: '2',
        format: 'json',
        origin: '*',
      });
      const data = await this.request(`${this.apiBase(target)}?${params}`, options);
      return data.query?.random?.[0]?.title || 'Macintosh';
    },

    /* Exposed so Safari can turn a URL fragment into the id the sanitiser
       actually wrote, without either side hard-coding the prefix. */
    anchorId(value) { return anchorId(value); },

    stripTags(html) {
      const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
      return (parsed.body.textContent || '').trim();
    },

    /* ---------------------------------------------------------- sanitising */

    /**
     * Rebuild fetched markup from an allowlist. Parsing happens in an inert
     * document, so nothing in the source can run before it is filtered.
     */
    sanitize(html, target) {
      const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
      DROP_SELECTORS.forEach(selector => {
        parsed.querySelectorAll(selector).forEach(node => node.remove());
      });

      const output = document.createElement('div');
      output.className = 'wiki-body';
      this.copyChildren(parsed.body, output, target);
      // outerHTML, so the .wiki-body wrapper (and its typography) survives.
      return output.outerHTML;
    },

    copyChildren(source, destination, target) {
      source.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          destination.appendChild(document.createTextNode(node.nodeValue));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (!ALLOWED_TAGS.has(node.tagName)) {
          // Unwrap unknown containers so their text survives; drop the rest.
          if (['BODY', 'SECTION', 'MAIN', 'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE',
               'NAV', 'DETAILS', 'SUMMARY', 'CENTER', 'FONT', 'TT'].includes(node.tagName)) {
            this.copyChildren(node, destination, target);
          }
          return;
        }

        const clone = document.createElement(node.tagName.toLowerCase());
        for (const attribute of node.attributes) {
          const name = attribute.name.toLowerCase();
          if (name.startsWith('on')) continue;
          if (ALLOWED_ATTRS.has(name)) clone.setAttribute(name, attribute.value);
        }
        // Namespaced, so section links resolve without colliding with the app.
        const id = node.getAttribute('id');
        if (id) clone.id = anchorId(id);

        if (node.tagName === 'A') this.rewriteLink(node, clone, target);
        if (node.tagName === 'IMG' && !this.rewriteImage(node, clone)) return;

        this.copyChildren(node, clone, target);
        destination.appendChild(clone);
      });
    },

    /** Internal wiki links keep browsing inside the simulator. */
    rewriteLink(source, clone, target) {
      const href = source.getAttribute('href') || '';
      const project = target.project === 'wikipedia' ? 'wikipedia' : target.project;

      if (href.startsWith('#')) {
        clone.setAttribute('data-web-anchor', anchorId(decodeURIComponent(href.slice(1))));
        clone.setAttribute('role', 'link');
        return;
      }
      const wiki = href.match(/^(?:https?:)?(?:\/\/[^/]+)?\/wiki\/([^#?]+)(#.*)?$/);
      if (wiki) {
        const title = decodeURIComponent(wiki[1]);
        const fragment = wiki[2] || '';
        /* A link to another article's section keeps its fragment, so the
           load lands on the section rather than the top of the page. */
        clone.setAttribute('data-command', 'browse');
        clone.setAttribute('data-arg', `${target.lang}.${project}.org/wiki/${encodeURIComponent(title)}${fragment}`);
        clone.setAttribute('title', title.replace(/_/g, ' ') + (fragment ? ` ${fragment}` : ''));
        return;
      }
      if (/^https?:\/\//i.test(href)) {
        clone.setAttribute('data-command', 'browse');
        clone.setAttribute('data-arg', href);
        clone.classList.add('external-link');
        return;
      }
      clone.classList.add('dead-link');
    },

    rewriteImage(source, clone) {
      let src = source.getAttribute('src') || '';
      if (src.startsWith('//')) src = `https:${src}`;
      if (!/^https:\/\//i.test(src)) return false;
      clone.setAttribute('src', src);
      clone.setAttribute('loading', 'lazy');
      clone.setAttribute('referrerpolicy', 'no-referrer');
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      return true;
    },

    /* ------------------------------------------------------------ loading */

    /**
     * Drive a live load for a tab. Resolves once the tab's `live` payload is
     * populated; the caller re-renders.
     */
    async load(win, tab, target) {
      /* Cancel whatever this tab was already fetching, and stamp this load
         so a response that arrives after the next navigation is discarded
         rather than pasted over whatever the user is reading now. */
      this.cancel(tab);
      const controller = new AbortController();
      const generation = (tab.loadGeneration = (tab.loadGeneration || 0) + 1);
      tab.loadController = controller;
      const current = () => tab.loadGeneration === generation;

      tab.live = { kind: target.kind, state: 'loading' };

      if (!this.simulatedOnline()) {
        tab.live = { kind: 'error', reason: 'simulated-offline' };
        return;
      }

      if (target.kind === 'frame') {
        tab.live = this.framable(target.host)
          ? { kind: 'frame', url: target.url, host: target.host, state: 'ready' }
          : { kind: 'error', reason: 'no-frame', url: target.url, host: target.host };
        return;
      }

      const options = { signal: controller.signal };
      try {
        if (target.title === '__random__') target.title = await this.randomTitle(target, options);
        if (target.search) {
          const results = await this.search(target, target.search, options);
          if (!current()) return;
          tab.live = { kind: 'wiki-search', query: target.search, results, target, state: 'ready' };
          return;
        }
        const article = await this.article(target, options);
        if (!current()) return;
        tab.live = { kind: 'wiki', ...article, target, hash: target.hash, state: 'ready' };
      } catch (error) {
        /* `abort(reason)` rejects the fetch with that reason verbatim, not
           with a DOMException — so the cancellation is identified by the
           marker put on it, not by error.name, which is just 'Error'. A load
           the user cancelled is not a failure to report back to them. */
        if (error.superseded) return;
        if (!current()) return;
        tab.live = {
          kind: 'error',
          reason: error.code === 'missingtitle' ? 'missing'
            : error.timedOut ? 'timeout' : 'fetch',
          message: error.message,
          target,
        };
      } finally {
        if (current()) tab.loadController = null;
      }
    },

    /** Abort a tab's in-flight load, if it has one. */
    cancel(tab) {
      if (!tab?.loadController) return;
      const reason = new Error('superseded');
      reason.superseded = true;
      tab.loadController.abort(reason);
      tab.loadController = null;
    },
  };
}(window.Mac));
