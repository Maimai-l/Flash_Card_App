/* Browse: read a deck front to back without scheduling anything.

   Nothing here writes to the review log, so reading through a subject the night
   before an exam cannot disturb what FSRS has planned. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, setKeys, typingInInput } from '../core/dom.js';
import { flashcardHtml, setFlipped } from './flashcard.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';

export async function renderBrowse() {
  if (!S.browse) {
    const result = await api.get_browse(S.deck, 500);
    S.browse = {
      cards: result.error ? [] : result.cards,
      index: 0,
      revealed: false,
      error: result.error || null,
    };
  }
  paint();
}

function paint() {
  const state = S.browse;
  const deckLabel = S.deck ? S.deck.split('::').pop() : t('all_decks');

  if (state.error || !state.cards.length) {
    $content().innerHTML = `
      <div class="study">
        <div class="study-top">
          <button class="btn btn-secondary btn-sm" data-action="exitBrowse">${esc(t('exit_session'))}</button>
          <span class="title">${esc(deckLabel)}</span>
        </div>
        <div class="study-body"><div class="study-inner">
          <div class="empty">${esc(state.error || t('browse_empty'))}</div>
        </div></div>
      </div>`;
    setKeys((event) => { if (event.key === 'Escape') actions.exitBrowse(); });
    return;
  }

  const card = state.cards[state.index];
  $content().innerHTML = `
    <div class="study">
      <div class="study-top">
        <button class="btn btn-secondary btn-sm" data-action="exitBrowse">${esc(t('exit_session'))}</button>
        <span class="title">${esc(deckLabel)}</span>
        <span class="counter">${state.index + 1} / ${state.cards.length}</span>
      </div>
      <div class="study-body"><div class="study-inner">
        ${flashcardHtml(card, { flipped: state.revealed, hintShown: true })}
      </div></div>
      <div class="study-foot">
        <button class="btn btn-secondary" data-action="browseStep" data-dir="-1"
                ${state.index === 0 ? 'disabled' : ''}>${esc(t('prev'))}</button>
        <button class="btn btn-primary" data-action="browseToggle">
          ${esc(state.revealed ? t('front') : t('show_answer'))}
        </button>
        <button class="btn btn-secondary" data-action="browseStep" data-dir="1"
                ${state.index >= state.cards.length - 1 ? 'disabled' : ''}>${esc(t('next'))}</button>
      </div>
    </div>`;

  setKeys(onKey);
}

function onKey(event) {
  if (typingInInput(event)) return;
  if (event.key === 'Escape') { event.preventDefault(); return actions.exitBrowse(); }
  if (event.key === 'ArrowLeft') { event.preventDefault(); return step(-1); }
  if (event.key === 'ArrowRight') { event.preventDefault(); return step(1); }
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    toggle();
  }
}

function step(direction) {
  const state = S.browse;
  const next = state.index + direction;
  if (next < 0 || next >= state.cards.length) return;
  state.index = next;
  state.revealed = false;
  paint();
}

function toggle() {
  S.browse.revealed = !S.browse.revealed;
  setFlipped(S.browse.revealed);
  const button = document.querySelector('[data-action="browseToggle"]');
  if (button) button.textContent = S.browse.revealed ? t('front') : t('show_answer');
}

export const actions = {
  browseStep: (el) => step(Number(el.dataset.dir)),
  browseToggle: () => toggle(),
  exitBrowse: () => { S.browse = null; navigate('home'); },
};
