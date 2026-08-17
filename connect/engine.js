/* ============================================================================
   CONNECT FOUR — engine
   ---------------------------------------------------------------------------
   Negamax with alpha-beta, a transposition table, killer/history ordering and
   iterative deepening against a clock. The board is a flat Int8Array with a
   per-column height, so a move is two writes and an undo is one.

   The part that matters most is not the search, it is the EVALUATION, and
   specifically threat parity. Connect Four is decided by zugzwang far more
   than by material: a threat you cannot be forced to fill is worth more than
   three you can. Every column alternates who owns each square as it fills, so
   a threat on an odd square (counting from the bottom) belongs to the player
   who opened, and an even one to the player who replied. An engine that counts
   threes without asking which parity they sit on will happily build a threat
   its opponent gets to fill, and then lose a position it thought it was
   winning. That single term is the difference between an opponent that blocks
   and one that plays Connect Four.
   ========================================================================= */
(function () {
    'use strict';

    var ROWS = 6, COLS = 7, SIZE = ROWS * COLS;
    var WIN = 1000000;
    var ABORT = { abort: true };

    /* ── Precomputed geometry ────────────────────────────────────────────────
       All 69 four-in-a-row windows as flat index quadruples. Building this once
       turns the evaluation inner loop into array reads with no bounds maths. */
    var WINDOWS = (function () {
        var w = [], r, c, i;
        for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
            if (c + 3 < COLS) w.push([r*COLS+c, r*COLS+c+1, r*COLS+c+2, r*COLS+c+3]);
            if (r + 3 < ROWS) w.push([r*COLS+c, (r+1)*COLS+c, (r+2)*COLS+c, (r+3)*COLS+c]);
            if (r + 3 < ROWS && c + 3 < COLS) w.push([r*COLS+c, (r+1)*COLS+c+1, (r+2)*COLS+c+2, (r+3)*COLS+c+3]);
            if (r + 3 < ROWS && c - 3 >= 0)   w.push([r*COLS+c, (r+1)*COLS+c-1, (r+2)*COLS+c-2, (r+3)*COLS+c-3]);
        }
        var flat = new Int16Array(w.length * 4);
        for (i = 0; i < w.length; i++) {
            flat[i*4] = w[i][0]; flat[i*4+1] = w[i][1];
            flat[i*4+2] = w[i][2]; flat[i*4+3] = w[i][3];
        }
        return flat;
    })();
    var NWIN = WINDOWS.length / 4;

    /* Zobrist keys. Two 32-bit halves kept separately: JS bitwise operators are
       32-bit, so a single Number cannot hold a 64-bit key without losing the
       top bits and quietly colliding. */
    var ZA = new Int32Array(SIZE * 2), ZB = new Int32Array(SIZE * 2);
    (function () {
        var seed = 0x2F6E2B1;
        function rnd() {
            seed ^= seed << 13; seed |= 0;
            seed ^= seed >>> 17;
            seed ^= seed << 5;  seed |= 0;
            return seed;
        }
        for (var i = 0; i < SIZE * 2; i++) { ZA[i] = rnd(); ZB[i] = rnd(); }
    })();

    var CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6];

    function newState(first) {
        return {
            cells: new Int8Array(SIZE),
            heights: new Int8Array(COLS),
            turn: first || 1,
            count: 0,
            moves: [],
            ha: 0, hb: 0
        };
    }

    function clone(st) {
        var n = newState(st.turn);
        n.cells.set(st.cells);
        n.heights.set(st.heights);
        n.count = st.count;
        n.moves = st.moves.slice();
        n.ha = st.ha; n.hb = st.hb;
        return n;
    }

    function canPlay(st, col) { return st.heights[col] < ROWS; }

    function legal(st) {
        var out = [];
        for (var i = 0; i < COLS; i++) if (st.heights[CENTER_ORDER[i]] < ROWS) out.push(CENTER_ORDER[i]);
        return out;
    }

    function drop(st, col) {
        var r = st.heights[col];
        if (r >= ROWS) return -1;
        var idx = r * COLS + col, p = st.turn;
        st.cells[idx] = p;
        st.heights[col] = r + 1;
        st.count++;
        st.moves.push(col);
        var z = idx * 2 + (p - 1);
        st.ha ^= ZA[z]; st.hb ^= ZB[z];
        st.turn = p === 1 ? 2 : 1;
        return r;
    }

    function undo(st) {
        if (!st.moves.length) return -1;
        var col = st.moves.pop();
        var r = st.heights[col] - 1;
        var idx = r * COLS + col;
        var p = st.cells[idx];
        st.cells[idx] = 0;
        st.heights[col] = r;
        st.count--;
        var z = idx * 2 + (p - 1);
        st.ha ^= ZA[z]; st.hb ^= ZB[z];
        st.turn = p;
        return col;
    }

    /* Win test anchored on the piece just played — the only cells whose lines
       can have changed. Returns the four indices, so the UI can light them. */
    var DIRS = [[0,1],[1,0],[1,1],[1,-1]];
    function winLineAt(st, row, col) {
        var p = st.cells[row * COLS + col];
        if (!p) return null;
        for (var d = 0; d < 4; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1];
            var line = [row * COLS + col], k, r, c;
            for (k = 1; k < 4; k++) {
                r = row + dr * k; c = col + dc * k;
                if (r < 0 || r >= ROWS || c < 0 || c >= COLS || st.cells[r*COLS+c] !== p) break;
                line.push(r*COLS+c);
            }
            for (k = 1; k < 4; k++) {
                r = row - dr * k; c = col - dc * k;
                if (r < 0 || r >= ROWS || c < 0 || c >= COLS || st.cells[r*COLS+c] !== p) break;
                line.unshift(r*COLS+c);
            }
            if (line.length >= 4) return line.slice(0, 4);
        }
        return null;
    }

    function winsAt(st, row, col) { return winLineAt(st, row, col) !== null; }

    /* The same test without building the line. winLineAt allocates three arrays
       per call, which is fine for the handful of UI calls and ruinous inside a
       search that runs it millions of times. */
    function winsFast(st, row, col) {
        var cells = st.cells, p = cells[row * COLS + col];
        if (!p) return false;
        for (var d = 0; d < 4; d++) {
            var dr = DIRS[d][0], dc = DIRS[d][1], n = 1, k, r, c;
            for (k = 1; k < 4; k++) {
                r = row + dr * k; c = col + dc * k;
                if (r < 0 || r >= ROWS || c < 0 || c >= COLS || cells[r*COLS+c] !== p) break;
                n++;
            }
            for (k = 1; k < 4; k++) {
                r = row - dr * k; c = col - dc * k;
                if (r < 0 || r >= ROWS || c < 0 || c >= COLS || cells[r*COLS+c] !== p) break;
                n++;
            }
            if (n >= 4) return true;
        }
        return false;
    }

    /* A column where `p` completes four right now, or -1. */
    function immediateWin(st, p) {
        var save = st.turn;
        st.turn = p;
        var found = -1;
        for (var i = 0; i < COLS && found < 0; i++) {
            var col = CENTER_ORDER[i];
            if (st.heights[col] >= ROWS) continue;
            var r = drop(st, col);
            if (winsFast(st, r, col)) found = col;
            undo(st);
        }
        st.turn = save;
        return found;
    }

    /* ── Evaluation ─────────────────────────────────────────────────────────
       Positive is good for `me`. Window shape plus centre control plus the
       parity term described at the top of the file. */

    var W3 = 52, W2 = 6, B3 = 58, B2 = 7, CENTRE = 9;
    var PARITY_GOOD = 30, PARITY_BAD = 5;

    function evaluate(st, me) {
        var cells = st.cells, opp = me === 1 ? 2 : 1;
        var score = 0, i, base, a, b, c, d, mine, theirs, empty, hole;

        for (i = 0; i < NWIN; i++) {
            base = i * 4;
            a = cells[WINDOWS[base]]; b = cells[WINDOWS[base+1]];
            c = cells[WINDOWS[base+2]]; d = cells[WINDOWS[base+3]];

            mine = 0; theirs = 0; empty = 0; hole = -1;
            if (a === me) mine++; else if (a) theirs++; else { empty++; hole = WINDOWS[base]; }
            if (b === me) mine++; else if (b) theirs++; else { empty++; hole = WINDOWS[base+1]; }
            if (c === me) mine++; else if (c) theirs++; else { empty++; hole = WINDOWS[base+2]; }
            if (d === me) mine++; else if (d) theirs++; else { empty++; hole = WINDOWS[base+3]; }

            if (mine && theirs) continue;                 /* dead window */

            if (mine === 3 && empty === 1) {
                score += W3 + parityBonus(st, hole, me);
            } else if (mine === 2 && empty === 2) {
                score += W2;
            } else if (theirs === 3 && empty === 1) {
                /* Blocking rated a shade above building, so it defends rather
                   than racing when both sides are one move from four. */
                score -= B3 + parityBonus(st, hole, opp);
            } else if (theirs === 2 && empty === 2) {
                score -= B2;
            }
        }

        for (i = 0; i < ROWS; i++) {
            var v = cells[i * COLS + 3];
            if (v === me) score += CENTRE; else if (v) score -= CENTRE;
        }
        return score;
    }

    /* The parity term. `hole` is the square that would complete the four for
       `owner`. It only counts while the square is still out of reach — once it
       is the next disc in that column the threat is tactical, and the search
       is already handling it far better than a heuristic could.

       Squares are numbered from 1 at the bottom, so an odd square is filled by
       whoever opened. A threat sitting on your own parity is one your opponent
       can never be forced to fill for you; on the wrong parity, they will. */
    function parityBonus(st, hole, owner) {
        if (hole < 0) return 0;
        var row = (hole / COLS) | 0, col = hole % COLS;
        if (st.heights[col] === row) return 0;            /* playable now */
        var odd = (row % 2) === 0;                        /* row 0 is square 1 */
        var wantsOdd = owner === 1;
        var good = (odd === wantsOdd);
        return good ? PARITY_GOOD : PARITY_BAD;
    }

    /* ── Search ─────────────────────────────────────────────────────────── */

    var EXACT = 0, LOWER = 1, UPPER = 2;

    function Searcher() {
        this.tt = new Map();
        this.killers = [];
        this.history = new Int32Array(COLS);
        this.nodes = 0;
        this.deadline = 0;
    }

    Searcher.prototype.order = function (st, moves, ply, ttCol) {
        var self = this, k = this.killers[ply];
        return moves.slice().sort(function (x, y) {
            return sc(y) - sc(x);
            function sc(c) {
                if (c === ttCol) return 1e9;
                var s = self.history[c];
                if (k && (c === k[0] || c === k[1])) s += 5e5;
                s += (3 - Math.abs(3 - c)) * 1000;         /* centre bias */
                return s;
            }
        });
    };

    Searcher.prototype.negamax = function (st, depth, alpha, beta, ply) {
        this.nodes++;
        if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) throw ABORT;

        var key = st.ha + ':' + st.hb;
        var hit = this.tt.get(key), ttCol = -1;
        if (hit) {
            ttCol = hit.col;
            if (hit.depth >= depth) {
                if (hit.flag === EXACT) return hit.score;
                if (hit.flag === LOWER) { if (hit.score > alpha) alpha = hit.score; }
                else if (hit.score < beta) beta = hit.score;
                if (alpha >= beta) return hit.score;
            }
        }

        var moves = legal(st);
        if (!moves.length) return 0;

        var me = st.turn;
        if (depth <= 0) return evaluate(st, me);

        var ordered = this.order(st, moves, ply, ttCol);
        var best = -Infinity, bestCol = ordered[0], a0 = alpha;

        for (var i = 0; i < ordered.length; i++) {
            var col = ordered[i];
            var r = drop(st, col);
            var sc;
            if (winsFast(st, r, col)) sc = WIN - ply;   /* sooner beats later */
            else if (st.count === SIZE) sc = 0;
            else sc = -this.negamax(st, depth - 1, -beta, -alpha, ply + 1);
            undo(st);

            if (sc > best) { best = sc; bestCol = col; }
            if (best > alpha) alpha = best;
            if (alpha >= beta) {
                this.history[col] += depth * depth;
                if (!this.killers[ply]) this.killers[ply] = [-1, -1];
                if (this.killers[ply][0] !== col) {
                    this.killers[ply][1] = this.killers[ply][0];
                    this.killers[ply][0] = col;
                }
                break;
            }
        }

        var flag = best <= a0 ? UPPER : (best >= beta ? LOWER : EXACT);
        if (this.tt.size < 400000) this.tt.set(key, { depth: depth, score: best, flag: flag, col: bestCol });
        return best;
    };

    /* Root: exact score per column, so a difficulty sampler has real numbers to
       weigh rather than only the argmax. */
    Searcher.prototype.roots = function (st, depth) {
        var moves = legal(st), out = [];
        for (var i = 0; i < moves.length; i++) {
            var col = moves[i];
            var r = drop(st, col);
            var sc;
            if (winsFast(st, r, col)) sc = WIN;
            else if (st.count === SIZE) sc = 0;
            else sc = -this.negamax(st, depth - 1, -Infinity, Infinity, 1);
            undo(st);
            out.push({ col: col, score: sc });
        }
        return out;
    };

    var LEVELS = {
        easy:   { maxDepth: 2,  ms: 40,  temp: 70, slack: 260, seeWin: 0.72, seeBlock: 0.5 },
        fair:   { maxDepth: 5,  ms: 140, temp: 26, slack: 70,  seeWin: 0.95, seeBlock: 0.85 },
        sharp:  { maxDepth: 9,  ms: 340, temp: 9,  slack: 24,  seeWin: 1,    seeBlock: 0.98 },
        brutal: { maxDepth: 14, ms: 800, temp: 0,  slack: 0,   seeWin: 1,    seeBlock: 1 }
    };

    /* Iterative deepening. Each pass seeds the next one's ordering through the
       table, which is what makes the deeper passes cheap enough to be worth
       running at all; and if the clock runs out mid-pass the previous complete
       pass is still there to answer with. */
    function bestMove(st, level) {
        var cfg = LEVELS[level] || LEVELS.fair;
        var moves = legal(st);
        if (!moves.length) return null;

        var t0 = performance.now();
        var s = new Searcher();
        s.deadline = t0 + cfg.ms;

        var me = st.turn, opp = me === 1 ? 2 : 1;
        var forced = [], blind = [];

        /* Tactics a weaker setting is allowed to miss. Anything missed is put
           beyond reach so the search cannot quietly find it again. */
        var win = immediateWin(st, me);
        if (win !== -1) {
            if (Math.random() < cfg.seeWin) {
                return { col: win, depth: 1, nodes: 1, score: WIN, ms: 0, note: 'wins now' };
            }
            blind.push(win);
        }
        var block = immediateWin(st, opp);
        if (block !== -1) {
            if (Math.random() < cfg.seeBlock) forced.push(block);
            else blind.push(block);
        }

        var pool = moves.filter(function (c) { return blind.indexOf(c) < 0; });
        if (forced.length) {
            var f = forced.filter(function (c) { return pool.indexOf(c) >= 0; });
            if (f.length) pool = f;
        }
        if (!pool.length) pool = moves;
        if (pool.length === 1) {
            return { col: pool[0], depth: 1, nodes: 1, score: 0, ms: Math.round(performance.now() - t0), note: 'only move' };
        }


        var best = null, reached = 0;

        /* The abort throw unwinds straight past every undo() on the stack, so
           the shared board is left holding all of the search's pieces. Rather
           than wrap the hot loop in try/finally — which costs more than the
           whole time limit saves — the move count is recorded here and the
           board is rewound to it. Without this, deeper levels (which are the
           ones that actually run out of clock) corrupt the position and then
           play from it: measured, brutal lost to easy 6-3 and returned columns
           that were already full. */
        var baseline = st.moves.length;
        function rewind() { while (st.moves.length > baseline) undo(st); }

        for (var d = 1; d <= cfg.maxDepth; d++) {
            try {
                var rs = s.roots(st, d).filter(function (x) { return pool.indexOf(x.col) >= 0; });
                if (rs.length) {
                    rs.sort(function (a, b) { return b.score - a.score; });
                    best = rs;
                    reached = d;
                }
            } catch (e) {
                if (e !== ABORT) { rewind(); throw e; }
                rewind();
                break;
            }
            if (performance.now() > s.deadline) break;
            /* A proven win or loss will not change with more depth. */
            if (best && Math.abs(best[0].score) > WIN - 100) break;
        }

        if (!best) best = [{ col: pool[0], score: 0 }];

        var pick = best[0].col;
        if (cfg.temp > 0 && best.length > 1 && Math.abs(best[0].score) < WIN - 100) {
            var top = best[0].score;
            var cands = best.filter(function (x) { return top - x.score <= cfg.slack; });
            var weights = cands.map(function (x) { return Math.exp((x.score - top) / cfg.temp); });
            var sum = weights.reduce(function (a, b) { return a + b; }, 0);
            var roll = Math.random() * sum, acc = 0;
            for (var i = 0; i < cands.length; i++) {
                acc += weights[i];
                if (roll <= acc) { pick = cands[i].col; break; }
            }
        }

        rewind();
        return {
            col: pick,
            depth: reached,
            nodes: s.nodes,
            score: best[0].score,
            ms: Math.round(performance.now() - t0),
            considered: best.length
        };
    }

    window.C4 = {
        ROWS: ROWS, COLS: COLS, SIZE: SIZE, WIN: WIN,
        LEVELS: LEVELS,
        newState: newState, clone: clone, legal: legal, canPlay: canPlay,
        drop: drop, undo: undo,
        winLineAt: winLineAt, winsAt: winsAt, winsFast: winsFast, immediateWin: immediateWin,
        evaluate: evaluate, bestMove: bestMove
    };
})();
