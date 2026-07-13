/* ════════════════════════════════════════════════════════════════════════
   Router — navigate / goBack / render + route registry
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from './state.js';
import { loading } from './dom.js';
import { showToast } from './ui.js';
import { saveSession } from './session_store.js';
import { _detachFcKeyboard } from '../views/session.js';

// Route registry — populated by main.js via registerRoutes() to avoid
// circular imports between the router and the view modules.
const _routes = {};
export function registerRoutes(map) { Object.assign(_routes, map); }

export function navigate(page, params = {}) {
  S.history.push(S.page);
  Object.assign(S, params);
  S.page = page;
  render();
}

export function goBack() {
  if (!S.history.length) return;
  if (S.page === 'session' && store.PS) { saveSession(); _detachFcKeyboard(); }
  S.page = S.history.pop();
  store.PS = null;
  render();
}

export function _debugBtnHtml() {
  return `<button class="icon-btn ${S.debug ? 'debug-active' : ''}"
    data-action="toggleDebug" title="Toggle Debug Mode" style="font-size:13px;padding:4px 8px">
    🐛
  </button>`;
}

export function toggleDebug() {
  S.debug = !S.debug;
  showToast(S.debug ? 'Debug mode ON' : 'Debug mode OFF', 1500);
  render();
}

export async function render() {
  loading();
  const fn = _routes[S.page] || _routes.home;
  await fn();
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  navigate: (el) => navigate(el.dataset.page),
  goBack:   () => goBack(),
  toggleDebug: () => toggleDebug(),
};
