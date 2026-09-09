// Small wood-and-leather frames shared by the game HUD and action belts.
export function medievalPanel(ctx, x, y, w, h, { active = false, inset = false } = {}) {
  x = Math.round(x); y = Math.round(y);
  ctx.save();
  ctx.fillStyle = '#17100d'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = active ? '#bd9458' : '#725333'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = '#35261d'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = inset ? '#211914' : '#2b2018'; ctx.fillRect(x + 3, y + 3, w - 6, h - 6);
  // Quiet grain in the wood, with a worn upper edge lit from the left.
  ctx.fillStyle = '#453022';
  for (let i = 9; i < w - 7; i += 23) ctx.fillRect(x + i, y + 2, Math.min(11, w - i - 3), 1);
  ctx.fillStyle = active ? '#ecd19a' : '#9c7950'; ctx.fillRect(x + 3, y + 1, w - 6, 1);
  ctx.fillStyle = '#130e0b'; ctx.fillRect(x + 3, y + h - 3, w - 6, 1);
  for (const dx of [2, w - 4]) for (const dy of [2, h - 4]) {
    ctx.fillStyle = '#211710';ctx.fillRect(x + dx, y + dy, 2, 2);
    ctx.fillStyle = active ? '#e4c38c' : '#a88b58';ctx.fillRect(x + dx, y + dy, 1, 1);
  }
  ctx.restore();
}
