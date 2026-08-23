/* Routing: which view owns the content area, and whether the app chrome
   (top bar + deck sidebar) is visible. Study screens take the whole window.

   The sidebar is part of the chrome, not of any one page. It used to appear
   only beside Home and Cards, which moved every heading 94px sideways as you
   navigated; a persistent left column is what stops the layout jumping. */

import { S, savePrefs } from './state.js';
import { $content, clearKeys, loading, closeModal } from './dom.js';
import { t } from './i18n.js';

const routes = {};
let renderChrome = null;

export function registerRoutes(map) {
  Object.assign(routes, map);
}

/**
 * Register how the persistent chrome (the deck sidebar) refreshes itself.
 * Registered from main.js rather than imported here, so the router and the
 * sidebar do not import each other.
 */
export function registerChrome(fn) {
  renderChrome = fn;
}

export const NAV_PAGES = ['home', 'quiz', 'cards', 'import', 'stats', 'settings'];

export async function navigate(page, params = {}) {
  Object.assign(S, params);
  S.page = page;
  closeModal();
  savePrefs();
  $content().scrollTop = 0;   // the pane scrolls, not the document
  await render();
}

export async function render({ silent = false } = {}) {
  const route = routes[S.page] || routes.home;
  const full = route.chrome === 'full';
  clearKeys();
  // The CJK rules in base.css key off this, and so does the browser's own
  // line-breaking, which differs between the two languages.
  document.documentElement.dataset.lang = S.lang;
  document.documentElement.lang = S.lang === 'zh' ? 'zh-Hans' : 'en';
  document.getElementById('topbar').hidden = full;
  document.getElementById('sidebar').hidden = route.chrome !== 'app';
  document.getElementById('body').classList.toggle('full', full);
  $content().classList.toggle('full', full);
  renderNav();
  if (!silent) loading();
  if (route.chrome === 'app' && renderChrome) await renderChrome();
  await route.view();
}

function renderNav() {
  document.getElementById('brand').textContent = t('app');
  document.getElementById('nav').innerHTML = NAV_PAGES.map((page) => `
    <button class="nav-link ${S.page === page ? 'active' : ''}"
            data-action="navigate" data-page="${page}">${t(`nav_${page}`)}</button>`).join('');
}

/** Does the current page act on the selected deck? */
export function currentPageIsDeckScoped() {
  const route = routes[S.page];
  return Boolean(route && route.deckScoped);
}

export const actions = {
  navigate: (el) => navigate(el.dataset.page),
};
