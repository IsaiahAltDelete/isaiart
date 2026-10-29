/* ===========================================================================
   Boot: load saved state over defaults, then bring up the shell.
   `?reset` discards the saved PC and starts fresh.
   =========================================================================== */

(function (Win) {
  'use strict';

  const params = new URLSearchParams(location.search);
  if (params.has('reset')) Win.Store.reset();

  const saved = Win.Store.load();
  Win.state = saved ? Win.merge(Win.clone(Win.DefaultState), saved) : Win.clone(Win.DefaultState);
  if (Win.state.update?.build) Win.OS.build = Win.state.update.build;

  Win.applyTheme();
  Win.Taskbar.init();
  Win.Desktop.init();
  Win.Session.init();

  if (params.has('app')) Win.wm.open(params.get('app'), Object.fromEntries(params));

  /* Auto-hide changes the work area, so maximised and snapped windows refit. */
  let autoHide = Win.state.settings.autoHide;
  Win.on('state', () => {
    if (Win.state.settings.autoHide === autoHide) return;
    autoHide = Win.state.settings.autoHide;
    Win.wm.relayout();
  });

  window.addEventListener('beforeunload', () => Win.Store.save());
})(window.Win);
