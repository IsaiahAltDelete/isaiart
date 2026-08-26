/* ─────────────────────────────────────────────────────────────────────────────
   math.js — the expression engine behind MATH, VALUE and PLOT nodes.

   No dependencies, no eval(). A tokeniser, a Pratt parser and a tree-walking
   evaluator, in that order. eval() was the obvious shortcut and it is the wrong
   one twice over: a board is importable JSON, so an expression is untrusted
   input, and eval() cannot report *which* name a line was missing — which is
   the whole mechanism by which a MATH node grows its input ports.

   The one idea worth stating up front: a free variable is a port. Parse a line
   as `a * b`, find that neither name is defined anywhere above it, and those
   two names become sockets on the left edge of the node. Nothing else in the
   file knows about nodes; it just reports what it could not resolve.

   Values are `number | number[]`. Lists exist so a TABLE column can be one
   value on one wire — sum(qty) reads better than six wires into an adder.
   ──────────────────────────────────────────────────────────────────────────── */
(function (global) {
'use strict';

/* ── Errors ─────────────────────────────────────────────────────────────── */

function MathError(msg, at) { this.name = 'MathError'; this.message = msg; this.at = at; }
MathError.prototype = Object.create(Error.prototype);
function fail(msg, at) { throw new MathError(msg, at); }

/* ── Constants ──────────────────────────────────────────────────────────── */

var CONSTANTS = {
    pi: Math.PI,
    tau: Math.PI * 2,
    e: Math.E,
    phi: (1 + Math.sqrt(5)) / 2,
    inf: Infinity,
    nan: NaN
};

/* ── Functions ──────────────────────────────────────────────────────────────
   Three shapes. `map` functions apply element-wise to a list, so sin(data)
   is a list of sines rather than an error. `agg` functions flatten every
   argument into one list first, so sum(a, b, [1,2]) is legal and means what
   it looks like. Everything else takes plain numbers. */

function isList(v) { return Array.isArray(v); }

function scalar(v, who) {
    if (isList(v)) fail(who + ' wants a number, not a list');
    if (typeof v !== 'number') fail(who + ' wants a number');
    return v;
}

function flatten(args) {
    var out = [], i, j;
    for (i = 0; i < args.length; i++) {
        if (isList(args[i])) { for (j = 0; j < args[i].length; j++) out.push(args[i][j]); }
        else out.push(args[i]);
    }
    return out;
}

function mapper(fn) {
    return function (args, name) {
        if (args.length !== 1) fail(name + '() takes one argument');
        var v = args[0];
        if (isList(v)) return v.map(function (x) { return fn(x); });
        return fn(scalar(v, name));
    };
}

function factorial(n) {
    if (n < 0 || Math.floor(n) !== n) fail('fact() wants a whole number 0 or above');
    if (n > 170) return Infinity;
    var r = 1, i;
    for (i = 2; i <= n; i++) r *= i;
    return r;
}

function pair(args, name, fn) {
    if (args.length !== 2) fail(name + '() takes two arguments');
    return bcast(args[0], args[1], fn);
}

function sorted(list) { return list.slice().sort(function (a, b) { return a - b; }); }

function median(list) {
    if (!list.length) return NaN;
    var s = sorted(list), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(list) {
    var n = list.length, i, mu = 0, acc = 0;
    if (n < 2) return 0;
    for (i = 0; i < n; i++) mu += list[i];
    mu /= n;
    for (i = 0; i < n; i++) acc += (list[i] - mu) * (list[i] - mu);
    return Math.sqrt(acc / (n - 1));
}

function gcd2(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var t = b; b = a % b; a = t; }
    return a;
}

var FUNCTIONS = {
    /* trigonometry — radians, with deg()/rad() to cross over */
    sin: mapper(Math.sin), cos: mapper(Math.cos), tan: mapper(Math.tan),
    asin: mapper(Math.asin), acos: mapper(Math.acos), atan: mapper(Math.atan),
    sinh: mapper(Math.sinh), cosh: mapper(Math.cosh), tanh: mapper(Math.tanh),
    deg: mapper(function (x) { return x * 180 / Math.PI; }),
    rad: mapper(function (x) { return x * Math.PI / 180; }),

    /* shape */
    sqrt: mapper(Math.sqrt), cbrt: mapper(Math.cbrt), abs: mapper(Math.abs),
    sign: mapper(Math.sign), floor: mapper(Math.floor), ceil: mapper(Math.ceil),
    trunc: mapper(Math.trunc), fract: mapper(function (x) { return x - Math.floor(x); }),
    exp: mapper(Math.exp), ln: mapper(Math.log), log2: mapper(Math.log2),
    log10: mapper(Math.log10), fact: mapper(factorial),

    /* log() is base 10 with one argument and base b with two — the convention
       every pocket calculator uses, and ln() is there when you want e. */
    log: function (args, name) {
        if (args.length === 1) return mapper(Math.log10)(args, name);
        if (args.length === 2) {
            var b = scalar(args[1], name);
            var f = function (x) { return Math.log(x) / Math.log(b); };
            return isList(args[0]) ? args[0].map(f) : f(scalar(args[0], name));
        }
        fail('log() takes one or two arguments');
    },

    /* round(x) and round(x, places) */
    round: function (args, name) {
        var dp = args.length > 1 ? scalar(args[1], name) : 0;
        var k = Math.pow(10, dp);
        var f = function (x) { return Math.round(x * k) / k; };
        if (args.length < 1) fail('round() takes one or two arguments');
        return isList(args[0]) ? args[0].map(f) : f(scalar(args[0], name));
    },

    /* aggregates — variadic, and lists flatten in */
    sum: function (a) { return flatten(a).reduce(function (x, y) { return x + y; }, 0); },
    product: function (a) { return flatten(a).reduce(function (x, y) { return x * y; }, 1); },
    avg: function (a) { var l = flatten(a); return l.length ? l.reduce(function (x, y) { return x + y; }, 0) / l.length : NaN; },
    median: function (a) { return median(flatten(a)); },
    stdev: function (a) { return stdev(flatten(a)); },
    count: function (a) { return flatten(a).length; },
    min: function (a) { var l = flatten(a); return l.length ? Math.min.apply(null, l) : NaN; },
    max: function (a) { var l = flatten(a); return l.length ? Math.max.apply(null, l) : NaN; },
    range: function (a) { var l = flatten(a); return l.length ? Math.max.apply(null, l) - Math.min.apply(null, l) : NaN; },
    sort: function (a) { return sorted(flatten(a)); },
    reverse: function (a) { return flatten(a).reverse(); },
    hypot: function (a) { return Math.hypot.apply(null, flatten(a)); },

    /* two-argument arithmetic */
    pow: function (a, name) { return pair(a, name, Math.pow); },
    mod: function (a, name) { return pair(a, name, function (x, y) { return ((x % y) + y) % y; }); },
    atan2: function (a, name) { return pair(a, name, Math.atan2); },
    gcd: function (a) { return flatten(a).reduce(gcd2); },
    lcm: function (a) { return flatten(a).reduce(function (x, y) { var g = gcd2(x, y); return g ? Math.abs(x * y) / g : 0; }); },

    /* interpolation and remapping — the three that turn a VALUE slider into
       something other than the number it already is */
    clamp: function (a, name) {
        if (a.length !== 3) fail('clamp() takes value, low, high');
        var lo = scalar(a[1], name), hi = scalar(a[2], name);
        var f = function (x) { return Math.min(hi, Math.max(lo, x)); };
        return isList(a[0]) ? a[0].map(f) : f(scalar(a[0], name));
    },
    lerp: function (a, name) {
        if (a.length !== 3) fail('lerp() takes from, to, t');
        var p = scalar(a[0], name), q = scalar(a[1], name);
        var f = function (t) { return p + (q - p) * t; };
        return isList(a[2]) ? a[2].map(f) : f(scalar(a[2], name));
    },
    map: function (a, name) {
        if (a.length !== 5) fail('map() takes value, inLow, inHigh, outLow, outHigh');
        var i0 = scalar(a[1], name), i1 = scalar(a[2], name),
            o0 = scalar(a[3], name), o1 = scalar(a[4], name);
        var f = function (x) { return i1 === i0 ? o0 : o0 + (x - i0) * (o1 - o0) / (i1 - i0); };
        return isList(a[0]) ? a[0].map(f) : f(scalar(a[0], name));
    },

    /* generators */
    seq: function (a, name) {
        var from = a.length > 1 ? scalar(a[0], name) : 1;
        var to = a.length > 1 ? scalar(a[1], name) : scalar(a[0], name);
        var step = a.length > 2 ? scalar(a[2], name) : (to < from ? -1 : 1);
        if (!step || !isFinite(step)) fail('seq() step must not be zero');
        var out = [], x, guard = 0;
        for (x = from; step > 0 ? x <= to + 1e-9 : x >= to - 1e-9; x += step) {
            out.push(x);
            if (++guard > 4096) fail('seq() is too long — cap is 4096 items');
        }
        return out;
    },
    rand: function (a, name) {
        if (!a.length) return Math.random();
        if (a.length === 2) { var lo = scalar(a[0], name), hi = scalar(a[1], name); return lo + Math.random() * (hi - lo); }
        return Math.random() * scalar(a[0], name);
    },
    randint: function (a, name) {
        var lo = a.length > 1 ? scalar(a[0], name) : 1;
        var hi = a.length > 1 ? scalar(a[1], name) : scalar(a[0], name);
        return Math.floor(lo + Math.random() * (hi - lo + 1));
    },

    /* selection */
    'if': function (a, name) {
        if (a.length !== 3) fail('if() takes test, then, else');
        return scalar(a[0], name) ? a[1] : a[2];
    }
};

/* rand/randint are the only impure functions here. Anything that reads them is
   re-rolled on every recompute, which is correct for a dice-roll node and a
   nuisance for a stable board — so the board keeps a list of them and warns. */
var IMPURE = { rand: 1, randint: 1 };

/* ── Tokeniser ──────────────────────────────────────────────────────────── */

var PUNCT = ['<=', '>=', '==', '!=', '**', '&&', '||', '+', '-', '*', '/', '%', '^', '(', ')', '[', ']', ',', '<', '>', '!'];
var ID_RE = /[A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*/;

function tokenise(src) {
    var toks = [], i = 0, n = src.length, c, m, rest;
    while (i < n) {
        c = src[i];
        if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }

        /* comments run to end of line; both spellings, because half the world
           writes # and the other half writes // */
        if (c === '#' || (c === '/' && src[i + 1] === '/')) break;

        /* number: 1  1.5  .5  1_000  2e-3 */
        if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
            m = /^[0-9_]*\.?[0-9_]*(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
            var raw = m[0].replace(/_/g, '');
            var val = parseFloat(raw);
            if (isNaN(val)) fail('cannot read the number "' + m[0] + '"', i);
            toks.push({ t: 'num', v: val, at: i });
            i += m[0].length;
            continue;
        }

        /* identifier or keyword operator */
        m = ID_RE.exec(src.slice(i));
        if (m && m.index === 0) {
            toks.push({ t: m[0] === 'of' ? 'op' : 'id', v: m[0], at: i });
            i += m[0].length;
            continue;
        }

        rest = src.slice(i);
        var hit = null, k;
        for (k = 0; k < PUNCT.length; k++) {
            if (rest.indexOf(PUNCT[k]) === 0) { hit = PUNCT[k]; break; }
        }
        if (!hit) fail('"' + c + '" does not mean anything here', i);
        toks.push({ t: hit === '(' || hit === ')' || hit === '[' || hit === ']' || hit === ',' ? hit : 'op', v: hit, at: i });
        i += hit.length;
    }
    toks.push({ t: 'end', v: '', at: n });
    return toks;
}

/* ── Parser ─────────────────────────────────────────────────────────────────
   Pratt, with three wrinkles worth knowing about:

   1. `^` binds tighter on the right ([16, 15]) so 2^3^2 is 2^9, and looser
      than prefix minus so -2^2 is -4. Both are what a maths textbook means.
   2. `%` is modulo when a value follows it and "per cent" when one does not.
      `10 % 3` is 1; `10% * 200` is 20. Deciding by lookahead is the only way
      to have both spellings, and both spellings are the ones people type.
   3. A value directly after a value is an implicit multiply, so 2pi and
      3(4+5) work. The exception is an identifier that names a function —
      sin(x) is a call, not sin × x. */

var BINDING = {
    '||': [1, 2], '&&': [3, 4],
    '==': [5, 6], '!=': [5, 6], '<': [7, 8], '>': [7, 8], '<=': [7, 8], '>=': [7, 8],
    '+': [9, 10], '-': [9, 10],
    '*': [11, 12], '/': [11, 12], '%': [11, 12], 'of': [11, 12],
    '^': [16, 15], '**': [16, 15]
};
var PREFIX_BP = 13;
var IMPLICIT = [11, 12];

function startsValue(tok) {
    return tok.t === 'num' || tok.t === '(' || (tok.t === 'id');
}

function Parser(toks) { this.toks = toks; this.i = 0; }
Parser.prototype.peek = function (k) { return this.toks[this.i + (k || 0)]; };
Parser.prototype.next = function () { return this.toks[this.i++]; };
Parser.prototype.eat = function (t) {
    var tok = this.toks[this.i];
    if (tok.t !== t) fail('expected "' + t + '" but found ' + (tok.t === 'end' ? 'the end of the line' : '"' + tok.v + '"'), tok.at);
    this.i++;
    return tok;
};

Parser.prototype.parse = function () {
    var node = this.expr(0);
    var tok = this.peek();
    if (tok.t !== 'end') fail('"' + tok.v + '" is left over at the end', tok.at);
    return node;
};

Parser.prototype.expr = function (minBp) {
    var left = this.unary(), tok, bp, op;
    for (;;) {
        tok = this.peek();

        /* implicit multiply — a value butted against a value */
        if (startsValue(tok) && !(tok.t === 'id' && tok.v === 'of')) {
            if (IMPLICIT[0] < minBp) break;
            left = { t: 'bin', op: '*', l: left, r: this.expr(IMPLICIT[1]), implicit: true };
            continue;
        }

        if (tok.t !== 'op') break;
        op = tok.v;

        /* postfix ! and postfix % */
        if (op === '!' || (op === '%' && !startsValue(this.peek(1)))) {
            if (17 < minBp) break;
            this.next();
            left = { t: 'post', op: op === '!' ? 'fact' : 'pct', x: left };
            continue;
        }

        bp = BINDING[op === '**' ? '^' : op];
        if (!bp || bp[0] < minBp) break;
        this.next();
        left = { t: 'bin', op: op === '**' ? '^' : op, l: left, r: this.expr(bp[1]) };
    }
    return left;
};

Parser.prototype.unary = function () {
    var tok = this.peek();
    if (tok.t === 'op' && (tok.v === '-' || tok.v === '+' || tok.v === '!')) {
        this.next();
        return { t: 'un', op: tok.v, x: this.expr(PREFIX_BP) };
    }
    return this.postfix(this.primary());
};

Parser.prototype.postfix = function (node) {
    /* only indexing; ! and % are handled in the binary loop so their binding
       power composes with everything else */
    while (this.peek().t === '[') {
        this.next();
        var idx = this.expr(0);
        this.eat(']');
        node = { t: 'index', x: node, i: idx };
    }
    return node;
};

Parser.prototype.primary = function () {
    var tok = this.next(), node, items;

    if (tok.t === 'num') return { t: 'num', v: tok.v };

    if (tok.t === '(') { node = this.expr(0); this.eat(')'); return node; }

    if (tok.t === '[') {
        items = [];
        if (this.peek().t !== ']') {
            for (;;) {
                items.push(this.expr(0));
                if (this.peek().t !== ',') break;
                this.next();
            }
        }
        this.eat(']');
        return { t: 'list', items: items };
    }

    if (tok.t === 'id') {
        if (this.peek().t === '(' && Object.prototype.hasOwnProperty.call(FUNCTIONS, tok.v)) {
            this.next();
            items = [];
            if (this.peek().t !== ')') {
                for (;;) {
                    items.push(this.expr(0));
                    if (this.peek().t !== ',') break;
                    this.next();
                }
            }
            this.eat(')');
            return { t: 'call', name: tok.v, args: items, at: tok.at };
        }
        return { t: 'var', name: tok.v, at: tok.at };
    }

    fail(tok.t === 'end' ? 'the line stops early' : '"' + tok.v + '" cannot start a value', tok.at);
};

/* ── Evaluator ──────────────────────────────────────────────────────────── */

function bcast(a, b, f) {
    var i, out, n;
    if (isList(a) && isList(b)) {
        n = Math.min(a.length, b.length);
        out = new Array(n);
        for (i = 0; i < n; i++) out[i] = f(a[i], b[i]);
        return out;
    }
    if (isList(a)) return a.map(function (x) { return f(x, b); });
    if (isList(b)) return b.map(function (x) { return f(a, x); });
    return f(a, b);
}

var BINOPS = {
    '+': function (a, b) { return a + b; },
    '-': function (a, b) { return a - b; },
    '*': function (a, b) { return a * b; },
    'of': function (a, b) { return a * b; },
    '/': function (a, b) { return a / b; },
    '%': function (a, b) { return a % b; },
    '^': function (a, b) { return Math.pow(a, b); },
    '<': function (a, b) { return a < b ? 1 : 0; },
    '>': function (a, b) { return a > b ? 1 : 0; },
    '<=': function (a, b) { return a <= b ? 1 : 0; },
    '>=': function (a, b) { return a >= b ? 1 : 0; },
    '==': function (a, b) { return a === b ? 1 : 0; },
    '!=': function (a, b) { return a !== b ? 1 : 0; },
    '&&': function (a, b) { return (a && b) ? 1 : 0; },
    '||': function (a, b) { return (a || b) ? 1 : 0; }
};

function evalNode(node, scope) {
    var i, args, v, idx;
    switch (node.t) {
        case 'num': return node.v;

        case 'list':
            return flatten(node.items.map(function (it) { return evalNode(it, scope); }));

        case 'var':
            if (Object.prototype.hasOwnProperty.call(scope, node.name)) return scope[node.name];
            if (Object.prototype.hasOwnProperty.call(CONSTANTS, node.name)) return CONSTANTS[node.name];
            fail('nothing is called "' + node.name + '" yet', node.at);
            break;

        case 'call':
            args = new Array(node.args.length);
            for (i = 0; i < node.args.length; i++) args[i] = evalNode(node.args[i], scope);
            return FUNCTIONS[node.name](args, node.name);

        case 'bin':
            return bcast(evalNode(node.l, scope), evalNode(node.r, scope), BINOPS[node.op]);

        case 'un':
            v = evalNode(node.x, scope);
            if (node.op === '-') return isList(v) ? v.map(function (x) { return -x; }) : -v;
            if (node.op === '!') return isList(v) ? v.map(function (x) { return x ? 0 : 1; }) : (v ? 0 : 1);
            return v;

        case 'post':
            v = evalNode(node.x, scope);
            if (node.op === 'pct') return isList(v) ? v.map(function (x) { return x / 100; }) : v / 100;
            return isList(v) ? v.map(factorial) : factorial(v);

        case 'index':
            v = evalNode(node.x, scope);
            idx = evalNode(node.i, scope);
            if (!isList(v)) fail('only a list can be indexed');
            idx = Math.round(scalar(idx, 'index'));
            if (idx < 0) idx += v.length;
            if (idx < 0 || idx >= v.length) fail('index ' + idx + ' is outside a list of ' + v.length);
            return v[idx];
    }
    fail('cannot work out this expression');
}

/* ── Static analysis ────────────────────────────────────────────────────────
   Walk the tree for names it will need at run time. `known` is everything
   already in scope; whatever is left over is a free variable, and the board
   turns each one into an input port. Order matters — ports appear in the
   order the names were first typed, so a line reads left to right into the
   node's left edge. */

function collect(node, known, free, seen, impure) {
    if (!node) return;
    switch (node.t) {
        case 'var':
            if (!Object.prototype.hasOwnProperty.call(known, node.name) &&
                !Object.prototype.hasOwnProperty.call(CONSTANTS, node.name) &&
                !seen[node.name]) {
                seen[node.name] = 1;
                free.push(node.name);
            }
            break;
        case 'call':
            if (IMPURE[node.name]) impure.hit = true;
            node.args.forEach(function (a) { collect(a, known, free, seen, impure); });
            break;
        case 'list':
            node.items.forEach(function (a) { collect(a, known, free, seen, impure); });
            break;
        case 'bin': collect(node.l, known, free, seen, impure); collect(node.r, known, free, seen, impure); break;
        case 'index': collect(node.x, known, free, seen, impure); collect(node.i, known, free, seen, impure); break;
        case 'un': case 'post': collect(node.x, known, free, seen, impure); break;
    }
}

/* ── Formatting ─────────────────────────────────────────────────────────────
   A result column is only useful if it is readable at a glance, which rules
   out both toString() (0.30000000000000004) and toFixed (2.00 for 2). Ten
   significant figures then trim: that is enough to show a real remainder and
   few enough to hide float noise. */

var GROUP = /\B(?=(\d{3})+(?!\d))/g;

function formatNumber(v, opts) {
    opts = opts || {};
    if (typeof v !== 'number') return String(v);
    if (v !== v) return 'NaN';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '-∞';
    if (v === 0) return '0';

    var abs = Math.abs(v), out;
    if (abs >= 1e15 || abs < 1e-7) {
        out = v.toExponential(opts.digits != null ? opts.digits : 6)
               .replace(/\.?0+e/, 'e').replace('e+', 'e');
        return out;
    }

    out = v.toPrecision(opts.digits != null ? opts.digits : 12);
    if (out.indexOf('e') >= 0) out = String(v);
    if (out.indexOf('.') >= 0) out = out.replace(/0+$/, '').replace(/\.$/, '');

    if (opts.group !== false && Math.abs(v) >= 10000) {
        var parts = out.split('.');
        parts[0] = parts[0].replace(GROUP, ',');
        out = parts.join('.');
    }
    return out;
}

function formatValue(v, opts) {
    opts = opts || {};
    if (v == null) return '—';
    if (isList(v)) {
        var cap = opts.cap || 8;
        var head = v.slice(0, cap).map(function (x) { return formatNumber(x, { group: false, digits: 8 }); });
        return '[' + head.join(', ') + (v.length > cap ? ', …' + (v.length - cap) : '') + ']';
    }
    return formatNumber(v, opts);
}

/* ── The line runner ────────────────────────────────────────────────────────
   A MATH node is a small program: one statement per line, later lines see
   earlier names. `ans` is the line above, `total` is every result so far
   added up — both of which exist because a running tally is the single most
   common thing anyone does with a column of numbers. */

var ASSIGN_RE = /^\s*([A-Za-z_À-ɏ][A-Za-z0-9_À-ɏ]*)\s*=(?!=)([\s\S]*)$/;

function run(source, external) {
    var lines = String(source == null ? '' : source).split('\n');
    var scope = Object.create(null);
    var key;

    if (external) for (key in external) if (external[key] != null) scope[key] = external[key];

    /* `known` and `scope` are deliberately not the same set. `scope` is what a
       line can read; `known` is what the line is allowed to have *meant*, and
       it starts empty of the external values. Otherwise a port would report
       itself free until the moment something was wired into it and then stop —
       so connecting a wire would delete the socket it had just been plugged
       into. Ports are a property of the text, not of the board around it. */
    var known = Object.create(null);
    known.ans = 1; known.total = 1;

    var out = { lines: [], vars: Object.create(null), order: [], result: null, free: [], impure: false, ok: true };
    var freeSeen = Object.create(null);
    var impure = { hit: false };
    /* names that were assigned but whose right-hand side is still waiting on a
       wire. They are not free — they are local — but reading one is not an
       error either, so anything downstream of them waits too. Without this a
       half-wired node reports a cascade of red lines that all say the same
       thing about one unplugged socket. */
    var blocked = Object.create(null);
    var noop = { hit: false };
    var total = 0, last = null, i;

    for (i = 0; i < lines.length; i++) {
        var raw = lines[i];
        var rec = { raw: raw, kind: 'blank', name: null, value: null, display: '', error: null };

        var bare = raw.replace(/^\s+|\s+$/g, '');
        if (!bare) { out.lines.push(rec); continue; }
        if (bare.indexOf('#') === 0 || bare.indexOf('//') === 0) {
            rec.kind = 'comment';
            out.lines.push(rec);
            continue;
        }

        var m = ASSIGN_RE.exec(raw), body = raw, name = null;
        if (m && m[2].replace(/^\s+/, '') !== '') { name = m[1]; body = m[2]; }

        try {
            var toks = tokenise(body);
            if (toks.length === 1) {           /* the line was only a comment */
                rec.kind = 'comment';
                out.lines.push(rec);
                continue;
            }
            var ast = new Parser(toks).parse();

            /* per-line, with its own seen-set: the union across lines is the
               port list, but only *this* line's names decide whether *this*
               line can run. A shared seen-set would silence line 3's use of a
               name line 1 already reported, and line 3 would throw instead of
               waiting for the wire. */
            var lineFree = [];
            collect(ast, known, lineFree, Object.create(null), impure);
            for (var f = 0; f < lineFree.length; f++) {
                if (!freeSeen[lineFree[f]]) { freeSeen[lineFree[f]] = 1; out.free.push(lineFree[f]); }
            }

            scope.ans = last === null ? 0 : last;
            scope.total = total;

            /* every name the line reads, local ones included, so a blocked
               local counts the same as an unplugged port */
            var lineRefs = [];
            collect(ast, Object.create(null), lineRefs, Object.create(null), noop);
            var missing = lineRefs.filter(function (nm) {
                return blocked[nm] || !Object.prototype.hasOwnProperty.call(scope, nm);
            });
            if (missing.length) {
                /* unresolved names are not an error yet — the board may be
                   about to deliver them down a wire. Report, do not throw. */
                rec.kind = 'pending';
                rec.name = name;
                rec.display = '—';
                rec.waiting = missing;
                out.lines.push(rec);
                if (name) {
                    known[name] = 1;
                    blocked[name] = 1;
                    if (out.order.indexOf(name) < 0) out.order.push(name);
                }
                continue;
            }

            var val = evalNode(ast, scope);

            rec.kind = name ? 'assign' : 'expr';
            rec.name = name;
            rec.value = val;
            rec.display = formatValue(val);

            if (name) {
                scope[name] = val;
                known[name] = 1;
                delete blocked[name];
                out.vars[name] = val;
                if (out.order.indexOf(name) < 0) out.order.push(name);
            }
            if (typeof val === 'number' && isFinite(val)) total += val;
            last = val;
            out.result = val;
        } catch (err) {
            rec.kind = 'error';
            rec.name = name;
            rec.error = err && err.message ? err.message : String(err);
            rec.display = rec.error;
            out.ok = false;
            /* a broken assignment blocks rather than un-defines: one red line
               and dashes below beats the same message repeated all the way
               down the node */
            if (name) { known[name] = 1; blocked[name] = 1; }
        }

        out.lines.push(rec);
    }

    out.impure = impure.hit;
    out.scope = scope;
    return out;
}

/* ── One-shot compile, for the plotter ──────────────────────────────────────
   PLOT evaluates the same expression a few hundred times per repaint, so it
   parses once and walks the tree per sample. */

function compile(source, argNames) {
    var known = Object.create(null), i;
    for (i = 0; i < (argNames || []).length; i++) known[argNames[i]] = 1;

    var ast, free = [], impure = { hit: false };
    try {
        var toks = tokenise(String(source == null ? '' : source));
        if (toks.length === 1) return { ok: false, error: 'nothing to plot', free: [] };
        ast = new Parser(toks).parse();
    } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err), free: [] };
    }
    collect(ast, known, free, Object.create(null), impure);

    return {
        ok: true,
        free: free,
        impure: impure.hit,
        at: function (scope) { return evalNode(ast, scope); }
    };
}

global.ISAMATH = {
    run: run,
    compile: compile,
    format: formatValue,
    formatNumber: formatNumber,
    FUNCTIONS: FUNCTIONS,
    CONSTANTS: CONSTANTS,
    names: function () {
        return Object.keys(FUNCTIONS).sort().concat(Object.keys(CONSTANTS).sort());
    }
};

if (typeof module !== 'undefined' && module.exports) module.exports = global.ISAMATH;

})(typeof globalThis !== 'undefined' ? globalThis : this);
