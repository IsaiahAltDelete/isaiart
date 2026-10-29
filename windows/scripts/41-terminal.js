/* ===========================================================================
   Windows Terminal with Windows PowerShell and Command Prompt profiles.

   Win.Terminal.run(line, session) is the command runner: it returns the text a
   command prints. The window layer consumes the same output as chunks with
   delays so ping, tracert and sfc pace themselves like the real tools, and a
   running command can be cancelled with Ctrl+C.

   Commands work against Win.FS and Win.Network. Output formats follow the
   Windows 11 originals as closely as the virtual machine allows.
   =========================================================================== */

(function (Win) {
  'use strict';

  Win.DefaultState.terminal = {
    defaultProfile: 'powershell',
    fontSize: 12,
    cursor: 'bar',            // 'bar' | 'underscore' | 'filledBox' | 'emptyBox'
    scheme: 'Campbell',
  };

  const P = Win.PERSONA;
  const VERSION = '10.0.26300.7019';
  const PS_VERSION = '5.1.26300.7019';
  const LOADED = Date.now();
  const INSTALLED = LOADED - 228 * 86400000;

  /* Machine-wide state the commands share across tabs and windows. */
  const machine = {
    released: false,
    dns: new Map([
      ['www.msn.com', '204.79.197.203'],
      ['outlook.com', '52.96.88.178'],
      ['www.microsoft.com', '23.40.62.117'],
    ]),
    shutdown: null,
  };
  Win.on('network', () => { machine.released = false; });

  /* --------------------------------------------------------------- helpers */

  const two = n => String(n).padStart(2, '0');
  const h12 = d => d.getHours() % 12 || 12;
  const ampm = d => (d.getHours() < 12 ? 'AM' : 'PM');
  const comma = n => Math.round(n).toLocaleString('en-US');
  const cmdStamp = d => `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}  ${two(h12(d))}:${two(d.getMinutes())} ${ampm(d)}`;
  const psDate = d => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const psTime = d => `${h12(d)}:${two(d.getMinutes())} ${ampm(d)}`;
  const longDate = d => d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const longTime = d => `${h12(d)}:${two(d.getMinutes())}:${two(d.getSeconds())} ${ampm(d)}`;
  const hash = value => [...String(value)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const hostName = () => Win.state.settings.deviceName || P.computer;
  const isIPv4 = v => Win.Network.validIPv4(v);

  const err = text => ({ text: ensureNL(text), cls: 'err' });
  const warn = text => ({ text: ensureNL(text), cls: 'warn' });
  const ensureNL = text => (text === '' ? '' : text.endsWith('\n') ? text : `${text}\n`);
  const stream = (gen, onCancel) => ({ stream: gen, onCancel });

  const ENV = () => ({
    ALLUSERSPROFILE: 'C:\\ProgramData',
    APPDATA: `C:\\Users\\${P.user}\\AppData\\Roaming`,
    COMPUTERNAME: hostName(),
    ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe',
    HOMEDRIVE: 'C:',
    HOMEPATH: `\\Users\\${P.user}`,
    LOCALAPPDATA: `C:\\Users\\${P.user}\\AppData\\Local`,
    LOGONSERVER: `\\\\${hostName()}`,
    NUMBER_OF_PROCESSORS: '8',
    OS: 'Windows_NT',
    Path: 'C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\WINDOWS\\System32\\Wbem;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\;C:\\WINDOWS\\System32\\OpenSSH\\;' +
      `C:\\Users\\${P.user}\\AppData\\Local\\Microsoft\\WindowsApps;`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    PROCESSOR_ARCHITECTURE: 'AMD64',
    PROCESSOR_IDENTIFIER: 'Intel64 Family 6 Model 189 Stepping 1, GenuineIntel',
    ProgramData: 'C:\\ProgramData',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    PUBLIC: 'C:\\Users\\Public',
    SystemDrive: 'C:',
    SystemRoot: 'C:\\WINDOWS',
    TEMP: `C:\\Users\\${P.user}\\AppData\\Local\\Temp`,
    TMP: `C:\\Users\\${P.user}\\AppData\\Local\\Temp`,
    USERDOMAIN: hostName(),
    USERNAME: P.user,
    USERPROFILE: `C:\\Users\\${P.user}`,
    windir: 'C:\\WINDOWS',
  });
  const envGet = name => {
    const env = ENV();
    const key = Object.keys(env).find(k => k.toLowerCase() === String(name).toLowerCase());
    return key ? env[key] : null;
  };

  /* ---------------------------------------------------------------- session */

  /* Win.FS.path() maps the 'home' id to its virtual "Home" root; shells need the real path. */
  function fsPath(id) {
    const parts = [];
    let node = Win.FS.get(id);
    if (!node) return Win.FS.path(id);
    while (node) {
      if (node.kind === 'drive') { parts.unshift(`${node.letter}:`); break; }
      parts.unshift(node.name);
      node = Win.FS.get(node.parent);
    }
    return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\');
  }

  function driveLetter(id) { return (Win.FS.driveOf(id)?.letter || 'C').toLowerCase(); }
  function driveRoot(letter) {
    return Win.state.fs.find(n => n.kind === 'drive' && n.letter.toLowerCase() === letter.toLowerCase() && !n.ejected)?.id || null;
  }

  function makeSession(profile = 'powershell', { cwd = null, admin = false } = {}) {
    const node = cwd && Win.FS.get(cwd);
    const start = node && Win.FS.isFolder(node) ? cwd : (admin ? 'c-system32' : 'home');
    const s = { profile: profile === 'cmd' ? 'cmd' : 'powershell', cwd: start, drives: {}, history: [], stack: [], admin: !!admin, line: '' };
    s.drives[driveLetter(start)] = start;
    return s;
  }

  const cwdPath = s => fsPath(s.cwd);
  const prompt = s => (s.profile === 'cmd' ? `${cwdPath(s)}>` : `PS ${cwdPath(s)}> `);

  function banner(profile) {
    return profile === 'cmd'
      ? `Microsoft Windows [Version ${VERSION}]\n(c) Microsoft Corporation. All rights reserved.\n`
      : 'Windows PowerShell\nCopyright (C) Microsoft Corporation. All rights reserved.\n\nInstall the latest PowerShell for new features and improvements! https://aka.ms/PSWindows\n';
  }

  /* --------------------------------------------------------------- parsing */

  /** Split a command line into tokens. Quotes group and are removed; `q` marks quoted tokens. */
  function tokenize(line, s) {
    const tokens = [];
    let cur = '';
    let quoted = false;
    let quote = '';
    let any = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quote) {
        if (ch === quote) { quote = ''; continue; }
        cur += ch;
        continue;
      }
      if (ch === '"' || (ch === '\'' && s?.profile !== 'cmd')) { quote = ch; quoted = true; any = true; continue; }
      if (/\s/.test(ch)) {
        if (any) tokens.push({ v: cur, q: quoted });
        cur = ''; quoted = false; any = false;
        continue;
      }
      cur += ch;
      any = true;
    }
    if (any) tokens.push({ v: cur, q: quoted });
    return tokens;
  }

  /** Split on a character outside quotes. */
  function splitOutside(line, ch) {
    const parts = [];
    let cur = '';
    let quote = '';
    for (const c of line) {
      if (quote) { if (c === quote) quote = ''; cur += c; continue; }
      if (c === '"' || c === '\'') { quote = c; cur += c; continue; }
      if (c === ch) { parts.push(cur); cur = ''; continue; }
      cur += c;
    }
    parts.push(cur);
    return parts;
  }

  function expandVars(line, s) {
    if (s.profile === 'cmd') {
      return line.replace(/%([^%\s]+)%/g, (all, name) => {
        if (name.toLowerCase() === 'cd') return cwdPath(s);
        if (name.toLowerCase() === 'date') return cmdDateT();
        if (name.toLowerCase() === 'time') { const d = new Date(); return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${two(Math.floor(d.getMilliseconds() / 10))}`; }
        return envGet(name) ?? all;
      });
    }
    /* PowerShell: expand outside single quotes only. */
    let out = '';
    let single = false;
    for (let i = 0; i < line.length; i += 1) {
      const c = line[i];
      if (c === '\'') { single = !single; out += c; continue; }
      if (c === '$' && !single) {
        const rest = line.slice(i);
        const m = rest.match(/^\$env:([A-Za-z_][\w()]*)/i) || rest.match(/^\$(HOME|PWD)\b/i);
        if (m) {
          const value = m[0].toLowerCase().startsWith('$env:') ? (envGet(m[1]) ?? '') : m[1].toLowerCase() === 'home' ? `C:\\Users\\${P.user}` : cwdPath(s);
          out += value;
          i += m[0].length - 1;
          continue;
        }
      }
      out += c;
    }
    return out;
  }

  /** PowerShell named/switch parameters with unambiguous-prefix matching. */
  function psArgs(tokens, { named = [], switches = [], positional = [] } = {}) {
    const out = { _: [], bad: null };
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];
      if (!t.q && /^-[a-z]/i.test(t.v)) {
        const [rawKey, inline] = t.v.slice(1).split(':');
        const key = rawKey.toLowerCase();
        const exact = n => n.toLowerCase() === key;
        const sw = switches.find(exact) || switches.find(n => n.toLowerCase().startsWith(key));
        const nm = named.find(exact) || named.find(n => n.toLowerCase().startsWith(key));
        if (sw && (!nm || exact(sw))) { out[sw] = inline == null ? true : !/^\$?false$/i.test(inline); continue; }
        if (nm) { out[nm] = inline != null ? inline : tokens[++i]?.v; continue; }
        if (!out.bad) out.bad = rawKey;
        continue;
      }
      out._.push(t.v);
    }
    positional.forEach((name, i) => { if (out[name] == null && out._[i] != null) out[name] = out._[i]; });
    return out;
  }

  const cmdFlags = tokens => tokens.filter(t => !t.q && /^\/./.test(t.v)).map(t => t.v.toLowerCase());
  const cmdArgs = tokens => tokens.filter(t => t.q || !/^\/./.test(t.v)).map(t => t.v);

  /* ------------------------------------------------------- PowerShell errors */

  const CMDLET_CLASS = name => `Microsoft.PowerShell.Commands.${name.replace(/-/g, '')}Command`;

  function psError(s, cmd, message, { target = '', category = 'ObjectNotFound', reason = 'ItemNotFoundException', fqid = 'PathNotFound', underline = null } = {}) {
    const line = s.line || cmd;
    const marks = underline != null ? underline : line.length;
    return err([
      `${cmd} : ${message}`,
      'At line:1 char:1',
      `+ ${line}`,
      `+ ${'~'.repeat(Math.max(1, marks))}`,
      `    + CategoryInfo          : ${category}: (${target}:String) [${cmd}], ${reason}`,
      `    + FullyQualifiedErrorId : ${fqid}${fqid.includes(',') ? '' : `,${CMDLET_CLASS(cmd)}`}`,
      '',
    ].join('\n') + '\n');
  }

  function notRecognized(s, name) {
    if (s.profile === 'cmd') return err(`'${name}' is not recognized as an internal or external command,\noperable program or batch file.`);
    return err([
      `${name} : The term '${name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`,
      'At line:1 char:1',
      `+ ${s.line}`,
      `+ ${'~'.repeat(name.length)}`,
      `    + CategoryInfo          : ObjectNotFound: (${name}:String) [], CommandNotFoundException`,
      '    + FullyQualifiedErrorId : CommandNotFoundException',
      '',
    ].join('\n') + '\n');
  }

  const badParam = (s, cmd, name) => psError(s, cmd, `A parameter cannot be found that matches parameter name '${name}'.`,
    { target: '', category: 'InvalidArgument', reason: 'ParameterBindingException', fqid: `NamedParameterNotFound,${CMDLET_CLASS(cmd)}` });

  /* ---------------------------------------------------------- file system */

  function absPath(s, input) {
    let v = String(input || '').replace(/\//g, '\\');
    if (/^[a-z]:/i.test(v)) return v.length === 2 ? `${v}\\` : v;
    if (v.startsWith('\\')) return `${cwdPath(s).slice(0, 2)}${v}`;
    const base = cwdPath(s).replace(/\\$/, '');
    const parts = base.split('\\');
    for (const p of v.split('\\').filter(Boolean)) {
      if (p === '.') continue;
      if (p === '..') { if (parts.length > 1) parts.pop(); continue; }
      parts.push(p);
    }
    return parts.length === 1 ? `${parts[0]}\\` : parts.join('\\');
  }

  const resolve = (s, p) => Win.FS.resolve(p, s.cwd);
  const wild = p => /[*?]/.test(p);
  const globRe = p => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
  const splitPath = p => {
    const v = p.replace(/\//g, '\\');
    const i = v.lastIndexOf('\\');
    if (i < 0) return /^[a-z]:$/i.test(v) ? [v, ''] : ['', v];
    return [v.slice(0, i + 1), v.slice(i + 1)];
  };

  /** Find the folder and optional name filter a dir-style argument refers to. */
  function locate(s, target) {
    if (!target) return { dir: s.cwd, pattern: null };
    const id = resolve(s, target);
    const node = id && Win.FS.get(id);
    if (node && Win.FS.isFolder(node)) return { dir: id, pattern: null };
    if (node) return { dir: node.parent, pattern: globRe(node.name), file: node };
    const [head, tail] = splitPath(target);
    const parent = head ? resolve(s, head) : s.cwd;
    if (!parent || !Win.FS.isFolder(Win.FS.get(parent))) return { missing: true, noPath: true, dir: null };
    if (wild(tail)) return { dir: parent, pattern: globRe(tail) };
    return { missing: true, dir: parent };
  }

  const stamp = node => new Date(node.modified ?? node.created ?? INSTALLED);
  const sortByName = list => list.slice().sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const modeOf = n => (Win.FS.isFolder(n) ? `d-${n.readonly ? 'r' : '-'}${n.hidden ? 'h' : '-'}${n.system && n.hidden ? 's' : '-'}-` : `-a${n.readonly ? 'r' : '-'}${n.hidden ? 'h' : '-'}--`);
  const serial = letter => (letter.toLowerCase() === 'c' ? '4E2A-91C3' : '1A07-5BC2');
  const freeBytes = id => {
    const drive = Win.FS.driveOf(id);
    return drive ? Math.max(0, (drive.capacity || 0) - Win.FS.used(drive.id)) : 0;
  };

  function volumeHeader(id) {
    const drive = Win.FS.driveOf(id);
    const letter = drive?.letter || 'C';
    const label = drive?.removable ? ` is ${drive.name}` : ' has no label.';
    return ` Volume in drive ${letter}${label}\n Volume Serial Number is ${serial(letter)}\n`;
  }

  function cmdDir(tokens, s) {
    const flags = cmdFlags(tokens);
    const bare = flags.includes('/b');
    const all = flags.some(f => f.startsWith('/a'));
    const sub = flags.includes('/s');
    const target = cmdArgs(tokens)[0] || '';
    const loc = locate(s, target);
    if (loc.noPath) return 'The system cannot find the path specified.';
    const lines = [];
    const header = () => { if (!bare) lines.push(volumeHeader(loc.dir || s.cwd).replace(/\n$/, '')); };
    if (loc.missing) {
      if (!bare) { header(); lines.push('', ` Directory of ${fsPath(loc.dir)}`, ''); }
      lines.push('File Not Found');
      return lines.join('\n');
    }
    let totalFiles = 0;
    let totalBytes = 0;
    let totalDirs = 0;
    let found = false;
    const block = id => {
      let entries = sortByName(Win.FS.children(id, { hidden: all }));
      if (loc.pattern) entries = entries.filter(n => loc.pattern.test(n.name));
      const isRoot = Win.FS.get(id)?.kind === 'drive';
      const dots = !loc.pattern && !isRoot;
      if (!entries.length && sub && loc.pattern) return;
      if (!entries.length && !dots) return;
      found = true;
      const files = entries.filter(n => !Win.FS.isFolder(n));
      const dirs = entries.filter(n => Win.FS.isFolder(n));
      const bytes = files.reduce((sum, n) => sum + Win.FS.size(n.id), 0);
      totalFiles += files.length;
      totalBytes += bytes;
      totalDirs += dirs.length + (dots ? 2 : 0);
      if (bare) {
        entries.forEach(n => lines.push(sub ? fsPath(n.id) : n.name));
        return;
      }
      lines.push(` Directory of ${fsPath(id)}`, '');
      const self = Win.FS.get(id);
      if (dots) {
        lines.push(`${cmdStamp(stamp(self))}    <DIR>          .`);
        lines.push(`${cmdStamp(stamp(Win.FS.get(self.parent) || self))}    <DIR>          ..`);
      }
      entries.forEach(n => lines.push(Win.FS.isFolder(n)
        ? `${cmdStamp(stamp(n))}    <DIR>          ${n.name}`
        : `${cmdStamp(stamp(n))} ${comma(Win.FS.size(n.id)).padStart(17)} ${n.name}`));
      lines.push(`${String(files.length).padStart(16)} File(s) ${comma(bytes).padStart(14)} bytes`);
      if (!sub) lines.push(`${String(dirs.length + (dots ? 2 : 0)).padStart(16)} Dir(s) ${comma(freeBytes(id)).padStart(15)} bytes free`);
      else lines.push('');
    };
    header();
    if (!bare) lines.push('');
    if (sub) {
      const walk = id => { block(id); sortByName(Win.FS.children(id, { hidden: all }).filter(Win.FS.isFolder)).forEach(f => walk(f.id)); };
      walk(loc.dir);
      if (!found) { lines.push('File Not Found'); return lines.join('\n'); }
      if (!bare) {
        lines.push('     Total Files Listed:');
        lines.push(`${String(totalFiles).padStart(16)} File(s) ${comma(totalBytes).padStart(14)} bytes`);
        lines.push(`${String(totalDirs).padStart(16)} Dir(s) ${comma(freeBytes(loc.dir)).padStart(15)} bytes free`);
      }
    } else {
      block(loc.dir);
      if (!found) {
        if (bare) return err('File Not Found');
        lines.push(` Directory of ${fsPath(loc.dir)}`, '', 'File Not Found');
      }
    }
    return lines.join('\n');
  }

  function psListing(id, entries) {
    const rows = [
      '',
      `    Directory: ${fsPath(id)}`,
      '',
      '',
      'Mode                 LastWriteTime         Length Name',
      '----                 -------------         ------ ----',
    ];
    entries.forEach(n => {
      const d = stamp(n);
      const len = Win.FS.isFolder(n) ? '' : String(Win.FS.size(n.id));
      rows.push(`${modeOf(n)}        ${psDate(d).padStart(10)}${psTime(d).padStart(10)}${len.padStart(15)} ${n.name}`);
    });
    rows.push('', '', '');
    return rows.join('\n');
  }

  function psDir(tokens, s, ctx) {
    const a = psArgs(tokens, { named: ['Path', 'Filter', 'Depth', 'Include', 'Exclude', 'LiteralPath'], switches: ['Recurse', 'Force', 'Name', 'File', 'Directory', 'Hidden'], positional: ['Path', 'Filter'] });
    if (a.bad) return badParam(s, 'Get-ChildItem', a.bad);
    const target = a.Path || a.LiteralPath || '';
    if (/^env:\\?$/i.test(target)) {
      const env = ENV();
      const rows = ['', 'Name                           Value', '----                           -----'];
      Object.keys(env).sort((x, y) => x.localeCompare(y)).forEach(k => rows.push(`${k.padEnd(30)} ${env[k]}`));
      return `${rows.join('\n')}\n\n`;
    }
    const loc = locate(s, target);
    if (loc.missing || loc.noPath) {
      const full = absPath(s, target);
      return psError(s, 'Get-ChildItem', `Cannot find path '${full}' because it does not exist.`, { target: full });
    }
    const filter = a.Filter ? globRe(a.Filter) : null;
    const out = [];
    const listOne = id => {
      let entries = Win.FS.children(id, { hidden: !!(a.Force || a.Hidden) });
      if (loc.pattern) entries = entries.filter(n => loc.pattern.test(n.name));
      if (filter) entries = entries.filter(n => filter.test(n.name));
      if (a.File) entries = entries.filter(n => !Win.FS.isFolder(n));
      if (a.Directory) entries = entries.filter(n => Win.FS.isFolder(n));
      if (a.Hidden) entries = entries.filter(n => n.hidden);
      const ordered = [...sortByName(entries.filter(Win.FS.isFolder)), ...sortByName(entries.filter(n => !Win.FS.isFolder(n)))];
      if (a.Name) ordered.forEach(n => out.push(`${fsPath(n.id).slice(fsPath(loc.dir).replace(/\\$/, '').length + 1)}\n`));
      else if (ordered.length) out.push(psListing(id, ordered));
      if (a.Recurse) sortByName(Win.FS.children(id, { hidden: !!a.Force }).filter(Win.FS.isFolder)).forEach(f => listOne(f.id));
    };
    if (loc.file && !a.Recurse) {
      if (a.Name) return loc.file.name;
      return psListing(loc.dir, [loc.file]);
    }
    listOne(loc.dir);
    return out.join('');
  }

  function setLocation(tokens, s, ctx) {
    const cmd = s.profile === 'cmd';
    if (cmd) {
      const flags = cmdFlags(tokens);
      const raw = ctx.rest.replace(/^\s*\/d\s*/i, '').trim().replace(/^"|"$/g, '');
      if (!raw) return cwdPath(s);
      const id = resolve(s, raw);
      const node = id && Win.FS.get(id);
      if (!node) return /^[a-z]:/i.test(raw) && !driveRoot(raw[0]) ? 'The system cannot find the drive specified.' : 'The system cannot find the path specified.';
      if (!Win.FS.isFolder(node)) return 'The directory name is invalid.';
      const letter = driveLetter(id);
      s.drives[letter] = id;
      if (letter === driveLetter(s.cwd) || flags.includes('/d')) s.cwd = id;
      return '';
    }
    const a = psArgs(tokens, { named: ['Path', 'LiteralPath'], switches: ['PassThru'], positional: ['Path'] });
    if (a.bad) return badParam(s, 'Set-Location', a.bad);
    const target = a.Path || a.LiteralPath || '';
    if (!target) { s.cwd = 'home'; return ''; }
    if (target === '-') return '';
    if (/^[a-z]:/i.test(target) && !driveRoot(target[0])) {
      return psError(s, 'Set-Location', `Cannot find drive. A drive with the name '${target[0].toUpperCase()}' does not exist.`,
        { target: target[0].toUpperCase(), reason: 'DriveNotFoundException', fqid: 'DriveNotFound' });
    }
    const id = resolve(s, target);
    const node = id && Win.FS.get(id);
    if (!node || !Win.FS.isFolder(node)) {
      const full = absPath(s, target);
      return psError(s, 'Set-Location', `Cannot find path '${full}' because it does not exist.`, { target: full });
    }
    s.cwd = id;
    s.drives[driveLetter(id)] = id;
    return '';
  }

  function switchDrive(s, letter) {
    const root = driveRoot(letter);
    if (!root) {
      if (s.profile === 'cmd') return 'The system cannot find the drive specified.';
      return psError(s, 'Set-Location', `Cannot find drive. A drive with the name '${letter.toUpperCase()}' does not exist.`,
        { target: letter.toUpperCase(), reason: 'DriveNotFoundException', fqid: 'DriveNotFound' });
    }
    const remembered = s.drives[letter.toLowerCase()];
    s.cwd = remembered && Win.FS.get(remembered) ? remembered : root;
    s.drives[letter.toLowerCase()] = s.cwd;
    return '';
  }

  function binaryPreview(node) {
    const ext = node.ext;
    if (ext === 'pdf') return '%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj\n<</Type/Catalog/Pages 2 0 R/Lang(en-US)>>\nendobj';
    if (['docx', 'xlsx', 'zip'].includes(ext)) return 'PK\u0003\u0004\u0014\u0000\u0006\u0000\b\u0000\u0000\u0000!\u0000';
    if (ext === 'exe') return 'MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u00ff\u00ff\u0000\u0000\u00b8\nThis program cannot be run in DOS mode.';
    if (['jpg', 'jpeg'].includes(ext)) return '\u00ff\u00d8\u00ff\u00e0\u0000\u0010JFIF\u0000\u0001\u0001';
    if (ext === 'png') return '\u0089PNG\n\u001a\n\u0000\u0000\u0000\rIHDR';
    return '';
  }

  function getContent(tokens, s) {
    if (s.profile === 'cmd') {
      const names = cmdArgs(tokens);
      if (!names.length) return 'The syntax of the command is incorrect.';
      const out = [];
      for (const name of names) {
        const id = resolve(s, name);
        const node = id && Win.FS.get(id);
        if (!node) { out.push(err('The system cannot find the file specified.')); continue; }
        if (Win.FS.isFolder(node)) { out.push(err('Access is denied.')); continue; }
        if (names.length > 1) out.push(`\n${name}\n\n\n`);
        out.push(ensureNL((node.content ?? binaryPreview(node)).replace(/\r\n/g, '\n')));
      }
      return out;
    }
    const a = psArgs(tokens, { named: ['Path', 'TotalCount', 'Head', 'First', 'Tail', 'Encoding', 'LiteralPath'], switches: ['Raw', 'Wait'], positional: ['Path'] });
    if (a.bad) return badParam(s, 'Get-Content', a.bad);
    const target = a.Path || a.LiteralPath;
    if (!target) return psError(s, 'Get-Content', 'Cannot bind argument to parameter \'Path\' because it is null.', { category: 'InvalidData', reason: 'ParameterBindingValidationException', fqid: 'ParameterArgumentValidationErrorNullNotAllowed' });
    const id = resolve(s, target);
    const node = id && Win.FS.get(id);
    const full = absPath(s, target);
    if (!node) return psError(s, 'Get-Content', `Cannot find path '${full}' because it does not exist.`, { target: full });
    if (Win.FS.isFolder(node)) {
      return psError(s, 'Get-Content', `Access to the path '${full}' is denied.`, { target: full, category: 'PermissionDenied', reason: 'UnauthorizedAccessException', fqid: 'GetContentReaderUnauthorizedAccessError' });
    }
    let lines = (node.content ?? binaryPreview(node)).replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    const head = Number(a.TotalCount || a.Head || a.First);
    if (head) lines = lines.slice(0, head);
    if (a.Tail) lines = lines.slice(-Number(a.Tail));
    return lines.join('\n');
  }

  function mkdirs(s, target) {
    const parts = target.replace(/\//g, '\\').split('\\');
    let base = s.cwd;
    let start = 0;
    if (/^[a-z]:$/i.test(parts[0])) { base = driveRoot(parts[0][0]); start = 1; if (!base) return { error: 'drive' }; }
    else if (parts[0] === '') { base = Win.FS.driveOf(s.cwd)?.id || 'c'; start = 1; }
    let created = null;
    for (let i = start; i < parts.length; i += 1) {
      const name = parts[i];
      if (!name || name === '.') continue;
      if (name === '..') { base = Win.FS.get(base)?.parent || base; continue; }
      const existing = Win.state.fs.find(n => n.parent === base && n.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        if (!Win.FS.isFolder(existing)) return { error: 'exists', id: existing.id };
        if (i === parts.length - 1) return { error: 'exists', id: existing.id };
        base = existing.id;
        continue;
      }
      const problem = Win.FS.validName(name);
      if (problem) return { error: 'syntax' };
      created = Win.FS.create(base, name, 'folder');
      base = created.id;
    }
    return { id: base, created };
  }

  function makeDir(tokens, s) {
    if (s.profile === 'cmd') {
      const names = cmdArgs(tokens);
      if (!names.length) return 'The syntax of the command is incorrect.';
      const out = [];
      for (const name of names) {
        const r = mkdirs(s, name);
        if (r.error === 'exists') out.push(err(`A subdirectory or file ${name} already exists.`));
        else if (r.error) out.push(err('The filename, directory name, or volume label syntax is incorrect.'));
      }
      return out;
    }
    return newItem([...tokens, { v: '-ItemType', q: false }, { v: 'Directory', q: false }], s);
  }

  function newItem(tokens, s) {
    const a = psArgs(tokens, { named: ['Path', 'Name', 'ItemType', 'Type', 'Value'], switches: ['Force'], positional: ['Path'] });
    if (a.bad) return badParam(s, 'New-Item', a.bad);
    let target = a.Path || '';
    if (a.Name) target = target ? `${target.replace(/\\$/, '')}\\${a.Name}` : a.Name;
    if (!target) return psError(s, 'New-Item', 'Cannot bind argument to parameter \'Path\' because it is an empty string.', { category: 'InvalidData', reason: 'ParameterBindingValidationException', fqid: 'ParameterArgumentValidationErrorEmptyStringNotAllowed' });
    const type = String(a.ItemType || a.Type || 'File').toLowerCase();
    const full = absPath(s, target);
    if (type.startsWith('dir')) {
      const r = mkdirs(s, target);
      if (r.error === 'exists' && !a.Force) {
        return psError(s, 'New-Item', `An item with the specified name ${full} already exists.`, { target: full, category: 'ResourceExists', reason: 'IOException', fqid: 'DirectoryExist' });
      }
      if (r.error && r.error !== 'exists') return psError(s, 'New-Item', `Could not find a part of the path '${full}'.`, { target: full, category: 'WriteError', reason: 'DirectoryNotFoundException', fqid: 'NewItemIOError' });
      const node = Win.FS.get(r.id);
      return psListing(node.parent, [node]);
    }
    const [head, tail] = splitPath(target);
    const parent = head ? resolve(s, head) : s.cwd;
    if (!parent || !Win.FS.isFolder(Win.FS.get(parent))) {
      return psError(s, 'New-Item', `Could not find a part of the path '${full}'.`, { target: full, category: 'WriteError', reason: 'DirectoryNotFoundException', fqid: 'NewItemIOError' });
    }
    const existing = Win.state.fs.find(n => n.parent === parent && n.name.toLowerCase() === tail.toLowerCase());
    if (existing && !a.Force) {
      return psError(s, 'New-Item', `The file '${full}' already exists.`, { target: full, category: 'WriteError', reason: 'IOException', fqid: 'NewItemIOError' });
    }
    if (Win.FS.validName(tail)) return psError(s, 'New-Item', 'The filename, directory name, or volume label syntax is incorrect.', { target: full, category: 'WriteError', reason: 'IOException', fqid: 'NewItemIOError' });
    let node = existing;
    if (existing) Win.FS.write(existing.id, a.Value || '');
    else node = Win.FS.create(parent, tail, 'file', { content: a.Value || '' });
    return psListing(parent, [node]);
  }

  function writeFile(s, target, text, append) {
    const [head, tail] = splitPath(target);
    const parent = head ? resolve(s, head) : s.cwd;
    if (!parent || !tail) return 'The system cannot find the path specified.';
    const content = text.replace(/\r?\n/g, '\r\n');
    const existing = Win.state.fs.find(n => n.parent === parent && n.name.toLowerCase() === tail.toLowerCase());
    if (existing) {
      if (Win.FS.isFolder(existing)) return 'Access is denied.';
      Win.FS.write(existing.id, append ? (existing.content || '') + content : content);
    } else {
      Win.FS.create(parent, tail, 'file', { content });
    }
    return '';
  }

  function setContent(tokens, s, ctx) {
    const cmd = ctx.canonical;
    const a = psArgs(tokens, { named: ['Path', 'Value', 'Encoding'], switches: ['Force', 'NoNewline'], positional: ['Path', 'Value'] });
    if (a.bad) return badParam(s, cmd, a.bad);
    if (!a.Path) return '';
    const value = a._.slice(a.Value === a._[1] ? 1 : 2).length && a.Value === a._[1] ? a._.slice(1).join('\n') : (a.Value ?? '');
    const problem = writeFile(s, a.Path, `${value}${a.NoNewline ? '' : '\n'}`, cmd === 'Add-Content');
    if (problem) { const full = absPath(s, a.Path); return psError(s, cmd, `Could not find a part of the path '${full}'.`, { target: full, category: 'WriteError', reason: 'DirectoryNotFoundException', fqid: 'GetContentWriterDirectoryNotFoundError' }); }
    return '';
  }

  function removeItem(tokens, s, ctx) {
    const cmd = s.profile === 'cmd';
    const rd = ['rd', 'rmdir'].includes(ctx.name) && cmd;
    const names = cmd ? cmdArgs(tokens) : psArgs(tokens, { named: ['Path', 'LiteralPath', 'Filter'], switches: ['Recurse', 'Force', 'Confirm', 'WhatIf'], positional: ['Path'] })._;
    const a = cmd ? null : psArgs(tokens, { named: ['Path', 'LiteralPath', 'Filter'], switches: ['Recurse', 'Force', 'Confirm', 'WhatIf'], positional: ['Path'] });
    if (a?.bad) return badParam(s, 'Remove-Item', a.bad);
    const flags = cmd ? cmdFlags(tokens) : [];
    if (!names.length) return cmd ? 'The syntax of the command is incorrect.' : psError(s, 'Remove-Item', 'Cannot bind argument to parameter \'Path\' because it is null.', { category: 'InvalidData', reason: 'ParameterBindingValidationException', fqid: 'ParameterArgumentValidationErrorNullNotAllowed' });
    const out = [];
    for (const name of names) {
      const loc = wild(name) ? locate(s, name) : null;
      const ids = loc && !loc.missing && loc.pattern
        ? Win.FS.children(loc.dir, { hidden: false }).filter(n => loc.pattern.test(n.name)).map(n => n.id)
        : [resolve(s, name)].filter(Boolean);
      const full = absPath(s, name);
      if (!ids.length) {
        if (cmd) out.push(err(rd ? 'The system cannot find the file specified.' : `Could Not Find ${full}`));
        else out.push(psError(s, 'Remove-Item', `Cannot find path '${full}' because it does not exist.`, { target: full }));
        continue;
      }
      for (const id of ids) {
        const node = Win.FS.get(id);
        if (node.system || node.kind === 'drive' || id === 'home' || Win.FS.contains(id, s.cwd) || id === s.cwd) {
          if (cmd) out.push(err('Access is denied.'));
          else out.push(psError(s, 'Remove-Item', `Cannot remove item ${fsPath(id)}: Access to the path '${fsPath(id)}' is denied.`, { target: fsPath(id), category: 'PermissionDenied', reason: 'IOException', fqid: 'RemoveFileSystemItemUnAuthorizedAccess' }));
          continue;
        }
        if (Win.FS.isFolder(node)) {
          if (cmd && !rd) {
            /* del on a folder removes the files inside it. */
            Win.FS.children(id, { hidden: true }).filter(n => !Win.FS.isFolder(n)).forEach(n => Win.FS.purge(n.id));
            continue;
          }
          const hasKids = Win.FS.children(id, { hidden: true }).length > 0;
          if (cmd && hasKids && !flags.includes('/s')) { out.push(err('The directory is not empty.')); continue; }
          if (!cmd && hasKids && !a.Recurse) {
            out.push(psError(s, 'Remove-Item', `The item at ${fsPath(id)} has children and the Recurse parameter was not specified. If you continue, all children will be removed with the item.`,
              { target: fsPath(id), category: 'WriteError', reason: 'IOException', fqid: 'DirectoryNotEmpty' }));
            continue;
          }
        } else if (rd) {
          out.push(err('The directory name is invalid.'));
          continue;
        }
        Win.FS.purge(id);
      }
    }
    return out;
  }

  function renameItem(tokens, s) {
    const cmd = s.profile === 'cmd';
    let src;
    let dest;
    if (cmd) [src, dest] = cmdArgs(tokens);
    else {
      const a = psArgs(tokens, { named: ['Path', 'NewName', 'LiteralPath'], switches: ['Force', 'PassThru'], positional: ['Path', 'NewName'] });
      if (a.bad) return badParam(s, 'Rename-Item', a.bad);
      src = a.Path || a.LiteralPath; dest = a.NewName;
    }
    if (!src || !dest) return cmd ? 'The syntax of the command is incorrect.' : '';
    const id = resolve(s, src);
    const full = absPath(s, src);
    if (!id) return cmd ? 'The system cannot find the file specified.' : psError(s, 'Rename-Item', `Cannot rename because item at '${full}' does not exist.`, { target: '', category: 'InvalidOperation', reason: 'PSInvalidOperationException', fqid: 'InvalidOperation' });
    if (Win.FS.get(id).system) return cmd ? 'Access is denied.' : psError(s, 'Rename-Item', `Access to the path '${full}' is denied.`, { target: full, category: 'PermissionDenied', reason: 'IOException', fqid: 'RenameItemUnauthorizedAccess' });
    const problem = Win.FS.rename(id, dest.replace(/^.*[\\/]/, ''));
    if (problem) {
      if (cmd) return problem.startsWith('There is already') ? 'A duplicate file name exists, or the file\ncannot be found.' : 'The syntax of the command is incorrect.';
      return psError(s, 'Rename-Item', problem.startsWith('There is already') ? 'Cannot create a file when that file already exists.' : problem, { target: full, category: 'WriteError', reason: 'IOException', fqid: 'RenameItemIOError' });
    }
    return '';
  }

  function transfer(tokens, s, ctx, kind) {
    const cmd = s.profile === 'cmd';
    const label = kind === 'copy' ? 'Copy-Item' : 'Move-Item';
    let src;
    let dest;
    let recurse = true;
    if (cmd) [src, dest] = cmdArgs(tokens);
    else {
      const a = psArgs(tokens, { named: ['Path', 'Destination', 'LiteralPath'], switches: ['Recurse', 'Force', 'PassThru', 'Container'], positional: ['Path', 'Destination'] });
      if (a.bad) return badParam(s, label, a.bad);
      src = a.Path || a.LiteralPath; dest = a.Destination; recurse = !!a.Recurse || kind === 'move';
    }
    if (!src) return cmd ? 'The syntax of the command is incorrect.' : '';
    const loc = wild(src) ? locate(s, src) : null;
    const ids = loc?.pattern && !loc.missing ? Win.FS.children(loc.dir, { hidden: false }).filter(n => loc.pattern.test(n.name) && !Win.FS.isFolder(n)).map(n => n.id) : [resolve(s, src)].filter(Boolean);
    const full = absPath(s, src);
    if (!ids.length) {
      return cmd ? 'The system cannot find the file specified.' : psError(s, label, `Cannot find path '${full}' because it does not exist.`, { target: full });
    }
    let parent = dest ? resolve(s, dest) : s.cwd;
    let newName = null;
    if (!parent || !Win.FS.isFolder(Win.FS.get(parent))) {
      const [head, tail] = splitPath(dest || '');
      parent = head ? resolve(s, head) : s.cwd;
      newName = tail;
      if (!parent || !Win.FS.isFolder(Win.FS.get(parent)) || ids.length > 1) {
        return cmd ? 'The system cannot find the path specified.' : psError(s, label, `Could not find a part of the path '${absPath(s, dest)}'.`, { target: absPath(s, dest), category: 'WriteError', reason: 'DirectoryNotFoundException', fqid: kind === 'copy' ? 'CopyDirectoryInfoItemIOError' : 'MoveDirectoryItemIOError' });
      }
    }
    let files = 0;
    let dirs = 0;
    for (const id of ids) {
      const node = Win.FS.get(id);
      if (node.system && kind === 'move') return cmd ? 'Access is denied.' : psError(s, label, `Access to the path '${fsPath(id)}' is denied.`, { target: fsPath(id), category: 'PermissionDenied', reason: 'IOException', fqid: 'MoveFileInfoItemUnauthorizedAccessError' });
      const target = newName || node.name;
      const clash = Win.state.fs.find(n => n.parent === parent && n.name.toLowerCase() === target.toLowerCase() && n.id !== id);
      if (clash && !Win.FS.isFolder(clash)) Win.FS.purge(clash.id);
      if (kind === 'copy') {
        if (Win.FS.isFolder(node) && cmd) {
          Win.FS.children(id, { hidden: false }).filter(n => !Win.FS.isFolder(n)).forEach(n => { Win.FS.copy(n.id, parent); files += 1; });
          continue;
        }
        const dupe = Win.FS.copy(id, parent);
        if (!dupe) continue;
        if (Win.FS.isFolder(node) && !recurse) Win.FS.children(dupe.id, { hidden: true }).forEach(n => Win.FS.purge(n.id));
        if (dupe.name !== target) Win.FS.rename(dupe.id, target);
        files += 1;
      } else {
        if (!Win.FS.move(id, parent)) { if (cmd) return 'Access is denied.'; continue; }
        if (Win.FS.get(id).name !== target) Win.FS.rename(id, target);
        if (Win.FS.isFolder(node)) dirs += 1; else files += 1;
      }
    }
    if (!cmd) return '';
    if (kind === 'copy') return `        ${files} file(s) copied.`;
    return dirs ? `        ${dirs} dir(s) moved.` : `        ${files} file(s) moved.`;
  }

  function tree(tokens, s) {
    const flags = cmdFlags(tokens);
    const files = flags.includes('/f');
    const ascii = flags.includes('/a');
    const target = cmdArgs(tokens)[0];
    const id = target ? resolve(s, target) : s.cwd;
    if (!id || !Win.FS.isFolder(Win.FS.get(id))) return `Invalid path - ${target ? absPath(s, target).toUpperCase().slice(2) : ''}\nNo subfolders exist \n`;
    const [mid, last, bar] = ascii ? ['+---', '\\---', '|   '] : ['\u251c\u2500\u2500\u2500', '\u2514\u2500\u2500\u2500', '\u2502   '];
    const drive = Win.FS.driveOf(id);
    const lines = ['Folder PATH listing', `Volume serial number is ${serial(drive?.letter || 'C')}`, fsPath(id).toUpperCase()];
    let any = false;
    const walk = (folder, prefix) => {
      const kids = sortByName(Win.FS.children(folder, { hidden: false }));
      const subs = kids.filter(Win.FS.isFolder);
      if (files) {
        const fl = kids.filter(n => !Win.FS.isFolder(n));
        fl.forEach(f => lines.push(`${prefix}${subs.length ? bar : '    '}${f.name}`));
        if (fl.length) lines.push(`${prefix}${subs.length ? bar : '    '}`.trimEnd() || '');
      }
      subs.forEach((f, i) => {
        any = true;
        const end = i === subs.length - 1;
        lines.push(`${prefix}${end ? last : mid}${f.name}`);
        walk(f.id, prefix + (end ? '    ' : bar));
      });
    };
    walk(id, '');
    if (!any) lines.push('No subfolders exist ', '');
    return lines.join('\n');
  }

  /* --------------------------------------------------------------- network */

  const connected = () => !!Win.Network.current();
  const cfg = () => (machine.released ? null : Win.Network.config());

  const label = (name, value = '') => {
    let text = name;
    const special = { 'Connection-specific DNS Suffix': 'Connection-specific DNS Suffix  . ', 'Primary Dns Suffix': 'Primary Dns Suffix  . . . . . . . ' };
    if (special[name]) text = special[name];
    else for (let i = name.length; i < 34; i += 1) text += i % 2 === 0 ? '.' : ' ';
    return `   ${text}: ${value}`.replace(/\s+$/, '');
  };

  const extra = value => `${' '.repeat(39)}${value}`;

  function leaseText(t) {
    const d = new Date(t);
    return `${longDate(d)} ${longTime(d)}`;
  }

  function wifiBlock(all) {
    const n = Win.state.network;
    if (!n.adapterEnabled.wifi) return [];
    const net = Win.Network.current();
    const lines = ['Wireless LAN adapter Wi-Fi:', ''];
    if (!net) {
      lines.push(label('Media State', 'Media disconnected'), label('Connection-specific DNS Suffix'));
      if (all) {
        lines.push(label('Description', Win.Network.ADAPTER.description), label('Physical Address', Win.Network.mac()),
          label('DHCP Enabled', 'Yes'), label('Autoconfiguration Enabled', 'Yes'));
      }
      return lines;
    }
    const c = Win.Network.config();
    const released = machine.released;
    const apipa = c.ip.startsWith('169.254.');
    lines.push(label('Connection-specific DNS Suffix', released ? '' : c.suffix));
    if (all) {
      lines.push(label('Description', Win.Network.ADAPTER.description), label('Physical Address', Win.Network.mac(net.ssid)),
        label('DHCP Enabled', c.dhcp ? 'Yes' : 'No'), label('Autoconfiguration Enabled', 'Yes'));
    }
    lines.push(label('Link-local IPv6 Address', `${c.ipv6}${all ? '(Preferred)' : ''}`));
    if (!released) {
      lines.push(label(apipa ? 'Autoconfiguration IPv4 Address' : 'IPv4 Address', `${c.ip}${all ? '(Preferred)' : ''}`));
      lines.push(label('Subnet Mask', apipa ? '255.255.0.0' : c.mask));
      if (all && c.dhcp) {
        lines.push(label('Lease Obtained', leaseText(c.leaseObtained)), label('Lease Expires', leaseText(c.leaseObtained + 86400000)));
      }
    }
    lines.push(label('Default Gateway', released || apipa ? '' : c.gateway));
    if (all) {
      if (c.dhcp && !released) lines.push(label('DHCP Server', c.dhcpServer));
      lines.push(label('DHCPv6 IAID', '112771824'), label('DHCPv6 Client DUID', `00-01-00-01-2E-8C-41-9A-${Win.Network.ADAPTER.mac}`));
      const dns = released ? ['fec0:0:0:ffff::1%1', 'fec0:0:0:ffff::2%1'] : c.dns.length ? c.dns : [c.router];
      lines.push(label('DNS Servers', dns[0]));
      dns.slice(1).forEach(d => lines.push(extra(d)));
      lines.push(label('NetBIOS over Tcpip', 'Enabled'));
    }
    return lines;
  }

  function disconnectedBlock(title, all, description, mac) {
    const lines = [title, '', label('Media State', 'Media disconnected'), label('Connection-specific DNS Suffix')];
    if (all) lines.push(label('Description', description), label('Physical Address', mac), label('DHCP Enabled', 'Yes'), label('Autoconfiguration Enabled', 'Yes'));
    return lines;
  }

  function ipconfigBlocks(all) {
    const n = Win.state.network;
    const blocks = [];
    if (n.adapterEnabled.wifi) {
      blocks.push(disconnectedBlock('Wireless LAN adapter Local Area Connection* 1:', all, 'Microsoft Wi-Fi Direct Virtual Adapter', '06-C3-F0-5E-12-9B'));
      blocks.push(disconnectedBlock('Wireless LAN adapter Local Area Connection* 2:', all, 'Microsoft Wi-Fi Direct Virtual Adapter #2', '0E-C3-F0-5E-12-9B'));
      blocks.push(wifiBlock(all));
    }
    if (n.adapterEnabled.bluetoothPan !== false) {
      blocks.push(disconnectedBlock('Ethernet adapter Bluetooth Network Connection:', all, 'Bluetooth Device (Personal Area Network)', 'A4-C3-F0-5E-12-9C'));
    }
    return blocks;
  }

  function ipconfig(tokens, s) {
    const flags = cmdFlags(tokens).concat(tokens.filter(t => /^-\w/.test(t.v)).map(t => `/${t.v.slice(1).toLowerCase()}`));
    const op = flags[0] || '';
    const head = '\nWindows IP Configuration\n';
    const blocks = all => ipconfigBlocks(all).map(b => b.join('\n')).join('\n\n');
    if (!op) return `${head}\n\n${blocks(false)}\n`;
    if (op === '/all') {
      const c = cfg();
      const top = [
        label('Host Name', hostName()), label('Primary Dns Suffix'), label('Node Type', 'Hybrid'),
        label('IP Routing Enabled', 'No'), label('WINS Proxy Enabled', 'No'),
      ];
      if (c?.suffix) top.push(label('DNS Suffix Search List', c.suffix));
      return `${head}\n${top.join('\n')}\n\n${blocks(true)}\n`;
    }
    if (op === '/flushdns') { machine.dns.clear(); return `${head}\nSuccessfully flushed the DNS Resolver Cache.\n`; }
    if (op === '/displaydns') {
      if (!machine.dns.size) return `${head}\nCould not display the DNS Resolver Cache.\n`;
      const rows = [...machine.dns].map(([name, ip]) => [
        `    ${name}`, '    ----------------------------------------',
        `    Record Name . . . . . : ${name}`, '    Record Type . . . . . : 1',
        `    Time To Live  . . . . : ${200 + (hash(name) % 3200)}`, '    Data Length . . . . . : 4',
        '    Section . . . . . . . : Answer', `    A (Host) Record . . . : ${ip}`, '', ''].join('\n'));
      return `${head}\n${rows.join('')}`;
    }
    if (op === '/registerdns') {
      return `${head}\nRegistration of the DNS resource records for all adapters of this computer has been initiated. Any errors will be reported in the Event Viewer in 15 minutes.\n`;
    }
    if (op === '/release' || op === '/renew') {
      if (!s.admin) return `${head}\nThe requested operation requires elevation.\n`;
      if (!Win.state.network.adapterEnabled.wifi) return `${head}\nThe operation failed as no adapter is in the state permissible for\nthis operation.\n`;
      const net = Win.Network.current();
      const lines = [head];
      lines.push('No operation can be performed on Local Area Connection* 1 while it has its media disconnected.');
      lines.push('No operation can be performed on Local Area Connection* 2 while it has its media disconnected.');
      if (!net) {
        lines.push('No operation can be performed on Wi-Fi while it has its media disconnected.');
        lines.push('No operation can be performed on Bluetooth Network Connection while it has its media disconnected.');
        return `${lines.join('\n')}\n`;
      }
      const c = Win.Network.config();
      if (!c.dhcp) {
        lines.push('No operation can be performed on Bluetooth Network Connection while it has its media disconnected.');
        return `${head}\nThe operation failed as no adapter is in the state permissible for\nthis operation.\n`;
      }
      lines.push('No operation can be performed on Bluetooth Network Connection while it has its media disconnected.');
      if (op === '/release') machine.released = true;
      if (op === '/renew') {
        if (!net.internet && c.ip.startsWith('169.254.')) {
          return `${lines.join('\n')}\nAn error occurred while renewing interface Wi-Fi : unable to contact your DHCP server. Request has timed out.\n`;
        }
        machine.released = false;
      }
      const result = `${lines.join('\n')}\n\n${blocks(false)}\n`;
      return op === '/renew' ? stream((function* () { yield { text: result, delay: 1800 }; })()) : result;
    }
    return `\nError: unrecognized or incomplete command line.\n\nUSAGE:\n    ipconfig [/allcompartments] [/? | /all |\n                                 /renew [adapter] | /release [adapter] |\n                                 /renew6 [adapter] | /release6 [adapter] |\n                                 /flushdns | /displaydns | /registerdns |\n                                 /showclassid adapter |\n                                 /setclassid adapter [classid] |\n                                 /showclassid6 adapter |\n                                 /setclassid6 adapter [classid] ]\n`;
  }

  const TTL = { '142.250.72.14': 117, '142.250.72.36': 117, '8.8.8.8': 117, '8.8.4.4': 117, '1.1.1.1': 57, '1.0.0.1': 57, '9.9.9.9': 56, '185.15.59.224': 55, '13.107.21.237': 117, '204.79.197.203': 117, '20.70.246.20': 106 };
  const ttlFor = (ip, c) => (ip === c?.router ? 64 : TTL[ip] || [52, 54, 55, 56, 57, 116, 117, 118][hash(ip) % 8]);

  function noteDns(host, ip) {
    if (!host || isIPv4(host) || !ip) return;
    machine.dns.set(String(host).toLowerCase(), ip);
  }

  function ping(tokens, s) {
    let count = 4;
    let forever = false;
    let size = 32;
    let target = '';
    for (let i = 0; i < tokens.length; i += 1) {
      const v = tokens[i].v.toLowerCase();
      if (v === '-n' || v === '/n') { count = Math.max(1, parseInt(tokens[++i]?.v, 10) || 4); continue; }
      if (v === '-l' || v === '/l') { size = Math.max(0, Math.min(65500, parseInt(tokens[++i]?.v, 10) || 32)); continue; }
      if (v === '-w' || v === '/w' || v === '-i' || v === '/i') { i += 1; continue; }
      if (v === '-t' || v === '/t') { forever = true; continue; }
      if (/^[-/][46afr]$/.test(v)) continue;
      if (/^[-/]/.test(v)) return `Bad option ${tokens[i].v}.`;
      target = tokens[i].v;
    }
    if (!target) {
      return '\nUsage: ping [-t] [-a] [-n count] [-l size] [-f] [-i TTL] [-v TOS]\n            [-r count] [-s count] [[-j host-list] | [-k host-list]]\n            [-w timeout] [-R] [-S srcaddr] [-c compartment] [-p]\n            [-4] [-6] target_name\n\nOptions:\n    -t             Ping the specified host until stopped.\n                   To see statistics and continue - type Control-Break;\n                   To stop - type Control-C.\n    -n count       Number of echo requests to send.\n    -l size        Send buffer size.\n    -w timeout     Timeout in milliseconds to wait for each reply.\n    -4             Force using IPv4.\n';
    }
    const lower = target.toLowerCase();
    const loop6 = lower === 'localhost' || lower === '::1' || lower === hostName().toLowerCase();
    const loop4 = lower === '127.0.0.1';
    const ip4 = isIPv4(target);
    let r;
    if (loop6 || loop4) r = { ok: true, ip: loop4 ? '127.0.0.1' : '::1', replies: [0] };
    else if (machine.released) r = { ok: false, error: ip4 ? 'general' : 'host' };
    else r = Win.Network.ping(target, 32);
    if (!r.ok && (r.error === 'host' || (r.error === 'general' && !ip4))) {
      return `Ping request could not find host ${target}. Please check the name and try again.`;
    }
    const ip = r.ip || target;
    if (r.ok || r.ip) noteDns(target, ip);
    const c = Win.Network.config();
    const shown = ip4 || loop4 ? ip : loop6 ? `${hostName()} [::1]` : `${target} [${ip}]`;
    const sent = { n: 0, ok: 0, real: [] };
    const ttl = ttlFor(ip, c);
    const line = i => {
      if (r.ok) {
        const ms = r.replies[i % r.replies.length];
        sent.ok += 1;
        sent.real.push(ms);
        if (ip === '::1') return `Reply from ::1: time<1ms`;
        return `Reply from ${ip}: bytes=${size} ${ms ? `time=${ms}ms` : 'time<1ms'} TTL=${ip === '127.0.0.1' ? 128 : ttl}`;
      }
      if (r.error === 'unreachable') { sent.ok += 1; return `Reply from ${r.from || c?.ip || '0.0.0.0'}: Destination host unreachable.`; }
      if (r.error === 'timeout') return 'Request timed out.';
      return 'PING: transmit failed. General failure. ';
    };
    const delay = r.ok || r.error === 'unreachable' ? 1000 : r.error === 'timeout' ? 4000 : 500;
    const stats = () => {
      const lost = sent.n - sent.ok;
      const lines = ['', `Ping statistics for ${ip}:`, `    Packets: Sent = ${sent.n}, Received = ${sent.ok}, Lost = ${lost} (${sent.n ? Math.floor((lost * 100) / sent.n) : 0}% loss),`];
      if (sent.real.length) {
        const min = Math.min(...sent.real);
        const max = Math.max(...sent.real);
        const avg = Math.floor(sent.real.reduce((x, y) => x + y, 0) / sent.real.length);
        lines.push('Approximate round trip times in milli-seconds:', `    Minimum = ${min}ms, Maximum = ${max}ms, Average = ${avg}ms`);
      }
      return `${lines.join('\n')}\n`;
    };
    function* run() {
      yield { text: `\nPinging ${shown} with ${size} bytes of data:\n`, delay: 30 };
      for (let i = 0; forever || i < count; i += 1) {
        const first = i === 0 && (r.ok || r.error === 'general');
        sent.n += 1;
        yield { text: `${line(i)}\n`, delay: first ? 20 : delay };
      }
      yield { text: stats(), delay: 0 };
    }
    return stream(run(), () => ({ text: `${stats()}Control-C\n^C\n` }));
  }

  const SERVER_NAMES = { '8.8.8.8': 'dns.google', '8.8.4.4': 'dns.google', '1.1.1.1': 'one.one.one.one', '1.0.0.1': 'one.one.one.one', '9.9.9.9': 'dns9.quad9.net', '149.112.112.112': 'dns.quad9.net', '208.67.222.222': 'dns.opendns.com', '208.67.220.220': 'dns.opendns.com' };

  /** Resolve through a specific, reachable resolver even when the configured one is broken. */
  function resolveVia(host) {
    const net = Win.Network.current();
    const p = net && Win.Network.profile(net.ssid);
    if (!p || p.dnsMode !== 'manual') return Win.Network.resolve(host);
    const saved = { dnsMode: p.dnsMode, dns: p.dns };
    p.dnsMode = 'auto';
    try { return Win.Network.resolve(host); } finally { p.dnsMode = saved.dnsMode; p.dns = saved.dns; }
  }

  function nslookup(tokens, s) {
    const args = tokens.map(t => t.v).filter(v => !/^-/.test(v));
    const [host, serverArg] = args;
    const reason = Win.Network.reason();
    const c = cfg();
    const offline = machine.released || ['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'].includes(reason);
    if (offline) {
      const lines = ['*** Default servers are not available', 'Server:  UnKnown', 'Address:  127.0.0.1', ''];
      if (host) lines.push(`*** UnKnown can't find ${host}: No response from server`);
      return `${lines.join('\n')}\n`;
    }
    const server = serverArg || c.dns[0] || c.router;
    const reachable = ip => !['no-internet', 'apipa', 'no-gateway'].includes(reason) ? (ip === c.router || Win.Network.RESOLVERS.has(ip)) : (ip === c.router && reason === 'no-internet' ? false : false);
    const name = SERVER_NAMES[server] || 'UnKnown';
    const timeout = 'DNS request timed out.\n    timeout was 2 seconds.\n';
    if (!reachable(server)) {
      const out = `${timeout}Server:  UnKnown\nAddress:  ${server}\n\n`;
      if (!host) return `${out}`;
      return stream((function* () {
        yield { text: timeout, delay: 2000 };
        yield { text: `Server:  UnKnown\nAddress:  ${server}\n\n`, delay: 0 };
        yield { text: timeout, delay: 2000 };
        yield { text: timeout, delay: 2000 };
        yield { text: `*** Request to UnKnown timed-out\n`, delay: 0 };
      })());
    }
    const head = `Server:  ${name}\nAddress:  ${server}\n\n`;
    if (!host) return head;
    const r = serverArg ? resolveVia(host) : Win.Network.resolve(host);
    if (!r.ok) return `${head}*** ${name} can't find ${host}: Non-existent domain\n`;
    noteDns(host, r.ip);
    if (isIPv4(host)) return `${head}*** ${name} can't find ${host}: Non-existent domain\n`;
    return `${head}Non-authoritative answer:\nName:    ${host}\nAddress:  ${r.ip}\n\n`;
  }

  function tracert(tokens, s) {
    const args = tokens.map(t => t.v);
    const numeric = args.some(a => /^[-/]d$/i.test(a));
    const target = args.filter(a => !/^[-/]/.test(a)).pop();
    if (!target) return '\nUsage: tracert [-d] [-h maximum_hops] [-j host-list] [-w timeout]\n               [-R] [-S srcaddr] [-4] [-6] target_name\n';
    const reason = Win.Network.reason();
    const ip4 = isIPv4(target);
    const offline = machine.released || ['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'].includes(reason);
    if (!ip4) {
      const r = machine.released ? { ok: false } : Win.Network.resolve(target);
      if (!r.ok) return `Unable to resolve target system name ${target}.`;
    }
    const ip = ip4 ? target : Win.Network.resolve(target).ip;
    const c = Win.Network.config();
    const headline = ip4 ? `\nTracing route to ${ip} over a maximum of 30 hops\n\n` : `\nTracing route to ${target} [${ip}]\nover a maximum of 30 hops:\n\n`;
    const ms = n => `  ${String(n).padStart(4)} ms`;
    const star = '     *   ';
    const hop = (n, times, host) => `${String(n).padStart(3)}${times.map(t => (t == null ? star : ms(t))).join('')}  ${host}\n`;
    function* run() {
      yield { text: headline, delay: 20 };
      if (offline) { yield { text: 'Transmit error: code 1231.\n\nTrace complete.\n', delay: 600 }; return; }
      const blocked = ['no-internet', 'apipa', 'no-gateway'].includes(reason);
      if (reason === 'apipa' || reason === 'no-gateway') {
        yield { text: `  1  ${c.ip}  reports: Destination host unreachable.\n\nTrace complete.\n`, delay: 3000 };
        return;
      }
      yield { text: hop(1, [2, 1, 1], c.router), delay: 700 };
      if (ip === c.router) { yield { text: '\nTrace complete.\n', delay: 0 }; return; }
      if (blocked) {
        for (let n = 2; n <= 30; n += 1) yield { text: `${String(n).padStart(3)}${star}${star}${star}  Request timed out.\n`, delay: 1500 };
        yield { text: '\nTrace complete.\n', delay: 0 };
        return;
      }
      const base = 9 + (hash(ip) % 20);
      const hops = [
        [[base - 1, base, base - 2], numeric ? '100.72.0.1' : '100.72.0.1'],
        [null, 'Request timed out.'],
        [[base + 2, base + 1, base + 3], numeric ? '198.51.100.14' : 'be-21.core1.sablewave.example [198.51.100.14]'],
        [[base + 4, base + 3, base + 4], numeric ? '198.51.100.62' : 'ae-3.edge2.sablewave.example [198.51.100.62]'],
        [[base + 5, base + 6, base + 5], numeric ? '192.0.2.18' : 'ix-peer.exchange.example [192.0.2.18]'],
      ];
      let n = 2;
      for (const [times, host] of hops) {
        yield { text: times ? hop(n, times, host) : `${String(n).padStart(3)}${star}${star}${star}  ${host}\n`, delay: times ? 650 : 4000 };
        n += 1;
      }
      const t = [base + 6, base + 7, base + 6];
      yield { text: hop(n, t, ip4 || numeric ? ip : `${target} [${ip}]`), delay: 650 };
      yield { text: '\nTrace complete.\n', delay: 0 };
    }
    return stream(run());
  }

  function signalPct(net) { return [0, 38, 61, 82, 96][net.signal] || 50; }

  function netsh(tokens, s) {
    const words = tokens.map(t => t.v);
    const low = words.map(w => w.toLowerCase());
    const n = Win.state.network;
    const named = key => {
      const hit = words.find(w => w.toLowerCase().startsWith(`${key}=`));
      return hit ? hit.slice(key.length + 1) : null;
    };
    const ctx = low[0];
    const elevate = 'The requested operation requires elevation (Run as administrator).\n';
    if (!ctx) return '\nUsage: netsh [-a AliasFile] [-c Context] [-r RemoteMachine] [-u [DomainName\\]UserName] [-p Password | *]\n             [Command | -f ScriptFile]\n\nThe following commands are available:\n\nCommands in this context:\n?              - Displays a list of commands.\nadvfirewall    - Changes to the `netsh advfirewall\' context.\ninterface      - Changes to the `netsh interface\' context.\nwinhttp        - Changes to the `netsh winhttp\' context.\nwinsock        - Changes to the `netsh winsock\' context.\nwlan           - Changes to the `netsh wlan\' context.\n';
    if (ctx === 'winsock' && low[1] === 'reset') {
      if (!s.admin) return elevate;
      return '\nSucessfully reset the Winsock Catalog.\nYou must restart the computer in order to complete the reset.\n\n';
    }
    if ((ctx === 'int' || ctx === 'interface') && ['ip', 'ipv4', 'tcp'].includes(low[1]) && low[2] === 'reset') {
      if (!s.admin) return elevate;
      const parts = ['Compartment Forwarding', 'Compartment', 'Control Protocol', 'Echo Sequence Request', 'Global', 'Interface', 'Anycast Address',
        'Multicast Address', 'Unicast Address', 'Neighbor', 'Path', 'Potential', 'Prefix Policy', 'Proxy Neighbor', 'Route', 'Site Prefix',
        'Subinterface', 'Wakeup Pattern', 'Resolve Neighbor', ''];
      return `${parts.map(p => `Resetting ${p}, OK!`).join('\n')}\nRestart the computer to complete this action.\n\n`;
    }
    if ((ctx === 'int' || ctx === 'interface') && low[1] === 'show' && low[2]?.startsWith('int')) {
      const wifiState = !n.adapterEnabled.wifi ? ['Disabled', 'Disconnected'] : connected() ? ['Enabled', 'Connected'] : ['Enabled', 'Disconnected'];
      return `\nAdmin State    State          Type             Interface Name\n-------------------------------------------------------------------------\n${wifiState[0].padEnd(15)}${wifiState[1].padEnd(15)}Dedicated        Wi-Fi\nEnabled        Disconnected   Dedicated        Bluetooth Network Connection\n\n`;
    }
    if (ctx === 'winhttp' && low[1] === 'show' && low[2] === 'proxy') return '\nCurrent WinHTTP proxy settings:\n\n    Direct access (no proxy server).\n\n';
    if (ctx === 'winhttp' && low[1] === 'reset' && low[2] === 'proxy') return s.admin ? '\nCurrent WinHTTP proxy settings:\n\n    Direct access (no proxy server).\n\n' : 'Error writing proxy settings. (5) Access is denied.\n\n';
    if (ctx === 'wlan') {
      if (!n.adapterEnabled.wifi) return '\nThe Wireless AutoConfig Service (wlansvc) is not running.\n';
      const verb = low[1];
      const what = low[2] || '';
      if (verb === 'show' && what.startsWith('interface')) {
        const net = Win.Network.current();
        const radio = Win.Network.radioOn();
        const lines = ['', 'There is 1 interface on the system: ', '',
          '    Name                   : Wi-Fi',
          `    Description            : ${Win.Network.ADAPTER.description}`,
          '    GUID                   : 3f2b8c1e-7a4d-4c11-9e2b-5d6a0f1c7b42',
          `    Physical address       : ${Win.Network.mac().toLowerCase().replace(/-/g, ':')}`,
          '    Interface type         : Primary',
          `    State                  : ${net ? 'connected' : 'disconnected'}`];
        if (net) {
          const p = Win.Network.profile(net.ssid);
          const rate = net.protocol.includes('6E') ? 1201 : net.protocol.includes('ac') ? 866 : 144;
          lines.push(
            `    SSID                   : ${net.ssid}`,
            `    AP BSSID               : 3c:84:6a:${(hash(net.ssid) % 256).toString(16).padStart(2, '0')}:9e:04`,
            `    Band                   : ${net.band}`,
            `    Channel                : ${net.channel}`,
            '    Network type           : Infrastructure',
            `    Radio type             : ${net.protocol.match(/\((.*)\)/)?.[1] || '802.11ax'}`,
            `    Authentication         : ${net.security === 'Open' ? 'Open' : net.security}`,
            `    Cipher                 : ${net.security === 'Open' ? 'None' : 'CCMP'}`,
            `    Connection mode        : ${p?.auto ? 'Auto Connect' : 'Profile'}`,
            `    Receive rate (Mbps)    : ${rate}`,
            `    Transmit rate (Mbps)   : ${rate}`,
            `    Signal                 : ${signalPct(net)}%`,
            `    Profile                : ${net.ssid}`,
            '',
            '    QoS MSCS Configured         : 0',
            '    QoS Map Configured          : 0',
            '    QoS Map Allowed by Policy   : 0');
        } else {
          lines.push(`    Radio status           : Hardware On`, `                             Software ${radio ? 'On' : 'Off'}`);
        }
        lines.push('', '    Hosted network status  : Not available', '');
        return lines.join('\n');
      }
      if (verb === 'show' && (what === 'profiles' || (what === 'profile' && !named('name') && !words[3]))) {
        const rows = n.known.map(k => `    All User Profile     : ${k.ssid}`);
        return `\nProfiles on interface Wi-Fi:\n\n\nGroup policy profiles (read only)\n---------------------------------\n    <None>\n\nUser profiles\n-------------\n${rows.join('\n') || '    <None>'}\n\n`;
      }
      if (verb === 'show' && what === 'profile') {
        const name = named('name') || words.slice(3).filter(w => !w.includes('=')).join(' ');
        const p = n.known.find(k => k.ssid.toLowerCase() === String(name).toLowerCase());
        if (!p) return `Profile "${name}" is not found on the system.\n`;
        const scan = Win.Network.lookup(p.ssid);
        const clear = (named('key') || '').toLowerCase() === 'clear';
        const sec = scan?.security || (p.password ? 'WPA2-Personal' : 'Open');
        return [
          '', `Profile ${p.ssid} on interface Wi-Fi: `,
          '=======================================================================', '',
          'Applied: All User Profile    ', '',
          'Profile information ', '------------------- ',
          '    Version                : 1',
          '    Type                   : Wireless LAN',
          `    Name                   : ${p.ssid}`,
          '    Control options        : ',
          `        Connection mode    : ${p.auto ? 'Connect automatically' : 'Connect manually'}`,
          '        Network broadcast  : Connect only if this network is broadcasting',
          '        AutoSwitch         : Do not switch to other networks',
          `        MAC Randomization  : ${p.randomMac === 'Off' ? 'Disabled' : 'Enabled'}`, '',
          'Connectivity settings ', '--------------------- ',
          '    Number of SSIDs        : 1',
          `    SSID name              : "${p.ssid}"`,
          `    Network type           : Infrastructure`,
          `    Radio type             : [ Any Radio Type ]`,
          '    Vendor extension          : Not present', '',
          'Security settings ', '----------------- ',
          `    Authentication         : ${sec === 'Open' ? 'Open' : sec}`,
          `    Cipher                 : ${sec === 'Open' ? 'None' : 'CCMP'}`,
          `    Security key           : ${sec === 'Open' ? 'Absent' : 'Present'}`,
          ...(clear && sec !== 'Open' ? [`    Key Content            : ${p.password}`] : []), '',
          'Cost settings ', '------------- ',
          `    Cost                   : ${p.metered ? 'Fixed' : 'Unrestricted'}`,
          '    Congested              : No',
          '    Approaching Data Limit : No',
          '    Over Data Limit        : No',
          '    Roaming                : No',
          '    Cost Source            : Default', '',
        ].join('\n');
      }
      if (verb === 'show' && what.startsWith('network')) {
        const list = Win.Network.scan();
        if (!Win.Network.radioOn()) return '\nInterface name : Wi-Fi \nThere are 0 networks currently visible. \n\n';
        const rows = list.map((net, i) => `SSID ${i + 1} : ${net.ssid}\n    Network type            : Infrastructure\n    Authentication          : ${net.security === 'Open' ? 'Open' : net.security}\n    Encryption              : ${net.security === 'Open' ? 'None' : 'CCMP'} \n`);
        return `\nInterface name : Wi-Fi \nThere are ${list.length} networks currently visible. \n\n${rows.join('\n')}\n`;
      }
      if (verb === 'disconnect') {
        if (connected()) Win.Network.disconnect();
        return 'Disconnection request was completed successfully for interface "Wi-Fi".\n';
      }
      if (verb === 'connect') {
        const name = named('name') || named('ssid');
        const p = name && n.known.find(k => k.ssid.toLowerCase() === name.toLowerCase());
        if (!p) return `There is no profile "${name || ''}" assigned to the specified interface.\n`;
        if (!Win.Network.lookup(p.ssid) || !Win.Network.radioOn()) return 'The network specified by profile "' + p.ssid + '" is not available to connect.\n';
        Win.Network.connect(p.ssid);
        return 'Connection request was completed successfully.\n';
      }
      if (verb === 'delete' && what === 'profile') {
        const name = named('name');
        const p = name && n.known.find(k => k.ssid.toLowerCase() === name.toLowerCase());
        if (!p) return `Profile "${name || ''}" is not found on any interface.\n`;
        Win.Network.forget(p.ssid);
        return `Profile "${p.ssid}" is deleted from interface "Wi-Fi".\n`;
      }
    }
    return `The following command was not found: ${words.join(' ')}.\n`;
  }

  function getmac() {
    const net = Win.Network.current();
    return `\nPhysical Address    Transport Name\n=================== ==========================================================\n${Win.Network.mac().padEnd(20)}${net && !machine.released ? '\\Device\\Tcpip_{3F2B8C1E-7A4D-4C11-9E2B-5D6A0F1C7B42}' : 'Media disconnected'}\nA4-C3-F0-5E-12-9C   Media disconnected\n`;
  }

  function arp() {
    const c = cfg();
    if (!c) return 'No ARP Entries Found.';
    const prefix = c.ip.split('.').slice(0, 3).join('.');
    return [
      '', `Interface: ${c.ip} --- 0xc`,
      '  Internet Address      Physical Address      Type',
      `  ${c.router.padEnd(22)}3c-84-6a-21-9e-04     dynamic   `,
      `  ${`${prefix}.23`.padEnd(22)}f4-5c-89-b1-07-3a     dynamic   `,
      `  ${`${prefix}.255`.padEnd(22)}ff-ff-ff-ff-ff-ff     static    `,
      '  224.0.0.22            01-00-5e-00-00-16     static    ',
      '  224.0.0.251           01-00-5e-00-00-fb     static    ',
      '  239.255.255.250       01-00-5e-7f-ff-fa     static    ',
      '  255.255.255.255       ff-ff-ff-ff-ff-ff     static    ', '',
    ].join('\n');
  }

  /* -------------------------------------------- PowerShell network cmdlets */

  function testNetConnection(tokens, s) {
    const a = psArgs(tokens, { named: ['ComputerName', 'Port', 'CommonTCPPort', 'InformationLevel'], switches: ['TraceRoute', 'Detailed'], positional: ['ComputerName', 'Port'] });
    if (a.bad) return badParam(s, 'Test-NetConnection', a.bad);
    const host = a.ComputerName || 'internetbeacon.msedge.net';
    const port = a.Port || ({ http: 80, rdp: 3389, smb: 445, winrm: 5985 })[String(a.CommonTCPPort || '').toLowerCase()];
    const c = cfg();
    const r = machine.released ? { ok: false, error: 'general' } : Win.Network.ping(host, 1);
    const resolved = isIPv4(host) ? { ok: true, ip: host } : machine.released ? { ok: false } : Win.Network.resolve(host);
    const out = [];
    if (!resolved.ok) {
      out.push(warn(`WARNING: Name resolution of ${host} failed`));
      const rows = [['ComputerName', host], ['RemoteAddress', ''], ['InterfaceAlias', ''], ['SourceAddress', ''], [port ? 'TcpTestSucceeded' : 'PingSucceeded', 'False']];
      out.push(table(rows));
      return out;
    }
    noteDns(host, resolved.ip);
    if (!r.ok) out.push(warn(port ? `WARNING: TCP connect to (${resolved.ip} : ${port}) failed` : `WARNING: Ping to ${resolved.ip} failed with status: ${r.error === 'timeout' ? 'TimedOut' : r.error === 'unreachable' ? 'DestinationHostUnreachable' : 'GeneralFailure'}`));
    const rows = [['ComputerName', host], ['RemoteAddress', resolved.ip]];
    if (port) rows.push(['RemotePort', String(port)]);
    rows.push(['InterfaceAlias', c ? 'Wi-Fi' : ''], ['SourceAddress', c?.ip || '']);
    if (port) {
      if (!r.ok) rows.push(['PingSucceeded', 'False'], ['PingReplyDetails (RTT)', '0 ms']);
      rows.push(['TcpTestSucceeded', r.ok ? 'True' : 'False']);
    } else {
      rows.push(['PingSucceeded', r.ok ? 'True' : 'False'], ['PingReplyDetails (RTT)', `${r.ok ? r.replies[0] : 0} ms`]);
    }
    out.push(table(rows));
    return stream((function* () { for (const chunk of out) yield { ...(typeof chunk === 'string' ? { text: ensureNL(chunk) } : chunk), delay: r.ok ? 300 : 1200 }; })());
  }

  function table(rows) {
    const w = Math.max(...rows.map(r => r[0].length));
    return `\n${rows.map(([k, v]) => `${k.padEnd(w)} : ${v}`).join('\n')}\n\n`;
  }

  function getNetIPConfiguration() {
    const net = Win.Network.current();
    const c = cfg();
    if (!Win.state.network.adapterEnabled.wifi) return '';
    const rows = [['InterfaceAlias', 'Wi-Fi'], ['InterfaceIndex', '12'], ['InterfaceDescription', Win.Network.ADAPTER.description]];
    if (net) rows.push(['NetProfile.Name', net.ssid]);
    else rows.push(['NetAdapter.Status', 'Disconnected']);
    if (net && c) {
      rows.push(['IPv4Address', c.ip], ['IPv6DefaultGateway', ''], ['IPv4DefaultGateway', c.gateway || ''], ['DNSServer', (c.dns.length ? c.dns : [c.router]).join('\n' + ' '.repeat(23))]);
    }
    return table(rows).replace(/^\n/, '\n');
  }

  function getNetAdapter() {
    const n = Win.state.network;
    const wifiStatus = !n.adapterEnabled.wifi ? 'Disabled' : connected() ? 'Up' : 'Disconnected';
    const speed = connected() ? (Win.Network.current().protocol.includes('6E') ? '1.2 Gbps' : '866.7 Mbps') : '0 bps';
    const row = (name, desc, idx, status, mac, link) => `${name.padEnd(25).slice(0, 25)} ${desc.length > 39 ? `${desc.slice(0, 36)}...` : desc.padEnd(39)} ${String(idx).padStart(7)} ${status.padEnd(12)} ${mac.padEnd(22)} ${link.padStart(9)}`;
    return ['', 'Name                      InterfaceDescription                    ifIndex Status       MacAddress             LinkSpeed',
      '----                      --------------------                    ------- ------       ----------             ---------',
      row('Wi-Fi', Win.Network.ADAPTER.description, 12, wifiStatus, Win.Network.mac(), speed),
      row('Bluetooth Network Conn...', 'Bluetooth Device (Personal Area Network)', 17, 'Disconnected', 'A4-C3-F0-5E-12-9C', '3 Mbps'), '', ''].join('\n');
  }

  function resolveDnsName(tokens, s) {
    const a = psArgs(tokens, { named: ['Name', 'Type', 'Server'], switches: ['DnsOnly', 'NoHostsFile'], positional: ['Name', 'Type'] });
    if (a.bad) return badParam(s, 'Resolve-DnsName', a.bad);
    if (!a.Name) return '';
    const reason = Win.Network.reason();
    const r = machine.released ? { ok: false, error: 'disconnected' } : a.Server && Win.Network.RESOLVERS.has(a.Server) && reason === 'no-dns' ? resolveVia(a.Name) : Win.Network.resolve(a.Name);
    const opts = { target: a.Name, category: 'OperationTimeout', reason: 'Win32Exception', fqid: 'ERROR_TIMEOUT,Microsoft.DnsClient.Commands.ResolveDnsName' };
    if (!r.ok) {
      if (r.error === 'nxdomain') return psError(s, 'Resolve-DnsName', `${a.Name} : DNS name does not exist`, { ...opts, category: 'ResourceUnavailable', fqid: 'DNS_ERROR_RCODE_NAME_ERROR,Microsoft.DnsClient.Commands.ResolveDnsName' });
      if (['airplane', 'wifi-off', 'adapter-disabled', 'disconnected'].includes(r.error)) return psError(s, 'Resolve-DnsName', `${a.Name} : No such host is known`, { ...opts, category: 'ResourceUnavailable', fqid: 'WSAHOST_NOT_FOUND,Microsoft.DnsClient.Commands.ResolveDnsName' });
      return psError(s, 'Resolve-DnsName', `${a.Name} : This operation returned because the timeout period expired`, opts);
    }
    noteDns(a.Name, r.ip);
    return `\nName                                           Type   TTL   Section    IPAddress\n----                                           ----   ---   -------    ---------\n${a.Name.padEnd(46)} A      ${String(60 + (hash(a.Name) % 240)).padEnd(5)} Answer     ${r.ip}\n\n`;
  }

  /* ------------------------------------------------------------ processes */

  const procs = () => Win.Processes?.list?.() || [];

  function tasklist(tokens) {
    const flags = cmdFlags(tokens);
    const filterIm = tokens.findIndex(t => /^\/fi$/i.test(t.v));
    let list = procs();
    if (filterIm >= 0) {
      const m = String(tokens[filterIm + 1]?.v || '').match(/imagename\s+eq\s+(.+)/i);
      if (m) list = list.filter(p => globRe(m[1].trim()).test(p.image));
    }
    if (!list.length) return 'INFO: No tasks are running which match the specified criteria.';
    if (flags.includes('/svc')) {
      return ['', 'Image Name                     PID Services', '========================= ======== ============================================',
        ...list.map(p => `${p.image.padEnd(25).slice(0, 25)} ${String(p.pid).padStart(8)} ${p.services || 'N/A'}`)].join('\n');
    }
    return ['', 'Image Name                     PID Session Name        Session#    Mem Usage', '========================= ======== ================ =========== ============',
      ...list.map(p => `${p.image.padEnd(25).slice(0, 25)} ${String(p.pid).padStart(8)} ${(p.session || 'Console').padEnd(16)} ${String(p.session === 'Services' ? 0 : 1).padStart(11)} ${`${comma(p.memKB)} K`.padStart(12)}`)].join('\n');
  }

  function taskkill(tokens) {
    const flags = tokens.map(t => t.v.toLowerCase());
    const force = flags.includes('/f');
    const tree = flags.includes('/t');
    const ims = [];
    const pids = [];
    tokens.forEach((t, i) => {
      if (/^\/im$/i.test(t.v) && tokens[i + 1]) ims.push(tokens[i + 1].v);
      if (/^\/pid$/i.test(t.v) && tokens[i + 1]) pids.push(tokens[i + 1].v);
    });
    if (!ims.length && !pids.length) return err('ERROR: Invalid syntax. Neither /FI nor /PID nor /IM were specified.\nType "TASKKILL /?" for usage.');
    const out = [];
    const list = procs();
    const kill = p => {
      const result = Win.Processes.kill(p, { force });
      if (result === 'denied') out.push(err(`ERROR: The process with PID ${p.pid} could not be terminated.\nReason: Access is denied.`));
      else if (result === 'gui' && !force) out.push(`SUCCESS: Sent termination signal to the process "${p.image}" with PID ${p.pid}.`);
      else out.push(`SUCCESS: The process "${p.image}" with PID ${p.pid} has been terminated.`);
      void tree;
    };
    ims.forEach(name => {
      const hits = list.filter(p => globRe(name).test(p.image) || globRe(`${name}.exe`).test(p.image));
      if (!hits.length) out.push(err(`ERROR: The process "${name}" not found.`));
      hits.forEach(kill);
    });
    pids.forEach(id => {
      const p = list.find(x => String(x.pid) === String(id));
      if (!p) out.push(err(`ERROR: The process "${id}" not found.`));
      else kill(p);
    });
    return out;
  }

  function getProcess(tokens, s) {
    const a = psArgs(tokens, { named: ['Name', 'Id'], switches: ['IncludeUserName', 'FileVersionInfo', 'Module'], positional: ['Name'] });
    if (a.bad) return badParam(s, 'Get-Process', a.bad);
    let list = procs().filter(p => p.pid !== 0 || true);
    if (a.Name) {
      const pats = String(a.Name).split(',');
      list = list.filter(p => pats.some(n => globRe(n).test(p.image.replace(/\.exe$/i, ''))));
      if (!list.length) {
        return psError(s, 'Get-Process', `Cannot find a process with the name "${a.Name}". Verify the process name and call the cmdlet again.`,
          { target: a.Name, reason: 'ProcessCommandException', fqid: 'NoProcessFoundForGivenName' });
      }
    }
    if (a.Id) {
      list = list.filter(p => String(p.pid) === String(a.Id));
      if (!list.length) return psError(s, 'Get-Process', `Cannot find a process with the process identifier ${a.Id}.`, { target: a.Id, reason: 'ProcessCommandException', fqid: 'NoProcessFoundForGivenId' });
    }
    list = list.slice().sort((x, y) => x.image.localeCompare(y.image, 'en', { sensitivity: 'base' }));
    const rows = ['', 'Handles  NPM(K)    PM(K)      WS(K)     CPU(s)     Id  SI ProcessName', '-------  ------    -----      -----     ------     --  -- -----------'];
    list.forEach(p => {
      const h = 120 + (p.pid * 7) % 1800;
      const npm = 8 + (p.pid % 60);
      const ws = p.memKB;
      const pm = Math.round(ws * 0.62);
      const cpu = p.cpuTime != null ? p.cpuTime.toFixed(2) : '';
      rows.push(`${String(h).padStart(7)}${String(npm).padStart(8)}${String(pm).padStart(9)}${String(ws).padStart(11)}${cpu.padStart(11)}${String(p.pid).padStart(7)}${String(p.session === 'Services' ? 0 : 1).padStart(4)} ${p.image.replace(/\.exe$/i, '')}`);
    });
    rows.push('', '');
    return rows.join('\n');
  }

  function stopProcess(tokens, s) {
    const a = psArgs(tokens, { named: ['Name', 'Id', 'InputObject'], switches: ['Force', 'PassThru', 'Confirm', 'WhatIf'], positional: ['Id'] });
    if (a.bad) return badParam(s, 'Stop-Process', a.bad);
    const list = procs();
    const out = [];
    if (a.Name) {
      const hits = list.filter(p => globRe(a.Name).test(p.image.replace(/\.exe$/i, '')));
      if (!hits.length) return psError(s, 'Stop-Process', `Cannot find a process with the name "${a.Name}". Verify the process name and call the cmdlet again.`, { target: a.Name, reason: 'ProcessCommandException', fqid: 'NoProcessFoundForGivenName' });
      hits.forEach(p => { if (Win.Processes.kill(p, { force: true }) === 'denied') out.push(psError(s, 'Stop-Process', `Cannot stop process "${p.image.replace(/\.exe$/i, '')} (${p.pid})" because of the following error: Access is denied`, { target: `System.Diagnostics.Process (${p.image.replace(/\.exe$/i, '')})`, category: 'CloseError', reason: 'ProcessCommandException', fqid: 'CouldNotStopProcess' })); });
      return out;
    }
    const id = a.Id || a._[0];
    if (!id) return psError(s, 'Stop-Process', 'Cannot bind parameter \'Id\'.', { category: 'InvalidArgument', reason: 'ParameterBindingException', fqid: 'MissingArgument' });
    const p = list.find(x => String(x.pid) === String(id));
    if (!p) return psError(s, 'Stop-Process', `Cannot find a process with the process identifier ${id}.`, { target: id, reason: 'ProcessCommandException', fqid: 'NoProcessFoundForGivenId' });
    if (Win.Processes.kill(p, { force: true }) === 'denied') return psError(s, 'Stop-Process', `Cannot stop process "${p.image.replace(/\.exe$/i, '')} (${p.pid})" because of the following error: Access is denied`, { target: `System.Diagnostics.Process (${p.image.replace(/\.exe$/i, '')})`, category: 'CloseError', reason: 'ProcessCommandException', fqid: 'CouldNotStopProcess' });
    return '';
  }

  /* ------------------------------------------------------ launching things */

  const LAUNCH = {
    notepad: 'notepad', calc: 'calculator', calculator: 'calculator', mspaint: 'paint', paint: 'paint', msedge: 'edge', explorer: 'explorer',
    control: 'controlpanel', taskmgr: 'taskmgr', cmd: 'cmd', powershell: 'powershell', wt: 'terminal', winver: 'winver', snippingtool: 'snip',
    'ms-photos:': 'photos', 'ms-clock:': 'clock', 'microsoft-edge:': 'edge', 'ms-windows-store:': 'store', outlook: 'mail', olk: 'mail',
    'ms-settings:': 'settings', systemsettings: 'settings', 'shell:recyclebinfolder': 'explorer', timedate: 'clock',
  };

  const SETTINGS_URI = {
    '': null, network: 'network', 'network-status': 'network', 'network-wifi': 'wifi', 'network-wifisettings': 'wifi', 'network-proxy': 'proxy',
    'network-ethernet': 'network', 'network-vpn': 'vpn', 'network-airplanemode': 'airplane', 'network-mobilehotspot': 'hotspot', 'network-advancedsettings': 'advanced-network',
    windowsupdate: 'update', 'windowsupdate-action': 'update', display: 'display', bluetooth: 'bluetooth', connecteddevices: 'bluetooth', about: 'about',
    appsfeatures: 'installed-apps', 'apps-volume': 'installed-apps', defaultapps: 'default-apps', startupapps: 'startup', sound: 'sound',
    personalization: 'personalization', 'personalization-background': 'background', colors: 'colors', themes: 'themes', taskbar: 'taskbar',
    privacy: 'privacy', windowsdefender: 'security', dateandtime: 'time', 'regionlanguage': 'language', yourinfo: 'your-info', signinoptions: 'sign-in',
    printers: 'printers', mousetouchpad: 'mouse', devices: 'bluetooth', storagesense: 'storage', powersleep: 'power', batterysaver: 'power',
    troubleshoot: 'troubleshoot', recovery: 'recovery', easeofaccess: 'accessibility', notifications: 'notifications', quiethours: 'notifications',
  };

  function openSettings(page) {
    if (page && Win.Settings?.open) { Win.Settings.open(page); return; }
    Win.wm.open('settings', page ? { page } : {});
  }

  function openNode(id) {
    const node = Win.FS.get(id);
    if (!node) return;
    if (Win.FS.isFolder(node)) { Win.wm.open('explorer', { path: id }); return; }
    if (Win.openFile) { Win.openFile(id); return; }
    const ext = node.ext;
    if (ext === 'pdf') Win.wm.open('edge', { fileId: id });
    else if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) Win.wm.open('photos', { fileId: id });
    else if (['txt', 'log', 'md', 'ini', 'csv', 'bat', 'ps1', ''].includes(ext)) Win.wm.open('notepad', { fileId: id });
    else Win.wm.open('explorer', { path: node.parent, select: id });
  }

  /**
   * Open a program, folder, document, URL or ms-settings: URI the way the Run
   * box and `start` do. Returns '' on success or the Windows error text.
   */
  function start(target, { cwd = 'home', admin = false, args = [] } = {}) {
    const raw = String(target || '').trim().replace(/^"|"$/g, '');
    if (!raw) return '';
    const lower = raw.toLowerCase();
    const notFound = `Windows cannot find '${raw}'. Make sure you typed the name correctly, and then try again.`;
    if (/^ms-settings:/i.test(raw)) {
      if (Win.msSettings) { Win.msSettings(raw); return ''; }
      const key = lower.slice('ms-settings:'.length);
      openSettings(SETTINGS_URI[key] ?? key);
      return '';
    }
    if (/^(https?:\/\/|www\.)/i.test(raw) || /^microsoft-edge:/i.test(raw)) {
      Win.wm.open('edge', { url: raw.replace(/^microsoft-edge:/i, '') });
      return '';
    }
    const bare = lower.replace(/\.(exe|msc|cpl)$/, '');
    const appId = LAUNCH[bare] || LAUNCH[lower] || (Win.apps.get(bare) ? bare : null);
    if (appId && Win.apps.get(appId)) {
      const extraArg = args.join(' ').trim();
      if (appId === 'notepad' && extraArg) {
        const id = Win.FS.resolve(extraArg, cwd);
        if (id) { Win.wm.open('notepad', { fileId: id }); return ''; }
      }
      if (appId === 'explorer' && extraArg) {
        const id = Win.FS.resolve(extraArg, cwd);
        if (id) { openNode(id); return ''; }
      }
      if (appId === 'edge' && extraArg) { Win.wm.open('edge', { url: extraArg }); return ''; }
      if ((appId === 'cmd' || appId === 'powershell' || appId === 'terminal') && admin) {
        Win.wm.open('terminal', { profile: appId === 'cmd' ? 'cmd' : 'powershell', admin: true });
        return '';
      }
      Win.wm.open(appId, appId === 'explorer' ? { path: 'home' } : {});
      return '';
    }
    if (bare === 'regedit' || bare === 'msconfig' || bare === 'services' || bare === 'devmgmt' || bare === 'ncpa' || bare === 'appwiz') {
      const map = { ncpa: 'network', appwiz: 'installed-apps' };
      if (map[bare]) { openSettings(map[bare]); return ''; }
      if (bare === 'services') { Win.wm.open('taskmgr', { page: 'services' }); return ''; }
      return notFound;
    }
    const id = Win.FS.resolve(raw, cwd);
    if (id) { openNode(id); return ''; }
    if (/^shell:/i.test(raw)) {
      const known = { 'shell:downloads': 'downloads', 'shell:desktop': 'desktop', 'shell:personal': 'documents', 'shell:my pictures': 'pictures', 'shell:startup': 'appdata' };
      if (known[lower]) { Win.wm.open('explorer', { path: known[lower] }); return ''; }
    }
    return notFound;
  }

  function startCmd(tokens, s, ctx) {
    let words = tokens.map(t => t.v);
    if (s.profile === 'cmd' && tokens[0]?.q && tokens.length > 1) words = words.slice(1);
    if (s.profile !== 'cmd') {
      const a = psArgs(tokens, { named: ['FilePath', 'ArgumentList', 'Verb', 'WorkingDirectory'], switches: ['Wait', 'PassThru', 'NoNewWindow'], positional: ['FilePath', 'ArgumentList'] });
      if (a.bad) return badParam(s, 'Start-Process', a.bad);
      if (!a.FilePath) { return psError(s, 'Start-Process', 'Cannot bind argument to parameter \'FilePath\' because it is null.', { category: 'InvalidData', reason: 'ParameterBindingValidationException', fqid: 'ParameterArgumentValidationErrorNullNotAllowed' }); }
      const problem = start(a.FilePath, { cwd: s.cwd, admin: /^runas$/i.test(a.Verb || ''), args: a.ArgumentList ? [a.ArgumentList] : [] });
      if (problem) return psError(s, 'Start-Process', 'This command cannot be run due to the error: The system cannot find the file specified.', { target: '', category: 'InvalidOperation', reason: 'InvalidOperationException', fqid: 'InvalidOperationException' });
      return '';
    }
    if (!words.length) { Win.wm.open('terminal', { profile: 'cmd', cwd: s.cwd }); return ''; }
    const problem = start(words[0], { cwd: s.cwd, args: words.slice(1) });
    if (problem) {
      Win.alert?.(words[0], problem);
      return '';
    }
    return '';
  }

  const app = (id, extraArgs) => (tokens, s) => {
    const arg = tokens.map(t => t.v).join(' ');
    const problem = start(id, { cwd: s.cwd, args: arg ? [arg] : [], ...extraArgs });
    return problem ? err(problem) : '';
  };

  /* ---------------------------------------------------------- maintenance */

  function progressBar(pct) {
    const width = 58;
    const label = `${pct.toFixed(1)}%`;
    const chars = Array.from({ length: width }, (_, i) => (i < Math.floor((width * pct) / 100) ? '=' : ' '));
    const at = Math.floor((width - label.length) / 2);
    for (let i = 0; i < label.length; i += 1) chars[at + i] = label[i];
    return `[${chars.join('')}]`;
  }

  function sfc(tokens, s) {
    const op = (tokens[0]?.v || '').toLowerCase();
    if (!op || op === '/?') {
      return '\nMicrosoft (R) Windows (R) Resource Checker Version 6.0\nCopyright (C) Microsoft Corporation. All rights reserved.\n\nScans the integrity of all protected system files and replaces incorrect versions with\ncorrect Microsoft versions.\n\nSFC [/SCANNOW] [/VERIFYONLY] [/SCANFILE=<file>] [/VERIFYFILE=<file>]\n    [/OFFWINDIR=<offline windows directory> /OFFBOOTDIR=<offline boot directory> [/OFFLOGFILE=<log file path>]]\n\n/SCANNOW        Scans integrity of all protected system files and repairs files with\n                problems when possible.\n/VERIFYONLY     Scans integrity of all protected system files. No repair operation is\n                performed.\n';
    }
    if (!s.admin) return 'You must be an administrator running a console session in order to\nuse the sfc utility.';
    if (op !== '/scannow' && op !== '/verifyonly') return 'Invalid option. Type SFC /? for help.';
    function* run() {
      yield { text: '\nBeginning system scan.  This process will take some time.\n\n', delay: 200 };
      yield { text: 'Beginning verification phase of system scan.\n', delay: 2600 };
      for (let p = 1; p <= 100; p += 1) yield { text: `Verification ${p}% complete.`, replace: p > 1, delay: p < 10 ? 380 : p > 90 ? 260 : 150 + (p % 7) * 30 };
      yield { text: '\n\nWindows Resource Protection did not find any integrity violations.\n', delay: 500 };
    }
    return stream(run(), () => ({ text: '\n' }));
  }

  function dism(tokens, s) {
    const flags = tokens.map(t => t.v.toLowerCase());
    const head = '\nDeployment Image Servicing and Management tool\nVersion: 10.0.26100.5074\n\n';
    if (!s.admin) return `${head}\nError: 740\n\nElevated permissions are required to run DISM.\nUse an elevated command prompt to complete these tasks.\n`;
    const online = flags.includes('/online');
    const cleanup = flags.includes('/cleanup-image');
    if (!online || !cleanup) return `${head}\nError: 87\n\nThe option is unknown.\nFor more information, refer to the help by running DISM.exe /?.\n\nThe DISM log file can be found at C:\\WINDOWS\\Logs\\DISM\\dism.log\n`;
    const img = `${head}Image Version: ${VERSION}\n\n`;
    if (flags.includes('/checkhealth')) return `${img}No component store corruption detected.\nThe operation completed successfully.\n`;
    const restore = flags.includes('/restorehealth');
    if (!restore && !flags.includes('/scanhealth')) return `${head}\nError: 87\n\nThe cleanup-image option is unknown.\n`;
    function* run() {
      yield { text: img, delay: 900 };
      const steps = [0, 4.8, 9.9, 19.7, 20.0, 31.4, 46.2, 52.6, 62.3, 62.3, 62.3, 71.0, 84.9, 92.1, 100];
      for (let i = 0; i < steps.length; i += 1) yield { text: progressBar(steps[i]), replace: i > 0, delay: steps[i] === 62.3 ? 2400 : 900 };
      yield { text: ` ${restore ? 'The restore operation completed successfully.' : 'No component store corruption detected.'}\nThe operation completed successfully.\n`, delay: 300 };
    }
    return stream(run(), () => ({ text: '\n\nError: 1223\n\nThe operation was canceled by the user.\n' }));
  }

  function chkdsk(tokens, s) {
    if (!s.admin) return 'Access Denied as you do not have sufficient privileges or\nthe disk may be locked by another process.\nYou have to invoke this utility running in elevated mode\nand make sure the disk is unlocked.';
    const fix = tokens.some(t => /^\/[fr]$/i.test(t.v));
    if (fix) return 'Chkdsk cannot run because the volume is in use by another\nprocess.  Would you like to schedule this volume to be\nchecked the next time the system restarts? (Y/N) Y\n\nThis volume will be checked the next time the system restarts.';
    function* run() {
      yield { text: 'The type of the file system is NTFS.\n\nWARNING!  /F parameter not specified.\nRunning CHKDSK in read-only mode.\n\nStage 1: Examining basic file system structure ...\n', delay: 400 };
      yield { text: '  412160 file records processed.\nFile verification completed.\n Phase duration (File record verification): 3.21 seconds.\n  9311 large file records processed.\n Phase duration (Orphan file record recovery): 0.00 milliseconds.\n  0 bad file records processed.\n Phase duration (Bad file record checking): 0.42 milliseconds.\n\n', delay: 3200 };
      yield { text: 'Stage 2: Examining file name linkage ...\n', delay: 200 };
      yield { text: '  2611 reparse records processed.\n  541836 index entries processed.\nIndex verification completed.\n Phase duration (Index verification): 6.84 seconds.\n  0 unindexed files scanned.\n  0 unindexed files recovered to lost and found.\n  2611 reparse records processed.\n Phase duration (Reparse point and Object ID verification): 18.07 milliseconds.\n\n', delay: 4200 };
      yield { text: 'Stage 3: Examining security descriptors ...\nSecurity descriptor verification completed.\n Phase duration (Security descriptor verification): 64.12 milliseconds.\n  64839 data files processed.\n Phase duration (Data attribute verification): 0.31 milliseconds.\nCHKDSK is verifying Usn Journal...\n  40106472 USN bytes processed.\nUsn Journal verification completed.\n Phase duration (USN journal verification): 152.66 milliseconds.\n\n', delay: 2600 };
      const total = 498917375;
      const used = Math.round(Win.FS.used('c') / 1024);
      yield { text: `Windows has scanned the file system and found no problems.\nNo further action is required.\n\n${comma(total).replace(/,/g, '').padStart(10)} KB total disk space.\n${String(used).padStart(10)} KB in 318841 files.\n    215480 KB in 64840 indexes.\n         0 KB in bad sectors.\n    771431 KB in use by the system.\n     65536 KB occupied by the log file.\n${String(total - used - 986911).padStart(10)} KB available on disk.\n\n      4096 bytes in each allocation unit.\n 124729343 total allocation units on disk.\n${String(Math.round((total - used - 986911) / 4)).padStart(10)} allocation units available on disk.\nTotal duration: 14.31 seconds (14310 ms).\n`, delay: 1200 };
    }
    return stream(run(), () => ({ text: '\n' }));
  }

  function shutdown(tokens, s) {
    const flags = tokens.map(t => t.v.toLowerCase());
    const tIndex = flags.findIndex(f => f === '/t' || f === '-t');
    const seconds = tIndex >= 0 ? Math.max(0, parseInt(flags[tIndex + 1], 10) || 0) : 30;
    const has = f => flags.includes(`/${f}`) || flags.includes(`-${f}`);
    if (has('a')) {
      if (!machine.shutdown) return 'Unable to abort the system shutdown because no shutdown was in progress.(1116)';
      clearTimeout(machine.shutdown);
      machine.shutdown = null;
      Win.toast?.({ app: 'Windows', glyph: 'power', title: 'Logoff is cancelled', body: 'The scheduled shutdown has been cancelled.' });
      return '';
    }
    const action = has('l') ? 'signOut' : has('r') || has('g') ? 'restart' : has('s') || has('p') ? 'shutdown' : has('h') ? 'sleep' : null;
    if (!action) {
      return 'Usage: shutdown [/i | /l | /s | /sg | /r | /g | /a | /p | /h | /e | /o] [/hybrid] [/soft] [/fw] [/f]\n    [/m \\\\computer][/t xxx][/d [p|u:]xx:yy [/c "comment"]]\n\n    No args    Display help. This is the same as typing /?.\n    /?         Display help. This is the same as not typing any options.\n    /l         Log off. This cannot be used with /m or /d options.\n    /s         Shutdown the computer.\n    /r         Full shutdown and restart the computer.\n    /a         Abort a system shutdown.\n                This can only be used during the time-out period.\n    /h         Hibernate the local computer.\n    /t xxx     Set the time-out period before shutdown to xxx seconds.\n    /f         Force running applications to close without forewarning users.\n';
    }
    if (machine.shutdown) return 'A system shutdown has already been scheduled.(1190)';
    const go = () => { machine.shutdown = null; Win.Session?.[action]?.(); };
    if (action === 'signOut' || action === 'sleep' || seconds === 0) { setTimeout(go, 400); return ''; }
    Win.toast?.({ app: 'Windows', glyph: 'power', title: 'You\'re about to be signed out', body: `Windows will ${action === 'restart' ? 'restart' : 'shut down'} in ${seconds >= 60 ? `${Math.round(seconds / 60)} minutes` : 'less than a minute'}.`, timeout: 10000 });
    machine.shutdown = setTimeout(go, seconds * 1000);
    return '';
  }

  /* -------------------------------------------------------------- system */

  function systeminfo() {
    const c = cfg();
    const net = Win.Network.current();
    const boot = new Date(Win.bootedAt || LOADED);
    const install = new Date(INSTALLED);
    const fmt = d => `${psDate(d)}, ${longTime(d)}`;
    const L = (k, v) => `${`${k}:`.padEnd(27)}${v}`;
    const pad = ' '.repeat(27);
    const hot = Win.state.update?.history?.filter(h => /^KB/.test(h.id)) || [];
    const lines = [
      '', L('Host Name', hostName()), L('OS Name', 'Microsoft Windows 11 Home'), L('OS Version', `10.0.26300 N/A Build 26300`),
      L('OS Manufacturer', 'Microsoft Corporation'), L('OS Configuration', 'Standalone Workstation'), L('OS Build Type', 'Multiprocessor Free'),
      L('Registered Owner', P.email), L('Registered Organization', 'N/A'), L('Product ID', '00342-41702-38194-AAOEM'),
      L('Original Install Date', fmt(install)), L('System Boot Time', fmt(boot)), L('System Manufacturer', 'Surface (Fictional)'),
      L('System Model', P.model), L('System Type', 'x64-based PC'), L('Processor(s)', '1 Processor(s) Installed.'),
      `${pad}[01]: Intel64 Family 6 Model 189 Stepping 1 GenuineIntel ~2200 Mhz`, L('BIOS Version', 'Surface (Fictional) 41.12.140, 8/19/2026'),
      L('Windows Directory', 'C:\\WINDOWS'), L('System Directory', 'C:\\WINDOWS\\system32'), L('Boot Device', '\\Device\\HarddiskVolume1'),
      L('System Locale', 'en-us;English (United States)'), L('Input Locale', '00000409'), L('Time Zone', Win.state.settings.timezone || '(UTC-05:00) Eastern Time (US & Canada)'),
      L('Total Physical Memory', '32,385 MB'), L('Available Physical Memory', `${comma(17000 + (Date.now() / 1000) % 2400)} MB`),
      L('Virtual Memory: Max Size', '37,249 MB'), L('Virtual Memory: Available', '19,822 MB'), L('Virtual Memory: In Use', '17,427 MB'),
      L('Page File Location(s)', 'C:\\pagefile.sys'), L('Domain', 'WORKGROUP'), L('Logon Server', `\\\\${hostName()}`),
      L('Hotfix(s)', `${hot.length} Hotfix(s) Installed.`), ...hot.map((h, i) => `${pad}[${two(i + 1)}]: ${h.id}`),
      L('Network Card(s)', '2 NIC(s) Installed.'), `${pad}[01]: ${Win.Network.ADAPTER.description}`,
      `${pad}      Connection Name: Wi-Fi`,
    ];
    if (net && c) {
      lines.push(`${pad}      DHCP Enabled:    ${c.dhcp ? 'Yes' : 'No'}`);
      if (c.dhcp) lines.push(`${pad}      DHCP Server:     ${c.dhcpServer}`);
      lines.push(`${pad}      IP address(es)`, `${pad}      [01]: ${c.ip}`, `${pad}      [02]: ${c.ipv6.replace(/%\d+$/, '')}`);
    } else {
      lines.push(`${pad}      Status:          Media disconnected`);
    }
    lines.push(`${pad}[02]: Bluetooth Device (Personal Area Network)`, `${pad}      Connection Name: Bluetooth Network Connection`, `${pad}      Status:          Media disconnected`,
      L('Virtualization-based security', 'Status: Running'), `${pad}Required Security Properties:`, `${pad}      Base Virtualization Support`,
      L('Hyper-V Requirements', 'A hypervisor has been detected. Features required for Hyper-V will not be displayed.'));
    const body = lines.join('\n');
    function* run() {
      yield { text: 'Loading Operating System Information ...', delay: 100 };
      yield { text: 'Loading Processor Information ...', replace: true, delay: 600 };
      yield { text: 'Loading Hotfix Information ...', replace: true, delay: 700 };
      yield { text: 'Loading Network Card Information ...', replace: true, delay: 500 };
      yield { text: `${body}\n`, replace: true, delay: 400 };
    }
    return stream(run());
  }

  const cmdDateT = () => {
    const d = new Date();
    return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()}`;
  };

  /* -------------------------------------------------------- help, history */

  const CMD_HELP = [
    ['CD', 'Displays the name of or changes the current directory.'], ['CHDIR', 'Displays the name of or changes the current directory.'],
    ['CHKDSK', 'Checks a disk and displays a status report.'], ['CLS', 'Clears the screen.'], ['CMD', 'Starts a new instance of the Windows command interpreter.'],
    ['COPY', 'Copies one or more files to another location.'], ['DATE', 'Displays or sets the date.'], ['DEL', 'Deletes one or more files.'],
    ['DIR', 'Displays a list of files and subdirectories in a directory.'], ['ECHO', 'Displays messages, or turns command echoing on or off.'],
    ['ERASE', 'Deletes one or more files.'], ['EXIT', 'Quits the CMD.EXE program (command interpreter).'], ['HELP', 'Provides Help information for Windows commands.'],
    ['IPCONFIG', 'Displays IP network configuration values.'], ['MD', 'Creates a directory.'], ['MKDIR', 'Creates a directory.'],
    ['MOVE', 'Moves one or more files from one directory to another directory.'], ['NETSH', 'Displays or modifies network configuration.'],
    ['NSLOOKUP', 'Queries DNS name servers.'], ['PING', 'Tests a connection to another computer.'], ['RD', 'Removes a directory.'],
    ['REN', 'Renames a file or files.'], ['RENAME', 'Renames a file or files.'], ['RMDIR', 'Removes a directory.'], ['SET', 'Displays, sets, or removes Windows environment variables.'],
    ['SFC', 'System File Checker.'], ['SHUTDOWN', 'Allows proper local or remote shutdown of machine.'], ['START', 'Starts a separate window to run a specified program or command.'],
    ['SYSTEMINFO', 'Displays machine specific properties and configuration.'], ['TASKLIST', 'Displays all currently running tasks including services.'],
    ['TASKKILL', 'Kill or stop a running process or application.'], ['TIME', 'Displays or sets the system time.'], ['TITLE', 'Sets the window title for a CMD.EXE session.'],
    ['TRACERT', 'Traces the route to a remote host.'], ['TREE', 'Graphically displays the directory structure of a drive or path.'],
    ['TYPE', 'Displays the contents of a text file.'], ['VER', 'Displays the Windows version.'], ['WHOAMI', 'Displays the current user name.'],
  ];

  const PS_CMDLETS = {
    'Add-Content': ['Microsoft.PowerShell.Management', ['ac']], 'Clear-DnsClientCache': ['DnsClient', []], 'Clear-Host': ['', ['cls', 'clear']],
    'Copy-Item': ['Microsoft.PowerShell.Management', ['copy', 'cp', 'cpi']], 'Get-ChildItem': ['Microsoft.PowerShell.Management', ['dir', 'gci', 'ls']],
    'Get-Command': ['Microsoft.PowerShell.Core', ['gcm']], 'Get-Content': ['Microsoft.PowerShell.Management', ['cat', 'gc', 'type']],
    'Get-Date': ['Microsoft.PowerShell.Utility', []], 'Get-Help': ['Microsoft.PowerShell.Core', ['help']], 'Get-History': ['Microsoft.PowerShell.Core', ['ghy', 'h', 'history']],
    'Get-Location': ['Microsoft.PowerShell.Management', ['gl', 'pwd']], 'Get-NetAdapter': ['NetAdapter', []], 'Get-NetIPConfiguration': ['NetTCPIP', ['gip']],
    'Get-Process': ['Microsoft.PowerShell.Management', ['gps', 'ps']], 'Move-Item': ['Microsoft.PowerShell.Management', ['mi', 'move', 'mv']],
    'New-Item': ['Microsoft.PowerShell.Management', ['ni']], 'Remove-Item': ['Microsoft.PowerShell.Management', ['del', 'erase', 'rd', 'ri', 'rm', 'rmdir']],
    'Rename-Item': ['Microsoft.PowerShell.Management', ['ren', 'rni']], 'Resolve-DnsName': ['DnsClient', []], 'Restart-Computer': ['Microsoft.PowerShell.Management', []],
    'Set-Content': ['Microsoft.PowerShell.Management', ['sc']], 'Set-Location': ['Microsoft.PowerShell.Management', ['cd', 'chdir', 'sl']],
    'Start-Process': ['Microsoft.PowerShell.Management', ['saps', 'start']], 'Stop-Computer': ['Microsoft.PowerShell.Management', []],
    'Stop-Process': ['Microsoft.PowerShell.Management', ['kill', 'spps']], 'Test-NetConnection': ['NetTCPIP', ['TNC']],
    'Write-Host': ['Microsoft.PowerShell.Utility', []], 'Write-Output': ['Microsoft.PowerShell.Utility', ['echo', 'write']],
  };

  function cmdHelp(tokens) {
    const topic = tokens[0]?.v?.toUpperCase();
    if (topic) {
      const hit = CMD_HELP.find(([n]) => n === topic);
      return hit ? `${hit[1]}\n\n${topic} [options]` : 'This command is not supported by the help utility.  Try "x /?".'.replace('x', topic.toLowerCase());
    }
    return `For more information on a specific command, type HELP command-name\n${CMD_HELP.map(([n, d]) => `${n.padEnd(15)}${d}`).join('\n')}\n\nFor more information on tools see the command-line reference in the online help.`;
  }

  function psHelp(tokens, s) {
    const name = tokens.find(t => !/^-/.test(t.v))?.v;
    if (!name) {
      return '\nTOPIC\n    Windows PowerShell Help System\n\nSHORT DESCRIPTION\n    Displays help about Windows PowerShell cmdlets and concepts.\n\nLONG DESCRIPTION\n    Windows PowerShell Help describes Windows PowerShell cmdlets,\n    functions, scripts, and modules, and explains concepts, including\n    the elements of the Windows PowerShell language.\n\n    Windows PowerShell does not include help files, but you can read the\n    help topics online, or use the Update-Help cmdlet to download help files\n    to your computer and then use the Get-Help cmdlet to display the help\n    topics at the command line.\n\n  Get-Help\n    Displays help on the command line.\n\n  Get-Command\n    Gets the cmdlets, functions and aliases available in this session.\n\n  EXAMPLES:\n      Get-Help Get-ChildItem    Displays help about the Get-ChildItem cmdlet.\n      Get-Command *-Net*        Lists networking commands.\n      ipconfig /all             Shows the full IP configuration.\n';
    }
    const full = canonicalCmdlet(name);
    if (!full) {
      return psError(s, 'Get-Help', `Get-Help could not find ${name} in a help file in this session. To download updated help topics type: "Update-Help". To get help online, search for the help topic in the TechNet library at https:/go.microsoft.com/fwlink/?LinkID=107116.`,
        { target: '', category: 'ResourceUnavailable', reason: 'HelpNotFoundException', fqid: 'HelpNotFound,Microsoft.PowerShell.Commands.GetHelpCommand' });
    }
    const aliases = PS_CMDLETS[full][1];
    return `\nNAME\n    ${full}\n\nSYNTAX\n    ${full} [<CommonParameters>]\n\n\nALIASES\n${aliases.map(a => `    ${a}`).join('\n') || '    None'}\n\n\nREMARKS\n    Get-Help cannot find the Help files for this cmdlet on this computer. It is displaying only partial help.\n        -- To download and install Help files for the module that includes this cmdlet, use Update-Help.\n\n`;
  }

  function canonicalCmdlet(name) {
    const lower = String(name).toLowerCase();
    return Object.keys(PS_CMDLETS).find(k => k.toLowerCase() === lower || PS_CMDLETS[k][1].some(a => a.toLowerCase() === lower)) || null;
  }

  function getCommand(tokens, s) {
    const a = psArgs(tokens, { named: ['Name', 'Module', 'Verb', 'Noun', 'CommandType'], switches: ['All'], positional: ['Name'] });
    if (a.bad) return badParam(s, 'Get-Command', a.bad);
    const header = '\nCommandType     Name                                               Version    Source\n-----------     ----                                               -------    ------';
    const row = (type, name, version, source) => `${type.padEnd(15)} ${name.padEnd(50)} ${version.padEnd(10)} ${source}`;
    const rows = [];
    const pattern = a.Name ? globRe(a.Name) : null;
    Object.entries(PS_CMDLETS).forEach(([n, [mod, aliases]]) => {
      aliases.forEach(al => { if (pattern?.test(al)) rows.push(row('Alias', `${al} -> ${n}`, '', '')); });
      if (!pattern || pattern.test(n)) rows.push(row(n === 'Clear-Host' ? 'Function' : 'Cmdlet', n, mod.startsWith('Microsoft.PowerShell') ? '3.1.0.0' : mod ? '1.0.0.0' : '', mod));
    });
    Object.keys(EXE).forEach(n => { if (pattern && (pattern.test(n) || pattern.test(`${n}.exe`))) rows.push(row('Application', `${n.toUpperCase() === n ? n : n}.exe`, '10.0.263...', `C:\\WINDOWS\\system32\\${n}.exe`)); });
    if (!rows.length) {
      return psError(s, 'Get-Command', `The term '${a.Name}' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again.`,
        { target: a.Name, reason: 'CommandNotFoundException', fqid: 'CommandNotFoundException,Microsoft.PowerShell.Commands.GetCommandCommand' });
    }
    return `${header}\n${rows.join('\n')}\n\n`;
  }

  function psVersionTable(line) {
    if (/\.psversion\s*$/i.test(line)) return '\nMajor  Minor  Build  Revision\n-----  -----  -----  --------\n5      1      26300  7019\n\n';
    return `\nName                           Value\n----                           -----\nPSVersion                      ${PS_VERSION}\nPSEdition                      Desktop\nPSCompatibleVersions           {1.0, 2.0, 3.0, 4.0...}\nBuildVersion                   ${VERSION}\nCLRVersion                     4.0.30319.42000\nWSManStackVersion              3.0\nPSRemotingProtocolVersion      2.3\nSerializationVersion           1.1.0.1\n\n\n`;
  }

  /* ------------------------------------------------------------ registry */

  const clear = () => ({ action: 'clear', text: '' });

  const EXE = {
    ipconfig, ping, nslookup, tracert, netsh, getmac, arp: () => arp(), tasklist, taskkill, sfc, dism, chkdsk, shutdown, systeminfo, tree,
    hostname: () => hostName(),
    whoami: tokens => (tokens.some(t => /^\/user$/i.test(t.v))
      ? `\nUSER INFORMATION\n----------------\n\nUser Name         SID\n================= ==============================================\n${`${hostName().toLowerCase()}\\${P.user}`.padEnd(17)} S-1-5-21-3166401672-2209713214-1093847351-1001\n`
      : `${hostName().toLowerCase()}\\${P.user}`),
    notepad: app('notepad'), calc: app('calculator'), mspaint: app('paint'), msedge: app('msedge'), explorer: app('explorer'),
    control: app('control'), taskmgr: app('taskmgr'), winver: app('winver'), snippingtool: app('snippingtool'), wt: app('wt'),
    pathping: (tokens, s) => {
      const target = tokens.map(t => t.v).filter(v => !/^[-/]/.test(v)).pop();
      if (!target) return '\nUsage: pathping [-g host-list] [-h maximum_hops] [-i address] [-n]\n                [-p period] [-q num_queries] [-w timeout]\n                [-4] [-6] target_name\n';
      const r = isIPv4(target) ? { ok: true, ip: target } : machine.released ? { ok: false } : Win.Network.resolve(target);
      if (!r.ok) return `Unable to resolve target system name ${target}.`;
      const c = Win.Network.config();
      const reach = Win.Network.ping(target, 1);
      const hops = reach.ok ? [c.router, '100.72.0.1', '198.51.100.14', r.ip] : [c?.router || '0.0.0.0'];
      function* run() {
        yield { text: `\nTracing route to ${target} [${r.ip}]\nover a maximum of 30 hops:\n  0  ${hostName()}.${c?.suffix || 'local'} [${c?.ip || '0.0.0.0'}] \n`, delay: 100 };
        for (let i = 0; i < hops.length; i += 1) yield { text: `  ${i + 1}  ${hops[i]} \n`, delay: 500 };
        if (!reach.ok) yield { text: '  2     *        *        *     \n', delay: 3000 };
        yield { text: `\nComputing statistics for ${hops.length * 25} seconds...\n`, delay: 200 };
        const rows = hops.map((h, i) => `  ${i + 1}  ${String(i * 3 + 2).padStart(4)}ms     0/ 100 =  0%     0/ 100 =  0%  ${h} `);
        yield { text: `            Source to Here   This Node/Link\nHop  RTT    Lost/Sent = Pct  Lost/Sent = Pct  Address\n  0                                           ${hostName()} [${c?.ip || '0.0.0.0'}] \n${rows.join('\n')}\n\nTrace complete.\n`, delay: 6000 };
      }
      return stream(run());
    },
  };

  const CMD = {
    cls: clear, dir: cmdDir, cd: setLocation, chdir: setLocation, type: getContent, md: makeDir, mkdir: makeDir,
    del: removeItem, erase: removeItem, rd: removeItem, rmdir: removeItem, ren: renameItem, rename: renameItem,
    copy: (t, s, c) => transfer(t, s, c, 'copy'), move: (t, s, c) => transfer(t, s, c, 'move'), start: startCmd, help: cmdHelp,
    ver: () => `\nMicrosoft Windows [Version ${VERSION}]`,
    echo: (tokens, s, ctx) => {
      const rest = ctx.rest;
      if (!rest.trim()) return 'ECHO is on.';
      if (/^(on|off)$/i.test(rest.trim())) return '';
      return rest.replace(/^\s/, '');
    },
    'echo.': () => '\n',
    set: (tokens, s, ctx) => {
      const env = ENV();
      const prefix = ctx.rest.trim().toLowerCase();
      const keys = Object.keys(env).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })).filter(k => !prefix || k.toLowerCase().startsWith(prefix));
      if (!keys.length) return `Environment variable ${ctx.rest.trim()} not defined`;
      return keys.map(k => `${k}=${env[k]}`).join('\n');
    },
    title: (tokens, s, ctx) => ({ action: 'title', value: ctx.rest.trim(), text: '' }),
    date: tokens => (tokens.some(t => /^\/t$/i.test(t.v)) ? cmdDateT() : `The current date is: ${cmdDateT()}\nEnter the new date: (mm-dd-yy) \nA required privilege is not held by the client.`),
    time: tokens => {
      const d = new Date();
      if (tokens.some(t => /^\/t$/i.test(t.v))) return `${two(h12(d))}:${two(d.getMinutes())} ${ampm(d)}`;
      return `The current time is: ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${two(Math.floor(d.getMilliseconds() / 10))}\nEnter the new time: \nA required privilege is not held by the client.`;
    },
    pause: () => 'Press any key to continue . . . ',
  };

  const PSC = {
    'clear-host': clear,
    'get-childitem': psDir,
    'set-location': setLocation,
    'get-location': (tokens, s) => `\nPath\n----\n${cwdPath(s)}\n\n`,
    'get-content': getContent,
    'set-content': setContent,
    'add-content': setContent,
    'write-output': tokens => tokens.map(t => t.v).join('\n'),
    'write-host': tokens => tokens.filter(t => !/^-/.test(t.v) || t.q).map(t => t.v).join(' '),
    'new-item': newItem,
    mkdir: makeDir,
    'remove-item': removeItem,
    'rename-item': renameItem,
    'copy-item': (t, s, c) => transfer(t, s, c, 'copy'),
    'move-item': (t, s, c) => transfer(t, s, c, 'move'),
    'test-netconnection': testNetConnection,
    'get-netipconfiguration': getNetIPConfiguration,
    'get-netadapter': getNetAdapter,
    'resolve-dnsname': resolveDnsName,
    'clear-dnsclientcache': () => { machine.dns.clear(); return ''; },
    'get-process': getProcess,
    'stop-process': stopProcess,
    'start-process': startCmd,
    'get-date': () => `\n${longDate(new Date())} ${longTime(new Date())}\n\n`,
    'get-history': (tokens, s) => {
      if (!s.history.length) return '';
      return `\n  Id CommandLine\n  -- -----------\n${s.history.map((h, i) => `${String(i + 1).padStart(4)} ${h}`).join('\n')}\n\n`;
    },
    'get-command': getCommand,
    'get-help': psHelp,
    'restart-computer': () => { setTimeout(() => Win.Session?.restart?.(), 300); return ''; },
    'stop-computer': () => { setTimeout(() => Win.Session?.shutdown?.(), 300); return ''; },
  };

  /* PowerShell aliases (lower case) → cmdlet key in PSC. */
  const PS_ALIAS = {
    cls: 'clear-host', clear: 'clear-host', dir: 'get-childitem', ls: 'get-childitem', gci: 'get-childitem', cd: 'set-location', chdir: 'set-location',
    sl: 'set-location', pwd: 'get-location', gl: 'get-location', type: 'get-content', cat: 'get-content', gc: 'get-content', sc: 'set-content', ac: 'add-content',
    echo: 'write-output', write: 'write-output', ni: 'new-item', md: 'mkdir', del: 'remove-item', erase: 'remove-item', rm: 'remove-item', ri: 'remove-item',
    rd: 'remove-item', rmdir: 'remove-item', ren: 'rename-item', rni: 'rename-item', copy: 'copy-item', cp: 'copy-item', cpi: 'copy-item',
    move: 'move-item', mv: 'move-item', mi: 'move-item', tnc: 'test-netconnection', gip: 'get-netipconfiguration', ps: 'get-process', gps: 'get-process',
    kill: 'stop-process', spps: 'stop-process', start: 'start-process', saps: 'start-process', history: 'get-history', h: 'get-history', ghy: 'get-history',
    gcm: 'get-command', help: 'get-help', man: 'get-help',
  };

  const titleCase = key => key.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('-')
    .replace('Netipconfiguration', 'NetIPConfiguration').replace('Netadapter', 'NetAdapter').replace('Dnsname', 'DnsName')
    .replace('Netconnection', 'NetConnection').replace('Childitem', 'ChildItem').replace('Dnsclientcache', 'DnsClientCache');

  function lookup(s, name) {
    const lower = name.toLowerCase();
    const exe = lower.replace(/\.(exe|com)$/, '');
    if (s.profile === 'cmd') {
      if (CMD[lower]) return { fn: CMD[lower] };
      if (EXE[exe]) return { fn: EXE[exe] };
      return null;
    }
    if (exe !== lower && EXE[exe]) return { fn: EXE[exe] };
    const key = PS_ALIAS[lower] || lower;
    if (PSC[key]) return { fn: PSC[key], canonical: titleCase(key) };
    if (EXE[exe]) return { fn: EXE[exe] };
    return null;
  }

  /* ------------------------------------------------------------- dispatch */

  /** Normalise a handler result into a list or iterator of chunks. */
  function chunksOf(result) {
    if (result == null || result === '') return { list: [] };
    if (typeof result === 'string') return { list: [{ text: ensureNL(result) }] };
    if (result.stream) return { iter: result.stream, onCancel: result.onCancel };
    if (Array.isArray(result)) {
      const list = [];
      result.forEach(r => {
        const inner = chunksOf(r);
        if (inner.list) list.push(...inner.list);
      });
      return { list };
    }
    return { list: [result] };
  }

  /** Evaluate a bare PowerShell expression (strings, numbers, simple arithmetic). */
  function psExpression(line, s) {
    const t = line.trim();
    if (/^\$psversiontable(\.psversion)?$/i.test(t)) return psVersionTable(t);
    if (/^"[^"]*"$|^'[^']*'$/.test(t)) return t.slice(1, -1);
    if (/^[\d\s.+\-*/%()]+$/.test(t) && /\d/.test(t)) {
      let value;
      try { value = Function(`"use strict"; return (${t});`)(); } catch { return null; }
      if (typeof value !== 'number') return null;
      if (!Number.isFinite(value)) {
        return err(`Attempted to divide by zero.\nAt line:1 char:1\n+ ${t}\n+ ${'~'.repeat(t.length)}\n    + CategoryInfo          : NotSpecified: (:) [], RuntimeException\n    + FullyQualifiedErrorId : RuntimeException\n \n`);
      }
      return String(Math.round(value * 1e12) / 1e12);
    }
    if (/^\$(true|false|null)$/i.test(t)) return /null/i.test(t) ? '' : t.slice(1).replace(/^./, c => c.toUpperCase());
    if (/^\$/.test(t) && !/^\$env:/i.test(t)) return '';
    return null;
  }

  /**
   * Execute one command line in a session. Returns { list | iter, onCancel }.
   * The session is mutated (cwd, history, profile changes for nested shells).
   */
  function exec(rawLine, s) {
    const line = String(rawLine ?? '');
    s.line = line.trim();
    if (!line.trim()) return { list: [] };
    if (s.history[s.history.length - 1] !== line.trim()) s.history.push(line.trim());
    if (s.history.length > 200) s.history.shift();

    const expanded = expandVars(line, s);
    const segments = splitOutside(expanded, '|').map(seg => seg.trim());
    let first = segments[0];
    let redirect = null;
    const last = segments.length - 1;
    const redir = splitOutside(segments[last], '>');
    if (redir.length > 1) {
      const target = redir[redir.length - 1].trim().replace(/^"|"$/g, '');
      const append = redir.length > 2 && redir[redir.length - 2] === '';
      segments[last] = redir[0].trim();
      if (last === 0) first = segments[0];
      redirect = { target, append };
    }

    let result = runOne(first, s);
    const filters = segments.slice(1);
    if (filters.length || redirect) {
      const collected = collect(result);
      let text = collected.filter(c => c.cls !== 'err').map(c => c.text).join('');
      const errors = collected.filter(c => c.cls === 'err');
      for (const f of filters) {
        const ft = tokenize(f, s);
        const name = (ft[0]?.v || '').toLowerCase();
        const args = ft.slice(1).filter(t => t.q || !/^[-/]/.test(t.v)).map(t => t.v);
        if (['findstr', 'find', 'select-string', 'sls', 'where-object'].includes(name)) {
          const needle = (args[0] || '').toLowerCase();
          const caseless = name !== 'find' || ft.some(t => /^\/i$/i.test(t.v));
          text = text.split('\n').filter(l => (caseless ? l.toLowerCase() : l).includes(caseless ? needle : args[0] || '')).join('\n');
          if (text) text += '\n';
          if (name === 'select-string' || name === 'sls') text = text ? `\n${text}\n` : '';
        } else if (['more', 'out-host', 'out-default', 'oh', 'format-table', 'ft', 'format-list', 'fl', 'out-string'].includes(name)) {
          /* pass-through */
        } else if (name === 'clip' || name === 'set-clipboard' || name === 'scb') {
          try { navigator.clipboard?.writeText?.(text); } catch { /* blocked */ }
          text = '';
        } else if (name === 'sort' || name === 'sort-object') {
          text = text.split('\n').filter(Boolean).sort((x, y) => x.localeCompare(y)).join('\n') + '\n';
        } else if (name === 'measure-object' || name === 'measure') {
          const count = text.split('\n').filter(Boolean).length;
          text = `\n\nCount    : ${count}\nAverage  :\nSum      :\nMaximum  :\nMinimum  :\nProperty :\n\n\n\n`;
        } else {
          const known = lookup(s, name);
          if (!known) return { list: [...errors, chunksOf(notRecognized(s, ft[0]?.v || name)).list[0]] };
        }
      }
      if (redirect) {
        const problem = writeFile(s, redirect.target, text, redirect.append);
        return { list: [...errors, ...(problem ? [err(s.profile === 'cmd' ? problem : `out-file : ${problem}`)] : [])] };
      }
      return { list: [...errors, ...(text ? [{ text }] : [])] };
    }
    return result;
  }

  function runOne(segment, s) {
    const tokens = tokenize(segment, s);
    if (!tokens.length) return { list: [] };
    const head = tokens[0].v;
    const lowered = head.toLowerCase();

    /* Drive switch: `E:` */
    if (/^[a-z]:$/i.test(head) && tokens.length === 1) return chunksOf(switchDrive(s, head[0]));

    /* cmd's cd.. and cd\ shorthands */
    if (s.profile === 'cmd' && /^cd(\.\.|\\)/i.test(head)) {
      return chunksOf(setLocation([], s, { rest: head.slice(2) + segment.slice(head.length), name: 'cd' }));
    }

    if (lowered === 'exit') {
      if (s.stack.length) {
        const prev = s.stack.pop();
        s.profile = prev.profile;
        return { list: [] };
      }
      return { list: [{ action: 'exit', text: '' }] };
    }

    /* Nested shells */
    if (/^(powershell|powershell\.exe)$/i.test(head) && tokens.length === 1) {
      s.stack.push({ profile: s.profile });
      s.profile = 'powershell';
      return { list: [{ text: banner('powershell') + '\n' }] };
    }
    if (/^(cmd|cmd\.exe)$/i.test(head) && tokens.length === 1) {
      s.stack.push({ profile: s.profile });
      s.profile = 'cmd';
      return { list: [{ text: `${banner('cmd')}\n` }] };
    }
    if (/^(cmd|cmd\.exe)$/i.test(head) && /^\/[ck]$/i.test(tokens[1]?.v || '')) {
      const inner = { ...s, profile: 'cmd', stack: [] };
      const r = exec(tokens.slice(2).map(t => (t.q ? `"${t.v}"` : t.v)).join(' '), inner);
      s.cwd = inner.cwd;
      return r;
    }
    if (/^(powershell|powershell\.exe)$/i.test(head) && /^-(c|command)$/i.test(tokens[1]?.v || '')) {
      const inner = { ...s, profile: 'powershell', stack: [] };
      return exec(tokens.slice(2).map(t => (t.q ? `"${t.v}"` : t.v)).join(' '), inner);
    }

    if (s.profile === 'powershell') {
      const value = psExpression(segment, s);
      if (value != null) return chunksOf(value);
      if (/^\$env:/i.test(head)) return chunksOf(tokens.map(t => t.v).join(' '));
    }

    /* ms-settings: and URLs typed at the prompt behave like `start`. */
    if (/^ms-settings:/i.test(head)) return chunksOf(start(head));

    const found = lookup(s, head);
    if (!found) {
      const id = Win.FS.resolve(head, s.cwd);
      const node = id && Win.FS.get(id);
      if (node && !Win.FS.isFolder(node) && (s.profile === 'cmd' || /^[.\\]|^[a-z]:/i.test(head))) {
        openNode(id);
        return { list: [] };
      }
      return chunksOf(notRecognized(s, head));
    }
    const restIndex = segment.toLowerCase().indexOf(lowered) + head.length;
    const ctx = { name: lowered, rest: segment.slice(restIndex), canonical: found.canonical || head };
    try {
      return chunksOf(found.fn(tokens.slice(1), s, ctx));
    } catch (error) {
      console.error(error);
      return chunksOf(err(s.profile === 'cmd' ? 'The system cannot execute the specified program.' : `${head} : ${error.message}`));
    }
  }

  function collect(result, limit = 400) {
    if (result.list) return result.list;
    const out = [];
    let n = 0;
    for (const chunk of result.iter) {
      if (chunk.replace && out.length) {
        const prev = out[out.length - 1];
        const cut = prev.text.lastIndexOf('\n');
        prev.text = cut >= 0 ? prev.text.slice(0, cut + 1) : '';
      }
      out.push({ ...chunk });
      n += 1;
      if (n >= limit) break;
    }
    return out;
  }

  /** Pure runner used by tests and scripts: returns the printed text. */
  function run(line, s = makeSession()) {
    return collect(exec(line, s)).map(c => c.text || '').join('');
  }

  /* --------------------------------------------------------- completion */

  function complete(input, s) {
    const tokens = tokenize(input, s);
    const endsSpace = /\s$/.test(input);
    const word = endsSpace || !tokens.length ? '' : tokens[tokens.length - 1].v;
    const m = endsSpace ? null : input.match(/(?:"[^"]*"?|'[^']*'?|[^\s"']+)+$/);
    const start = m ? m.index : input.length;
    const first = tokens.length <= 1 && !endsSpace;
    const results = [];
    const [head, tail] = splitPath(word);
    const dir = head ? Win.FS.resolve(head, s.cwd) : s.cwd;
    if (dir && Win.FS.isFolder(Win.FS.get(dir))) {
      const kids = sortByName(Win.FS.children(dir, { hidden: false })).filter(n => n.name.toLowerCase().startsWith(tail.toLowerCase()));
      const dirsFirst = s.profile === 'cmd' ? kids : [...kids.filter(Win.FS.isFolder), ...kids.filter(n => !Win.FS.isFolder(n))];
      dirsFirst.forEach(n => {
        let value = head + n.name;
        if (s.profile === 'powershell' && !head) value = `.\\${n.name}`;
        if (/\s/.test(value)) value = s.profile === 'cmd' ? `"${value}"` : `'${value}'`;
        results.push(value);
      });
    }
    if (first && s.profile === 'powershell' && word) {
      Object.keys(PS_CMDLETS).filter(n => n.toLowerCase().startsWith(word.toLowerCase())).forEach(n => results.unshift(n));
    }
    return { start: Math.max(0, start), word, results };
  }

  /* -------------------------------------------------------- terminal UI */

  const SCHEMES = {
    Campbell: { bg: '#0c0c0c', fg: '#cccccc', red: '#e74856', yellow: '#f9f1a5', green: '#16c60c', cyan: '#3a96dd', gray: '#767676', sel: '#ffffff' },
    'Campbell Powershell': { bg: '#012456', fg: '#cccccc', red: '#e74856', yellow: '#f9f1a5', green: '#16c60c', cyan: '#3a96dd', gray: '#767676', sel: '#ffffff' },
    'One Half Dark': { bg: '#282c34', fg: '#dcdfe4', red: '#e06c75', yellow: '#e5c07b', green: '#98c379', cyan: '#56b6c2', gray: '#5a6374', sel: '#ffffff' },
    Vintage: { bg: '#000000', fg: '#c0c0c0', red: '#ff0000', yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', gray: '#808080', sel: '#ffffff' },
  };

  const TS = () => Win.state.terminal || Win.DefaultState.terminal;
  const profileTitle = (profile, admin) => `${admin ? 'Administrator: ' : ''}${profile === 'cmd' ? 'Command Prompt' : 'Windows PowerShell'}`;
  const profileIcon = profile => (profile === 'cmd' ? 'cmd' : profile === 'settings' ? 'settings' : 'powershell');

  function applyScheme(win) {
    const t = TS();
    const sc = SCHEMES[t.scheme] || SCHEMES.Campbell;
    const el = win.el;
    el.style.setProperty('--wt-bg', sc.bg);
    el.style.setProperty('--wt-fg', sc.fg);
    el.style.setProperty('--wt-red', sc.red);
    el.style.setProperty('--wt-yellow', sc.yellow);
    el.style.setProperty('--wt-green', sc.green);
    el.style.setProperty('--wt-cyan', sc.cyan);
    el.style.setProperty('--wt-gray', sc.gray);
    el.style.setProperty('--wt-size', `${Math.round((t.fontSize || 12) * 1.333)}px`);
    el.dataset.cursor = t.cursor || 'bar';
  }

  function highlightPS(text) {
    let first = true;
    return text.split(/(\s+|"[^"]*"?|'[^']*'?)/).map(part => {
      if (!part) return '';
      if (/^\s+$/.test(part)) return Win.esc(part);
      let cls = '';
      if (/^["']/.test(part)) cls = 'str';
      else if (first) cls = 'cmd';
      else if (/^-[a-z]/i.test(part)) cls = 'param';
      else if (/^\$/.test(part)) cls = 'var';
      else if (/^\d+$/.test(part)) cls = 'num';
      else if (part === '|') { first = true; return '<span class="wt-op">|</span>'; }
      first = false;
      return cls ? `<span class="wt-${cls}">${Win.esc(part)}</span>` : Win.esc(part);
    }).join('');
  }

  function createTerminal(win, args = {}) {
    win.state.tabs = [];
    win.state.active = null;
    applyScheme(win);
    win.el.classList.add('wt-win');
    win.titleContent.innerHTML = `<div class="wt-strip" role="tablist" aria-label="Tabs"></div>
      <button class="wt-new" aria-label="New tab" title="New Tab (Ctrl+Shift+T)">${Win.glyph('plus', 14)}</button>
      <button class="wt-drop" aria-label="Open a new tab dropdown" title="Open a new tab">${Win.glyph('chevdown', 12)}</button>
      <div class="wt-drag"></div>`;
    win.body.innerHTML = '<div class="wt-panes"></div>';
    const strip = win.titleContent.querySelector('.wt-strip');
    const panes = win.body.querySelector('.wt-panes');

    const renderTabs = () => {
      strip.innerHTML = win.state.tabs.map(t => `<div class="wt-tab ${t === win.state.active ? 'active' : ''}" role="tab" data-nodrag data-tab="${t.id}" aria-selected="${t === win.state.active}" tabindex="0" title="${Win.esc(t.title)}">
        <span class="wt-tab-ico">${Win.appIcon(profileIcon(t.kind === 'settings' ? 'settings' : t.s.profile), 16)}</span>
        <span class="wt-tab-title">${Win.esc(t.title)}</span>
        <button class="wt-tab-x" aria-label="Close tab" title="Close Tab">${Win.glyph('close', 10)}</button></div>`).join('');
      if (win.state.active) win.setTitle(win.state.active.title);
    };

    const activate = tab => {
      win.state.active = tab;
      win.state.tabs.forEach(t => t.el.classList.toggle('hidden', t !== tab));
      renderTabs();
      requestAnimationFrame(() => (tab.ta || tab.el.querySelector('select, input, button'))?.focus({ preventScroll: true }));
    };

    const closeTab = tab => {
      if (tab.running) cancel(tab, true);
      tab.el.remove();
      const i = win.state.tabs.indexOf(tab);
      win.state.tabs.splice(i, 1);
      if (!win.state.tabs.length) { win.close({ force: true }); return; }
      if (win.state.active === tab) activate(win.state.tabs[Math.max(0, i - 1)]);
      else renderTabs();
    };

    const write = (tab, text, cls = '', replace = false) => {
      const out = tab.out;
      if (replace) {
        /* Drop everything after the last newline in the buffer. */
        let node = out.lastChild;
        while (node) {
          const content = node.textContent;
          const nl = content.lastIndexOf('\n');
          if (nl >= 0) { node.textContent = content.slice(0, nl + 1); break; }
          const prev = node.previousSibling;
          node.remove();
          node = prev;
        }
      }
      if (!text) return;
      const span = document.createElement('span');
      if (cls) span.className = `wt-${cls}`;
      span.textContent = text;
      out.appendChild(span);
      while (out.childNodes.length > 4000) out.firstChild.remove();
    };

    const scrollEnd = tab => { tab.scroll.scrollTop = tab.scroll.scrollHeight; };

    const renderInput = tab => {
      const s = tab.s;
      const value = tab.ta.value;
      const caret = tab.ta.selectionStart ?? value.length;
      tab.promptEl.textContent = tab.running ? '' : prompt(s);
      const before = value.slice(0, caret);
      const at = value.slice(caret, caret + 1);
      const after = value.slice(caret + 1);
      const hl = s.profile === 'powershell' ? highlightPS : Win.esc;
      if (tab.running) { tab.inputEl.innerHTML = '<span class="wt-cursor"> </span>'; return; }
      /* Highlighting is cosmetic, so text after a mid-line caret is drawn plain. */
      tab.inputEl.innerHTML = caret >= value.length
        ? `${hl(value)}<span class="wt-cursor"> </span>`
        : `${hl(before)}<span class="wt-cursor">${Win.esc(at)}</span>${Win.esc(after)}`;
      tab.line.classList.remove('blink-reset');
      void tab.line.offsetWidth;
      tab.line.classList.add('blink-reset');
    };

    const finishCommand = tab => {
      tab.running = null;
      if (tab.s.profile === 'cmd') write(tab, '\n');
      renderInput(tab);
      scrollEnd(tab);
    };

    const cancel = (tab, silent = false) => {
      const job = tab.running;
      if (!job) return;
      job.cancelled = true;
      clearTimeout(job.timer);
      if (!silent) {
        const extra = job.onCancel?.();
        if (extra?.text) write(tab, extra.text, extra.cls);
        else write(tab, '^C\n');
        finishCommand(tab);
      }
    };

    const handleChunk = (tab, chunk) => {
      if (chunk.action === 'clear') { tab.out.textContent = ''; return; }
      if (chunk.action === 'exit') { setTimeout(() => closeTab(tab), 0); return 'exit'; }
      if (chunk.action === 'title') { tab.customTitle = chunk.value || null; tab.title = chunk.value || profileTitle(tab.s.profile, tab.s.admin); renderTabs(); return null; }
      write(tab, chunk.text, chunk.cls, chunk.replace);
      return null;
    };

    const submit = (tab, line) => {
      const s = tab.s;
      write(tab, prompt(s));
      if (s.profile === 'powershell') {
        const span = document.createElement('span');
        span.innerHTML = highlightPS(line);
        tab.out.appendChild(span);
      } else {
        write(tab, line);
      }
      write(tab, '\n');
      tab.ta.value = '';
      tab.histIndex = null;
      const result = exec(line, s);
      if (!tab.customTitle) tab.title = profileTitle(s.profile, s.admin);
      if (result.list) {
        for (const chunk of result.list) if (handleChunk(tab, chunk) === 'exit') return;
        renderTabs();
        finishCommand(tab);
        return;
      }
      const job = { iter: result.iter, onCancel: result.onCancel, cancelled: false, timer: null };
      tab.running = job;
      renderInput(tab);
      const step = () => {
        if (job.cancelled || win.closed) return;
        const next = job.iter.next();
        if (next.done) { finishCommand(tab); return; }
        const chunk = next.value;
        job.timer = setTimeout(() => {
          if (job.cancelled || win.closed) return;
          handleChunk(tab, chunk);
          scrollEnd(tab);
          step();
        }, chunk.delay || 0);
      };
      step();
    };

    const selectionInside = tab => {
      const sel = getSelection();
      return sel && !sel.isCollapsed && tab.scroll.contains(sel.anchorNode) ? sel.toString() : '';
    };

    const copySelection = text => { try { navigator.clipboard?.writeText?.(text); } catch { /* blocked */ } getSelection()?.removeAllRanges(); };

    const paste = async tab => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text) return;
        const ta = tab.ta;
        const at = ta.selectionStart;
        ta.value = ta.value.slice(0, at) + text.replace(/\r?\n/g, ' ') + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = at + text.length;
        renderInput(tab);
      } catch { /* clipboard permission denied */ }
      tab.ta.focus();
    };

    const addShell = (profile, { cwd = null, command = '', admin = false } = {}) => {
      const s = makeSession(profile, { cwd, admin });
      const tab = { id: Win.uid('t'), kind: 'shell', s, title: profileTitle(s.profile, admin), histIndex: null, running: null, completion: null };
      tab.el = Win.html(`<div class="wt-pane" data-pane="${tab.id}">
        <div class="wt-scroll" tabindex="-1"><div class="wt-out"></div><div class="wt-line"><span class="wt-prompt"></span><span class="wt-input"></span></div></div>
        <textarea class="wt-ta" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="${Win.esc(tab.title)} input" rows="1"></textarea>
      </div>`);
      tab.scroll = tab.el.querySelector('.wt-scroll');
      tab.out = tab.el.querySelector('.wt-out');
      tab.line = tab.el.querySelector('.wt-line');
      tab.promptEl = tab.el.querySelector('.wt-prompt');
      tab.inputEl = tab.el.querySelector('.wt-input');
      tab.ta = tab.el.querySelector('.wt-ta');
      panes.appendChild(tab.el);
      win.state.tabs.push(tab);
      write(tab, `${banner(s.profile)}\n`);
      renderInput(tab);
      wireShell(tab);
      activate(tab);
      if (command) setTimeout(() => submit(tab, command), 60);
      return tab;
    };

    const wireShell = tab => {
      const ta = tab.ta;
      ta.addEventListener('input', () => {
        if (/[\r\n]/.test(ta.value)) ta.value = ta.value.replace(/\r?\n/g, ' ');
        tab.completion = null;
        renderInput(tab);
        scrollEnd(tab);
      });
      ta.addEventListener('focus', () => tab.el.classList.add('focused'));
      ta.addEventListener('blur', () => tab.el.classList.remove('focused'));
      ta.addEventListener('keydown', e => {
        const s = tab.s;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'c') {
          const text = selectionInside(tab);
          if (text) { e.preventDefault(); copySelection(text); return; }
          e.preventDefault();
          if (tab.running) { cancel(tab); return; }
          write(tab, prompt(s) + ta.value + (s.profile === 'cmd' ? '^C\n' : '\n'));
          ta.value = '';
          renderInput(tab);
          scrollEnd(tab);
          return;
        }
        if (ctrl && e.key.toLowerCase() === 'l' && !e.shiftKey) { e.preventDefault(); tab.out.textContent = ''; renderInput(tab); return; }
        if (tab.running) { if (!ctrl) e.preventDefault(); return; }
        if (e.key === 'Enter') { e.preventDefault(); submit(tab, ta.value); scrollEnd(tab); return; }
        if (e.key === 'Escape') { e.preventDefault(); ta.value = ''; renderInput(tab); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const h = s.history;
          if (!h.length) return;
          if (tab.histIndex == null) tab.histIndex = h.length;
          tab.histIndex = Win.clamp(tab.histIndex + (e.key === 'ArrowUp' ? -1 : 1), 0, h.length);
          ta.value = h[tab.histIndex] ?? '';
          ta.selectionStart = ta.selectionEnd = ta.value.length;
          renderInput(tab);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const before = ta.value.slice(0, ta.selectionStart);
          if (!tab.completion) {
            const c = complete(before, s);
            if (!c.results.length) return;
            tab.completion = { ...c, i: -1, prefix: before.slice(0, c.start), suffix: ta.value.slice(ta.selectionStart) };
          }
          const c = tab.completion;
          c.i = (c.i + (e.shiftKey ? -1 : 1) + c.results.length) % c.results.length;
          ta.value = c.prefix + c.results[c.i] + c.suffix;
          ta.selectionStart = ta.selectionEnd = (c.prefix + c.results[c.i]).length;
          renderInput(tab);
          return;
        }
        if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); tab.scroll.scrollTop += (e.key === 'PageUp' ? -1 : 1) * tab.scroll.clientHeight * 0.9; }
        if (/^(Arrow(Left|Right)|Home|End|Delete)$/.test(e.key)) requestAnimationFrame(() => renderInput(tab));
      });
      tab.scroll.addEventListener('mouseup', e => {
        if (e.button !== 0) return;
        if (!selectionInside(tab)) ta.focus({ preventScroll: true });
      });
      tab.scroll.addEventListener('contextmenu', e => {
        e.preventDefault();
        const text = selectionInside(tab);
        if (text) copySelection(text);
        else paste(tab);
      });
    };

    const addSettings = () => {
      const existing = win.state.tabs.find(t => t.kind === 'settings');
      if (existing) { activate(existing); return; }
      const draft = { ...TS() };
      const tab = { id: Win.uid('t'), kind: 'settings', title: 'Settings', s: { profile: 'settings' } };
      const opts = (list, value) => list.map(([v, l]) => `<option value="${Win.esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${Win.esc(l)}</option>`).join('');
      tab.el = Win.html(`<div class="wt-pane wt-settings" data-pane="${tab.id}">
        <nav class="wt-set-nav" aria-label="Settings">
          <button class="active" data-sec="startup">${Win.glyph('home', 16)}<span>Startup</span></button>
          <button data-sec="appearance">${Win.glyph('palette', 16)}<span>Appearance</span></button>
          <button data-sec="defaults">${Win.glyph('terminal', 16)}<span>Defaults</span></button>
        </nav>
        <div class="wt-set-main">
          <section data-sec="startup"><h1>Startup</h1>
            <label class="wt-set-row"><span><b>Default profile</b><small>Profile that opens when you click the '+' icon or type the key binding for a new tab.</small></span>
              <select class="combo" data-k="defaultProfile">${opts([['powershell', 'Windows PowerShell'], ['cmd', 'Command Prompt']], draft.defaultProfile)}</select></label>
            <div class="wt-set-row"><span><b>Default terminal application</b><small>The terminal application that launches when a command-line application is run without an existing session.</small></span><span class="muted">Windows Terminal</span></div>
          </section>
          <section data-sec="appearance" class="hidden"><h1>Appearance</h1>
            <label class="wt-set-row"><span><b>Color scheme</b><small>Applies to every profile.</small></span>
              <select class="combo" data-k="scheme">${opts(Object.keys(SCHEMES).map(k => [k, k]), draft.scheme)}</select></label>
          </section>
          <section data-sec="defaults" class="hidden"><h1>Defaults</h1>
            <label class="wt-set-row"><span><b>Font size</b><small>Size of the font in points.</small></span>
              <input class="input" type="number" min="6" max="36" data-k="fontSize" value="${Win.esc(draft.fontSize)}" style="width:96px"></label>
            <label class="wt-set-row"><span><b>Cursor shape</b></span>
              <select class="combo" data-k="cursor">${opts([['bar', 'Bar ( \u2503 )'], ['underscore', 'Underscore ( \u2581 )'], ['filledBox', 'Filled box ( \u2588 )'], ['emptyBox', 'Empty box ( \u25af )']], draft.cursor)}</select></label>
          </section>
          <footer class="wt-set-foot"><button class="btn accent" data-act="save">Save</button><button class="btn" data-act="discard">Discard changes</button></footer>
        </div></div>`);
      tab.el.addEventListener('click', e => {
        const nav = e.target.closest('[data-sec]');
        if (nav && nav.tagName === 'BUTTON') {
          tab.el.querySelectorAll('.wt-set-nav button').forEach(b => b.classList.toggle('active', b === nav));
          tab.el.querySelectorAll('section[data-sec]').forEach(sec => sec.classList.toggle('hidden', sec.dataset.sec !== nav.dataset.sec));
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'save') {
          tab.el.querySelectorAll('[data-k]').forEach(input => { draft[input.dataset.k] = input.type === 'number' ? Win.clamp(Number(input.value) || 12, 6, 36) : input.value; });
          Win.state.terminal = { ...TS(), ...draft };
          Win.save('terminal');
        }
        if (act === 'discard') closeTab(tab);
      });
      panes.appendChild(tab.el);
      win.state.tabs.push(tab);
      activate(tab);
    };

    const dropdown = button => {
      const r = button.getBoundingClientRect();
      Win.menu(r.left, r.bottom + 4, [
        { label: 'Windows PowerShell', icon: Win.appIcon('powershell', 16), shortcut: 'Ctrl+Shift+1', action: () => addShell('powershell') },
        { label: 'Command Prompt', icon: Win.appIcon('cmd', 16), shortcut: 'Ctrl+Shift+2', action: () => addShell('cmd') },
        { divider: true },
        { label: 'Run as administrator', glyph: 'shield', submenu: [
          { label: 'Windows PowerShell', icon: Win.appIcon('powershell', 16), action: () => elevate('powershell') },
          { label: 'Command Prompt', icon: Win.appIcon('cmd', 16), action: () => elevate('cmd') },
        ] },
        { divider: true },
        { label: 'Settings', glyph: 'gear', shortcut: 'Ctrl+,', action: addSettings },
        { label: 'About', glyph: 'info', action: () => Win.dialog({ owner: win, title: 'About', body: '<p><b>Windows Terminal</b></p><p>Version: 1.23.12811.0</p>' }) },
      ]);
    };

    const elevate = profile => {
      const go = () => Win.wm.open('terminal', { profile, admin: true });
      if (Win.UAC) Win.UAC('Terminal', go);
      else Win.confirm('User Account Control', 'Do you want to allow this app to make changes to your device?\n\nTerminal\nVerified publisher: Microsoft Corporation', { ok: 'Yes', cancel: 'No' }).then(ok => ok && go());
    };

    strip.addEventListener('click', e => {
      const tabEl = e.target.closest('[data-tab]');
      if (!tabEl) return;
      const tab = win.state.tabs.find(t => t.id === tabEl.dataset.tab);
      if (e.target.closest('.wt-tab-x')) { e.stopPropagation(); closeTab(tab); return; }
      activate(tab);
    });
    strip.addEventListener('auxclick', e => {
      if (e.button !== 1) return;
      const tabEl = e.target.closest('[data-tab]');
      if (tabEl) closeTab(win.state.tabs.find(t => t.id === tabEl.dataset.tab));
    });
    strip.addEventListener('keydown', e => {
      const tabEl = e.target.closest('[data-tab]');
      if (tabEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(win.state.tabs.find(t => t.id === tabEl.dataset.tab)); }
    });
    win.titleContent.querySelector('.wt-new').addEventListener('click', e => {
      if (e.ctrlKey) { elevate(TS().defaultProfile); return; }
      addShell(TS().defaultProfile);
    });
    win.titleContent.querySelector('.wt-drop').addEventListener('click', e => dropdown(e.currentTarget));

    win.el.addEventListener('keydown', e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && (k === 't')) { e.preventDefault(); addShell(TS().defaultProfile); }
      else if (e.shiftKey && k === 'w') { e.preventDefault(); if (win.state.active) closeTab(win.state.active); }
      else if (e.shiftKey && (e.code === 'Digit1' || k === '!')) { e.preventDefault(); addShell('powershell'); }
      else if (e.shiftKey && (e.code === 'Digit2' || k === '@')) { e.preventDefault(); addShell('cmd'); }
      else if (k === ',') { e.preventDefault(); addSettings(); }
      else if (k === 'tab') {
        e.preventDefault();
        const list = win.state.tabs;
        const i = list.indexOf(win.state.active);
        activate(list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]);
      } else if (k === '=' || k === '+' || k === '-' || k === '0') {
        e.preventDefault();
        const t = TS();
        const size = k === '0' ? 12 : Win.clamp((t.fontSize || 12) + (k === '-' ? -1 : 1), 6, 36);
        Win.state.terminal = { ...t, fontSize: size };
        Win.save('terminal');
      } else if (e.shiftKey && k === 'v' && win.state.active?.ta) { e.preventDefault(); paste(win.state.active); }
      else if (e.shiftKey && k === 'c' && win.state.active?.scroll) { const text = selectionInside(win.state.active); if (text) { e.preventDefault(); copySelection(text); } }
    });

    win.listen('terminal', () => applyScheme(win));
    win.cleanup(() => win.state.tabs.forEach(t => { if (t.running) cancel(t, true); }));
    win.api = { addShell, addSettings };

    addShell(args.profile || TS().defaultProfile, { cwd: args.cwd, command: args.command, admin: !!args.admin });
  }

  /* ------------------------------------------------------------- register */

  Win.apps.register({
    id: 'terminal', name: 'Terminal', icon: 'terminal', customTitle: true,
    width: 860, height: 520, minWidth: 420, minHeight: 240, category: 'Developer tools',
    keywords: ['powershell', 'cmd', 'command prompt', 'shell', 'console', 'wt'],
    create: createTerminal,
  });

  const launcher = profile => args => {
    /* Elevated requests or explicit new windows always get their own window. */
    Win.wm.open('terminal', { ...args, profile });
  };

  Win.apps.register({ id: 'cmd', name: 'Command Prompt', icon: 'cmd', hidden: true, keywords: ['cmd', 'command prompt', 'dos'], launch: launcher('cmd'), create() {} });
  Win.apps.register({ id: 'powershell', name: 'Windows PowerShell', icon: 'powershell', hidden: true, keywords: ['powershell', 'ps'], launch: launcher('powershell'), create() {} });

  /** Shell processes per terminal tab, for tasklist and Task Manager. */
  function shellProcesses() {
    const out = [];
    Win.wm.windows.filter(w => w.app.id === 'terminal').forEach(w => (w.state.tabs || []).forEach(t => {
      if (t.kind !== 'shell') return;
      t.pid ||= 6000 + (hash(t.id) % 9000) * 2;
      out.push({ image: t.s.profile === 'cmd' ? 'cmd.exe' : 'powershell.exe', pid: t.pid, title: t.title, win: w, tab: t,
        close: () => w.state.tabs.includes(t) && t.el.isConnected && w.titleContent.querySelector(`[data-tab="${t.id}"] .wt-tab-x`)?.click() });
    }));
    return out;
  }

  Win.Terminal = {
    session: makeSession,
    run,
    exec,
    complete,
    prompt,
    banner,
    start,
    noteDns,
    processes: shellProcesses,
    state: machine,
  };
})(window.Win);
