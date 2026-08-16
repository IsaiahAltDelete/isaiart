/* ============================================================================
   TAPE TRANSFER — 1980s broadcast / VHS look
   ---------------------------------------------------------------------------
   Four GPU passes, in the order the artefacts actually happen in a signal
   chain, because doing them out of order is what makes most "VHS filters" read
   as a photo with stuff sprinkled on it:

     1 SIGNAL     luma and chroma are filtered SEPARATELY. This is the whole
                  trick. Composite video carried colour at a fraction of the
                  luminance bandwidth, so edges stay legible while colour runs
                  sideways off the object it belongs to. Blurring RGB together
                  — what a plain blur does — cannot produce that, and no amount
                  of grain on top will fake it.
     2/3 GLOW     bright-pass, then separable blur at half resolution. Studio
                  key lights are why every one of these clips halates.
     4 COMPOSITE  levels, tint, noise, frame. Grain goes on LAST, after the
                  blur, or it gets smeared into the picture and stops reading
                  as grain.

   Everything renders at the image's native size into an offscreen GL canvas,
   which the visible canvas then blits with a pan/zoom transform. That keeps
   export trivially correct — the thing you save is the thing that was
   rendered, not a re-run at a different scale.
   ========================================================================= */
(function () {
    'use strict';

    var S = window.SRCH;
    var el = function (id) { return document.getElementById(id); };

    /* ── Header furniture ────────────────────────────────────────────────── */
    if (window.CAS) CAS.bootOnce(el('headScreen'));
    S.clock(el('clock'));
    var trace = S.scope(el('scope'));
    S.phosphorSwitch(el('phosSw'), function () { if (trace) trace.repaint(); });
    if (window.CAS) CAS.pageTransition();

    /* ── GL boot ─────────────────────────────────────────────────────────── */

    var glCanvas = document.createElement('canvas');
    var gl = glCanvas.getContext('webgl', { preserveDrawingBuffer: true, premultipliedAlpha: false })
          || glCanvas.getContext('experimental-webgl', { preserveDrawingBuffer: true });

    if (!gl) {
        el('nogl').hidden = false;
        el('pickBtn').disabled = true;
        return;
    }

    var MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    var VERT =
        'attribute vec2 aPos;varying vec2 vUV;' +
        'void main(){vUV=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}';

    var YIQ =
        'vec3 rgb2yiq(vec3 c){return vec3(dot(c,vec3(0.299,0.587,0.114)),' +
        'dot(c,vec3(0.5959,-0.2746,-0.3213)),dot(c,vec3(0.2115,-0.5227,0.3112)));}' +
        'vec3 yiq2rgb(vec3 v){return vec3(v.x+0.956*v.y+0.619*v.z,' +
        'v.x-0.272*v.y-0.647*v.z,v.x-1.106*v.y+1.703*v.z);}';

    var HASH =
        'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}';

    /* ── Pass 1: the signal path ─────────────────────────────────────────────
       Tap SPACING scales with the requested radius rather than the tap count,
       so a 30px chroma smear costs exactly the same as a 3px one and the loop
       bounds stay constant (GLSL ES 1.00 requires that anyway). */
    var FRAG_SIGNAL =
        'precision highp float;varying vec2 vUV;' +
        'uniform sampler2D uTex;uniform vec2 uTexel;' +
        'uniform float uSoft,uChroma,uCLag,uRing;' + YIQ +
        'void main(){' +
        '  float lumaR=uSoft*5.0;' +
        '  float chromaR=uChroma*34.0;' +
        '  float lag=uCLag*10.0;' +
        /* luma: narrow, symmetric */
        '  float ls=lumaR/4.0; float sgl=max(lumaR*0.55,0.0001);' +
        '  float ySum=0.0,yW=0.0;' +
        '  for(int k=-4;k<=4;k++){float d=float(k)*ls;' +
        '    float w=exp(-(d*d)/(2.0*sgl*sgl));' +
        '    ySum+=rgb2yiq(texture2D(uTex,vUV+vec2(d*uTexel.x,0.0)).rgb).x*w;yW+=w;}' +
        '  float y=ySum/max(yW,0.0001);' +
        /* chroma: wide, and lagging to the right of what it belongs to */
        '  float cs=chromaR/10.0; float sgc=max(chromaR*0.55,0.0001);' +
        '  vec2 cSum=vec2(0.0);float cW=0.0;' +
        '  for(int k=-10;k<=10;k++){float d=float(k)*cs;' +
        '    float w=exp(-(d*d)/(2.0*sgc*sgc));' +
        '    cSum+=rgb2yiq(texture2D(uTex,vUV+vec2((d-lag)*uTexel.x,0.0)).rgb).yz*w;cW+=w;}' +
        '  vec2 iq=cSum/max(cW,0.0001);' +
        /* ringing: compare against luma a few pixels LEFT, so the overshoot
           lands after the edge — a bright lip trailing every dark boundary,
           which is what analogue sharpening actually did. */
        '  float echo=rgb2yiq(texture2D(uTex,vUV-vec2(2.5*uTexel.x,0.0)).rgb).x;' +
        '  y+=uRing*1.1*(y-echo);' +
        '  gl_FragColor=vec4(clamp(yiq2rgb(vec3(y,iq)),0.0,1.0),1.0);}';

    /* ── Pass 2/3: bright pass then separable blur ───────────────────────── */
    var FRAG_BLUR =
        'precision highp float;varying vec2 vUV;' +
        'uniform sampler2D uTex;uniform vec2 uTexel;uniform vec2 uDir;' +
        'uniform float uThresh,uRadius,uBright;' +
        'void main(){vec3 acc=vec3(0.0);float wsum=0.0;' +
        '  float st=max(uRadius,0.5)/8.0;' +
        '  for(int k=-8;k<=8;k++){float f=float(k);' +
        '    vec3 c=texture2D(uTex,vUV+uDir*(f*st)*uTexel).rgb;' +
        '    if(uBright>0.5){float l=dot(c,vec3(0.299,0.587,0.114));' +
        '      c*=smoothstep(uThresh,uThresh+0.28,l);}' +
        '    float w=exp(-(f*f)/22.0);acc+=c*w;wsum+=w;}' +
        '  gl_FragColor=vec4(acc/wsum,1.0);}';

    /* ── Pass 4: composite ───────────────────────────────────────────────── */
    var FRAG_COMP =
        'precision highp float;varying vec2 vUV;' +
        'uniform sampler2D uTex,uGlow;uniform vec2 uRes;' +
        'uniform float uBloom,uLift,uContrast,uSat,uWarm,uShadowTint;' +
        'uniform float uGrain,uCNoise,uStreak,uVig,uEdge,uScan,uHead,uSeed;' +
        YIQ + HASH +
        'void main(){' +
        '  vec2 uv=vUV;' +
        /* Head switching: the torn strip at the very bottom where the tape
           head changes over. vUV.y is 0 at the bottom of the picture. */
        '  float band=0.018+0.03*uHead;' +
        '  if(uHead>0.001&&uv.y<band){' +
        '    float t=1.0-uv.y/band;' +
        '    float j=hash(vec2(floor(uv.y*uRes.y),uSeed))-0.5;' +
        '    uv.x+=uHead*(0.055*t*t+0.02*j*t);}' +
        '  vec3 col=texture2D(uTex,clamp(uv,0.001,0.999)).rgb;' +
        /* halation, warm — phosphor and film both bloom to the red end */
        '  vec3 glow=texture2D(uGlow,clamp(uv,0.001,0.999)).rgb;' +
        '  col+=glow*uBloom*vec3(1.12,0.98,0.88);' +
        /* contrast about mid grey, then saturation in YIQ */
        '  col=clamp((col-0.5)*(1.0+uContrast)+0.5,0.0,2.0);' +
        '  vec3 y=rgb2yiq(col);y.yz*=(1.0+uSat);col=yiq2rgb(y);' +
        /* black lift: the milky floor tape never got below. Applied as a
           compression of the range rather than a straight add, so highlights
           are not pushed out of the top of the picture. */
        '  col=col*(1.0-uLift*0.55)+uLift*0.16;' +
        /* shadow tint — cool one way, magenta the other */
        '  float sh=1.0-smoothstep(0.0,0.55,dot(col,vec3(0.299,0.587,0.114)));' +
        '  col+=sh*uShadowTint*vec3(0.05,-0.02,0.045);' +
        /* warmth */
        '  col*=vec3(1.0+uWarm*0.09,1.0+uWarm*0.012,1.0-uWarm*0.075);' +
        /* chroma noise: coarse and blotchy, nothing like film grain */
        '  vec2 cq=floor(vec2(vUV.x*uRes.x/6.0,vUV.y*uRes.y/4.0));' +
        '  vec2 cn=vec2(hash(cq+uSeed),hash(cq.yx+uSeed*1.7))-0.5;' +
        '  vec3 yq=rgb2yiq(col);yq.yz+=cn*uCNoise*0.34;col=yiq2rgb(yq);' +
        /* horizontal dropout banding — tracking, not scanlines */
        '  float b=hash(vec2(floor(vUV.y*uRes.y*0.5)+uSeed*3.0,7.0));' +
        '  col*=1.0+(b-0.5)*uStreak*0.34*step(0.72,b);' +
        /* luma grain last, so the blur never smears it */
        '  float g=hash(vUV*uRes+uSeed*13.0)-0.5;' +
        '  col+=g*uGrain*0.22;' +
        /* frame */
        '  float r=length((vUV-0.5)*vec2(1.06,1.0))*1.414;' +
        '  col*=1.0-uVig*smoothstep(0.45,1.15,r);' +
        '  float e=min(min(vUV.x,1.0-vUV.x),min(vUV.y,1.0-vUV.y));' +
        '  col*=1.0-uEdge*(1.0-smoothstep(0.0,0.022,e));' +
        '  col*=1.0-uScan*0.42*(0.5+0.5*cos(vUV.y*uRes.y*3.14159));' +
        '  gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}';

    function compile(src, type) {
        var s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
        }
        return s;
    }

    function program(frag) {
        var p = gl.createProgram();
        gl.attachShader(p, compile(VERT, gl.VERTEX_SHADER));
        gl.attachShader(p, compile(frag, gl.FRAGMENT_SHADER));
        gl.bindAttribLocation(p, 0, 'aPos');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(p));
        }
        var loc = {};
        var n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) {
            var nm = gl.getActiveUniform(p, i).name;
            loc[nm] = gl.getUniformLocation(p, nm);
        }
        return { p: p, u: loc };
    }

    var progSignal, progBlur, progComp;
    try {
        progSignal = program(FRAG_SIGNAL);
        progBlur = program(FRAG_BLUR);
        progComp = program(FRAG_COMP);
    } catch (e) {
        el('nogl').hidden = false;
        el('nogl').querySelector('p').textContent = 'Shader compile failed: ' + e.message;
        return;
    }

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    function makeTarget(w, h) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        return { tex: t, fbo: f, w: w, h: h };
    }

    var srcTex = null, targets = null, imgW = 0, imgH = 0;

    function allocate(w, h) {
        if (targets) {
            targets.forEach(function (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); });
        }
        var hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
        targets = [makeTarget(w, h), makeTarget(hw, hh), makeTarget(hw, hh)];
    }

    /* ── State ───────────────────────────────────────────────────────────── */

    var st = {
        name: '', srcCanvas: null, ready: false, seed: 17,
        compare: false,
        view: { scale: 1, x: 0, y: 0, fit: true }
    };

    var view = el('view'), vctx = view.getContext('2d'), wrap = el('wrap');

    /* ── Presets ─────────────────────────────────────────────────────────────
       Values read off the reference material rather than invented: the era's
       looks differ mostly in how far the chroma runs and how high the black
       floor sits. */
    var PRESETS = {
        'WORKOUT TAPE': { uSoft: 40, uChroma: 58, uCLag: 26, uRing: 48, uLift: 44, uContrast: -22,
                          uSat: 10, uWarm: 14, uShadowTint: 14, uBloom: 52, uBloomT: 52, uBloomR: 52,
                          uGrain: 18, uCNoise: 20, uStreak: 20, uVig: 16, uEdge: 12, uScan: 0, uHead: 30 },
        'DATING SHOW':  { uSoft: 34, uChroma: 66, uCLag: 34, uRing: 38, uLift: 26, uContrast: -8,
                          uSat: 30, uWarm: 32, uShadowTint: 24, uBloom: 66, uBloomT: 46, uBloomR: 58,
                          uGrain: 26, uCNoise: 32, uStreak: 12, uVig: 30, uEdge: 22, uScan: 0, uHead: 18 },
        'WEATHER DESK': { uSoft: 30, uChroma: 54, uCLag: 22, uRing: 52, uLift: 22, uContrast: -4,
                          uSat: 16, uWarm: 8,  uShadowTint: -10, uBloom: 34, uBloomT: 60, uBloomR: 42,
                          uGrain: 22, uCNoise: 26, uStreak: 16, uVig: 18, uEdge: 16, uScan: 0, uHead: 24 },
        'MTV BACKSTAGE':{ uSoft: 28, uChroma: 48, uCLag: 20, uRing: 44, uLift: 18, uContrast: 8,
                          uSat: 6,  uWarm: 10, uShadowTint: -18, uBloom: 30, uBloomT: 64, uBloomR: 40,
                          uGrain: 38, uCNoise: 34, uStreak: 22, uVig: 34, uEdge: 24, uScan: 0, uHead: 22 },
        'SITCOM':       { uSoft: 22, uChroma: 40, uCLag: 16, uRing: 34, uLift: 20, uContrast: -2,
                          uSat: 20, uWarm: 16, uShadowTint: 10, uBloom: 38, uBloomT: 58, uBloomR: 44,
                          uGrain: 14, uCNoise: 16, uStreak: 8,  uVig: 14, uEdge: 10, uScan: 0, uHead: 12 },
        'NTH GEN DUB':  { uSoft: 62, uChroma: 88, uCLag: 52, uRing: 66, uLift: 52, uContrast: -30,
                          uSat: -14, uWarm: 24, uShadowTint: 30, uBloom: 58, uBloomT: 42, uBloomR: 66,
                          uGrain: 48, uCNoise: 58, uStreak: 46, uVig: 36, uEdge: 30, uScan: 0, uHead: 52 }
    };
    var DEFAULT_PRESET = 'WORKOUT TAPE';
    var activePreset = DEFAULT_PRESET;

    var sliders = Array.prototype.slice.call(document.querySelectorAll('input[data-u]'));

    function params() {
        var o = {};
        sliders.forEach(function (s) { o[s.id] = parseFloat(s.value); });
        return o;
    }

    function fmt(s) {
        var v = parseFloat(s.value);
        return s.dataset.fmt === 'signed'
            ? (v > 0 ? '+' : '') + v
            : v + '%';
    }

    function syncLabels() {
        sliders.forEach(function (s) {
            var row = s.closest('.sl');
            row.querySelector('.val').textContent = fmt(s);
            var base = PRESETS[activePreset] && PRESETS[activePreset][s.id];
            row.classList.toggle('moved', base !== undefined && parseFloat(s.value) !== base);
        });
    }

    function applyPreset(name) {
        var p = PRESETS[name];
        if (!p) return;
        activePreset = name;
        sliders.forEach(function (s) {
            if (p[s.id] !== undefined) s.value = p[s.id];
        });
        Array.prototype.forEach.call(el('presets').children, function (b) {
            b.classList.toggle('latched', b.textContent === name);
        });
        syncLabels();
        render();
    }

    Object.keys(PRESETS).forEach(function (name) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'key';
        b.textContent = name;
        b.addEventListener('click', function () { applyPreset(name); });
        el('presets').appendChild(b);
    });

    /* ── Render ──────────────────────────────────────────────────────────── */

    function drawQuad() { gl.drawArrays(gl.TRIANGLES, 0, 3); }

    function bindTarget(t) {
        if (t) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
            gl.viewport(0, 0, t.w, t.h);
        } else {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, glCanvas.width, glCanvas.height);
        }
    }

    function useTex(unit, tex, loc) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc, unit);
    }

    function render() {
        if (!st.ready) return;
        var t0 = performance.now();
        var p = params();
        var A = targets[0], B = targets[1], C = targets[2];

        /* 1 — signal */
        gl.useProgram(progSignal.p);
        bindTarget(A);
        useTex(0, srcTex, progSignal.u.uTex);
        gl.uniform2f(progSignal.u.uTexel, 1 / imgW, 1 / imgH);
        gl.uniform1f(progSignal.u.uSoft, p.uSoft / 100);
        gl.uniform1f(progSignal.u.uChroma, p.uChroma / 100);
        gl.uniform1f(progSignal.u.uCLag, p.uCLag / 100);
        gl.uniform1f(progSignal.u.uRing, p.uRing / 100);
        drawQuad();

        /* 2 — bright pass + horizontal blur, half res */
        gl.useProgram(progBlur.p);
        bindTarget(B);
        useTex(0, A.tex, progBlur.u.uTex);
        gl.uniform2f(progBlur.u.uTexel, 1 / B.w, 1 / B.h);
        gl.uniform2f(progBlur.u.uDir, 1, 0);
        gl.uniform1f(progBlur.u.uThresh, p.uBloomT / 100);
        gl.uniform1f(progBlur.u.uRadius, 1 + p.uBloomR * 0.22);
        gl.uniform1f(progBlur.u.uBright, 1);
        drawQuad();

        /* 3 — vertical blur */
        bindTarget(C);
        useTex(0, B.tex, progBlur.u.uTex);
        gl.uniform2f(progBlur.u.uDir, 0, 1);
        gl.uniform1f(progBlur.u.uBright, 0);
        drawQuad();

        /* 4 — composite to the canvas */
        gl.useProgram(progComp.p);
        bindTarget(null);
        useTex(0, A.tex, progComp.u.uTex);
        useTex(1, C.tex, progComp.u.uGlow);
        gl.uniform2f(progComp.u.uRes, imgW, imgH);
        gl.uniform1f(progComp.u.uBloom, p.uBloom / 100);
        gl.uniform1f(progComp.u.uLift, p.uLift / 100);
        gl.uniform1f(progComp.u.uContrast, p.uContrast / 100);
        gl.uniform1f(progComp.u.uSat, p.uSat / 100);
        gl.uniform1f(progComp.u.uWarm, p.uWarm / 100);
        gl.uniform1f(progComp.u.uShadowTint, p.uShadowTint / 100);
        gl.uniform1f(progComp.u.uGrain, p.uGrain / 100);
        gl.uniform1f(progComp.u.uCNoise, p.uCNoise / 100);
        gl.uniform1f(progComp.u.uStreak, p.uStreak / 100);
        gl.uniform1f(progComp.u.uVig, p.uVig / 100);
        gl.uniform1f(progComp.u.uEdge, p.uEdge / 100);
        gl.uniform1f(progComp.u.uScan, p.uScan / 100);
        gl.uniform1f(progComp.u.uHead, p.uHead / 100);
        gl.uniform1f(progComp.u.uSeed, st.seed);
        drawQuad();

        el('fMs').textContent = Math.round(performance.now() - t0) + 'ms';
        draw();
    }

    /* ── Load ────────────────────────────────────────────────────────────── */

    function loadFile(file) {
        if (!file || !/^image\//.test(file.type)) {
            if (window.CAS) CAS.toast('NOT AN IMAGE', true);
            return;
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
            URL.revokeObjectURL(url);
            var w = img.naturalWidth, h = img.naturalHeight;
            /* A source past the GPU's texture limit cannot be uploaded at all,
               so it is fitted down rather than failing — and said out loud,
               because the export will be that size too. */
            var scale = Math.min(1, MAX_TEX / Math.max(w, h));
            if (scale < 1) {
                w = Math.floor(w * scale); h = Math.floor(h * scale);
                if (window.CAS) CAS.toast('FITTED TO ' + w + '×' + h + ' (GPU LIMIT)', true);
            }
            var c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);

            st.name = file.name || 'pasted';
            st.srcCanvas = c;
            imgW = w; imgH = h;
            glCanvas.width = w; glCanvas.height = h;

            if (srcTex) gl.deleteTexture(srcTex);
            srcTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            /* Flip on upload: WebGL's texture origin is bottom-left but the
               canvas presents top-down, and without this the export is mirrored
               vertically while the preview looks fine. */
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            allocate(w, h);
            st.ready = true;
            st.view.fit = true;
            wrap.classList.add('has-img');
            el('hint').style.display = 'none';
            el('fSize').textContent = w + ' × ' + h;
            el('dockStat').textContent = w + '×' + h;
            el('saveBtn').disabled = false;
            el('vLed').className = 'led on green';
            el('vStat').textContent = 'READY';
            render();
        };
        img.onerror = function () {
            URL.revokeObjectURL(url);
            if (window.CAS) CAS.toast('COULD NOT DECODE THAT FILE', true);
        };
        img.src = url;
    }

    /* ── Viewport ────────────────────────────────────────────────────────── */

    var LADDER = [1 / 16, 1 / 12, 1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3,
                  1, 1.5, 2, 3, 4, 6, 8, 12, 16];

    function activeCanvas() { return st.compare ? st.srcCanvas : glCanvas; }
    function boxSize() { return { w: wrap.clientWidth, h: wrap.clientHeight }; }

    function fitScale(cv) {
        var b = boxSize();
        if (!cv || !b.w || !b.h) return 1;
        return Math.min((b.w - 24) / cv.width, (b.h - 24) / cv.height);
    }
    function currentScale() {
        return st.view.fit ? fitScale(activeCanvas()) : st.view.scale;
    }
    function centre() {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize(), s = currentScale();
        st.view.x = (b.w - cv.width * s) / 2;
        st.view.y = (b.h - cv.height * s) / 2;
    }
    function doFit() { st.view.fit = true; st.view.scale = fitScale(activeCanvas()); centre(); draw(); }
    function nearestRung(s) {
        var bi = 0, bd = Infinity;
        for (var i = 0; i < LADDER.length; i++) {
            var d = Math.abs(Math.log(LADDER[i] / s));
            if (d < bd) { bd = d; bi = i; }
        }
        return bi;
    }
    function clampPan() {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize(), s = currentScale();
        var w = cv.width * s, h = cv.height * s;
        var mx = Math.min(w, b.w) * 0.25, my = Math.min(h, b.h) * 0.25;
        st.view.x = Math.min(b.w - mx, Math.max(mx - w, st.view.x));
        st.view.y = Math.min(b.h - my, Math.max(my - h, st.view.y));
    }
    function zoomTo(rung, cx, cy) {
        var cv = activeCanvas(); if (!cv) return;
        var b = boxSize();
        if (cx === undefined) { cx = b.w / 2; cy = b.h / 2; }
        var os = currentScale();
        var ns = LADDER[Math.max(0, Math.min(LADDER.length - 1, rung))];
        var ax = (cx - st.view.x) / os, ay = (cy - st.view.y) / os;
        st.view.fit = false; st.view.scale = ns;
        st.view.x = cx - ax * ns; st.view.y = cy - ay * ns;
        clampPan(); draw();
    }
    function stepZoom(d, cx, cy) { zoomTo(nearestRung(currentScale()) + d, cx, cy); }

    function draw() {
        var b = boxSize();
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (view.width !== Math.round(b.w * dpr)) {
            view.width = Math.round(b.w * dpr); view.height = Math.round(b.h * dpr);
            view.style.width = b.w + 'px'; view.style.height = b.h + 'px';
        }
        vctx.setTransform(1, 0, 0, 1, 0, 0);
        vctx.clearRect(0, 0, view.width, view.height);
        var cv = activeCanvas();
        if (!cv || !st.ready) { el('zoomVal').textContent = 'FIT'; return; }
        if (st.view.fit) { st.view.scale = fitScale(cv); centre(); }
        var s = st.view.scale;
        vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vctx.imageSmoothingEnabled = s < 3;
        vctx.drawImage(cv, st.view.x, st.view.y, cv.width * s, cv.height * s);
        el('zoomVal').textContent = (st.view.fit ? 'FIT ' : '') + Math.round(s * 100) + '%';
    }

    /* ── Wiring ──────────────────────────────────────────────────────────── */

    sliders.forEach(function (s) {
        s.addEventListener('input', function () { syncLabels(); render(); });
    });

    el('reroll').addEventListener('click', function () {
        st.seed = 1 + Math.floor(Math.random() * 997);
        render();
    });

    el('pickBtn').addEventListener('click', function () { el('file').click(); });
    el('file').addEventListener('change', function () {
        if (this.files && this.files[0]) loadFile(this.files[0]);
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
        wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
        wrap.addEventListener(ev, function (e) { e.preventDefault(); wrap.classList.remove('drag'); });
    });
    wrap.addEventListener('drop', function (e) {
        if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    document.addEventListener('paste', function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') === 0) { loadFile(items[i].getAsFile()); break; }
        }
    });

    /* Hold, not toggle: an A/B you have to keep holding is much easier to judge
       than one you have to remember the state of. */
    var cmp = el('cmpBtn');
    function cmpOn() { if (!st.ready) return; st.compare = true; draw(); }
    function cmpOff() { if (!st.compare) return; st.compare = false; draw(); }
    cmp.addEventListener('pointerdown', cmpOn);
    cmp.addEventListener('pointerup', cmpOff);
    cmp.addEventListener('pointerleave', cmpOff);
    cmp.addEventListener('pointercancel', cmpOff);

    el('zoomIn').addEventListener('click', function () { stepZoom(1); });
    el('zoomOut').addEventListener('click', function () { stepZoom(-1); });
    el('fitBtn').addEventListener('click', doFit);
    el('oneBtn').addEventListener('click', function () { if (st.ready) zoomTo(LADDER.indexOf(1)); });

    wrap.addEventListener('wheel', function (e) {
        if (!st.ready) return;
        e.preventDefault();
        var r = wrap.getBoundingClientRect();
        stepZoom(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
        if (!st.ready || e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        wrap.setPointerCapture(e.pointerId);
        wrap.classList.add('panning');
    });
    wrap.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        st.view.x += e.clientX - drag.x;
        st.view.y += e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (st.view.fit) { st.view.fit = false; st.view.scale = currentScale(); }
        clampPan(); draw();
    });
    function endDrag(e) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        try { wrap.releasePointerCapture(drag.id); } catch (err) {}
        drag = null; wrap.classList.remove('panning');
    }
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('dblclick', function (e) { e.preventDefault(); doFit(); });

    var reT;
    window.addEventListener('resize', function () {
        clearTimeout(reT);
        reT = setTimeout(function () { if (st.ready) { clampPan(); draw(); } }, 150);
    });

    /* ── Export ──────────────────────────────────────────────────────────── */

    el('saveBtn').addEventListener('click', function () {
        if (!st.ready) return;
        glCanvas.toBlob(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (st.name.replace(/\.[^.]+$/, '') || 'tape') + '_tape.png';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
            if (window.CAS) CAS.toast('SAVED ' + imgW + '×' + imgH);
        }, 'image/png');
    });

    el('copyBtn').addEventListener('click', function () {
        if (!st.ready) { if (window.CAS) CAS.toast('NOTHING TO COPY', true); return; }
        if (!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) {
            if (window.CAS) CAS.toast('CLIPBOARD IMAGES UNSUPPORTED HERE', true); return;
        }
        glCanvas.toBlob(function (blob) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .then(function () { CAS.toast('COPIED'); },
                      function () { CAS.toast('COPY BLOCKED', true); });
        }, 'image/png');
    });

    el('resetBtn').addEventListener('click', function () {
        applyPreset(DEFAULT_PRESET);
        if (window.CAS) CAS.toast('RESET TO ' + DEFAULT_PRESET);
    });

    /* ── Boot ────────────────────────────────────────────────────────────── */
    applyPreset(DEFAULT_PRESET);
    syncLabels();
    draw();
})();
