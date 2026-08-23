/* The card itself: a real surface that turns over, shared by Review and Browse.

   Both faces are always in the DOM, stacked in one grid cell, so the card keeps
   a single height and the flip has something to turn to. Revealing toggles a
   class rather than re-rendering, which is what makes the turn animate. */

import { esc } from '../core/dom.js';
import { richBlock } from '../core/render.js';
import { t } from '../core/i18n.js';

function head(card) {
  const tags = (card.tags || []).map((tag) => '#' + tag).join('  ');
  return `
    <div class="face-head">
      <span class="chip ${card.is_new ? 'chip-new' : 'chip-review'}">${
        esc(t(card.is_new ? 'state_new' : 'state_review'))}</span>
      <span class="card-tags">${esc(tags)}</span>
    </div>`;
}

export function flashcardHtml(card, { flipped = false, hintShown = false } = {}) {
  const hint = card.hint
    ? (hintShown
      ? `<span class="card-hint">${esc(card.hint)}</span>`
      : `<button class="btn btn-quiet btn-sm" data-action="showHint">${
          esc(t('hint'))}<span class="kbd">H</span></button>`)
    : '';

  return `
    <div class="flashcard">
      <div class="flashcard-inner${flipped ? ' flipped' : ''}" id="flashcard-inner">
        <div class="flashcard-face">
          ${head(card)}
          <div class="face-body">${richBlock(card.front, 'card-front')}</div>
          <div class="face-foot">${hint}</div>
        </div>
        <div class="flashcard-face back">
          ${head(card)}
          <div class="face-body answer">
            <!-- The question stays in view: you cannot grade your recall
                 honestly against an answer whose prompt has turned away. -->
            <div class="face-echo">${richBlock(card.front)}</div>
            ${richBlock(card.back, 'card-back')}
          </div>
        </div>
      </div>
    </div>`;
}

/** Turn the card without rebuilding it, so the transition actually runs. */
export function setFlipped(flipped) {
  const inner = document.getElementById('flashcard-inner');
  if (inner) inner.classList.toggle('flipped', flipped);
}
