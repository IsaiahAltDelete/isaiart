/* ===========================================================================
   Paint.

   One document per window. The picture lives in a <canvas> at its real pixel
   size and is scaled with CSS for zoom; a second canvas on top carries live
   previews (shapes, brush strokes, floating selections). Undo keeps up to 30
   full-canvas snapshots as offscreen canvases.
   =========================================================================== */

(function (Win) {
  'use strict';

  const g = (name, size = 16) => Win.glyph(name, size);
  const esc = Win.esc;
  const HISTORY = 30;
  const ZOOMS = [0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.5, 2, 3, 4, 6, 8];
  const PALETTE = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4',
    '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
  const SHAPES = {
    line: { label: 'Line', svg: '<path d="M4 16 16 4"/>' },
    rect: { label: 'Rectangle', svg: '<rect x="3.5" y="5" width="13" height="10"/>' },
    rrect: { label: 'Rounded rectangle', svg: '<rect x="3.5" y="5" width="13" height="10" rx="3"/>' },
    ellipse: { label: 'Oval', svg: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>' },
    triangle: { label: 'Triangle', svg: '<path d="M10 4 16.5 16h-13z"/>' },
    diamond: { label: 'Diamond', svg: '<path d="M10 3.5 16.5 10 10 16.5 3.5 10z"/>' },
  };
  const BRUSHES = { brush: 'Brush', marker: 'Marker', airbrush: 'Airbrush' };
  const TOOL_LABELS = { pencil: 'Pencil', fill: 'Fill', text: 'Text', eraser: 'Eraser', picker: 'Color picker', zoom: 'Magnifier', select: 'Rectangle selection' };

  Win.DefaultState.paint = { custom: [], size: 3, grid: false, statusBar: true };
  const P = () => (Win.state.paint ||= Win.clone(Win.DefaultState.paint));

  const svgIcon = (inner, size = 20) => `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const selectIcon = size => svgIcon('<rect x="3" y="4" width="14" height="12" rx="1" stroke-dasharray="2.2 2"/>', size);
  const pickerIcon = size => svgIcon('<path d="M13.5 3.5a2 2 0 0 1 3 3l-2 2-3-3zM11.5 5.5l3 3-7.5 7.5H4v-3z"/>', size);
  const cropIcon = size => svgIcon('<path d="M6 2.5V14h11.5M2.5 6H14v11.5"/>', size);
  const resizeIcon = size => svgIcon('<rect x="2.5" y="8" width="9.5" height="9.5" rx="1"/><path d="M10 2.5h7.5V10M17.5 2.5 12 8"/>', size);
  const pencilIcon = size => svgIcon('<path d="M13.5 3.5l3 3-9.5 9.5-3.8.8.8-3.8z"/><path d="M11.8 5.2l3 3"/>', size);

  const hexToRGBA = hex => {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
  };
  const rgbToHex = (r, gg, b) => `#${[r, gg, b].map(n => n.toString(16).padStart(2, '0')).join('')}`;

  function copyCanvas(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  /** Scanline flood fill; `tolerance` softens antialiased edges. */
  function floodFill(ctx, x, y, rgba, tolerance = 32) {
    const { width: W, height: H } = ctx.canvas;
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const start = (y * W + x) * 4;
    const t = [d[start], d[start + 1], d[start + 2], d[start + 3]];
    if (t[0] === rgba[0] && t[1] === rgba[1] && t[2] === rgba[2] && t[3] === rgba[3]) return false;
    const seen = new Uint8Array(W * H);
    const match = p => !seen[p] && Math.abs(d[p * 4] - t[0]) + Math.abs(d[p * 4 + 1] - t[1]) + Math.abs(d[p * 4 + 2] - t[2]) + Math.abs(d[p * 4 + 3] - t[3]) <= tolerance;
    const paint = p => { seen[p] = 1; d[p * 4] = rgba[0]; d[p * 4 + 1] = rgba[1]; d[p * 4 + 2] = rgba[2]; d[p * 4 + 3] = rgba[3]; };
    const stack = [x, y];
    while (stack.length) {
      const py = stack.pop();
      const px = stack.pop();
      const row = py * W;
      if (!match(row + px)) continue;
      let lx = px;
      while (lx > 0 && match(row + lx - 1)) lx -= 1;
      let rx = px;
      while (rx < W - 1 && match(row + rx + 1)) rx += 1;
      for (let i = lx; i <= rx; i += 1) paint(row + i);
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= H) continue;
        const nrow = ny * W;
        let inside = false;
        for (let i = lx; i <= rx; i += 1) {
          const ok = match(nrow + i);
          if (ok && !inside) { stack.push(i, ny); inside = true; } else if (!ok) inside = false;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return true;
  }

  /* ================================================================ window */

  Win.apps.register({
    id: 'paint',
    name: 'Paint',
    icon: 'paint',
    customTitle: true,
    width: 1100,
    height: 720,
    minWidth: 560,
    minHeight: 380,
    category: 'Accessories',
    keywords: ['draw', 'image', 'picture', 'paint', 'mspaint'],
    create: createPaint,
    async beforeClose(win) {
      const pt = win.state.pt;
      if (!pt || !pt.dirty) return true;
      return (await askSave(pt)) !== 'cancel';
    },
  });

  function createPaint(win, args = {}) {
    const pt = {
      win, W: 1000, H: 640, zoom: 1, tool: 'brush', lastTool: 'brush', brush: 'brush', shape: 'rect', outline: 'solid', fillMode: 'none',
      fg: '#000000', bg: '#ffffff', slot: 'fg', size: P().size || 3, history: [], index: -1, dirty: false, fileId: null, name: 'Untitled',
      sel: null, float: null, text: null, font: { family: 'Segoe UI', size: 24, bold: false, italic: false },
    };
    win.state.pt = pt;
    win.el.classList.add('pt-window');
    win.titleContent.innerHTML = `<span class="pt-appico">${Win.appIcon('paint', 16)}</span>
      <button class="pt-tm" data-act="file" aria-haspopup="menu">File</button>
      <button class="pt-tm" data-act="viewmenu" aria-haspopup="menu">View</button>
      <span class="pt-tsep"></span>
      <button class="icon-btn pt-ti" data-act="save" aria-label="Save" title="Save (Ctrl+S)">${g('download')}</button>
      <button class="icon-btn pt-ti" data-act="undo" aria-label="Undo" title="Undo (Ctrl+Z)">${g('undo')}</button>
      <button class="icon-btn pt-ti" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Y)">${g('redo')}</button>
      <span class="pt-title"></span>`;
    win.body.innerHTML = `<div class="pt">
      <div class="pt-ribbon" role="toolbar" aria-label="Paint tools"></div>
      <div class="pt-work" tabindex="0" aria-label="Canvas" autofocus>
        <div class="pt-pad">
          <div class="pt-stage">
            <canvas class="pt-canvas"></canvas>
            <canvas class="pt-overlay"></canvas>
            <div class="pt-grid hidden" aria-hidden="true"></div>
            <div class="pt-sel hidden" aria-hidden="true"></div>
            <span class="pt-h e" data-h="e" aria-hidden="true"></span><span class="pt-h s" data-h="s" aria-hidden="true"></span><span class="pt-h se" data-h="se" aria-hidden="true"></span>
            <div class="pt-ghost hidden" aria-hidden="true"></div>
          </div>
        </div>
      </div>
      <div class="pt-status" role="status">
        <span class="pt-st">${svgIcon('<path d="M10 3v14M3 10h14"/>', 14)}<span class="pt-pos"></span></span>
        <span class="pt-st">${selectIcon(14)}<span class="pt-selsz"></span></span>
        <span class="pt-st">${resizeIcon(14)}<span class="pt-size"></span></span>
        <span class="pt-sp"></span>
        <button class="icon-btn pt-zb" data-act="zoomout" aria-label="Zoom out">${g('zoomout', 14)}</button>
        <input type="range" class="pt-zr" min="0" max="${ZOOMS.length - 1}" step="1" aria-label="Zoom">
        <button class="icon-btn pt-zb" data-act="zoomin" aria-label="Zoom in">${g('zoomin', 14)}</button>
        <button class="pt-zp" data-act="zoommenu" aria-haspopup="menu">100%</button>
      </div>
      <input type="color" class="pt-color" tabindex="-1" aria-hidden="true">
    </div>`;
    const $ = sel => win.body.querySelector(sel);
    pt.el = {
      ribbon: $('.pt-ribbon'), work: $('.pt-work'), stage: $('.pt-stage'), canvas: $('.pt-canvas'), overlay: $('.pt-overlay'), grid: $('.pt-grid'),
      sel: $('.pt-sel'), ghost: $('.pt-ghost'), pos: $('.pt-pos'), selsz: $('.pt-selsz'), size: $('.pt-size'), zr: $('.pt-zr'), zp: $('.pt-zp'),
      status: $('.pt-status'), color: $('.pt-color'), title: win.titleContent.querySelector('.pt-title'),
    };
    pt.ctx = pt.el.canvas.getContext('2d', { willReadFrequently: true });
    pt.octx = pt.el.overlay.getContext('2d');
    const a = win.rect || { w: 1100, h: 720 };
    resizeCanvas(pt, Math.max(320, Math.min(1152, Math.round(a.w - 140))), Math.max(240, Math.min(648, Math.round(a.h - 300))), { keep: false });
    pushHistory(pt, true);
    renderRibbon(pt);
    wire(pt);
    Win.Explorer?.holdFocus?.(win);
    applyZoom(pt);
    updateTitle(pt);
    if (args.fileId) loadFile(pt, args.fileId);
    win.listen('fs', () => {
      const node = pt.fileId && Win.FS.get(pt.fileId);
      if (node && node.name !== pt.name) { pt.name = node.name; updateTitle(pt); }
    });
  }

  /* --------------------------------------------------------------- document */

  function resizeCanvas(pt, w, h, { keep = true, fill = pt.bg } = {}) {
    const old = keep ? copyCanvas(pt.el.canvas) : null;
    pt.W = Math.max(1, Math.round(w));
    pt.H = Math.max(1, Math.round(h));
    pt.el.canvas.width = pt.W;
    pt.el.canvas.height = pt.H;
    pt.el.overlay.width = pt.W;
    pt.el.overlay.height = pt.H;
    pt.ctx.fillStyle = fill;
    pt.ctx.fillRect(0, 0, pt.W, pt.H);
    if (old) pt.ctx.drawImage(old, 0, 0);
    applyZoom(pt);
  }

  function pushHistory(pt, initial = false) {
    pt.history = pt.history.slice(0, pt.index + 1);
    pt.history.push(copyCanvas(pt.el.canvas));
    if (pt.history.length > HISTORY + 1) pt.history.shift();
    pt.index = pt.history.length - 1;
    if (!initial) { pt.dirty = true; updateTitle(pt); }
    syncUndo(pt);
  }

  function restore(pt, snap) {
    if (snap.width !== pt.W || snap.height !== pt.H) resizeCanvas(pt, snap.width, snap.height, { keep: false });
    pt.ctx.clearRect(0, 0, pt.W, pt.H);
    pt.ctx.drawImage(snap, 0, 0);
  }

  function undo(pt) {
    commitPending(pt);
    if (pt.index <= 0) return;
    pt.index -= 1;
    restore(pt, pt.history[pt.index]);
    pt.dirty = true;
    clearSelection(pt);
    syncUndo(pt);
    updateTitle(pt);
  }

  function redo(pt) {
    if (pt.index >= pt.history.length - 1) return;
    pt.index += 1;
    restore(pt, pt.history[pt.index]);
    pt.dirty = true;
    clearSelection(pt);
    syncUndo(pt);
    updateTitle(pt);
  }

  function syncUndo(pt) {
    const t = pt.win.titleContent;
    t.querySelector('[data-act="undo"]').disabled = pt.index <= 0;
    t.querySelector('[data-act="redo"]').disabled = pt.index >= pt.history.length - 1;
  }

  function updateTitle(pt) {
    const title = `${pt.name}${pt.dirty ? '*' : ''} - Paint`;
    pt.el.title.textContent = title;
    if (pt.win.title !== title) pt.win.setTitle(title);
    pt.el.size.textContent = `${pt.W} × ${pt.H}px`;
  }

  function loadFile(pt, id) {
    const node = Win.FS.get(id);
    const url = node && Win.imageURL?.(node);
    if (!url) { Win.alert('Paint', `Paint can't read this file.\n\nThis is not a valid bitmap file, or its format is not currently supported.`, pt.win); return; }
    const img = new Image();
    img.onload = () => {
      const rot = ((node.rotation || 0) % 360 + 360) % 360;
      const sw = Math.min(4000, img.naturalWidth || 1500);
      const sh = Math.min(4000, img.naturalHeight || 1000);
      const turned = rot === 90 || rot === 270;
      resizeCanvas(pt, turned ? sh : sw, turned ? sw : sh, { keep: false, fill: '#ffffff' });
      pt.ctx.save();
      pt.ctx.translate(pt.W / 2, pt.H / 2);
      pt.ctx.rotate((rot * Math.PI) / 180);
      pt.ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      pt.ctx.restore();
      pt.fileId = node.id;
      pt.name = node.name;
      pt.rotationBaked = !!rot;
      pt.history = [];
      pt.index = -1;
      pushHistory(pt, true);
      pt.dirty = false;
      clearSelection(pt);
      fitZoom(pt, true);
      updateTitle(pt);
      Win.FS.touch(node.id);
    };
    img.onerror = () => Win.alert('Paint', 'Paint cannot read this file.', pt.win);
    img.src = url;
  }

  function encode(pt, ext) {
    commitPending(pt);
    const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
    const data = pt.el.canvas.toDataURL(type, 0.92);
    const size = Math.round(((data.length - data.indexOf(',') - 1) * 3) / 4);
    return { data, size };
  }

  async function save(pt, as = false, ext = null) {
    const node = pt.fileId && Win.FS.get(pt.fileId);
    if (!as && node && node.parent !== 'bin') {
      if (node.readonly || node.system) {
        await Win.alert('Paint', `Access is denied. Use Save as to keep a copy of ${node.name}.`, pt.win);
        return save(pt, true);
      }
      writeImage(node, encode(pt, node.ext));
      return markSaved(pt, node);
    }
    const order = ext ? [ext] : ['png', 'jpg', 'bmp', 'gif'];
    const stem = (node ? node.name : 'Untitled').replace(/\.[^.]+$/, '');
    const result = await Win.pickFile({
      mode: 'save', title: 'Save as', owner: pt.win, exts: order,
      defaultName: `${stem}.${order[0]}`, folder: node && node.parent !== 'bin' ? node.parent : 'pictures',
    });
    if (!result) return false;
    let target;
    const extOf = name => (name.includes('.') ? name.split('.').pop().toLowerCase() : 'png');
    if (result.overwrite) {
      target = Win.FS.get(result.id);
      if (!target || target.readonly || target.system) { await Win.alert('Paint', 'Access is denied.', pt.win); return false; }
      writeImage(target, encode(pt, target.ext));
    } else {
      const name = /\.(png|jpe?g|bmp|gif)$/i.test(result.name) ? result.name : `${result.name}.png`;
      const img = encode(pt, extOf(name));
      target = Win.FS.create(result.folder, name, 'file', { data: img.data, size: img.size });
    }
    return markSaved(pt, target);
  }

  function writeImage(node, { data, size }) {
    node.data = data;
    node.size = size;
    node.modified = Date.now();
    delete node.art;
    if (node.rotation) delete node.rotation;
    Win.save('fs');
  }

  function markSaved(pt, node) {
    pt.fileId = node.id;
    pt.name = node.name;
    pt.dirty = false;
    updateTitle(pt);
    Win.FS.touch(node.id);
    return true;
  }

  function askSave(pt) {
    return Win.dialog({
      title: 'Paint', owner: pt.win,
      body: `<p>Do you want to save changes to ${esc(pt.name)}?</p>`,
      buttons: [{ label: 'Save', value: 'save', primary: true }, { label: "Don't save", value: 'discard' }, { label: 'Cancel', value: 'cancel' }],
    }).then(async answer => {
      if (answer === 'save') return (await save(pt)) ? 'saved' : 'cancel';
      return answer || 'cancel';
    });
  }

  async function newImage(pt) {
    if (pt.dirty && (await askSave(pt)) === 'cancel') return;
    clearSelection(pt);
    resizeCanvas(pt, pt.W, pt.H, { keep: false, fill: '#ffffff' });
    pt.fileId = null;
    pt.name = 'Untitled';
    pt.history = [];
    pt.index = -1;
    pushHistory(pt, true);
    pt.dirty = false;
    updateTitle(pt);
  }

  async function openImage(pt) {
    if (pt.dirty && (await askSave(pt)) === 'cancel') return;
    const result = await Win.pickFile({ mode: 'open', title: 'Open', owner: pt.win, exts: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'svg'], folder: 'pictures' });
    if (result?.id) loadFile(pt, result.id);
  }

  /* ------------------------------------------------------------------- zoom */

  function applyZoom(pt) {
    const z = pt.zoom;
    const w = Math.max(1, Math.round(pt.W * z));
    const h = Math.max(1, Math.round(pt.H * z));
    Object.assign(pt.el.stage.style, { width: `${w}px`, height: `${h}px` });
    pt.el.stage.classList.toggle('pixelated', z >= 2);
    pt.el.grid.classList.toggle('hidden', !(P().grid && z >= 2));
    pt.el.grid.style.backgroundSize = `${z}px ${z}px`;
    pt.el.zp.textContent = `${Math.round(z * 100)}%`;
    let idx = ZOOMS.findIndex(v => v >= z - 0.001);
    if (idx < 0) idx = ZOOMS.length - 1;
    pt.el.zr.value = String(idx);
    Win.paintRange?.(pt.el.zr);
    positionSelection(pt);
    if (pt.text) positionText(pt);
    pt.el.size.textContent = `${pt.W} × ${pt.H}px`;
  }

  function setZoom(pt, z, around = null) {
    const work = pt.el.work;
    const before = pt.zoom;
    const next = Win.clamp(z, 0.125, 8);
    const r = work.getBoundingClientRect();
    const ax = around ? around.x - r.left : work.clientWidth / 2;
    const ay = around ? around.y - r.top : work.clientHeight / 2;
    const cx = (work.scrollLeft + ax) / before;
    const cy = (work.scrollTop + ay) / before;
    pt.zoom = next;
    applyZoom(pt);
    work.scrollLeft = cx * next - ax;
    work.scrollTop = cy * next - ay;
  }

  const zoomStep = (pt, dir) => {
    const i = ZOOMS.findIndex(v => v >= pt.zoom - 0.001);
    const at = i < 0 ? ZOOMS.length - 1 : i;
    const exact = Math.abs(ZOOMS[at] - pt.zoom) < 0.001;
    setZoom(pt, ZOOMS[Win.clamp(dir > 0 ? (exact ? at + 1 : at) : at - 1, 0, ZOOMS.length - 1)]);
  };

  function fitZoom(pt, onlyShrink = false) {
    const w = pt.el.work.clientWidth - 48;
    const h = pt.el.work.clientHeight - 48;
    if (w <= 0 || h <= 0) return;
    let z = Math.min(w / pt.W, h / pt.H);
    if (onlyShrink) z = Math.min(1, z);
    setZoom(pt, Math.max(0.125, z));
  }

  /* ----------------------------------------------------------------- ribbon */

  function renderRibbon(pt) {
    const tool = (id, icon, label) => `<button class="pt-tool ${pt.tool === id ? 'on' : ''}" data-tool="${id}" aria-label="${esc(label)}" title="${esc(label)}" aria-pressed="${pt.tool === id}">${icon}</button>`;
    const swatch = c => `<button class="pt-sw" data-color="${c}" style="--c:${c}" aria-label="Color ${c}" title="${c}"></button>`;
    const custom = P().custom.slice(0, 10);
    const brushIcon = { brush: g('brush', 20), marker: svgIcon('<path d="M12.5 3.5 16.5 7.5 9 15H5v-4z"/><path d="M4 17h12" stroke-width="2.5"/>'), airbrush: svgIcon('<circle cx="6" cy="6" r=".8" fill="currentColor"/><circle cx="9" cy="4.5" r=".8" fill="currentColor"/><circle cx="5" cy="9.5" r=".8" fill="currentColor"/><path d="M9 8l7 7-2 2-7-7z"/>') }[pt.brush];
    const text = pt.tool === 'text' ? `<div class="pt-group pt-textgroup">
        <div class="pt-gbody pt-col">
          <div class="pt-row">${Win.select(['Segoe UI', 'Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Impact'], pt.font.family, 'data-font="family" aria-label="Font"')}
          ${Win.select([8, 10, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72], pt.font.size, 'data-font="size" aria-label="Font size"')}</div>
          <div class="pt-row"><button class="pt-tool sm ${pt.font.bold ? 'on' : ''}" data-fontflag="bold" aria-label="Bold" aria-pressed="${pt.font.bold}"><b>B</b></button><button class="pt-tool sm ${pt.font.italic ? 'on' : ''}" data-fontflag="italic" aria-label="Italic" aria-pressed="${pt.font.italic}"><i>I</i></button></div>
        </div><span class="pt-glabel">Text</span></div>` : '';
    pt.el.ribbon.innerHTML = `
      <div class="pt-group"><div class="pt-gbody">
        <button class="pt-big ${pt.tool === 'select' ? 'on' : ''}" data-tool="select" aria-label="Rectangle selection" title="Select">${selectIcon(24)}</button>
        <button class="pt-dd" data-menu="select" aria-label="Selection options">${g('chevdown', 10)}</button>
      </div><span class="pt-glabel">Selection</span></div>
      <div class="pt-group"><div class="pt-gbody pt-grid2">
        <button class="pt-tool" data-act="crop" aria-label="Crop" title="Crop to selection (Ctrl+Shift+X)" ${pt.sel ? '' : 'disabled'}>${cropIcon(20)}</button>
        <button class="pt-tool" data-act="resize" aria-label="Resize and skew" title="Resize and skew (Ctrl+W)">${resizeIcon(20)}</button>
        <button class="pt-tool" data-menu="rotate" aria-label="Rotate or flip" title="Rotate">${g('rotate', 20)}</button>
      </div><span class="pt-glabel">Image</span></div>
      <div class="pt-group"><div class="pt-gbody pt-grid3">
        ${tool('pencil', pencilIcon(20), 'Pencil')}${tool('fill', g('fill', 20), 'Fill with color')}${tool('text', g('text', 20), 'Text')}
        ${tool('eraser', g('eraser', 20), 'Eraser')}${tool('picker', pickerIcon(20), 'Color picker')}${tool('zoom', g('zoomin', 20), 'Magnifier')}
      </div><span class="pt-glabel">Tools</span></div>
      <div class="pt-group"><div class="pt-gbody">
        <button class="pt-big ${pt.tool === 'brush' ? 'on' : ''}" data-tool="brush" aria-label="${esc(BRUSHES[pt.brush])}" title="${esc(BRUSHES[pt.brush])}">${brushIcon}</button>
        <button class="pt-dd" data-menu="brush" aria-label="Brush styles">${g('chevdown', 10)}</button>
      </div><span class="pt-glabel">Brushes</span></div>
      <div class="pt-group"><div class="pt-gbody">
        <div class="pt-shapes" role="group" aria-label="Shapes">${Object.entries(SHAPES).map(([id, s]) => `<button class="pt-tool sm ${pt.tool === 'shape' && pt.shape === id ? 'on' : ''}" data-shape="${id}" aria-label="${s.label}" title="${s.label}">${svgIcon(s.svg, 18)}</button>`).join('')}</div>
        <div class="pt-col pt-shopts">
          <button class="pt-mini" data-menu="outline">${svgIcon('<rect x="3.5" y="4.5" width="13" height="11" rx="1"/>', 14)}<span>Outline</span>${g('chevdown', 10)}</button>
          <button class="pt-mini" data-menu="fillmode">${svgIcon('<rect x="3.5" y="4.5" width="13" height="11" rx="1" fill="currentColor"/>', 14)}<span>Fill</span>${g('chevdown', 10)}</button>
        </div>
      </div><span class="pt-glabel">Shapes</span></div>
      <div class="pt-group"><div class="pt-gbody pt-col pt-sizebox">
        <span class="pt-sizeprev"><i style="height:${Math.min(18, pt.size)}px"></i></span>
        <input type="range" class="pt-sizer" min="1" max="50" value="${pt.size}" aria-label="Size">
        <span class="pt-sizeval">${pt.size}px</span>
      </div><span class="pt-glabel">Size</span></div>
      <div class="pt-group pt-colors"><div class="pt-gbody">
        <div class="pt-active">
          <button class="pt-slot ${pt.slot === 'fg' ? 'on' : ''}" data-slot="fg" aria-label="Color 1" title="Color 1 (left-click)"><span style="--c:${pt.fg}"></span></button>
          <button class="pt-slot ${pt.slot === 'bg' ? 'on' : ''}" data-slot="bg" aria-label="Color 2" title="Color 2 (right-click)"><span style="--c:${pt.bg}"></span></button>
        </div>
        <div class="pt-palette" role="group" aria-label="Colors">${PALETTE.map(swatch).join('')}${Array.from({ length: 10 }, (_, i) => (custom[i] ? swatch(custom[i]) : '<span class="pt-sw empty" aria-hidden="true"></span>')).join('')}</div>
        <button class="pt-tool pt-edit" data-act="editcolor" aria-label="Edit colors" title="Edit colors">${g('palette', 20)}</button>
      </div><span class="pt-glabel">Colors</span></div>
      ${text}`;
    Win.paintRanges?.(pt.el.ribbon);
    pt.el.stage.dataset.tool = pt.tool;
    pt.el.work.dataset.tool = pt.tool;
  }

  function setTool(pt, tool) {
    commitPending(pt);
    if (tool !== 'select') clearSelection(pt);
    if (tool !== 'picker') pt.lastTool = tool;
    pt.tool = tool;
    renderRibbon(pt);
  }

  function setColor(pt, slot, color) {
    pt[slot] = color;
    renderRibbon(pt);
    if (pt.text) pt.text.el.style.color = pt.fg;
  }

  function ribbonMenu(pt, name, anchor) {
    const r = anchor.getBoundingClientRect();
    const at = items => Win.menu(r.left, r.bottom + 4, items);
    if (name === 'select') {
      at([
        { label: 'Rectangle selection', icon: selectIcon(16), checked: pt.tool === 'select', action: () => setTool(pt, 'select') },
        { divider: true },
        { label: 'Select all', shortcut: 'Ctrl+A', action: () => selectAll(pt) },
        { label: 'Delete', glyph: 'trash', shortcut: 'Delete', disabled: !pt.sel, action: () => deleteSelection(pt) },
        { label: 'Crop', icon: cropIcon(16), shortcut: 'Ctrl+Shift+X', disabled: !pt.sel, action: () => crop(pt) },
      ]);
    }
    if (name === 'rotate') {
      at([
        { label: 'Rotate right 90°', glyph: 'rotate', action: () => transform(pt, 'r90') },
        { label: 'Rotate left 90°', glyph: 'refresh', action: () => transform(pt, 'l90') },
        { label: 'Rotate 180°', action: () => transform(pt, 'r180') },
        { divider: true },
        { label: 'Flip vertical', action: () => transform(pt, 'fv') },
        { label: 'Flip horizontal', action: () => transform(pt, 'fh') },
      ]);
    }
    if (name === 'brush') {
      at(Object.entries(BRUSHES).map(([id, label]) => ({ label, checked: pt.brush === id, radio: true, action: () => { pt.brush = id; setTool(pt, 'brush'); } })));
    }
    if (name === 'outline') {
      at([['solid', 'Solid color'], ['none', 'No outline']].map(([id, label]) => ({ label, checked: pt.outline === id, radio: true, action: () => { pt.outline = id; if (pt.outline === 'none' && pt.fillMode === 'none') pt.fillMode = 'solid'; } })));
    }
    if (name === 'fillmode') {
      at([['none', 'No fill'], ['solid', 'Solid color']].map(([id, label]) => ({ label, checked: pt.fillMode === id, radio: true, action: () => { pt.fillMode = id; if (pt.outline === 'none' && pt.fillMode === 'none') pt.outline = 'solid'; } })));
    }
  }

  function fileMenu(pt, anchor) {
    const r = anchor.getBoundingClientRect();
    const node = pt.fileId && Win.FS.get(pt.fileId);
    Win.menu(r.left, r.bottom + 4, [
      { label: 'New', glyph: 'file', shortcut: 'Ctrl+N', action: () => newImage(pt) },
      { label: 'Open', glyph: 'folder', shortcut: 'Ctrl+O', action: () => openImage(pt) },
      { label: 'Save', glyph: 'download', shortcut: 'Ctrl+S', action: () => save(pt) },
      {
        label: 'Save as', glyph: 'copy', submenu: [
          { label: 'PNG image', action: () => save(pt, true, 'png') },
          { label: 'JPEG image', action: () => save(pt, true, 'jpg') },
          { label: 'BMP image', action: () => save(pt, true, 'bmp') },
          { label: 'GIF image', action: () => save(pt, true, 'gif') },
        ],
      },
      { divider: true },
      { label: 'Image properties', glyph: 'info', shortcut: 'Ctrl+E', action: () => propertiesDialog(pt) },
      { label: 'Set as desktop background', glyph: 'picture', disabled: !node, action: () => { Win.state.settings.wallpaper = `file:${node.id}`; Win.save('theme'); } },
      { divider: true },
      { label: 'Exit', glyph: 'close', action: () => pt.win.close() },
    ]);
  }

  function viewMenu(pt, anchor) {
    const r = anchor.getBoundingClientRect();
    Win.menu(r.left, r.bottom + 4, [
      { label: 'Zoom in', glyph: 'zoomin', shortcut: 'Ctrl+Plus', action: () => zoomStep(pt, 1) },
      { label: 'Zoom out', glyph: 'zoomout', shortcut: 'Ctrl+Minus', action: () => zoomStep(pt, -1) },
      { label: 'Fit to window', shortcut: 'Ctrl+Shift+0', action: () => fitZoom(pt) },
      { label: 'Actual size', shortcut: 'Ctrl+0', action: () => setZoom(pt, 1) },
      { divider: true },
      { label: 'Gridlines', checked: !!P().grid, action: () => { P().grid = !P().grid; Win.save(); applyZoom(pt); } },
      { label: 'Status bar', checked: P().statusBar !== false, action: () => { P().statusBar = P().statusBar === false; Win.save(); pt.el.status.classList.toggle('hidden', P().statusBar === false); } },
    ]);
  }

  /* --------------------------------------------------------- image commands */

  function transform(pt, kind) {
    commitPending(pt);
    clearSelection(pt);
    const src = copyCanvas(pt.el.canvas);
    const turn = kind === 'r90' || kind === 'l90';
    resizeCanvas(pt, turn ? pt.H : pt.W, turn ? pt.W : pt.H, { keep: false });
    const c = pt.ctx;
    c.save();
    c.translate(pt.W / 2, pt.H / 2);
    if (kind === 'r90') c.rotate(Math.PI / 2);
    if (kind === 'l90') c.rotate(-Math.PI / 2);
    if (kind === 'r180') c.rotate(Math.PI);
    if (kind === 'fv') c.scale(1, -1);
    if (kind === 'fh') c.scale(-1, 1);
    c.drawImage(src, -src.width / 2, -src.height / 2);
    c.restore();
    pushHistory(pt);
  }

  function resizeDialog(pt) {
    commitPending(pt);
    Win.dialog({
      title: 'Resize and Skew', owner: pt.win, width: 380,
      body: `<div class="pt-dlg">
        <div class="pt-drow"><span>By:</span><label class="check"><input type="radio" name="pt-by" value="pct" checked> Percentage</label><label class="check"><input type="radio" name="pt-by" value="px"> Pixels</label></div>
        <label class="field"><span>Horizontal</span><input class="input" data-r="w" type="number" min="1" value="100"></label>
        <label class="field"><span>Vertical</span><input class="input" data-r="h" type="number" min="1" value="100"></label>
        <label class="check"><input type="checkbox" data-r="lock" checked> Maintain aspect ratio</label>
      </div>`,
      onRender(box) {
        const w = box.querySelector('[data-r="w"]');
        const h = box.querySelector('[data-r="h"]');
        const lock = box.querySelector('[data-r="lock"]');
        const by = () => box.querySelector('[name="pt-by"]:checked').value;
        box.addEventListener('change', e => {
          if (e.target.name !== 'pt-by') return;
          if (by() === 'px') { w.value = pt.W; h.value = pt.H; } else { w.value = 100; h.value = 100; }
        });
        w.addEventListener('input', () => { if (lock.checked) h.value = by() === 'px' ? Math.round((Number(w.value) * pt.H) / pt.W) : w.value; });
        h.addEventListener('input', () => { if (lock.checked) w.value = by() === 'px' ? Math.round((Number(h.value) * pt.W) / pt.H) : h.value; });
      },
      buttons: [
        {
          label: 'OK', primary: true,
          validate: box => {
            const w = Number(box.querySelector('[data-r="w"]').value);
            const h = Number(box.querySelector('[data-r="h"]').value);
            const px = box.querySelector('[name="pt-by"]:checked').value === 'px';
            const W = px ? w : (pt.W * w) / 100;
            const H = px ? h : (pt.H * h) / 100;
            if (!(W >= 1 && H >= 1)) return 'Enter a size of at least 1 pixel.';
            if (W > 6000 || H > 6000) return 'The picture is too large. Choose a size up to 6000 × 6000 pixels.';
            return '';
          },
          value: box => {
            const w = Number(box.querySelector('[data-r="w"]').value);
            const h = Number(box.querySelector('[data-r="h"]').value);
            const px = box.querySelector('[name="pt-by"]:checked').value === 'px';
            return { w: Math.round(px ? w : (pt.W * w) / 100), h: Math.round(px ? h : (pt.H * h) / 100) };
          },
        },
        { label: 'Cancel', value: null },
      ],
    }).then(v => {
      if (!v || (v.w === pt.W && v.h === pt.H)) return;
      clearSelection(pt);
      const src = copyCanvas(pt.el.canvas);
      resizeCanvas(pt, v.w, v.h, { keep: false });
      pt.ctx.imageSmoothingQuality = 'high';
      pt.ctx.drawImage(src, 0, 0, v.w, v.h);
      pushHistory(pt);
    });
  }

  function propertiesDialog(pt) {
    commitPending(pt);
    const node = pt.fileId && Win.FS.get(pt.fileId);
    Win.dialog({
      title: 'Image properties', owner: pt.win, width: 380,
      body: `<div class="pt-dlg">
        <p class="muted">${node ? `Last saved: ${esc(Win.formatDateTime(node.modified || Date.now()))}<br>Size on disk: ${esc(Win.bytes(node.size || 0))}` : 'Not saved yet'}</p>
        <label class="field"><span>Width (pixels)</span><input class="input" data-p="w" type="number" min="1" max="6000" value="${pt.W}"></label>
        <label class="field"><span>Height (pixels)</span><input class="input" data-p="h" type="number" min="1" max="6000" value="${pt.H}"></label>
      </div>`,
      buttons: [
        { label: 'OK', primary: true, validate: box => { const w = Number(box.querySelector('[data-p="w"]').value); const h = Number(box.querySelector('[data-p="h"]').value); return w >= 1 && h >= 1 && w <= 6000 && h <= 6000 ? '' : 'Width and height must be between 1 and 6000 pixels.'; }, value: box => ({ w: Number(box.querySelector('[data-p="w"]').value), h: Number(box.querySelector('[data-p="h"]').value) }) },
        { label: 'Cancel', value: null },
      ],
    }).then(v => {
      if (!v || (v.w === pt.W && v.h === pt.H)) return;
      clearSelection(pt);
      resizeCanvas(pt, v.w, v.h);
      pushHistory(pt);
    });
  }

  /* -------------------------------------------------------------- selection */

  function positionSelection(pt) {
    const s = pt.float || pt.sel;
    const box = pt.el.sel;
    box.classList.toggle('hidden', !s);
    pt.el.selsz.textContent = s ? `${Math.round(s.w)} × ${Math.round(s.h)}px` : '';
    if (!s) return;
    const z = pt.zoom;
    Object.assign(box.style, { left: `${s.x * z}px`, top: `${s.y * z}px`, width: `${s.w * z}px`, height: `${s.h * z}px` });
  }

  function clearSelection(pt) {
    if (pt.float) commitFloat(pt);
    pt.sel = null;
    positionSelection(pt);
    if (pt.el.ribbon.querySelector('[data-act="crop"]')) pt.el.ribbon.querySelector('[data-act="crop"]').disabled = true;
  }

  function setSelection(pt, rect) {
    pt.sel = rect;
    positionSelection(pt);
    const crop = pt.el.ribbon.querySelector('[data-act="crop"]');
    if (crop) crop.disabled = !rect;
  }

  function selectAll(pt) {
    commitPending(pt);
    if (pt.tool !== 'select') { pt.tool = 'select'; renderRibbon(pt); }
    setSelection(pt, { x: 0, y: 0, w: pt.W, h: pt.H });
  }

  function liftSelection(pt) {
    if (pt.float || !pt.sel) return;
    const { x, y, w, h } = pt.sel;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.getContext('2d').drawImage(pt.el.canvas, Math.round(x), Math.round(y), c.width, c.height, 0, 0, c.width, c.height);
    pt.ctx.fillStyle = pt.bg;
    pt.ctx.fillRect(Math.round(x), Math.round(y), c.width, c.height);
    pt.float = { canvas: c, x: Math.round(x), y: Math.round(y), w: c.width, h: c.height };
    drawFloat(pt);
  }

  function drawFloat(pt) {
    const o = pt.octx;
    o.clearRect(0, 0, pt.W, pt.H);
    if (pt.float) o.drawImage(pt.float.canvas, pt.float.x, pt.float.y);
    positionSelection(pt);
  }

  function commitFloat(pt) {
    const f = pt.float;
    if (!f) return;
    pt.float = null;
    pt.octx.clearRect(0, 0, pt.W, pt.H);
    pt.ctx.drawImage(f.canvas, f.x, f.y);
    pt.sel = { x: f.x, y: f.y, w: f.w, h: f.h };
    pushHistory(pt);
    positionSelection(pt);
  }

  function deleteSelection(pt) {
    if (pt.float) { pt.float = null; pt.octx.clearRect(0, 0, pt.W, pt.H); pushHistory(pt); setSelection(pt, null); return; }
    if (!pt.sel) return;
    const { x, y, w, h } = pt.sel;
    pt.ctx.fillStyle = pt.bg;
    pt.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    pushHistory(pt);
    setSelection(pt, null);
  }

  function crop(pt) {
    const s = pt.float || pt.sel;
    if (!s) return;
    if (pt.float) commitFloat(pt);
    const { x, y, w, h } = pt.sel;
    const part = document.createElement('canvas');
    part.width = Math.round(w);
    part.height = Math.round(h);
    part.getContext('2d').drawImage(pt.el.canvas, Math.round(x), Math.round(y), part.width, part.height, 0, 0, part.width, part.height);
    resizeCanvas(pt, part.width, part.height, { keep: false });
    pt.ctx.drawImage(part, 0, 0);
    setSelection(pt, null);
    pushHistory(pt);
  }

  let clipboard = null;

  function copySelection(pt, cut = false) {
    const s = pt.float || pt.sel;
    if (!s) return;
    const c = document.createElement('canvas');
    c.width = Math.round(s.w);
    c.height = Math.round(s.h);
    if (pt.float) c.getContext('2d').drawImage(pt.float.canvas, 0, 0);
    else c.getContext('2d').drawImage(pt.el.canvas, Math.round(s.x), Math.round(s.y), c.width, c.height, 0, 0, c.width, c.height);
    clipboard = c;
    if (cut) deleteSelection(pt);
  }

  function pasteSelection(pt) {
    if (!clipboard) return;
    commitPending(pt);
    if (pt.tool !== 'select') { pt.tool = 'select'; renderRibbon(pt); }
    if (clipboard.width > pt.W || clipboard.height > pt.H) resizeCanvas(pt, Math.max(pt.W, clipboard.width), Math.max(pt.H, clipboard.height));
    const work = pt.el.work;
    const x = Math.max(0, Math.round((work.scrollLeft - 24) / pt.zoom));
    const y = Math.max(0, Math.round((work.scrollTop - 24) / pt.zoom));
    pt.float = { canvas: copyCanvas(clipboard), x: Math.min(x, pt.W - clipboard.width), y: Math.min(y, pt.H - clipboard.height), w: clipboard.width, h: clipboard.height };
    pt.sel = { ...pt.float };
    drawFloat(pt);
  }

  /* ------------------------------------------------------------------- text */

  function positionText(pt) {
    const t = pt.text;
    const z = pt.zoom;
    const f = pt.font;
    Object.assign(t.el.style, {
      left: `${t.x * z}px`, top: `${t.y * z}px`, fontSize: `${f.size * z}px`, lineHeight: `${f.size * 1.25 * z}px`,
      fontFamily: `"${f.family}", var(--font)`, fontWeight: f.bold ? '700' : '400', fontStyle: f.italic ? 'italic' : 'normal', color: pt.fg,
    });
    t.el.style.width = 'auto';
    t.el.style.width = `${Math.max(120 * z, t.el.scrollWidth + 8)}px`;
    t.el.style.height = 'auto';
    t.el.style.height = `${Math.max(f.size * 1.4 * z, t.el.scrollHeight)}px`;
  }

  function startText(pt, x, y) {
    commitText(pt);
    const el = Win.html('<textarea class="pt-text" spellcheck="false" aria-label="Text" wrap="off"></textarea>');
    pt.el.stage.appendChild(el);
    pt.text = { el, x, y };
    positionText(pt);
    el.addEventListener('input', () => positionText(pt));
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); commitText(pt); pt.el.work.focus({ preventScroll: true }); }
    });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    setTimeout(() => el.focus(), 0);
  }

  function commitText(pt) {
    const t = pt.text;
    if (!t) return;
    pt.text = null;
    const value = t.el.value;
    t.el.remove();
    if (!value.trim()) return;
    const f = pt.font;
    const c = pt.ctx;
    c.save();
    c.font = `${f.italic ? 'italic ' : ''}${f.bold ? '700 ' : '400 '}${f.size}px "${f.family}", "Segoe UI", sans-serif`;
    c.fillStyle = pt.fg;
    c.textBaseline = 'top';
    value.split('\n').forEach((line, i) => c.fillText(line, t.x + 2, t.y + 2 + i * f.size * 1.25));
    c.restore();
    pushHistory(pt);
  }

  const commitPending = pt => { commitText(pt); if (pt.float) commitFloat(pt); };

  /* ---------------------------------------------------------------- drawing */

  function linePixels(x0, y0, x1, y1, plot) {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 20000; guard += 1) {
      plot(x, y);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }

  function squareLine(ctx, a, b, size, color) {
    const half = Math.floor(size / 2);
    ctx.fillStyle = color;
    linePixels(a.x, a.y, b.x, b.y, (x, y) => ctx.fillRect(x - half, y - half, size, size));
  }

  function strokePath(ctx, points, size, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i += 1) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function spray(ctx, p, size, color) {
    const radius = size * 2 + 4;
    ctx.fillStyle = color;
    for (let i = 0; i < 18 + size; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      ctx.fillRect(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1, 1);
    }
  }

  function shapePath(ctx, kind, a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    ctx.beginPath();
    if (kind === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); return; }
    if (kind === 'rect') ctx.rect(x, y, w, h);
    if (kind === 'rrect') {
      const r = Math.min(w, h) * 0.18;
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    }
    if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
    if (kind === 'triangle') { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
    if (kind === 'diamond') { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); }
  }

  function drawShape(pt, ctx, a, b, stroke, fill) {
    ctx.save();
    ctx.lineWidth = pt.size;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    shapePath(ctx, pt.shape, a, b);
    if (pt.shape !== 'line' && pt.fillMode === 'solid') ctx.fill();
    if (pt.shape === 'line' || pt.outline === 'solid') ctx.stroke();
    ctx.restore();
  }

  function constrain(a, b, shift, shape) {
    if (!shift) return b;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (shape === 'line') {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
    }
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
  }

  function pointFrom(pt, e) {
    const r = pt.el.overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / pt.zoom, y: (e.clientY - r.top) / pt.zoom };
  }

  const inside = (s, p) => s && p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h;

  function onDown(pt, e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    pt.el.work.focus({ preventScroll: true });
    const p = pointFrom(pt, e);
    const color = e.button === 2 ? pt.bg : pt.fg;
    const other = e.button === 2 ? pt.fg : pt.bg;
    const tool = pt.tool;
    const target = pt.el.overlay;

    if (tool !== 'text') commitText(pt);
    if (tool === 'text') {
      if (pt.text) { commitText(pt); return; }
      if (p.x >= 0 && p.y >= 0 && p.x < pt.W && p.y < pt.H) startText(pt, Math.round(p.x), Math.round(p.y));
      return;
    }
    if (tool === 'picker') {
      const x = Win.clamp(Math.floor(p.x), 0, pt.W - 1);
      const y = Win.clamp(Math.floor(p.y), 0, pt.H - 1);
      const [r, gg, b] = pt.ctx.getImageData(x, y, 1, 1).data;
      pt[e.button === 2 ? 'bg' : 'fg'] = rgbToHex(r, gg, b);
      setTool(pt, pt.lastTool || 'brush');
      return;
    }
    if (tool === 'zoom') { zoomStep(pt, e.button === 2 ? -1 : 1); return; }
    if (tool === 'fill') {
      if (floodFill(pt.ctx, Math.floor(p.x), Math.floor(p.y), hexToRGBA(color))) pushHistory(pt);
      return;
    }

    target.setPointerCapture(e.pointerId);
    let last = p;
    let frame = 0;
    const points = [p];
    let moved = false;
    let mode = tool;
    let dragFrom = null;

    if (tool === 'select') {
      if (inside(pt.float || pt.sel, p)) {
        mode = 'move';
        liftSelection(pt);
        dragFrom = { x: p.x - pt.float.x, y: p.y - pt.float.y };
      } else {
        if (pt.float) commitFloat(pt);
        setSelection(pt, null);
      }
    }
    if (mode === 'pencil') squareLine(pt.ctx, p, p, Math.max(1, Math.min(pt.size, 8)), color);
    if (mode === 'eraser') squareLine(pt.ctx, p, p, Math.max(4, pt.size * 2), pt.bg);
    if (mode === 'brush' && pt.brush === 'airbrush') spray(pt.ctx, p, pt.size, color);
    if (mode === 'brush' && pt.brush !== 'airbrush') strokePath(pt.octx, points, pt.size, color, pt.brush === 'marker' ? 0.45 : 1);
    let sprayTimer = mode === 'brush' && pt.brush === 'airbrush' ? setInterval(() => spray(pt.ctx, last, pt.size, color), 30) : 0;

    const render = shift => {
      frame = 0;
      if (mode === 'brush' && pt.brush !== 'airbrush') {
        pt.octx.clearRect(0, 0, pt.W, pt.H);
        strokePath(pt.octx, points, pt.size, color, pt.brush === 'marker' ? 0.45 : 1);
      } else if (mode === 'shape') {
        pt.octx.clearRect(0, 0, pt.W, pt.H);
        drawShape(pt, pt.octx, p, constrain(p, last, shift, pt.shape), color, other);
      } else if (mode === 'select') {
        const b = { x: Win.clamp(last.x, 0, pt.W), y: Win.clamp(last.y, 0, pt.H) };
        const a = { x: Win.clamp(p.x, 0, pt.W), y: Win.clamp(p.y, 0, pt.H) };
        setSelection(pt, { x: Math.round(Math.min(a.x, b.x)), y: Math.round(Math.min(a.y, b.y)), w: Math.round(Math.abs(b.x - a.x)), h: Math.round(Math.abs(b.y - a.y)) });
      } else if (mode === 'move') {
        pt.float.x = Math.round(last.x - dragFrom.x);
        pt.float.y = Math.round(last.y - dragFrom.y);
        pt.sel = { ...pt.float };
        drawFloat(pt);
      }
    };

    const move = ev => {
      const events = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of events.length ? events : [ev]) {
        const q = pointFrom(pt, ce);
        if (mode === 'pencil') squareLine(pt.ctx, last, q, Math.max(1, Math.min(pt.size, 8)), color);
        else if (mode === 'eraser') squareLine(pt.ctx, last, q, Math.max(4, pt.size * 2), pt.bg);
        else if (mode === 'brush' && pt.brush === 'airbrush') spray(pt.ctx, q, pt.size, color);
        else if (mode === 'brush') { if (Math.hypot(q.x - last.x, q.y - last.y) >= 0.75) points.push(q); }
        last = q;
      }
      moved = true;
      if (!frame) { const shift = ev.shiftKey; frame = requestAnimationFrame(() => render(shift)); }
      updatePos(pt, last);
    };
    const up = ev => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      clearInterval(sprayTimer);
      sprayTimer = 0;
      cancelAnimationFrame(frame);
      if (mode === 'brush' && pt.brush !== 'airbrush') {
        pt.octx.clearRect(0, 0, pt.W, pt.H);
        strokePath(pt.ctx, points, pt.size, color, pt.brush === 'marker' ? 0.45 : 1);
        pushHistory(pt);
      } else if (mode === 'shape') {
        pt.octx.clearRect(0, 0, pt.W, pt.H);
        if (moved) { drawShape(pt, pt.ctx, p, constrain(p, last, ev.shiftKey, pt.shape), color, other); pushHistory(pt); }
      } else if (mode === 'select') {
        render(false);
        if (!pt.sel || pt.sel.w < 2 || pt.sel.h < 2) setSelection(pt, null);
      } else if (mode === 'move') {
        render(false);
      } else if (mode === 'pencil' || mode === 'eraser' || mode === 'brush') {
        pushHistory(pt);
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function updatePos(pt, p) {
    if (!p || p.x < 0 || p.y < 0 || p.x >= pt.W || p.y >= pt.H) { pt.el.pos.textContent = ''; return; }
    pt.el.pos.textContent = `${Math.floor(p.x)}, ${Math.floor(p.y)}px`;
  }

  function resizeFromHandle(pt, e, dir) {
    e.preventDefault();
    e.stopPropagation();
    commitPending(pt);
    const handle = e.target;
    handle.setPointerCapture(e.pointerId);
    const ghost = pt.el.ghost;
    let w = pt.W;
    let h = pt.H;
    ghost.classList.remove('hidden');
    const move = ev => {
      if (dir.includes('e')) w = Math.max(1, Math.round(pt.W + (ev.clientX - e.clientX) / pt.zoom));
      if (dir.includes('s')) h = Math.max(1, Math.round(pt.H + (ev.clientY - e.clientY) / pt.zoom));
      Object.assign(ghost.style, { width: `${w * pt.zoom}px`, height: `${h * pt.zoom}px` });
      pt.el.size.textContent = `${w} × ${h}px`;
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      ghost.classList.add('hidden');
      if (w !== pt.W || h !== pt.H) { clearSelection(pt); resizeCanvas(pt, w, h); pushHistory(pt); }
      updateTitle(pt);
    };
    Object.assign(ghost.style, { width: `${w * pt.zoom}px`, height: `${h * pt.zoom}px` });
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  /* ----------------------------------------------------------------- wiring */

  function wire(pt) {
    const { win } = pt;
    const { ribbon, overlay, work, zr, color } = pt.el;

    win.titleContent.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'file') fileMenu(pt, b);
      if (act === 'viewmenu') viewMenu(pt, b);
      if (act === 'save') save(pt);
      if (act === 'undo') undo(pt);
      if (act === 'redo') redo(pt);
    });

    ribbon.addEventListener('click', e => {
      const t = e.target.closest('[data-tool]');
      if (t) { setTool(pt, t.dataset.tool); return; }
      const shape = e.target.closest('[data-shape]');
      if (shape) { pt.shape = shape.dataset.shape; setTool(pt, 'shape'); return; }
      const m = e.target.closest('[data-menu]');
      if (m) { ribbonMenu(pt, m.dataset.menu, m); return; }
      const slot = e.target.closest('[data-slot]');
      if (slot) { pt.slot = slot.dataset.slot; renderRibbon(pt); return; }
      const sw = e.target.closest('[data-color]');
      if (sw) { setColor(pt, pt.slot, sw.dataset.color); return; }
      const flag = e.target.closest('[data-fontflag]');
      if (flag) { pt.font[flag.dataset.fontflag] = !pt.font[flag.dataset.fontflag]; renderRibbon(pt); if (pt.text) { positionText(pt); pt.text.el.focus(); } return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'crop') crop(pt);
      if (act === 'resize') resizeDialog(pt);
      if (act === 'editcolor') { color.value = pt[pt.slot]; color.click(); }
    });
    ribbon.addEventListener('contextmenu', e => {
      const sw = e.target.closest('[data-color]');
      if (!sw) return;
      e.preventDefault();
      e.stopPropagation();
      setColor(pt, 'bg', sw.dataset.color);
    });
    ribbon.addEventListener('input', e => {
      if (e.target.matches('.pt-sizer')) {
        pt.size = Number(e.target.value);
        P().size = pt.size;
        ribbon.querySelector('.pt-sizeval').textContent = `${pt.size}px`;
        ribbon.querySelector('.pt-sizeprev i').style.height = `${Math.min(18, pt.size)}px`;
      }
    });
    ribbon.addEventListener('change', e => {
      if (e.target.matches('.pt-sizer')) Win.save();
      const f = e.target.dataset.font;
      if (f) { pt.font[f] = f === 'size' ? Number(e.target.value) : e.target.value; if (pt.text) { positionText(pt); pt.text.el.focus(); } }
    });
    color.addEventListener('change', () => {
      const c = color.value;
      const custom = P().custom.filter(x => x !== c);
      custom.unshift(c);
      P().custom = custom.slice(0, 10);
      Win.save();
      setColor(pt, pt.slot, c);
    });

    overlay.addEventListener('pointerdown', e => onDown(pt, e));
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    pt.el.stage.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-h]');
      if (h) resizeFromHandle(pt, e, h.dataset.h);
    });
    work.addEventListener('pointerdown', e => {
      if (e.target !== work && !e.target.classList.contains('pt-pad')) return;
      commitPending(pt);
      if (pt.tool === 'select') setSelection(pt, null);
    });
    work.addEventListener('pointermove', e => {
      if (e.target === overlay) updatePos(pt, pointFrom(pt, e)); else pt.el.pos.textContent = '';
    });
    work.addEventListener('pointerleave', () => { pt.el.pos.textContent = ''; });
    work.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(pt, pt.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX, y: e.clientY });
    }, { passive: false });
    work.addEventListener('dragover', e => {
      if (e.dataTransfer?.types?.includes('application/x-win-fs')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    });
    work.addEventListener('drop', async e => {
      if (!e.dataTransfer?.types?.includes('application/x-win-fs')) return;
      e.preventDefault();
      let ids = Win.dragFiles?.ids;
      if (!ids) { try { ids = JSON.parse(e.dataTransfer.getData('application/x-win-fs') || '[]'); } catch { ids = []; } }
      Win.dragFiles = null;
      const node = ids.map(id => Win.FS.get(id)).find(n => n && Win.imageURL?.(n));
      if (!node) return;
      if (pt.dirty && (await askSave(pt)) === 'cancel') return;
      loadFile(pt, node.id);
    });

    zr.addEventListener('input', () => setZoom(pt, ZOOMS[Number(zr.value)]));
    pt.el.status.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'zoomin') zoomStep(pt, 1);
      if (act === 'zoomout') zoomStep(pt, -1);
      if (act === 'zoommenu') {
        const r = e.target.closest('button').getBoundingClientRect();
        Win.menu(r.left, r.top - 8 - 32 * 10, [...[8, 6, 4, 2, 1, 0.5, 0.25, 0.125].map(z => ({ label: `${z * 100}%`, checked: Math.abs(pt.zoom - z) < 0.001, radio: true, action: () => setZoom(pt, z) })), { divider: true }, { label: 'Fit to window', action: () => fitZoom(pt) }]);
      }
    });
    pt.el.status.classList.toggle('hidden', P().statusBar === false);

    win.el.addEventListener('keydown', e => onKey(pt, e));
  }

  function onKey(pt, e) {
    if (e.defaultPrevented || e.target.closest?.('.dlg-smoke') || e.target.matches?.('input, textarea, select')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const act = fn => { e.preventDefault(); e.stopPropagation(); fn(); };
    if (ctrl && e.shiftKey && k === 'x') return act(() => crop(pt));
    if (ctrl && e.shiftKey && k === 's') return act(() => save(pt, true));
    if (ctrl && e.shiftKey && (k === '0' || e.code === 'Digit0')) return act(() => fitZoom(pt));
    if (ctrl && !e.shiftKey) {
      if (k === 'z') return act(() => undo(pt));
      if (k === 'y') return act(() => redo(pt));
      if (k === 's') return act(() => save(pt));
      if (k === 'o') return act(() => openImage(pt));
      if (k === 'n') return act(() => newImage(pt));
      if (k === 'a') return act(() => selectAll(pt));
      if (k === 'c') return act(() => copySelection(pt));
      if (k === 'x') return act(() => copySelection(pt, true));
      if (k === 'v') return act(() => pasteSelection(pt));
      if (k === 'e') return act(() => propertiesDialog(pt));
      if (k === 'w') return act(() => resizeDialog(pt));
      if (k === '=' || k === '+' || k === 'PageUp') return act(() => zoomStep(pt, 1));
      if (k === '-' || k === 'PageDown') return act(() => zoomStep(pt, -1));
      if (k === '0') return act(() => setZoom(pt, 1));
    }
    if (k === 'Delete' && (pt.sel || pt.float)) return act(() => deleteSelection(pt));
    if (k === 'Escape' && (pt.sel || pt.float)) return act(() => clearSelection(pt));
    if (pt.float && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
      return act(() => {
        const d = e.shiftKey ? 10 : 1;
        pt.float.x += k === 'ArrowLeft' ? -d : k === 'ArrowRight' ? d : 0;
        pt.float.y += k === 'ArrowUp' ? -d : k === 'ArrowDown' ? d : 0;
        pt.sel = { ...pt.float };
        drawFloat(pt);
      });
    }
    if (pt.sel && !pt.float && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return act(() => { liftSelection(pt); });
    return undefined;
  }

  Win.Paint = { floodFill, copyCanvas };
})(window.Win);
