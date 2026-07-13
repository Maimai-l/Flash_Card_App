/* ════════════════════════════════════════════════════════════════════════
   FlashCard App — PyWebView SPA (ES-module entry point)
   Boot + route registry + action registry + delegation init.
   ════════════════════════════════════════════════════════════════════════ */
import { registerActions, bindDelegation } from './core/dom.js';
import { render, registerRoutes, actions as routerActions } from './core/router.js';
import { actions as uiActions } from './core/ui.js';
import { renderHome,     actions as homeActions }     from './views/home.js';
import { renderSession,  actions as sessionActions }  from './views/session.js';
import { renderImport,   actions as importActions }   from './views/import.js';
import { renderSettings, actions as settingsActions } from './views/settings.js';
import { renderDebug,    actions as debugActions }    from './views/debug.js';

// Route registry — matches the original render() switch over S.page.
registerRoutes({
  home:     renderHome,
  session:  renderSession,
  import:   renderImport,
  settings: renderSettings,
  debug:    renderDebug,
});

// Merge every module's delegation adapters into one registry.
registerActions({
  ...routerActions,
  ...uiActions,
  ...homeActions,
  ...sessionActions,
  ...importActions,
  ...settingsActions,
  ...debugActions,
});

// One delegated listener covers the topbar (back/settings), page content, and
// the modal overlay — all of which live under document.
bindDelegation(document);

// ── Init ──────────────────────────────────────────────────────────────────
let _booted = false;
function _boot() {
  if (_booted) return;
  _booted = true;
  render();
}
window.addEventListener('pywebviewready', _boot);

// Fallback for browser-based dev / e2e: pywebview is never injected there, so
// boot once we're confident it isn't coming and drive the HTTP bridge instead.
if (typeof window.pywebview !== 'undefined') {
  _boot();
} else {
  setTimeout(() => {
    if (typeof window.pywebview === 'undefined') {
      console.warn('PyWebView not detected — booting via HTTP bridge (dev/e2e mode)');
      _boot();
    }
  }, 500);
}
