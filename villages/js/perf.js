// Dev A/B switch for measuring: sessionStorage.villagesPerfOff = '1' turns off villager baking,
// draw batching and forest LOD for this tab (see tools/devkit.js perf() and perfScene()).
export const PERF_OFF = (() => { try { return sessionStorage.getItem('villagesPerfOff') === '1'; } catch { return false; } })();
// draw batching (batch.js) needs WEBGL_multi_draw to be a win: without it three.js falls back to one draw
// per instance. Checked once on a throwaway WebGL2 context.
export const BATCHING = !PERF_OFF && (() => {
  try { const gl = document.createElement('canvas').getContext('webgl2'); const ok = !!gl?.getExtension('WEBGL_multi_draw'); gl?.getExtension('WEBGL_lose_context')?.loseContext(); return ok; }
  catch { return false; }
})();
