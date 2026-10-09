/* ============================================================================
   CONNECT FOUR — board, input, motion and game loop
   ---------------------------------------------------------------------------
   The engine (engine.js) knows nothing about the DOM; this file is the only
   place they meet. Pieces are absolutely positioned in a layer of their own so
   every drop, bounce, undo and clear can be animated with the Web Animations
   API without touching the slot grid.
   ========================================================================= */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var ROWS = C4.ROWS, COLS = C4.COLS;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var DIFF_NOTE = {
        easy:   'Two moves ahead, and it lets things slide. It misses a four you leave open about a third of the time.',
        fair:   'Five moves ahead. It defends properly and takes what you give it, but it can still be out-planned.',
        sharp:  'Nine moves ahead, and it understands threat parity: it builds threats you cannot be forced to fill.',
        brutal: 'Fourteen moves ahead with no deliberate mistakes, reading to the bottom of the board. No takebacks.'
    };
    var SETTINGS_KEY = 'connect4.settings';

    var st = null;
    var score = { p1: 0, p2: 0, draw: 0 };
    var over = false, thinking = false, busy = false, winLine = null;
    var gameNo = 0;
    /* Bumped by anything that invalidates an opponent turn already in flight
       (new game, undo, settings change), so a stale reply never lands. */
    var turnTok = 0;
    var pieces = new Array(ROWS * COLS);   /* DOM piece per cell index */
    var hoverCol = 3;
    var clockStart = 0, clockStop = 0, clockTimer = 0;
    var wander = 0;

    var boardEl = $('board'), discsEl = $('discs'), colsEl = $('cols'), slotsEl = $('slots');
    var hoverEl = $('hover'), winEl = $('winline');

    function mode()  { return document.querySelector('input[name="mode"]:checked').value; }
    function diff()  { return document.querySelector('input[name="diff"]:checked').value; }
    function opens() { return document.querySelector('input[name="first"]:checked').value; }
    function vsCPU() { return mode() === 'cpu'; }
    var CPU = 2;     /* the human is always red against the computer */

    function colorName(p) { return p === 1 ? 'Red' : 'Blue'; }
    function vr(row) { return ROWS - 1 - row; }  /* visual row, 0 = top */

    /* ── Build ───────────────────────────────────────────────────────────── */
    function build() {
        for (var i = 0; i < ROWS * COLS; i++) slotsEl.appendChild(document.createElement('div')).className = 'slot';
        for (var c = 0; c < COLS; c++) {
            var col = document.createElement('div');
            col.className = 'col';
            col.dataset.col = c;
            col.setAttribute('role', 'gridcell');
            col.setAttribute('aria-label', 'Drop in column ' + (c + 1));
            colsEl.appendChild(col);
        }
    }

    function makePiece(idx, p) {
        var r = Math.floor(idx / COLS), c = idx % COLS;
        var el = document.createElement('div');
        el.className = 'piece p' + p;
        el.style.left = (c * 100 / COLS) + '%';
        el.style.top = (vr(r) * 100 / ROWS) + '%';
        el.innerHTML = '<div class="disc' + (p === 2 ? ' p2' : '') + '"></div>';
        discsEl.appendChild(el);
        pieces[idx] = el;
        return el;
    }

    /* ── Motion ──────────────────────────────────────────────────────────── */

    /* Gravity drop: accelerate in from above the board, land, one small bounce,
       squash on impact, ripple. Fall time grows with distance, so every drop
       reads as the same acceleration rather than the same duration. */
    function animateDrop(el, row, p) {
        if (reduce) return 0;
        var dist = vr(row) + 1;                       /* in cell heights */
        var dur = 260 + dist * 70;
        el.animate([
            { transform: 'translateY(' + (-dist * 100) + '%)', easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
            { transform: 'translateY(0)', offset: 0.7, easing: 'cubic-bezier(0, 0.55, 0.45, 1)' },
            { transform: 'translateY(-14%)', offset: 0.84, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' },
            { transform: 'translateY(0)' }
        ], { duration: dur });
        var land = dur * 0.7;
        el.firstChild.animate([
            { transform: 'scale(1, 1)' },
            { transform: 'scale(1.1, 0.86)', offset: 0.35 },
            { transform: 'scale(1, 1)' }
        ], { duration: 260, delay: land, easing: 'ease-out' });
        setTimeout(function () { ripple(el, p); }, land);
        return dur;
    }

    function ripple(el, p) {
        var r = document.createElement('span');
        r.className = 'ripple';
        r.style.cssText = 'left:' + el.style.left + ';top:' + el.style.top + ';width:' + (100 / COLS) + '%;height:' + (100 / ROWS) + '%;color:' + (p === 1 ? 'var(--red)' : 'var(--blue)');
        discsEl.appendChild(r);
        setTimeout(function () { r.remove(); }, 600);
    }

    function animateLift(el, row) {
        if (reduce) { el.remove(); return; }
        var dist = vr(row) + 1;
        el.animate([
            { transform: 'translateY(0)', opacity: 1 },
            { transform: 'translateY(' + (-dist * 100) + '%)', opacity: 0.2 }
        ], { duration: 220 + dist * 40, easing: 'cubic-bezier(0.4, 0, 1, 1)' }).onfinish = function () { el.remove(); };
    }

    /* New game: the board's latch opens and everything falls out of the bottom,
       column by column. Resolves once the board is empty. */
    function clearBoard() {
        clearWinLine();
        var all = pieces.filter(Boolean);
        pieces = new Array(ROWS * COLS);
        if (!all.length) return Promise.resolve();
        if (reduce) { all.forEach(function (e) { e.remove(); }); return Promise.resolve(); }
        var longest = 0;
        all.forEach(function (e) {
            var c = Math.round(parseFloat(e.style.left) / (100 / COLS));
            var delay = Math.abs(c - 3) * 45 + Math.random() * 40;
            var dur = 520 + Math.random() * 120;
            longest = Math.max(longest, delay + dur);
            e.animate([
                { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
                { transform: 'translateY(780%) rotate(' + (Math.random() * 40 - 20) + 'deg)', opacity: 1 }
            ], { duration: dur, delay: delay, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' });
        });
        return new Promise(function (res) {
            setTimeout(function () { all.forEach(function (e) { e.remove(); }); res(); }, longest + 20);
        });
    }

    function centre(idx) {
        var r = Math.floor(idx / COLS), c = idx % COLS;
        return { x: (c + 0.5) * 100, y: (vr(r) + 0.5) * 100 };   /* svg units, 700 × 600 */
    }

    function drawWinLine(line, p) {
        /* the two cells furthest apart are the ends of the four */
        var a = line[0], b = line[0], best = -1;
        line.forEach(function (i) { line.forEach(function (j) {
            var A = centre(i), B = centre(j), d = (A.x - B.x) * (A.x - B.x) + (A.y - B.y) * (A.y - B.y);
            if (d > best) { best = d; a = i; b = j; }
        }); });
        var A = centre(a), B = centre(b);
        var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ln.setAttribute('x1', A.x); ln.setAttribute('y1', A.y);
        ln.setAttribute('x2', B.x); ln.setAttribute('y2', B.y);
        winEl.appendChild(ln);
        var len = Math.sqrt(best);
        ln.style.strokeDasharray = len;
        ln.style.strokeDashoffset = reduce ? 0 : len;
        if (!reduce) ln.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 520, delay: 120, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
        confetti(A, B, p);
    }
    function clearWinLine() {
        Array.from(winEl.children).forEach(function (n) {
            if (reduce) return n.remove();
            n.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).onfinish = function () { n.remove(); };
        });
    }

    /* A small burst of mini discs from the middle of the winning line. */
    function confetti(A, B, p) {
        if (reduce) return;
        var rect = boardEl.getBoundingClientRect();
        var cx = rect.left + ((A.x + B.x) / 2) / 700 * rect.width;
        var cy = rect.top + ((A.y + B.y) / 2) / 600 * rect.height;
        var colors = p === 1 ? ['#ef4444', '#f87171', '#fecaca', '#ffffff'] : ['#3b8ef0', '#7cb4f7', '#cfe3fc', '#ffffff'];
        for (var i = 0; i < 26; i++) {
            var d = document.createElement('span');
            d.className = 'confetti';
            var size = 8 + Math.random() * 10;
            d.style.cssText = 'left:' + (cx - size / 2) + 'px;top:' + (cy - size / 2) + 'px;width:' + size + 'px;height:' + size + 'px;background:' + colors[i % colors.length];
            document.body.appendChild(d);
            var ang = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 180;
            var dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp - 120;
            d.animate([
                { transform: 'translate(0,0) scale(0.4)', opacity: 1 },
                { transform: 'translate(' + dx * 0.6 + 'px,' + dy * 0.6 + 'px) scale(1)', opacity: 1, offset: 0.35 },
                { transform: 'translate(' + dx + 'px,' + (dy + 260) + 'px) scale(0.8)', opacity: 0 }
            ], { duration: 1100 + Math.random() * 400, delay: 380, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'forwards' })
             .onfinish = (function (n) { return function () { n.remove(); }; })(d);
        }
    }

    function bump(el) {
        el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }

    /* ── Hover disc ──────────────────────────────────────────────────────── */
    function setHover(c, who) {
        if (c != null && c !== hoverCol) hoverEl.classList.remove('tipping');
        if (c != null) hoverCol = c;
        hoverEl.style.setProperty('--hc', hoverCol);
        var p = who || (st ? st.turn : 1);
        hoverEl.firstChild.className = 'disc' + (p === 2 ? ' p2' : '');
        Array.prototype.forEach.call(colsEl.children, function (col, i) {
            col.classList.toggle('hot', i === hoverCol && !over && !thinking && !busy);
        });
    }
    function showHover(on) { hoverEl.classList.toggle('off', !on); }
    function syncHover() {
        var can = !over && !busy && (thinking || C4.canPlay(st, hoverCol) || true);
        showHover(can && !over && !busy);
        hoverEl.classList.toggle('cpu', thinking);
        setHover(null, thinking ? CPU : st.turn);
    }

    /* ── Status ──────────────────────────────────────────────────────────── */
    function names() { return vsCPU() ? ['You', 'CPU'] : ['Red', 'Blue']; }
    function undoAllowed() { return !(vsCPU() && diff() === 'brutal'); }

    var lastTurnShown = 0;
    function status() {
        var nm = names();
        $('n1').textContent = nm[0];
        $('n2').textContent = nm[1];
        var undo = $('undoBtn');
        undo.disabled = !undoAllowed() || !st.moves.length || thinking || busy;
        undo.title = undoAllowed() ? '' : 'No takebacks on Brutal';
        $('newBtn').classList.toggle('glow', over);
        var hb = $('hintBtn');
        hb.disabled = over || thinking || busy || !undoAllowed();
        hb.title = undoAllowed() ? 'Suggest a column (H)' : 'No hints on Brutal';
        boardEl.classList.toggle('locked', over || thinking || busy);
        Array.prototype.forEach.call(colsEl.children, function (col, c) { col.classList.toggle('full', !C4.canPlay(st, c)); });

        var s = $('status'), lbl = $('turnLbl'), who = $('turnWho'), big = $('bigDisc');
        s.className = 'v';
        var shown;
        if (over) {
            if (winLine) {
                var w = st.cells[winLine[0]];
                shown = w;
                s.textContent = 'Game over';
                lbl.textContent = 'Winner:';
                who.textContent = colorName(w);
            } else {
                shown = 0;
                s.textContent = 'Game over';
                lbl.textContent = 'Result:';
                who.textContent = 'Draw';
            }
        } else {
            shown = st.turn;
            s.innerHTML = thinking ? '<span class="dots">Thinking</span>' : 'Playing';
            lbl.textContent = vsCPU() ? (st.turn === 1 ? 'Your turn:' : 'CPU turn:') : 'Player turn:';
            who.textContent = colorName(st.turn);
        }
        who.className = 'who' + (shown === 2 ? ' p2' : '') + (shown === 0 ? '' : '');
        if (shown === 0) who.style.color = 'var(--soft)'; else who.style.color = '';
        big.firstChild.className = 'disc' + (shown === 2 ? ' p2' : '');
        big.firstChild.style.background = shown === 0 ? 'linear-gradient(90deg, var(--red) 50%, var(--blue) 50%)' : '';
        big.classList.toggle('thinking', thinking);
        document.body.classList.toggle('ended', over);
        if (shown !== lastTurnShown && !reduce) {
            big.classList.remove('flip'); void big.offsetWidth; big.classList.add('flip');
            who.classList.remove('swap'); void who.offsetWidth; who.classList.add('swap');
        }
        lastTurnShown = shown;
        syncHover();
    }

    function readout(html) { $('analysis').innerHTML = $('showEngine').checked ? html : ''; lastReadout = html; }
    var lastReadout = '';
    function analysisText(r) {
        if (!r) return '';
        var lines = ['<b>col ' + (r.col + 1) + '</b>   depth ' + r.depth + '   ' + r.ms + 'ms', r.nodes.toLocaleString() + (r.nodes === 1 ? ' position read' : ' positions read')];
        if (Math.abs(r.score) > C4.WIN - 100) lines.push(r.score > 0 ? '<b>forced win found</b>' : 'loses with best play');
        else lines.push('eval ' + (r.score > 0 ? '+' : '') + r.score);
        if (r.note) lines.push(r.note);
        return lines.join('\n');
    }

    /* ── Clock ───────────────────────────────────────────────────────────── */
    function fmt(ms) {
        var s = Math.floor(ms / 1000);
        return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }
    function tick() { var t = fmt((clockStop || performance.now()) - clockStart); $('clock').textContent = t; $('clock2').textContent = t; }
    function startClock() {
        if (clockStart) return;
        clockStart = performance.now(); clockStop = 0;
        clearInterval(clockTimer); clockTimer = setInterval(tick, 250);
    }
    function stopClock() { if (clockStart && !clockStop) { clockStop = performance.now(); tick(); } clearInterval(clockTimer); }
    function resetClock() { clearInterval(clockTimer); clockStart = clockStop = 0; $('clock').textContent = '00:00'; $('clock2').textContent = '00:00'; }

    /* ── Moves ───────────────────────────────────────────────────────────── */
    function play(col, byCPU) {
        if (over || busy || !C4.canPlay(st, col)) return false;
        if (thinking && !byCPU) return false;

        startClock();
        var p = st.turn;
        var row = C4.drop(st, col);
        var idx = row * COLS + col;
        var el = makePiece(idx, p);
        setHover(col);
        var fall = animateDrop(el, row, p);
        pushChip(p, col);
        var land = reduce ? 0 : fall * 0.7;

        var line = C4.winLineAt(st, row, col);
        if (line) {
            over = true; winLine = line;
            stopClock();
            setTimeout(function () {
                line.forEach(function (i) { pieces[i] && pieces[i].classList.add('win'); });
                boardEl.classList.add('over');
                drawWinLine(line, p);
                showResult(p);
            }, land);
            if (p === 1) score.p1++; else score.p2++;
            setTimeout(function () { bumpScore(p === 1 ? 's1' : 's2'); }, land + 300);
        } else if (st.count === ROWS * COLS) {
            over = true; winLine = null;
            stopClock();
            score.draw++;
            setTimeout(function () {
                if (!reduce) { boardEl.classList.remove('shake'); void boardEl.offsetWidth; boardEl.classList.add('shake'); }
                bumpScore('sd');
                showResult(0);
            }, land);
        }

        status();
        if (!over && vsCPU() && st.turn === CPU) scheduleCPU(fall);
        return true;
    }

    /* How long the opponent takes to answer: let the player's disc land, a beat
       of visible consideration, and a floor on the whole reply so EASY (2ms)
       and BRUTAL (800ms) feel like the same opponent thinking. While it thinks,
       its disc hesitates over a few columns. */
    var THINK_PAUSE = 160;
    var THINK_FLOOR = 760;

    function scheduleCPU(settle) {
        thinking = true;
        status();
        var t0 = performance.now();
        var mine = ++turnTok;
        startWander();

        setTimeout(function () {
            if (mine !== turnTok) return;
            var r = null, blew = null;
            try { r = C4.bestMove(st, diff()); }
            catch (err) { blew = err; }

            var rest = reduce ? 0 : Math.max(0, THINK_FLOOR - (performance.now() - t0));
            setTimeout(function () {
                if (mine !== turnTok) return;
                stopWander();
                if (blew) {
                    thinking = false;
                    readout('search failed, play on');
                    toast('Opponent error');
                    status();
                    throw blew;
                }
                readout(analysisText(r));
                if (!r || r.col < 0) { thinking = false; status(); return; }
                /* glide to the chosen column, hold a beat, drop */
                setHover(r.col, CPU);
                setTimeout(function () {
                    if (mine !== turnTok) return;
                    thinking = false;
                    play(r.col, true);
                }, reduce ? 0 : 300);
            }, rest);
        }, reduce ? 0 : (settle || 0) * 0.7 + THINK_PAUSE);
    }

    function startWander() {
        stopWander();
        if (reduce) return;
        wander = setInterval(function () {
            var opts = [];
            for (var c = 0; c < COLS; c++) if (C4.canPlay(st, c)) opts.push(c);
            if (!opts.length) return;
            /* drift toward the middle, the way a person scans */
            var pick = opts[Math.floor(Math.random() * opts.length)];
            if (Math.random() < 0.5) pick = opts.reduce(function (a, b) { return Math.abs(b - 3) < Math.abs(a - 3) ? b : a; });
            if (pick === hoverCol) pick = opts[(opts.indexOf(pick) + 1) % opts.length];
            setHover(pick, CPU);
        }, 340);
    }
    function stopWander() { clearInterval(wander); wander = 0; }

    /* A hint is a modest search on the player's behalf: the hover disc glides to
       the suggested column and the column flashes. Barred on Brutal, like undo. */
    function hint() {
        if (over || thinking || busy || !undoAllowed()) return;
        var r = null;
        try { r = C4.bestMove(C4.clone(st), 'sharp'); } catch (e) { return; }
        if (!r || r.col < 0) return;
        setHover(r.col);
        var col = colsEl.children[r.col];
        col.classList.remove('hint'); void col.offsetWidth; col.classList.add('hint');
        setTimeout(function () { col.classList.remove('hint'); }, 2900);
        hoverEl.classList.toggle('tip-left', r.col >= 5);
        hoverEl.classList.add('tipping');
        clearTimeout(hint.t);
        hint.t = setTimeout(function () { hoverEl.classList.remove('tipping'); }, 2600);
    }

    function undoMove() {
        if (thinking || busy || !st.moves.length || !undoAllowed()) return;
        var takeTwo = vsCPU() && !over && st.turn === 1 && st.moves.length >= 2;
        turnTok++;
        var n = takeTwo ? 2 : 1;
        if (over) { boardEl.classList.remove('over'); clearWinLine(); pieces.forEach(function (e) { e && e.classList.remove('win'); }); clockStop = 0; clockStart && (clockTimer = setInterval(tick, 250)); }
        for (var k = 0; k < n; k++) {
            var col = st.moves[st.moves.length - 1];
            var row = st.heights[col] - 1, idx = row * COLS + col;
            C4.undo(st);
            if (pieces[idx]) { animateLift(pieces[idx], row); pieces[idx] = null; }
        }
        hideResult();
        popChips(n);
        over = false; winLine = null;
        if (!st.moves.length) resetClock();
        status();
        if (vsCPU() && st.turn === CPU) scheduleCPU();
    }

    /* ── Move history + result banner ────────────────────────────────────── */
    function pushChip(p, col) {
        var box = $('history');
        var none = box.querySelector('.none'); if (none) none.remove();
        box.querySelectorAll('.chip.last').forEach(function (c) { c.classList.remove('last'); });
        var c = document.createElement('span');
        c.className = 'chip last' + (p === 2 ? ' p2' : '');
        c.innerHTML = '<i></i>' + (col + 1);
        c.title = colorName(p) + ' in column ' + (col + 1);
        box.appendChild(c);
        box.scrollTop = box.scrollHeight;
        box.scrollLeft = box.scrollWidth;
        $('moveCount').textContent = st.count;
    }
    function popChips(n) {
        var box = $('history');
        var chips = Array.prototype.slice.call(box.querySelectorAll('.chip:not(.out)'), -n);
        chips.forEach(function (c) { c.classList.add('out'); setTimeout(function () { c.remove(); markLast(); }, reduce ? 0 : 200); });
        $('moveCount').textContent = st.count;
        if (!reduce) return;
        markLast();
    }
    function markLast() {
        var box = $('history');
        var all = box.querySelectorAll('.chip:not(.out)');
        all.forEach(function (c, i) { c.classList.toggle('last', i === all.length - 1); });
        if (!all.length && !box.querySelector('.none')) box.innerHTML = '<span class="none">No moves yet.</span>';
    }
    function resetHistory() { $('history').innerHTML = '<span class="none">No moves yet.</span>'; $('moveCount').textContent = '0'; }
    function showResult(w) {
        var r = $('result');
        r.className = 'result' + (w === 2 ? ' p2' : w === 0 ? ' draw' : '');
        $('resTitle').textContent = w === 0 ? 'Draw' : (vsCPU() ? (w === 1 ? 'You win' : 'CPU wins') : colorName(w) + ' wins');
        $('resSub').textContent = fmt((clockStop || performance.now()) - clockStart) + ' · ' + st.count + ' moves';
        void r.offsetWidth;
        r.classList.add('on');
    }
    function hideResult() { $('result').classList.remove('on'); }

    function bumpScore(which) {
        $('s1').textContent = score.p1;
        $('s2').textContent = score.p2;
        $('sd').textContent = score.draw;
        if (which && !reduce) bump(which === 'sd' ? $('sd') : $(which));
    }

    function newGame() {
        gameNo++;
        turnTok++;
        stopWander();
        var first = 1;
        if (vsCPU()) {
            var o = opens();
            if (o === 'cpu') first = CPU;
            else if (o === 'alt') first = (gameNo % 2 === 1) ? 1 : CPU;
        }
        over = false; winLine = null; thinking = false; busy = true;
        boardEl.classList.remove('over');
        hideResult();
        resetHistory();
        resetClock();
        readout('');
        if (st) status();
        var mine = turnTok;
        clearBoard().then(function () {
            if (mine !== turnTok) return;
            st = C4.newState(first);
            busy = false;
            setHover(3);
            status();
            if (vsCPU() && st.turn === CPU) scheduleCPU();
        });
    }

    /* ── Input ───────────────────────────────────────────────────────────── */
    function colFromEvent(e) {
        var t = e.target.closest ? e.target.closest('.col') : null;
        return t ? parseInt(t.dataset.col, 10) : -1;
    }
    colsEl.addEventListener('click', function (e) {
        var c = colFromEvent(e);
        if (c >= 0) play(c, false);
    });
    colsEl.addEventListener('pointermove', function (e) {
        if (thinking || over || busy) return;
        var c = colFromEvent(e);
        if (c >= 0 && c !== hoverCol) setHover(c);
    });

    document.addEventListener('keydown', function (e) {
        if (document.querySelector('.scrim.open')) {
            if (e.key === 'Escape') closeAll();
            return;
        }
        var n = '1234567'.indexOf(e.key);
        if (n >= 0) { e.preventDefault(); play(n, false); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (thinking || over || busy) return;
            e.preventDefault();
            setHover(Math.max(0, Math.min(COLS - 1, hoverCol + (e.key === 'ArrowLeft' ? -1 : 1))));
            return;
        }
        if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') && e.target === document.body) { e.preventDefault(); play(hoverCol, false); return; }
        if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoMove(); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newGame(); return; }
        if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hint(); }
    });

    $('newBtn').addEventListener('click', newGame);
    $('undoBtn').addEventListener('click', undoMove);
    $('resetScore').addEventListener('click', function () {
        score = { p1: 0, p2: 0, draw: 0 };
        bumpScore();
        gameNo = 0;
        toast('Scores cleared');
    });

    /* ── Sheets (settings, rules) ────────────────────────────────────────── */
    var lastFocus = null;
    function openSheet(id) {
        closeAll();
        lastFocus = document.activeElement;
        var s = $(id);
        s.classList.add('open');
        requestAnimationFrame(function () { s.querySelectorAll('.seg').forEach(placePill); });
        setTimeout(function () { var x = s.querySelector('[data-close]'); x && x.focus(); }, 50);
    }
    function closeAll() {
        document.querySelectorAll('.scrim.open').forEach(function (s) { s.classList.remove('open'); });
        if (lastFocus && lastFocus.focus) lastFocus.focus();
        lastFocus = null;
    }
    document.querySelectorAll('.scrim').forEach(function (s) {
        s.addEventListener('click', function (e) { if (e.target === s || e.target.closest('[data-close]')) closeAll(); });
    });
    $('hintBtn').addEventListener('click', hint);
    $('showEngine').addEventListener('change', function () { saveSettings(); readout(lastReadout); });
    $('navSettings').addEventListener('click', function () { openSheet('setScrim'); });
    $('navRules').addEventListener('click', function () { openSheet('rulesScrim'); });
    $('navPlay').addEventListener('click', function () { closeAll(); boardEl.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' }); });
    $('navScore').addEventListener('click', function () {
        var card = $('scoreCard');
        card.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
        if (!reduce) card.animate([{ boxShadow: '0 0 0 0 rgba(59,142,240,0.6)' }, { boxShadow: '0 0 0 10px rgba(59,142,240,0)' }], { duration: 900, easing: 'ease-out' });
    });

    /* segmented controls get a sliding pill */
    function placePill(seg) {
        var pill = seg.querySelector('.pill');
        if (!pill) { pill = document.createElement('span'); pill.className = 'pill'; seg.insertBefore(pill, seg.firstChild); }
        var on = seg.querySelector('input:checked');
        if (!on) return;
        var lab = on.parentElement;
        pill.style.left = lab.offsetLeft + 'px';
        pill.style.width = lab.offsetWidth + 'px';
    }
    document.querySelectorAll('.seg').forEach(function (seg) {
        seg.addEventListener('change', function () { placePill(seg); saveSettings(); });
    });
    window.addEventListener('resize', function () { document.querySelectorAll('.scrim.open .seg').forEach(placePill); });

    function saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mode: mode(), diff: diff(), first: opens(), engine: $('showEngine').checked })); } catch (e) {}
    }
    function loadSettings() {
        try {
            var s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
            if (!s) return;
            $('showEngine').checked = !!s.engine;
            ['mode', 'diff', 'first'].forEach(function (k) {
                var el = document.querySelector('input[name="' + k + '"][value="' + s[k] + '"]');
                if (el) el.checked = true;
            });
        } catch (e) {}
    }

    function syncFields() {
        $('diffFld').hidden = !vsCPU();
        $('openFld').hidden = !vsCPU();
        $('diffNote').textContent = DIFF_NOTE[diff()];
        $('footNote').textContent = vsCPU() ? 'Opponent reads threat parity. Good luck.' : 'Pass the device. Red goes first.';
        document.querySelectorAll('.scrim.open .seg').forEach(placePill);
    }
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
        r.addEventListener('change', function () { syncFields(); newGame(); });
    });
    document.querySelectorAll('input[name="diff"]').forEach(function (r) {
        r.addEventListener('change', function () { syncFields(); status(); });
    });
    document.querySelectorAll('input[name="first"]').forEach(function (r) {
        r.addEventListener('change', newGame);
    });

    var toastT = 0;
    function toast(msg) {
        var t = $('toast');
        t.textContent = msg;
        t.classList.add('on');
        clearTimeout(toastT);
        toastT = setTimeout(function () { t.classList.remove('on'); }, 1800);
    }

    /* ── Boot ────────────────────────────────────────────────────────────── */
    build();
    loadSettings();
    syncFields();
    newGame();
    bumpScore();
})();
