/* Routing: which view owns the content area, and whether the app chrome
   (top bar + deck sidebar) is visible. Study screens take the whole window. */

import { S, savePrefs } from './state.js';
import { $content, clearKeys, loading, closeModal } from './dom.js';
import { t } from './i18n.js';

const routes = {};

export function registerRoutes(map) {
  Object.assign(routes, map);
}

export const NAV_PAGES = ['home', 'quiz', 'cards', 'import', 'stats', 'settings'];

export async function navigate(page, params = {}) {
  Object.assign(S, params);
  S.page = page;
  closeModal();
  savePrefs();
  window.scrollTo(0, 0);
  await render();
}

export async function render({ silent = false } = {}) {
  const route = routes[S.page] || routes.home;
  clearKeys();
  document.getElementById('topbar').hidden = route.chrome === 'full';
  document.getElementById('sidebar').hidden = route.chrome !== 'app' || !route.sidebar;
  $content().classList.toggle('full', route.chrome === 'full');
  renderNav();
  if (!silent) loading();
  await route.view();
}

function renderNav() {
  document.getElementById('brand').textContent = t('app');
  document.getElementById('nav').innerHTML = NAV_PAGES.map((page) => `
    <button class="nav-link ${S.page === page ? 'active' : ''}"
            data-action="navigate" data-page="${page}">${t(`nav_${page}`)}</button>`).join('');
}

export const actions = {
  navigate: (el) => navigate(el.dataset.page),
};
