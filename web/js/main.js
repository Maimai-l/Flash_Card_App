/* Boot: load settings and decks, register routes and actions, render. */

import { S } from './core/state.js';
import { api } from './core/api.js';
import { registerActions, bindDelegation, bindKeyboard, $content, esc } from './core/dom.js';
import { registerRoutes, render, actions as routerActions } from './core/router.js';

import { renderHome, actions as homeActions } from './views/home.js';
import { renderReview, actions as reviewActions } from './views/review.js';
import { renderBrowse, actions as browseActions } from './views/browse.js';
import { renderQuizList, actions as quizActions } from './views/quiz.js';
import { renderQuizRun, actions as quizRunActions } from './views/quizrun.js';
import { renderCards, actions as cardsActions } from './views/cards.js';
import { renderImport, actions as importActions } from './views/import.js';
import { renderStats, actions as statsActions } from './views/stats.js';
import { renderSettings, actions as settingsActions } from './views/settings.js';
import { actions as sidebarActions } from './views/sidebar.js';

registerRoutes({
  home:     { view: renderHome,      chrome: 'app',  sidebar: true },
  cards:    { view: renderCards,     chrome: 'app',  sidebar: true },
  quiz:     { view: renderQuizList,  chrome: 'app' },
  import:   { view: renderImport,    chrome: 'app' },
  stats:    { view: renderStats,     chrome: 'app' },
  settings: { view: renderSettings,  chrome: 'app' },
  review:   { view: renderReview,    chrome: 'full' },
  browse:   { view: renderBrowse,    chrome: 'full' },
  quizrun:  { view: renderQuizRun,   chrome: 'full' },
});

registerActions({
  ...routerActions,
  ...sidebarActions,
  ...homeActions,
  ...reviewActions,
  ...browseActions,
  ...quizActions,
  ...quizRunActions,
  ...cardsActions,
  ...importActions,
  ...statsActions,
  ...settingsActions,
});

bindDelegation(document);
bindKeyboard();

async function boot() {
  const bootstrap = await api.get_bootstrap();
  if (bootstrap.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(bootstrap.error)}</div></div>`;
    return;
  }
  S.settings = bootstrap.settings || {};
  S.decks = bootstrap.decks || [];
  S.version = bootstrap.version || '';
  if (S.settings.language && !localStorage.getItem('kc.prefs')) {
    S.lang = S.settings.language;
  }
  if (S.deck && !S.decks.some((deck) => deck.path === S.deck)) S.deck = '';
  await render();
}

boot();
