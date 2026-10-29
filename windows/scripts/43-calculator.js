/* ===========================================================================
   Calculator: Standard, Scientific and Date calculation.

   Win.Calculator.engine(mode) is the arithmetic core with Windows Calculator
   semantics: immediate execution in Standard (2 + 3 × 4 = 20), operator
   precedence in Scientific (= 14), repeat-equals, CE vs C, percent relative
   to the pending operand, and the "Cannot divide by zero" family of errors.
   =========================================================================== */

(function (Win) {
  'use strict';

  Win.DefaultState.calculator = { mode: 'standard', angle: 'deg' };

  const SYM = { '+': '+', '-': '−', '*': '×', '/': '÷', '^': '^', mod: 'mod', yroot: 'yroot' };
  const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, mod: 2, '^': 3, yroot: 3 };

  class CalcError extends Error {}

  const group = digits => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  /** Format a number the way Calculator's display does. */
  function fmt(n) {
    if (!Number.isFinite(n)) throw new CalcError('Overflow');
    if (Object.is(n, -0)) n = 0;
    const r = Number(n.toPrecision(15));
    const a = Math.abs(r);
    if (a !== 0 && (a >= 1e16 || a < 1e-6)) {
      let [m, e] = r.toExponential().split('e');
      if (!m.includes('.')) m += '.';
      return `${m}e${e.startsWith('-') ? e : `+${e.replace('+', '')}`}`;
    }
    let s = r.toFixed(Math.max(0, Math.min(15, 15 - Math.floor(Math.log10(a || 1)))));
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    const neg = s.startsWith('-');
    const [i, f] = s.replace('-', '').split('.');
    return `${neg ? '-' : ''}${group(i)}${f ? `.${f}` : ''}`;
  }

  function fmtEntry(text) {
    const neg = text.startsWith('-');
    const [i, f] = text.replace('-', '').split('.');
    return `${neg ? '-' : ''}${group(i)}${text.includes('.') ? `.${f}` : ''}`;
  }

  function factorial(n) {
    if (n < 0 || !Number.isInteger(n)) throw new CalcError('Invalid input');
    if (n > 170) throw new CalcError('Overflow');
    let r = 1;
    for (let i = 2; i <= n; i += 1) r *= i;
    return r;
  }

  function apply(a, op, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new CalcError(a === 0 ? 'Result is undefined' : 'Cannot divide by zero');
        return a / b;
      case 'mod':
        if (b === 0) throw new CalcError('Result is undefined');
        return a - b * Math.floor(a / b);
      case '^': return a ** b;
      case 'yroot':
        if (b === 0) throw new CalcError('Invalid input');
        return a < 0 && b % 2 ? -((-a) ** (1 / b)) : a ** (1 / b);
      default: return b;
    }
  }

  /** The calculator core. Feed it keys with press(); read display/expression. */
  function engine(mode = 'standard') {
    const e = {
      mode,
      angle: 'deg',
      history: [],
      memory: [],
      second: false,
    };
    let vals;
    let ops;
    let parts;
    let entry;
    let error;
    let last;
    let justEq;
    let lastWasOp;
    let depth;

    const reset = () => {
      vals = []; ops = []; parts = []; error = null; justEq = false; lastWasOp = false; depth = 0;
      entry = { text: '0', value: 0, typing: false, expr: null, closed: false };
    };
    reset();

    const cur = () => (entry.typing ? Number(entry.text) : entry.value);
    const prec = op => (e.mode === 'standard' ? 1 : PREC[op]);
    const setValue = (value, expr = null) => { entry = { text: '', value, typing: false, expr, closed: false }; fmt(value); };

    const fail = err => {
      if (!(err instanceof CalcError)) throw err;
      error = err.message;
      vals = []; ops = []; justEq = false;
    };

    const reduce = minPrec => {
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        if (minPrec != null && prec(top) < minPrec) break;
        ops.pop();
        const b = vals.pop();
        const a = vals.pop();
        last = { op: top, operand: b };
        vals.push(apply(a, top, b));
      }
    };

    const operandText = () => entry.expr ?? fmt(cur());

    const startFresh = () => { if (justEq) { parts = []; justEq = false; } };

    const digit = d => {
      if (error) reset();
      if (justEq) { parts = []; justEq = false; vals = []; ops = []; }
      lastWasOp = false;
      if (!entry.typing) { entry = { text: d === '.' ? '0.' : d, typing: true, expr: null, closed: false }; return; }
      if (d === '.') { if (!entry.text.includes('.')) entry.text += '.'; return; }
      if (entry.text.replace(/[-.]/g, '').length >= 16) return;
      entry.text = entry.text === '0' ? d : entry.text === '-0' ? `-${d}` : entry.text + d;
    };

    const binary = op => {
      if (error) return;
      if (justEq) { parts = []; justEq = false; }
      if (lastWasOp && ops.length && ops[ops.length - 1] !== '(') {
        ops[ops.length - 1] = op;
        parts[parts.length - 1] = SYM[op];
        return;
      }
      try {
        if (!entry.closed) parts.push(operandText());
        vals.push(cur());
        reduce(op === '^' || op === 'yroot' ? prec(op) + 1 : prec(op));
        ops.push(op);
        parts.push(SYM[op]);
        setValue(vals[vals.length - 1]);
        lastWasOp = true;
      } catch (err) { fail(err); }
    };

    const equals = () => {
      if (error) { reset(); return; }
      try {
        if (!ops.length) {
          if (justEq && last) {
            const v = cur();
            const r = apply(v, last.op, last.operand);
            parts = [fmt(v), SYM[last.op], fmt(last.operand), '='];
            setValue(r);
          } else {
            parts = [operandText(), '='];
            setValue(cur());
          }
        } else {
          if (!entry.closed) parts.push(operandText());
          vals.push(cur());
          while (ops.length) {
            reduce();
            if (ops[ops.length - 1] === '(') { ops.pop(); parts.push(')'); }
          }
          depth = 0;
          parts.push('=');
          const r = vals.pop();
          vals = [];
          setValue(r);
        }
        e.history.unshift({ expr: parts.join(' '), result: fmt(entry.value) });
        if (e.history.length > 50) e.history.pop();
        justEq = true;
        lastWasOp = false;
      } catch (err) { fail(err); }
    };

    const unary = (name, fn, label) => {
      if (error) return;
      startFresh();
      try {
        const v = cur();
        const r = fn(v);
        if (!Number.isFinite(r) || Number.isNaN(r)) throw new CalcError(Number.isNaN(r) ? 'Invalid input' : 'Overflow');
        const inner = entry.expr ?? fmt(v);
        setValue(r, label === null ? fmt(r) : `${label}(${inner})`);
        lastWasOp = false;
      } catch (err) { fail(err); }
    };

    const toRad = v => (e.angle === 'deg' ? (v * Math.PI) / 180 : e.angle === 'grad' ? (v * Math.PI) / 200 : v);
    const fromRad = v => (e.angle === 'deg' ? (v * 180) / Math.PI : e.angle === 'grad' ? (v * 200) / Math.PI : v);
    const trig = fn => v => {
      const r = fn(toRad(v));
      if (fn === Math.tan && Math.abs(Math.cos(toRad(v))) < 1e-15) throw new CalcError('Invalid input');
      return Math.abs(r) < 1e-15 ? 0 : r;
    };
    const inverse = fn => v => {
      if ((fn === Math.asin || fn === Math.acos) && Math.abs(v) > 1) throw new CalcError('Invalid input');
      return fromRad(fn(v));
    };

    const UNARY = {
      inv: [v => { if (v === 0) throw new CalcError('Cannot divide by zero'); return 1 / v; }, '1/'],
      sqr: [v => v * v, 'sqr'],
      cube: [v => v ** 3, 'cube'],
      sqrt: [v => { if (v < 0) throw new CalcError('Invalid input'); return Math.sqrt(v); }, '√'],
      cbrt: [v => Math.cbrt(v), 'cuberoot'],
      pow10: [v => 10 ** v, '10^'],
      pow2: [v => 2 ** v, '2^'],
      exp: [v => Math.exp(v), 'e^'],
      log: [v => { if (v <= 0) throw new CalcError('Invalid input'); return Math.log10(v); }, 'log'],
      ln: [v => { if (v <= 0) throw new CalcError('Invalid input'); return Math.log(v); }, 'ln'],
      fact: [factorial, 'fact'],
      abs: [Math.abs, 'abs'],
      sin: [trig(Math.sin), 'sin'], cos: [trig(Math.cos), 'cos'], tan: [trig(Math.tan), 'tan'],
      asin: [inverse(Math.asin), 'sin⁻¹'], acos: [inverse(Math.acos), 'cos⁻¹'], atan: [inverse(Math.atan), 'tan⁻¹'],
    };

    const percent = () => {
      if (error) return;
      startFresh();
      const x = cur();
      const op = ops[ops.length - 1];
      let v;
      if (op === '+' || op === '-') v = (vals[vals.length - 1] * x) / 100;
      else if (op === '*' || op === '/') v = x / 100;
      else v = 0;
      setValue(v, fmt(v));
      lastWasOp = false;
    };

    const negate = () => {
      if (error) return;
      if (entry.typing) {
        if (entry.text === '0') return;
        entry.text = entry.text.startsWith('-') ? entry.text.slice(1) : `-${entry.text}`;
        return;
      }
      startFresh();
      const v = cur();
      setValue(-v, `negate(${entry.expr ?? fmt(v)})`);
      lastWasOp = false;
    };

    const backspace = () => {
      if (error) { reset(); return; }
      if (justEq) { parts = []; return; }
      if (!entry.typing) return;
      entry.text = entry.text.slice(0, -1);
      if (!entry.text || entry.text === '-' || entry.text === '-0') entry.text = '0';
    };

    const paren = open => {
      if (error || e.mode !== 'scientific') return;
      startFresh();
      if (open) {
        if (!lastWasOp && (vals.length || ops.length) && !entry.typing) return;
        ops.push('(');
        parts.push('(');
        depth += 1;
        entry = { text: '0', value: 0, typing: false, expr: null, closed: false };
        lastWasOp = true;
        return;
      }
      if (!depth) return;
      try {
        if (!entry.closed) parts.push(operandText());
        vals.push(cur());
        reduce();
        ops.pop();
        depth -= 1;
        parts.push(')');
        setValue(vals.pop());
        entry.closed = true;
        lastWasOp = false;
      } catch (err) { fail(err); }
    };

    const constant = v => {
      if (error) reset();
      if (justEq) { parts = []; justEq = false; vals = []; ops = []; }
      setValue(v);
      lastWasOp = false;
    };

    e.press = key => {
      const k = String(key);
      if (/^[0-9]$/.test(k) || k === '.') digit(k);
      else if (k === '+' || k === '-' || k === '*' || k === '/' || k === '^' || k === 'mod' || k === 'yroot') binary(k);
      else if (k === '=' || k === 'Enter') equals();
      else if (k === 'C' || k === 'Escape') reset();
      else if (k === 'CE' || k === 'Delete') { if (error) reset(); else { entry = { text: '0', value: 0, typing: false, expr: null, closed: false }; if (justEq) { parts = []; justEq = false; } } }
      else if (k === 'Backspace') backspace();
      else if (k === '%') percent();
      else if (k === 'negate' || k === 'F9') negate();
      else if (k === '(') paren(true);
      else if (k === ')') paren(false);
      else if (k === 'pi') constant(Math.PI);
      else if (k === 'e') constant(Math.E);
      else if (UNARY[k]) unary(k, UNARY[k][0], UNARY[k][1]);
      return e;
    };

    e.pressAll = keys => { keys.forEach(k => e.press(k)); return e; };

    e.memoryOp = op => {
      if (error) return;
      const v = cur();
      if (op === 'MS') e.memory.unshift(v);
      if (op === 'M+') { if (!e.memory.length) e.memory.push(0); e.memory[0] += v; }
      if (op === 'M-') { if (!e.memory.length) e.memory.push(0); e.memory[0] -= v; }
      if (op === 'MR' && e.memory.length) { startFresh(); setValue(e.memory[0]); lastWasOp = false; return; }
      if (op === 'MC') e.memory = [];
      if (entry.typing) setValue(v);
    };

    e.recall = value => { if (error) reset(); startFresh(); setValue(value); lastWasOp = false; };

    e.useHistory = item => {
      reset();
      parts = [item.expr];
      setValue(Number(item.result.replace(/,/g, '')));
      justEq = true;
    };

    e.setMode = m => { e.mode = m; reset(); };
    e.clear = reset;
    e.isError = () => !!error;
    e.value = () => cur();
    e.display = () => {
      if (error) return error;
      return entry.typing ? fmtEntry(entry.text) : fmt(entry.value);
    };
    e.expression = () => {
      if (error) return parts.join(' ');
      const pending = !justEq && entry.expr && !entry.closed ? [entry.expr] : [];
      return [...parts, ...pending].join(' ');
    };
    e.parens = () => depth;
    return e;
  }

  /* ----------------------------------------------------------- date calc */

  function dateDiff(a, b) {
    let start = new Date(Math.min(a, b));
    const end = new Date(Math.max(a, b));
    start = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = Math.round((stop - start) / 86400000);
    if (!days) return { days: 0, text: 'Same dates' };
    let y = stop.getFullYear() - start.getFullYear();
    let m = stop.getMonth() - start.getMonth();
    let d = stop.getDate() - start.getDate();
    if (d < 0) { m -= 1; d += new Date(stop.getFullYear(), stop.getMonth(), 0).getDate(); }
    if (m < 0) { y -= 1; m += 12; }
    const w = Math.floor(d / 7);
    d %= 7;
    const bits = [[y, 'year'], [m, 'month'], [w, 'week'], [d, 'day']].filter(([n]) => n).map(([n, u]) => `${n} ${u}${n === 1 ? '' : 's'}`);
    return { days, text: bits.join(', ') };
  }

  /* -------------------------------------------------------------- window */

  const STANDARD_KEYS = [
    ['%', '%', 'fn'], ['CE', 'CE', 'fn'], ['C', 'C', 'fn'], ['Backspace', 'back', 'fn'],
    ['inv', '¹∕ₓ', 'fn'], ['sqr', 'x²', 'fn'], ['sqrt', '²√x', 'fn'], ['/', '÷', 'op'],
    ['7', '7', 'num'], ['8', '8', 'num'], ['9', '9', 'num'], ['*', '×', 'op'],
    ['4', '4', 'num'], ['5', '5', 'num'], ['6', '6', 'num'], ['-', '−', 'op'],
    ['1', '1', 'num'], ['2', '2', 'num'], ['3', '3', 'num'], ['+', '+', 'op'],
    ['negate', '+/−', 'num'], ['0', '0', 'num'], ['.', '.', 'num'], ['=', '=', 'eq'],
  ];

  const sciKeys = second => [
    ['2nd', '2ⁿᵈ', 'fn toggle'], ['pi', 'π', 'fn'], ['e', 'e', 'fn'], ['C', 'C', 'fn'], ['Backspace', 'back', 'fn'],
    second ? ['cube', 'x³', 'fn'] : ['sqr', 'x²', 'fn'], ['inv', '¹∕ₓ', 'fn'], ['abs', '|x|', 'fn'], ['exp', 'exp', 'fn'], ['mod', 'mod', 'fn'],
    second ? ['cbrt', '³√x', 'fn'] : ['sqrt', '²√x', 'fn'], ['(', '(', 'fn'], [')', ')', 'fn'], ['fact', 'n!', 'fn'], ['/', '÷', 'op'],
    second ? ['yroot', 'ʸ√x', 'fn'] : ['^', 'xʸ', 'fn'], ['7', '7', 'num'], ['8', '8', 'num'], ['9', '9', 'num'], ['*', '×', 'op'],
    second ? ['pow2', '2ˣ', 'fn'] : ['pow10', '10ˣ', 'fn'], ['4', '4', 'num'], ['5', '5', 'num'], ['6', '6', 'num'], ['-', '−', 'op'],
    second ? ['exp', 'eˣ', 'fn'] : ['log', 'log', 'fn'], ['1', '1', 'num'], ['2', '2', 'num'], ['3', '3', 'num'], ['+', '+', 'op'],
    ['ln', 'ln', 'fn'], ['negate', '+/−', 'num'], ['0', '0', 'num'], ['.', '.', 'num'], ['=', '=', 'eq'],
  ];

  const LABELS = {
    '%': 'Percent', CE: 'Clear entry', C: 'Clear', Backspace: 'Backspace', inv: 'Reciprocal', sqr: 'Square', sqrt: 'Square root', '/': 'Divide by', '*': 'Multiply by',
    '-': 'Minus', '+': 'Plus', '=': 'Equals', negate: 'Positive negative', '.': 'Decimal separator', pi: 'Pi', e: 'Euler’s number', abs: 'Absolute value',
    exp: 'Exponential', mod: 'Modulo', '(': 'Left parenthesis', ')': 'Right parenthesis', fact: 'Factorial', '^': 'X to the exponent', pow10: 'Ten to the exponent',
    log: 'Log', ln: 'Natural log', '2nd': 'Inverse function', cube: 'Cube', cbrt: 'Cube root', yroot: 'Y root', pow2: 'Two to the exponent',
    sin: 'Sine', cos: 'Cosine', tan: 'Tangent',
  };

  const KEYMAP = {
    Enter: '=', '=': '=', Escape: 'C', Delete: 'CE', Backspace: 'Backspace', '%': '%', F9: 'negate', r: 'inv', R: 'inv', '@': 'sqrt', q: 'sqr', Q: 'sqr',
    '+': '+', '-': '-', '*': '*', '/': '/', '.': '.', ',': '.', '(': '(', ')': ')', '^': '^', '!': 'fact', p: 'pi', P: 'pi', l: 'log', n: 'ln', s: 'sin', o: 'cos', t: 'tan',
  };

  const MODES = [['standard', 'Standard'], ['scientific', 'Scientific'], ['date', 'Date calculation']];

  function create(win) {
    const S = () => Win.state.calculator;
    const eng = engine(S().mode === 'scientific' ? 'scientific' : 'standard');
    eng.angle = S().angle || 'deg';
    const st = win.state;
    st.mode = S().mode || 'standard';
    st.panel = 'history';
    st.navOpen = false;
    st.flyout = false;
    st.second = false;
    st.trig = false;

    win.el.classList.add('calc-win');
    win.body.innerHTML = `<div class="calc">
      <header class="calc-head"><button class="calc-ham" aria-label="Open Navigation" title="Open Navigation">${Win.glyph('list', 16)}</button><h1 class="calc-mode"></h1>
        <button class="calc-ontop" aria-label="Keep on top" title="Keep on top (Alt+Up)">${Win.glyph('pin', 14)}</button><span class="calc-fill"></span>
        <button class="calc-histbtn" aria-label="Open history flyout" title="History (Ctrl+H)">${Win.glyph('history', 16)}</button></header>
      <div class="calc-main"><div class="calc-left"></div><aside class="calc-side" aria-label="History and memory"></aside></div>
      <nav class="calc-nav hidden" aria-label="Navigation"><button class="calc-ham" aria-label="Close Navigation">${Win.glyph('list', 16)}</button>
        <h2>Calculator</h2>${MODES.map(([id, label]) => `<button class="calc-nav-item" data-mode="${id}">${Win.glyph(id === 'date' ? 'calendar' : id === 'scientific' ? 'shapes' : 'apps', 16)}<span>${label}</span></button>`).join('')}
        <span class="calc-fill"></span><button class="calc-nav-item" data-mode="about">${Win.glyph('gear', 16)}<span>Settings</span></button></nav>
      <div class="calc-fly hidden"></div>
    </div>`;
    const root = win.body.querySelector('.calc');
    const left = root.querySelector('.calc-left');
    const side = root.querySelector('.calc-side');
    const nav = root.querySelector('.calc-nav');
    const fly = root.querySelector('.calc-fly');

    const wide = () => win.el.offsetWidth >= 560 && st.mode !== 'date';

    const sideHtml = () => {
      const tabs = `<div class="calc-tabs" role="tablist"><button role="tab" data-panel="history" aria-selected="${st.panel === 'history'}" class="${st.panel === 'history' ? 'on' : ''}">History</button><button role="tab" data-panel="memory" aria-selected="${st.panel === 'memory'}" class="${st.panel === 'memory' ? 'on' : ''}">Memory</button></div>`;
      let list;
      if (st.panel === 'history') {
        list = eng.history.length ? eng.history.map((h, i) => `<button class="calc-hitem" data-hist="${i}"><small>${Win.esc(h.expr)}</small><b>${Win.esc(h.result)}</b></button>`).join('') : '<p class="calc-empty">There’s no history yet.</p>';
      } else {
        list = eng.memory.length ? eng.memory.map((m, i) => `<div class="calc-mitem" data-mem="${i}"><b>${Win.esc(safeFmt(m))}</b><span><button data-memop="MC" data-i="${i}" aria-label="Clear memory item">MC</button><button data-memop="M+" data-i="${i}" aria-label="Add to memory item">M+</button><button data-memop="M-" data-i="${i}" aria-label="Subtract from memory item">M−</button></span></div>`).join('') : '<p class="calc-empty">There’s nothing saved in memory.</p>';
      }
      const clearBtn = (st.panel === 'history' ? eng.history.length : eng.memory.length) ? `<button class="calc-trash" data-clear="${st.panel}" aria-label="Clear all ${st.panel}" title="Clear all ${st.panel}">${Win.glyph('trash', 16)}</button>` : '';
      return `${tabs}<div class="calc-list">${list}</div>${clearBtn}`;
    };

    const safeFmt = v => { try { return fmt(v); } catch { return 'Overflow'; } };

    const renderDisplay = () => {
      const d = left.querySelector('.calc-display');
      if (!d) return;
      const text = eng.display();
      d.querySelector('.calc-expr').textContent = eng.expression();
      const num = d.querySelector('.calc-num');
      num.textContent = text;
      num.setAttribute('aria-label', `Display is ${text}`);
      num.classList.toggle('err', eng.isError());
      const len = text.length;
      num.style.fontSize = len > 18 ? '24px' : len > 14 ? '32px' : len > 11 ? '40px' : '';
      left.querySelectorAll('.calc-grid button').forEach(b => {
        const k = b.dataset.k;
        b.disabled = eng.isError() && !/^[0-9]$|^C$|^CE$|^Backspace$|^=$|^\.$/.test(k);
      });
      left.querySelectorAll('.calc-mem button').forEach(b => { b.disabled = eng.isError() || (/MC|MR|Mlist/.test(b.dataset.mem) && !eng.memory.length); });
      const pc = left.querySelector('[data-k="("] sub');
      if (pc) pc.textContent = eng.parens() ? String(eng.parens()) : '';
      if (wide()) side.innerHTML = sideHtml();
    };

    const renderDate = () => {
      const today = new Date();
      const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      left.innerHTML = `<div class="calc-date"><label class="field"><span>From</span><input class="input" type="date" data-d="from" value="${iso(today)}"></label>
        <label class="field"><span>To</span><input class="input" type="date" data-d="to" value="${iso(today)}"></label>
        <div class="calc-date-out"><span class="muted">Difference</span><b data-out>Same dates</b><span class="muted" data-days></span></div></div>`;
      const update = () => {
        const a = new Date(`${left.querySelector('[data-d=from]').value}T00:00`);
        const b = new Date(`${left.querySelector('[data-d=to]').value}T00:00`);
        if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return;
        const r = dateDiff(a.getTime(), b.getTime());
        left.querySelector('[data-out]').textContent = r.text;
        left.querySelector('[data-days]').textContent = r.days ? `${r.days.toLocaleString('en-US')} day${r.days === 1 ? '' : 's'}` : '';
      };
      left.addEventListener('input', update);
      update();
    };

    const renderKeys = () => {
      const sci = st.mode === 'scientific';
      const keys = sci ? sciKeys(st.second) : STANDARD_KEYS;
      const keyBtn = ([k, label, cls]) => `<button class="calc-key ${cls} ${k === '2nd' && st.second ? 'on' : ''}" data-k="${k}" aria-label="${Win.esc(LABELS[k] || label)}">${k === 'Backspace' ? Win.glyph('back', 16) : Win.esc(label)}${k === '(' ? '<sub></sub>' : ''}</button>`;
      const trig = st.second ? [['asin', 'sin⁻¹'], ['acos', 'cos⁻¹'], ['atan', 'tan⁻¹']] : [['sin', 'sin'], ['cos', 'cos'], ['tan', 'tan']];
      return `${sci ? `<div class="calc-sci-row"><button class="calc-chip" data-angle>${eng.angle.toUpperCase()}</button><button class="calc-chip" disabled>F-E</button></div>` : ''}
        <div class="calc-mem" role="toolbar" aria-label="Memory controls">${[['MC', 'Clear all memory (Ctrl+L)'], ['MR', 'Memory recall (Ctrl+R)'], ['M+', 'Memory add (Ctrl+P)'], ['M-', 'Memory subtract (Ctrl+Q)'], ['MS', 'Memory store (Ctrl+M)'], ['Mlist', 'Open memory flyout']].map(([m, t]) => `<button data-mem="${m}" title="${t}" aria-label="${t}">${m === 'Mlist' ? 'M˅' : m.replace('-', '−')}</button>`).join('')}</div>
        ${sci ? `<div class="calc-trig">${trig.map(([k, l]) => `<button class="calc-key fn" data-k="${k}" aria-label="${LABELS[k] || l}">${l}</button>`).join('')}</div>` : ''}
        <div class="calc-grid ${sci ? 'sci' : ''}">${keys.map(keyBtn).join('')}</div>`;
    };

    const render = () => {
      root.querySelector('.calc-mode').textContent = MODES.find(m => m[0] === st.mode)?.[1] || 'Standard';
      root.classList.toggle('wide', wide());
      root.classList.toggle('date', st.mode === 'date');
      nav.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === st.mode));
      if (st.mode === 'date') { renderDate(); side.innerHTML = ''; return; }
      left.innerHTML = `<div class="calc-display" aria-live="polite"><div class="calc-expr"></div><div class="calc-num" role="status"></div></div>${renderKeys()}`;
      side.innerHTML = wide() ? sideHtml() : '';
      renderDisplay();
    };

    const setMode = mode => {
      st.mode = mode;
      if (mode !== 'date') eng.setMode(mode);
      S().mode = mode;
      Win.save('calculator');
      st.navOpen = false;
      nav.classList.add('hidden');
      win.setTitle('Calculator');
      render();
    };

    const flash = k => {
      const b = left.querySelector(`[data-k="${CSS.escape(k)}"]`);
      if (!b) return;
      b.classList.add('press');
      setTimeout(() => b.classList.remove('press'), 110);
    };

    const press = k => {
      if (k === '2nd') { st.second = !st.second; render(); return; }
      eng.press(k);
      renderDisplay();
    };

    const showFly = kind => {
      st.panel = kind;
      fly.innerHTML = sideHtml();
      fly.classList.remove('hidden');
      st.flyout = true;
    };
    const hideFly = () => { fly.classList.add('hidden'); st.flyout = false; };

    root.addEventListener('click', e => {
      const t = e.target;
      if (t.closest('.calc-ham')) { st.navOpen = !st.navOpen; nav.classList.toggle('hidden', !st.navOpen); if (st.navOpen) nav.querySelector('.calc-nav-item')?.focus(); return; }
      const mode = t.closest('[data-mode]');
      if (mode) {
        if (mode.dataset.mode === 'about') {
          st.navOpen = false; nav.classList.add('hidden');
          Win.dialog({ owner: win, title: 'Settings', body: `<p><b>Appearance</b></p><p class="muted">App theme follows your Windows setting.</p><p><b>About</b></p><p class="muted">Calculator 11.2508.4.0<br>© 2026 Microsoft. All rights reserved.</p>` });
          return;
        }
        setMode(mode.dataset.mode);
        return;
      }
      if (t.closest('.calc-ontop')) {
        win.el.classList.toggle('calc-pinned');
        t.closest('.calc-ontop').classList.toggle('on');
        return;
      }
      if (t.closest('.calc-histbtn')) { if (st.flyout) hideFly(); else showFly('history'); return; }
      const key = t.closest('[data-k]');
      if (key && !key.disabled) { press(key.dataset.k); return; }
      if (t.closest('[data-angle]')) {
        eng.angle = { deg: 'rad', rad: 'grad', grad: 'deg' }[eng.angle];
        S().angle = eng.angle;
        Win.save('calculator');
        t.closest('[data-angle]').textContent = eng.angle.toUpperCase();
        return;
      }
      const mem = t.closest('[data-mem]');
      if (mem && mem.tagName === 'BUTTON' && !mem.disabled) {
        if (mem.dataset.mem === 'Mlist') { if (st.flyout) hideFly(); else showFly('memory'); return; }
        eng.memoryOp(mem.dataset.mem);
        if (st.flyout) fly.innerHTML = sideHtml();
        renderDisplay();
        return;
      }
      const tab = t.closest('[data-panel]');
      if (tab) { st.panel = tab.dataset.panel; if (st.flyout) fly.innerHTML = sideHtml(); else side.innerHTML = sideHtml(); return; }
      const hist = t.closest('[data-hist]');
      if (hist) { eng.useHistory(eng.history[Number(hist.dataset.hist)]); hideFly(); renderDisplay(); return; }
      const memop = t.closest('[data-memop]');
      if (memop) {
        const i = Number(memop.dataset.i);
        const v = eng.value();
        if (memop.dataset.memop === 'MC') eng.memory.splice(i, 1);
        if (memop.dataset.memop === 'M+') eng.memory[i] += v;
        if (memop.dataset.memop === 'M-') eng.memory[i] -= v;
        if (st.flyout) fly.innerHTML = sideHtml();
        renderDisplay();
        return;
      }
      const mitem = t.closest('[data-mem]');
      if (mitem) { eng.recall(eng.memory[Number(mitem.dataset.mem)]); hideFly(); renderDisplay(); return; }
      const clr = t.closest('[data-clear]');
      if (clr) {
        if (clr.dataset.clear === 'history') eng.history.length = 0; else eng.memory.length = 0;
        if (st.flyout) fly.innerHTML = sideHtml();
        renderDisplay();
        return;
      }
      if (st.flyout && !fly.contains(t)) hideFly();
      if (st.navOpen && !nav.contains(t)) { st.navOpen = false; nav.classList.add('hidden'); }
    });

    win.el.addEventListener('keydown', e => {
      if (e.target.matches('input, select, textarea')) return;
      if (st.mode === 'date') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (e.altKey && e.key === '1') { e.preventDefault(); setMode('standard'); return; }
      if (e.altKey && e.key === '2') { e.preventDefault(); setMode('scientific'); return; }
      if (e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode('date'); return; }
      if (ctrl) {
        const map = { m: 'MS', p: 'M+', q: 'M-', r: 'MR', l: 'MC' };
        const k = e.key.toLowerCase();
        if (map[k]) { e.preventDefault(); eng.memoryOp(map[k]); renderDisplay(); return; }
        if (k === 'h') { e.preventDefault(); if (st.flyout) hideFly(); else showFly('history'); return; }
        if (k === 'c') { e.preventDefault(); try { navigator.clipboard?.writeText(eng.display().replace(/,/g, '')); } catch { /* blocked */ } return; }
        if (k === 'v') {
          e.preventDefault();
          navigator.clipboard?.readText?.().then(text => {
            const n = Number(String(text).replace(/[,\s]/g, ''));
            if (Number.isFinite(n)) { eng.recall(n); renderDisplay(); }
          }).catch(() => {});
          return;
        }
        if (k === 'shift' || k === 'd') return;
        return;
      }
      if (e.key === 'Escape' && (st.flyout || st.navOpen)) { e.preventDefault(); hideFly(); st.navOpen = false; nav.classList.add('hidden'); return; }
      let k = /^[0-9]$/.test(e.key) ? e.key : KEYMAP[e.key];
      if (!k) return;
      if (st.mode !== 'scientific' && ['(', ')', '^', 'fact', 'pi', 'log', 'ln', 'sin', 'cos', 'tan'].includes(k)) return;
      if (e.key === 'Enter' && e.target.closest('button') && !e.target.closest('.calc-key')) return;
      e.preventDefault();
      if (e.key === 'Enter') k = '=';
      flash(k);
      press(k);
    });

    win.el.addEventListener('win-resize', Win.debounce(() => {
      root.classList.toggle('wide', wide());
      side.innerHTML = wide() ? sideHtml() : '';
      if (wide()) hideFly();
    }, 60));

    win.api = { engine: eng };
    render();
    requestAnimationFrame(() => root.classList.toggle('wide', wide()));
  }

  Win.apps.register({
    id: 'calculator', name: 'Calculator', icon: 'calculator',
    width: 340, height: 540, minWidth: 320, minHeight: 500, category: 'Utilities', keywords: ['calc', 'math', 'scientific'],
    create,
  });

  Win.Calculator = { engine, fmt, dateDiff, CalcError };
})(window.Win);
