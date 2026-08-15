/* The card itself — a real surface that turns over, shared by Review and Browse.

   Both faces are always in the DOM, stacked in one grid cell, so the card keeps
   a single height and the flip has something to turn to. Revealing toggles a
   class rather than re-rendering, which is what makes the turn animate. */

import { esc } from '../core/dom.js';
import { richBlock } from '../core/render.js';
import { t } from '../core/i18n.js';

export function flashcardHtml(card, { flipped = false, hintShown = false } = {}) {
  const tags = (card.tags || []).length
    ? `<div class="card-tags">${card.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>`
    : '';

  const hint = card.hint
    ? (hintShown
      ? `<div class="card-hint">${esc(card.hint)}</div>`
      : `<button class="btn-text card-hint-btn" data-action="showHint">${esc(t('hint'))}</button>`)
    : '';

  return `
    <div class="flashcard">
      <div class="flashcard-inner${flipped ? ' flipped' : ''}" id="flashcard-inner">
        <div class="flashcard-face">
          <div class="face-label">${esc(t('front'))}</div>
          <div class="face-body">${richBlock(card.front, 'card-front')}</div>
          ${hint}
        </div>
        <div class="flashcard-face back">
          <div class="face-label">${esc(t('back'))}</div>
          <div class="face-body">
            <!-- The question stays in view: you cannot grade your recall
                 honestly against an answer whose prompt has turned away. -->
            <div class="face-echo">${richBlock(card.front)}</div>
            ${richBlock(card.back, 'card-back')}
          </div>
          ${tags}
        </div>
      </div>
    </div>`;
}

/** Turn the card without rebuilding it, so the transition actually runs. */
export function setFlipped(flipped) {
  const inner = document.getElementById('flashcard-inner');
  if (inner) inner.classList.toggle('flipped', flipped);
}
