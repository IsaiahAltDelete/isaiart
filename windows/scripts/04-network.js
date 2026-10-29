/* ===========================================================================
   Network model.

   One shared answer to "is this PC online, and if not, why?" used by the tray
   icon, Quick Settings, Settings, Edge and the command line. Networks, routers
   and resolvers are fictional fixtures; nothing touches the host network.
   =========================================================================== */

(function (Win) {
  'use strict';

  const ADAPTER = {
    name: 'Wi-Fi',
    description: 'Intel(R) Wi-Fi 7 BE201 320MHz',
    mac: 'A4-C3-F0-5E-12-9B',
    randomMac: '5A-1E-77-C2-0D-41',
    driver: '23.140.0.3',
  };

  /* Networks in range. `internet: false` models a network that associates but
     has no upstream route (a printer's direct network, a captive café). */
  const SCAN = [
    { ssid: 'Sablewave Home', security: 'WPA3-Personal', signal: 4, password: 'sablewave', band: '5 GHz', channel: 149, protocol: 'Wi-Fi 6E (802.11ax)', subnet: '192.168.1', internet: true },
    { ssid: 'Sablewave Guest', security: 'Open', signal: 3, password: '', band: '2.4 GHz', channel: 6, protocol: 'Wi-Fi 4 (802.11n)', subnet: '192.168.50', internet: true },
    { ssid: 'DIRECT-25-HP OfficeJet', security: 'WPA2-Personal', signal: 3, password: 'printer25', band: '2.4 GHz', channel: 11, protocol: 'Wi-Fi 4 (802.11n)', subnet: '192.168.223', internet: false },
    { ssid: 'Hollis_5G', security: 'WPA2-Personal', signal: 2, password: 'hollisfamily', band: '5 GHz', channel: 36, protocol: 'Wi-Fi 5 (802.11ac)', subnet: '10.0.0', internet: true },
    { ssid: 'CornerCafe Free WiFi', security: 'Open', signal: 1, password: '', band: '2.4 GHz', channel: 1, protocol: 'Wi-Fi 4 (802.11n)', subnet: '172.16.4', internet: false },
  ];

  /* Public resolvers the fixture treats as reachable. Anything else, including
     the documentation ranges, times out. */
  const RESOLVERS = new Set(['1.1.1.1', '1.0.0.1', '8.8.8.8', '8.8.4.4', '9.9.9.9', '149.112.112.112', '208.67.222.222', '208.67.220.220',
    '2606:4700:4700::1111', '2606:4700:4700::1001', '2001:4860:4860::8888', '2001:4860:4860::8844', '2620:fe::fe']);

  const HOSTS = {
    localhost: '127.0.0.1', 'example.com': '93.184.215.14', 'www.example.com': '93.184.215.14', 'wikipedia.org': '185.15.59.224',
    'en.wikipedia.org': '185.15.59.224', 'microsoft.com': '20.70.246.20', 'www.microsoft.com': '23.40.62.117', 'bing.com': '13.107.21.237',
    'www.bing.com': '13.107.21.237', 'google.com': '142.250.72.14', 'www.google.com': '142.250.72.36', 'msn.com': '204.79.197.203',
    'www.msn.com': '204.79.197.203', 'one.one.one.one': '1.1.1.1', 'dns.google': '8.8.8.8', 'github.com': '140.82.112.4',
    'outlook.com': '52.96.88.178', 'support.example': '203.0.113.80', 'vpn.support.example': '203.0.113.10',
  };

  const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  const IPV6 = /^[0-9a-f:]+$/i;

  const N = () => Win.state.network;

  const hash = value => [...String(value)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

  Win.Network = {
    ADAPTER,
    RESOLVERS,

    validIPv4: value => IPV4.test(String(value || '').trim()),
    validIPv6: value => { const v = String(value || '').trim(); return v.includes(':') && IPV6.test(v) && v.split('::').length <= 2; },
    validDNS: value => Win.Network.validIPv4(value) || Win.Network.validIPv6(value),

    /** Networks currently visible in the Wi-Fi list, strongest first. */
    scan() {
      if (!Win.Network.radioOn()) return [];
      return SCAN.slice().sort((a, b) => b.signal - a.signal).map(n => ({ ...n, known: !!Win.Network.profile(n.ssid) }));
    },

    lookup: ssid => SCAN.find(n => n.ssid === ssid) || null,
    profile: ssid => N().known.find(k => k.ssid === ssid) || null,
    radioOn: () => !N().airplane && N().wifi && N().adapterEnabled.wifi,
    current: () => (Win.Network.radioOn() && N().connected ? Win.Network.lookup(N().connected) : null),

    mac(ssid = N().connected) {
      const p = Win.Network.profile(ssid);
      return p && p.randomMac !== 'Off' ? ADAPTER.randomMac : ADAPTER.mac;
    },

    /** Effective IPv4 configuration for the connected network. */
    config() {
      const net = Win.Network.current();
      if (!net) return null;
      const p = Win.Network.profile(net.ssid) || {};
      const dhcp = p.ipMode !== 'manual';
      const host = 40 + (hash(net.ssid) % 50);
      const gateway = `${net.subnet}.1`;
      const config = {
        dhcp,
        ip: dhcp ? `${net.subnet}.${host}` : p.ip,
        mask: dhcp ? '255.255.255.0' : p.mask,
        gateway: dhcp ? gateway : p.gateway,
        router: gateway,
        dns: p.dnsMode === 'manual' ? p.dns.filter(Boolean) : [gateway],
        dnsManual: p.dnsMode === 'manual',
        ipv6: `fe80::${(hash(net.ssid) % 0xffff).toString(16)}:3b2a:9c1e:44f0%12`,
        dhcpServer: dhcp ? gateway : '',
        leaseObtained: Date.now() - 3 * 3600e3,
        suffix: net.ssid.startsWith('Sablewave') ? 'lan' : '',
      };
      if (!dhcp && !Win.Network.validIPv4(config.ip)) config.ip = '169.254.112.7';
      return config;
    },

    /**
     * Why this PC can't reach the internet, or '' if it can. Reasons:
     * airplane, wifi-off, adapter-disabled, disconnected, no-gateway,
     * apipa, no-internet, no-dns. Proxy problems only affect web traffic
     * and are reported by webReason().
     */
    reason() {
      const n = N();
      if (n.airplane) return 'airplane';
      if (!n.adapterEnabled.wifi) return 'adapter-disabled';
      if (!n.wifi) return 'wifi-off';
      const net = Win.Network.current();
      if (!net) return 'disconnected';
      const c = Win.Network.config();
      if (c.ip.startsWith('169.254.')) return 'apipa';
      if (!c.dhcp) {
        const sameSubnet = c.ip.startsWith(`${net.subnet}.`) && c.gateway === c.router && c.mask === '255.255.255.0';
        if (!sameSubnet || c.ip === c.router) return 'no-gateway';
      }
      if (!net.internet) return 'no-internet';
      const resolvers = c.dnsManual ? c.dns : [c.router];
      if (!resolvers.some(ip => ip === c.router || RESOLVERS.has(ip))) return 'no-dns';
      return '';
    },

    online: () => !Win.Network.reason(),

    /** Web traffic additionally passes through the proxy settings. */
    webReason() {
      const base = Win.Network.reason();
      if (base) return base;
      const p = N().proxy;
      if (p.manual && p.address && !/^proxy\.support\.example$/i.test(p.address.trim())) return 'proxy';
      if (p.useScript && p.script && !/^https?:\/\/proxy\.support\.example\/proxy\.pac$/i.test(p.script.trim())) return 'proxy';
      return '';
    },

    /** Short status line for tray tooltips and Settings. */
    summary() {
      const r = Win.Network.reason();
      const name = N().connected;
      return {
        airplane: 'Airplane mode is on',
        'wifi-off': 'Wi-Fi is turned off',
        'adapter-disabled': 'Wi-Fi adapter is disabled',
        disconnected: 'Not connected',
        'no-gateway': `${name}\nNo internet`,
        apipa: `${name}\nNo internet`,
        'no-internet': `${name}\nNo internet`,
        'no-dns': `${name}\nNo internet`,
        '': `${name}\nInternet access`,
      }[r];
    },

    /** Tray glyph for the current state. */
    glyph() {
      const r = Win.Network.reason();
      if (r === 'airplane') return 'airplane';
      if (['wifi-off', 'adapter-disabled', 'disconnected'].includes(r)) return 'wifioff';
      if (r) return 'wifiwarn';
      return `wifi${Win.Network.current().signal}`;
    },

    connect(ssid, password = '', { auto = true } = {}) {
      return new Promise(resolve => {
        const net = Win.Network.lookup(ssid);
        if (!net || !Win.Network.radioOn()) { resolve({ ok: false, error: 'Can\'t connect to this network' }); return; }
        const saved = Win.Network.profile(ssid);
        const key = saved ? saved.password : password;
        if (net.security !== 'Open' && key !== net.password) {
          setTimeout(() => resolve({ ok: false, error: 'The network security key isn\'t correct. Please try again.' }), 900);
          return;
        }
        setTimeout(() => {
          if (!saved) {
            N().known.push({ ssid, password: key, auto, metered: false, randomMac: 'Off', profile: net.security === 'Open' ? 'Public' : 'Private',
              ipMode: 'dhcp', ip: '', mask: '255.255.255.0', gateway: '', dnsMode: 'auto', dns: [], dnsEncryption: 'Unencrypted only' });
          } else {
            saved.auto = auto;
          }
          N().connected = ssid;
          Win.save('network');
          resolve({ ok: true });
        }, 1100);
      });
    },

    disconnect() {
      const p = Win.Network.profile(N().connected);
      if (p) p.auto = false;           // Windows stops auto-joining after a manual disconnect
      N().connected = '';
      Win.save('network');
    },

    forget(ssid) {
      N().known = N().known.filter(k => k.ssid !== ssid);
      if (N().connected === ssid) N().connected = '';
      Win.save('network');
    },

    /** Join the strongest saved network with auto-connect turned on. */
    autoJoin() {
      if (!Win.Network.radioOn() || N().connected) return;
      const pick = Win.Network.scan().find(n => Win.Network.profile(n.ssid)?.auto);
      if (pick) N().connected = pick.ssid;
    },

    setWifi(on) {
      N().wifi = !!on;
      if (!on) N().connected = '';
      else Win.Network.autoJoin();
      Win.save('network');
    },

    setAirplane(on) {
      N().airplane = !!on;
      if (on) { N().connected = ''; Win.state.settings.bluetooth = false; }
      else { Win.Network.autoJoin(); Win.state.settings.bluetooth = true; }
      Win.save('network');
    },

    setAdapter(on) {
      N().adapterEnabled.wifi = !!on;
      if (!on) N().connected = '';
      else Win.Network.autoJoin();
      Win.save('network');
    },

    /**
     * Validate and save IP settings for a known network. Returns an error
     * string, or '' on success. Nothing is written if validation fails.
     */
    saveIP(ssid, patch) {
      const p = Win.Network.profile(ssid);
      if (!p) return 'This network is not saved on this PC.';
      const next = { ...p, ...patch };
      if (next.ipMode === 'manual') {
        if (!Win.Network.validIPv4(next.ip)) return 'Enter a valid IP address.';
        if (!Win.Network.validIPv4(next.mask)) return 'Enter a valid subnet mask.';
        if (next.gateway && !Win.Network.validIPv4(next.gateway)) return 'Enter a valid gateway.';
      }
      if (next.dnsMode === 'manual') {
        next.dns = (next.dns || []).map(s => String(s).trim()).filter(Boolean);
        if (!next.dns.length) return 'Enter a preferred DNS server.';
        const bad = next.dns.find(d => !Win.Network.validDNS(d));
        if (bad) return `"${bad}" isn't a valid DNS server address.`;
      }
      Object.assign(p, next);
      Win.save('network');
      return '';
    },

    /** DNS lookup for nslookup, ping and Edge. */
    resolve(host) {
      const name = String(host || '').trim().toLowerCase().replace(/\.$/, '');
      if (!name) return { ok: false, error: 'invalid' };
      if (Win.Network.validIPv4(name)) return { ok: true, ip: name };
      if (name === 'localhost' || name === Win.PERSONA.computer.toLowerCase()) return { ok: true, ip: name === 'localhost' ? '127.0.0.1' : (Win.Network.config()?.ip || '127.0.0.1') };
      const r = Win.Network.reason();
      if (r === 'no-dns' || ['airplane', 'wifi-off', 'adapter-disabled', 'disconnected', 'apipa', 'no-gateway'].includes(r)) return { ok: false, error: r };
      if (r === 'no-internet') return { ok: false, error: 'no-internet' };
      if (HOSTS[name]) return { ok: true, ip: HOSTS[name] };
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return { ok: false, error: 'nxdomain' };
      if (/\.(invalid|test|local)$/.test(name)) return { ok: false, error: 'nxdomain' };
      const h = hash(name);
      return { ok: true, ip: `${104 + (h % 80)}.${(h >> 8) % 250}.${(h >> 16) % 250}.${1 + (h >> 24) % 250}` };
    },

    /** Simulated echo results. Returns { ok, ip, replies: [ms…] } or an error. */
    ping(host, count = 4) {
      const name = String(host || '').trim().toLowerCase();
      const c = Win.Network.config();
      if (name === '127.0.0.1' || name === 'localhost' || name === '::1') return { ok: true, ip: '127.0.0.1', replies: Array(count).fill(0) };
      const r = Win.Network.reason();
      if (['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'].includes(r)) return { ok: false, error: 'general' };
      const resolved = Win.Network.resolve(name);
      if (!resolved.ok) return { ok: false, error: resolved.error === 'nxdomain' || resolved.error === 'no-dns' || resolved.error === 'no-internet' ? 'host' : 'general' };
      const ip = resolved.ip;
      const local = c && ip.startsWith(c.ip.split('.').slice(0, 3).join('.') + '.');
      if (r === 'apipa' || (r === 'no-gateway' && !local)) return { ok: false, ip, error: 'unreachable', from: c?.ip };
      if (local && ip === c.router && r !== 'no-gateway') return { ok: true, ip, replies: Array.from({ length: count }, (_, i) => 1 + ((hash(ip) + i) % 4)) };
      if (local) return { ok: false, ip, error: 'timeout' };
      if (r === 'no-internet' || (!RESOLVERS.has(ip) && !Object.values(HOSTS).includes(ip) && Win.Network.validIPv4(name) && /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip))) return { ok: false, ip, error: 'timeout' };
      const base = 9 + (hash(ip) % 30);
      return { ok: true, ip, replies: Array.from({ length: count }, (_, i) => base + ((hash(ip) >> i) % 7)) };
    },
  };
})(window.Win);
