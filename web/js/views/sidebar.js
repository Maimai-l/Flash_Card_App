/* The deck tree. Shown beside Home and Cards; it is the subject switcher for
   both. Counts are rolled up from each deck's subtree. */

import { S, savePrefs } from '../core/state.js';
import { api } from '../core/api.js';
import { esc, attr, showModal, closeModal, promptDialog, confirmDialog, showToast } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { render } from '../core/router.js';

const CHEVRON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
const PLUS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const DOTS = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;

function hasChildren(path) {
  return S.decks.some((d) => d.path.startsWith(path + '::'));
}

function isHidden(path) {
  const parts = path.split('::');
  for (let i = 1; i < parts.length; i++) {
    if (S.collapsed.has(parts.slice(0, i).join('::'))) return true;
  }
  return false;
}

export function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.hidden) return;

  const totals = S.decks
    .filter((d) => d.depth === 0)
    .reduce((acc, d) => ({
      due: acc.due + d.due_count,
      neu: acc.neu + d.new_count,
    }), { due: 0, neu: 0 });

  const rows = S.decks.filter((d) => !isHidden(d.path)).map((deck) => {
    const actionable = deck.due_count + deck.new_count;
    const children = hasChildren(deck.path);
    const collapsed = S.collapsed.has(deck.path);
    return `
      <div class="deck-item ${S.deck === deck.path ? 'active' : ''}"
           style="padding-left:${8 + deck.depth * 13}px"
           data-action="selectDeck" data-deck="${attr(deck.path)}">
        <span class="deck-twisty ${children ? (collapsed ? 'collapsed' : '') : 'leaf'}"
              ${children ? `data-action="toggleDeck" data-deck="${attr(deck.path)}"` : ''}>${CHEVRON}</span>
        <span class="deck-name">${esc(deck.name)}</span>
        ${actionable ? `<span class="deck-count">${actionable}</span>` : ''}
        <button class="deck-menu icon-btn" data-action="deckMenu"
                data-deck="${attr(deck.path)}" title="${attr(t('edit'))}">${DOTS}</button>
      </div>`;
  }).join('');

  sidebar.innerHTML = `
    <div class="section-label" style="padding:0 10px">
      <span class="grow">${esc(t('decks'))}</span>
      <button class="icon-btn" data-action="addDeck" title="${attr(t('add_deck'))}">${PLUS}</button>
    </div>
    <div class="deck-item ${S.deck === '' ? 'active' : ''}" data-action="selectDeck" data-deck="">
      <span class="deck-twisty leaf">${CHEVRON}</span>
      <span class="deck-name">${esc(t('all_decks'))}</span>
      ${totals.due + totals.neu ? `<span class="deck-count">${totals.due + totals.neu}</span>` : ''}
    </div>
    ${rows}`;
}

export async function refreshDecks() {
  const decks = await api.get_decks();
  S.decks = Array.isArray(decks) ? decks : [];
  if (S.deck && !S.decks.some((d) => d.path === S.deck)) S.deck = '';
}

export const actions = {
  selectDeck: async (el) => {
    S.deck = el.dataset.deck;
    savePrefs();
    await render();
  },

  toggleDeck: (el, event) => {
    event.stopPropagation();
    const path = el.dataset.deck;
    if (S.collapsed.has(path)) S.collapsed.delete(path); else S.collapsed.add(path);
    savePrefs();
    renderSidebar();
  },

  addDeck: async (el, event) => {
    event.stopPropagation();
    const name = await promptDialog({ title: t('add_deck'), label: t('deck_name_prompt') });
    if (!name) return;
    const result = await api.create_deck(name);
    if (result.error) return showToast(result.error, 3200);
    S.decks = result.decks;
    S.deck = name;
    savePrefs();
    await render();
  },

  deckMenu: (el, event) => {
    event.stopPropagation();
    const path = el.dataset.deck;
    const deck = S.decks.find((d) => d.path === path);
    if (!deck) return;
    showModal(`
      <h2>${esc(deck.name)}</h2>
      <p class="sub small">${esc(path)} · ${deck.total} ${esc(t(deck.total === 1 ? 'card' : 'cards'))}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
        <button class="btn btn-secondary btn-sm" data-action="renameDeck"
                data-deck="${attr(path)}">${esc(t('rename'))}</button>
        <button class="btn btn-danger btn-sm" data-action="deleteDeck"
                data-deck="${attr(path)}">${esc(t('delete'))}</button>
      </div>`);
  },

  renameDeck: async (el) => {
    const path = el.dataset.deck;
    const deck = S.decks.find((d) => d.path === path);
    closeModal();
    const name = await promptDialog({ title: t('rename'), value: deck ? deck.name : '' });
    if (!name) return;
    const result = await api.rename_deck(path, name);
    if (result.error) return showToast(result.error, 3200);
    S.decks = result.decks;
    if (S.deck === path) S.deck = '';
    savePrefs();
    await render();
  },

  deleteDeck: async (el) => {
    const path = el.dataset.deck;
    const deck = S.decks.find((d) => d.path === path);
    closeModal();
    const ok = await confirmDialog({
      title: t('delete'),
      body: t('delete_confirm', { n: deck ? deck.total : 0 }),
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;
    const result = await api.delete_deck(path);
    if (result.error) return showToast(result.error, 3200);
    S.decks = result.decks;
    if (S.deck === path || S.deck.startsWith(path + '::')) S.deck = '';
    savePrefs();
    await render();
  },
};
