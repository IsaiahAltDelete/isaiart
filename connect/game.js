/* ============================================================================
   CONNECT FOUR — board, input and game loop
   ---------------------------------------------------------------------------
   The engine knows nothing about the DOM and the DOM knows nothing about the
   search; this file is the only place they meet.
   ========================================================================= */
(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var ROWS = C4.ROWS, COLS = C4.COLS;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ── Console furniture ───────────────────────────────────────────────── */
    if (window.CAS) CAS.bootOnce($('headScreen'));
    SRCH.clock($('clock'));
    var trace = SRCH.scope($('scope'));
    SRCH.themeSwitch($('themeSw'), function () { if (trace) trace.repaint(); });
    if (window.CAS) CAS.pageTransition();

    var DIFF_NOTE = {
        easy:   'Two moves ahead, and it lets things slide — it will miss a four you leave open about a third of the time.',
        fair:   'Five moves ahead. It defends properly and takes what you give it, but it can still be out-planned.',
        sharp:  'Nine moves ahead, and it understands threat parity — it will build threats you cannot be forced to fill.',
        brutal: 'Fourteen moves ahead with no deliberate mistakes. In the endgame it is reading to the bottom of the board — and there are no takebacks.'
    };

    var st = null;
    var score = { p1: 0, p2: 0, draw: 0 };
    var over = false, thinking = false, winLine = null;
    var lastAI = null;
    var gameNo = 0;
    /* Bumped by anything that invalidates an opponent turn already in flight.
       scheduleCPU captures the value and bails if it has moved on. Without
       this, hitting NEW while the opponent is thinking lets the pending reply
       land on the fresh board — a stray disc, out of turn, before you have
       played. Harmless-looking at the old 90ms delay because the window was
       too small to hit; the deliberate ~640ms pause makes it easy. */
    var turnTok = 0;
    var cells = [];             /* DOM cell per index */
    var boardEl = $('board'), ghostEl = $('ghost');

    function mode()  { return document.querySelector('input[name="mode"]:checked').value; }
    function diff()  { return document.querySelector('input[name="diff"]:checked').value; }
    function opens() { return document.querySelector('input[name="first"]:checked').value; }
    function vsCPU() { return mode() === 'cpu'; }

    /* The human is always disc 1 against the computer, so the colours never
       swap under you mid-session even when the opponent opens. */
    function cpuPlayer() { return 2; }

    /* ── Build ───────────────────────────────────────────────────────────── */

    function build() {
        boardEl.querySelectorAll('.col').forEach(function (c) { c.remove(); });
        cells = new Array(ROWS * COLS);
        for (var c = 0; c < COLS; c++) {
            var col = document.createElement('div');
            col.className = 'col';
            col.dataset.col = c;
            col.setAttribute('role', 'gridcell');
            col.setAttribute('aria-label', 'Column ' + (c + 1));
            /* column-reverse in CSS, so append bottom row first */
            for (var r = 0; r < ROWS; r++) {
                var cell = document.createElement('div');
                cell.className = 'cell';
                var pip = document.createElement('span');
                pip.className = 'pip';
                cell.appendChild(pip);
                col.appendChild(cell);
                cells[r * COLS + c] = pip;
            }
            boardEl.appendChild(col);
        }
    }

    function paint() {
        for (var i = 0; i < ROWS * COLS; i++) {
            var v = st.cells[i], pip = cells[i];
            pip.className = 'pip' + (v ? ' p' + v + ' set' : '');
        }
        for (var c = 0; c < COLS; c++) {
            boardEl.children[c + 1] && 0;   /* ghost is child 0 */
        }
        syncCols();
    }

    function syncCols() {
        var cols = boardEl.querySelectorAll('.col');
        for (var c = 0; c < COLS; c++) {
            cols[c].classList.toggle('full', st.heights[c] >= ROWS);
            cols[c].classList.toggle('locked', over || thinking);
        }
    }

    /* ── Status ──────────────────────────────────────────────────────────── */

    function names() {
        return vsCPU() ? ['YOU', 'COMPUTER'] : ['PLAYER ONE', 'PLAYER TWO'];
    }

    /* BRUTAL is the level that promises no deliberate mistakes, and a takeback
       is the player's way of un-losing to it — so it does not get one. Disabled
       rather than hidden: pulling the button out reflows the turn bar and moves
       NEW under the cursor, and a visibly barred control explains the rule
       better than a missing one. */
    function undoAllowed() { return !(vsCPU() && diff() === 'brutal'); }

    function status() {
        var nm = names();
        $('n1').textContent = nm[0];
        $('n2').textContent = nm[1];
        $('fMove').textContent = st.count;
        $('fLast').textContent = st.moves.length ? 'COL ' + (st.moves[st.moves.length - 1] + 1) : '—';

        var barred = !undoAllowed();
        $('undoBtn').disabled = barred || !st.moves.length || thinking;
        $('undoBtn').title = barred ? 'No takebacks on Brutal' : '';

        /* Nothing left to do but start another one. */
        $('newBtn').classList.toggle('glow', over);

        var disc = $('turnDisc'), name = $('turnName');
        if (over) {
            if (winLine) {
                var w = st.cells[winLine[0]];
                disc.className = 'disc p' + w;
                name.textContent = (vsCPU() ? (w === 1 ? 'YOU WIN' : 'COMPUTER WINS') : nm[w - 1] + ' WINS');
            } else {
                disc.className = 'disc';
                name.textContent = 'DRAW';
            }
            return;
        }
        disc.className = 'disc p' + st.turn;
        if (thinking) { name.textContent = 'THINKING…'; return; }
        name.textContent = vsCPU()
            ? (st.turn === 1 ? 'YOUR MOVE' : 'COMPUTER')
            : nm[st.turn - 1] + ' TO PLAY';
    }

    function readout(txt) { $('analysis').textContent = txt; }

    function analysisText(r) {
        if (!r) return '';
        var lines = [];
        lines.push('col ' + (r.col + 1) + '   depth ' + r.depth + '   ' + r.ms + 'ms');
        lines.push(r.nodes.toLocaleString() + ' positions');
        if (Math.abs(r.score) > C4.WIN - 100) {
            lines.push(r.score > 0 ? 'forced win found' : 'loses with best play');
        } else {
            lines.push('eval ' + (r.score > 0 ? '+' : '') + r.score);
        }
        if (r.note) lines.push(r.note);
        return lines.join('\n');
    }

    /* ── Moves ───────────────────────────────────────────────────────────── */

    function play(col, byCPU) {
        if (over || !C4.canPlay(st, col)) return false;
        if (thinking && !byCPU) return false;

        var p = st.turn;
        var row = C4.drop(st, col);
        var pip = cells[row * COLS + col];
        /* Longer fall from higher up, so every drop looks like the same
           acceleration rather than the same duration. */
        var fall = reduce ? 0 : 170 + (ROWS - row) * 42;
        pip.className = 'pip p' + p + (reduce ? ' set' : ' drop');
        if (!reduce) pip.style.setProperty('--fall', fall + 'ms');

        var line = C4.winLineAt(st, row, col);
        if (line) {
            over = true; winLine = line;
            line.forEach(function (i) { cells[i].classList.add('win'); });
            boardEl.classList.add('over');
            if (p === 1) score.p1++; else score.p2++;
            bumpScore();
        } else if (st.count === ROWS * COLS) {
            over = true; winLine = null;
            score.draw++;
            bumpScore();
        }

        syncCols();
        status();
        if (!over && vsCPU() && st.turn === cpuPlayer()) scheduleCPU(fall);
        return true;
    }

    /* How long the opponent takes to answer. EASY finds its move in about two
       milliseconds, so without this it replied while the player's disc was
       still in the air and the game felt like a switch rather than an
       opponent. Two separate waits, because they are two different problems:

         SETTLE  the player's own disc has to land first. Passed in from play()
                 rather than assumed, since the fall is longer from a high row.
         PAUSE   a beat of visible consideration after it lands.
         FLOOR   a minimum on the whole reply, so BRUTAL taking 800ms and EASY
                 taking 2ms still feel like the same opponent thinking.

       The floor is applied AFTER the search, not before, so a slow search
       costs nothing extra — it has already spent the time. */
    var THINK_PAUSE = 220;
    var THINK_FLOOR = 640;

    function scheduleCPU(settle) {
        thinking = true;
        syncCols();
        status();
        var t0 = performance.now();
        var mine = ++turnTok;

        /* setTimeout, not requestAnimationFrame. rAF does not fire in a tab
           that is not compositing, so scheduling the search on a frame meant
           that moving and then switching tabs left `thinking` true forever and
           the board locked on return. A timer still fires when backgrounded —
           throttled, which is fine, because the only thing waiting on it is the
           opponent. */
        setTimeout(function () {
            if (mine !== turnTok) return;     /* abandoned before we even ran */
            var r = null, blew = null;
            try { r = C4.bestMove(st, diff()); }
            catch (err) { blew = err; }

            /* Scheduled unconditionally, so `thinking` is cleared and the board
               unlocks even if the search threw. */
            var rest = reduce ? 0 : Math.max(0, THINK_FLOOR - (performance.now() - t0));
            setTimeout(function () {
                if (mine !== turnTok) return; /* newGame already reset `thinking` */
                thinking = false;
                if (blew) {
                    readout('search failed — play on');
                    if (window.CAS) CAS.toast('OPPONENT ERROR', true);
                    syncCols(); status();
                    throw blew;
                }
                lastAI = r;
                readout(analysisText(r));
                if (r && r.col >= 0) play(r.col, true);
                else { syncCols(); status(); }
            }, rest);
        }, reduce ? 0 : (settle || 0) + THINK_PAUSE);
    }

    function undoOne() {
        if (thinking || !st.moves.length) return;
        C4.undo(st);
    }

    function undoMove() {
        /* Checked here, not just on the button. The U shortcut calls straight
           in and never consults `disabled`. */
        if (thinking || !st.moves.length || !undoAllowed()) return;
        /* Against the computer, undo the pair — undoing only its reply would
           just hand it the same position and it would move again immediately. */
        var takeTwo = vsCPU() && !over && st.turn === 1 && st.moves.length >= 2;
        turnTok++;
        undoOne();
        if (takeTwo) undoOne();
        over = false; winLine = null;
        boardEl.classList.remove('over');
        paint();
        status();
        readout(lastAI && st.count ? $('analysis').textContent : '');
        if (vsCPU() && st.turn === cpuPlayer() && !over) scheduleCPU();
    }

    function bumpScore() {
        $('s1').textContent = score.p1;
        $('s2').textContent = score.p2;
        $('sd').textContent = score.draw;
    }

    function newGame() {
        gameNo++;
        turnTok++;      /* strand any reply still in flight */
        var first = 1;
        if (vsCPU()) {
            var o = opens();
            if (o === 'cpu') first = cpuPlayer();
            else if (o === 'alt') first = (gameNo % 2 === 1) ? 1 : cpuPlayer();
        }
        st = C4.newState(first);
        over = false; winLine = null; thinking = false; lastAI = null;
        boardEl.classList.remove('over');
        paint();
        status();
        readout('');
        if (vsCPU() && st.turn === cpuPlayer()) scheduleCPU();
    }

    /* ── Input ───────────────────────────────────────────────────────────── */

    function colFromEvent(e) {
        var t = e.target.closest ? e.target.closest('.col') : null;
        return t ? parseInt(t.dataset.col, 10) : -1;
    }

    boardEl.addEventListener('click', function (e) {
        var c = colFromEvent(e);
        if (c >= 0) play(c, false);
    });

    function showGhost(c) {
        if (over || thinking || c < 0 || !C4.canPlay(st, c)) { ghostEl.classList.remove('on'); return; }
        ghostEl.style.left = (c * (100 / COLS)) + '%';
        ghostEl.querySelector('i').style.background =
            getComputedStyle(document.documentElement).getPropertyValue(st.turn === 1 ? '--p1' : '--p2');
        ghostEl.classList.add('on');
    }

    boardEl.addEventListener('pointermove', function (e) { showGhost(colFromEvent(e)); });
    boardEl.addEventListener('pointerleave', function () { ghostEl.classList.remove('on'); });

    document.addEventListener('keydown', function (e) {
        if (e.target.tagName === 'INPUT' && e.target.type !== 'radio') return;
        var n = '1234567'.indexOf(e.key);
        if (n >= 0) { e.preventDefault(); play(n, false); showGhost(n); return; }
        if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoMove(); return; }
        if (e.key === 'n' || e.key === 'N') { e.preventDefault(); newGame(); }
    });

    $('newBtn').addEventListener('click', newGame);
    $('undoBtn').addEventListener('click', undoMove);
    $('resetScore').addEventListener('click', function () {
        score = { p1: 0, p2: 0, draw: 0 };
        bumpScore();
        gameNo = 0;
        if (window.CAS) CAS.toast('SESSION CLEARED');
    });

    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
        r.addEventListener('change', function () {
            $('diffFld').hidden = !vsCPU();
            newGame();
        });
    });
    document.querySelectorAll('input[name="diff"]').forEach(function (r) {
        r.addEventListener('change', function () {
            $('diffNote').textContent = DIFF_NOTE[diff()];
            /* Switching to or from BRUTAL changes whether undo is available,
               and the level can be changed mid-game. */
            status();
        });
    });
    document.querySelectorAll('input[name="first"]').forEach(function (r) {
        r.addEventListener('change', newGame);
    });

    /* ── Boot ────────────────────────────────────────────────────────────── */
    build();
    $('diffNote').textContent = DIFF_NOTE[diff()];
    $('diffFld').hidden = !vsCPU();
    newGame();
    bumpScore();
})();
