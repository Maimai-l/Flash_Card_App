/* The review session.

   One card at a time: front, then back, then a rating. The four buttons are the
   only judgement in the app: a flashcard has no machine-checkable answer, so
   you grade it. Quizzes, which do have answers, grade themselves elsewhere.

   Keyboard first: Space reveals, 1 to 4 rate, E edits the card in place, Z undoes
   the last rating, Esc leaves. Leaving mid-session loses nothing: every answer
   was already written when you pressed the key. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, setKeys, typingInInput, showModal, closeModal } from '../core/dom.js';
import { flashcardHtml, setFlipped } from './flashcard.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';
import { copyForAI } from '../core/aicopy.js';

const RATINGS = [
  { value: 1, key: 'again' },
  { value: 2, key: 'hard' },
  { value: 3, key: 'good' },
  { value: 4, key: 'easy' },
];

export async function renderReview() {
  if (!S.session) {
    const queue = await api.get_queue(S.deck);
    if (queue.error) {
      $content().innerHTML = shell(`<div class="empty">${esc(queue.error)}</div>`);
      return;
    }
    S.session = {
      queue: queue.cards,
      current: null,
      revealed: false,
      hintShown: false,
      answers: 0,
      seen: new Set(),
      counts: { 1: 0, 2: 0, 3: 0, 4: 0 },
      // card_id -> the card as last rated Again or Hard, kept so the summary
      // can hand exactly these to an AI
      struggles: new Map(),
      extra: false,
    };
    nextCard();
  }
  paint();
}

function nextCard() {
  const session = S.session;
  session.current = session.queue.shift() || null;
  session.revealed = false;
  session.hintShown = false;
}

function progress() {
  const session = S.session;
  const remaining = session.queue.length + (session.current ? 1 : 0);
  return { done: session.answers, total: session.answers + remaining };
}

function shell(inner, { counter = '', foot = null, controls = '', percent = null } = {}) {
  const deckLabel = S.deck ? S.deck.split('::').pop() : t('all_decks');
  return `
    <div class="study">
      <div class="study-top">
        <button class="btn btn-secondary btn-sm" data-action="exitSession">${esc(t('exit_session'))}</button>
        <span class="title">${esc(deckLabel)}</span>
        <span class="counter">${esc(counter)}</span>
        ${controls}
      </div>
      ${percent === null ? '' : `
        <div class="quiz-progress"><span style="width:${percent}%"></span></div>`}
      <div class="study-body"><div class="study-inner">${inner}</div></div>
      ${foot === null ? '' : `<div class="study-foot" id="study-foot">${foot}</div>`}
    </div>`;
}

/* Undo and Edit sit in the top bar with their keys printed on them, rather than
   in a line of legend under the card. The shortcut belongs on the control. */
function controlsHtml() {
  return `
    <button class="btn btn-secondary btn-sm" data-action="undo">${
      esc(t('undo'))}<span class="kbd">Z</span></button>
    <button class="btn btn-secondary btn-sm" data-action="editCard">${
      esc(t('edit'))}<span class="kbd">E</span></button>`;
}

function paint() {
  const session = S.session;
  if (!session.current) return paintSummary();

  const card = session.current;
  const { done, total } = progress();

  $content().innerHTML = shell(
    flashcardHtml(card, { flipped: session.revealed, hintShown: session.hintShown }),
    { counter: `${done} / ${total}`, foot: footHtml(), controls: controlsHtml(),
      percent: Math.round(100 * done / Math.max(1, total)) },
  );
  setKeys(onKey);
}

/** The footer swaps between reveal and rate; the card above it stays put. */
function footHtml() {
  const session = S.session;
  const card = session.current;
  if (!session.revealed) {
    return `
      <button class="btn btn-primary btn-lg" data-action="reveal">${esc(t('show_answer'))}</button>
      <span class="kbd">Space</span>`;
  }
  return `
    <div class="rating-row">
      ${RATINGS.map(({ value, key }) => `
        <button class="rating-btn" data-action="rate" data-rating="${value}">
          <span class="label">${esc(t(key))}</span>
          <span class="interval">${esc((card.intervals || {})[value] || '')}</span>
        </button>`).join('')}
    </div>`;
}

function paintFoot() {
  const foot = document.getElementById('study-foot');
  if (foot) foot.innerHTML = footHtml();
}

function paintSummary() {
  const session = S.session;
  const counts = RATINGS
    .filter(({ value }) => session.counts[value] > 0)
    .map(({ value, key }) => `
      <span class="count-chip"><span class="k">${esc(t(key))}</span
        ><span class="v">${session.counts[value]}</span></span>`).join('');

  $content().innerHTML = shell(`
    <div class="session-done">
      <span class="title">${esc(t('session_done'))}</span>
      <span class="summary">${esc(t('session_summary', {
        cards: session.seen.size, answers: session.answers,
      }))}</span>
      ${counts ? `<div class="session-counts">${counts}</div>` : ''}
      <div class="actions">
        <button class="btn btn-primary" data-action="exitSession">${esc(t('done'))}</button>
        <button class="btn btn-secondary" data-action="studyMore">${esc(t('study_more'))}</button>
        ${session.struggles.size ? `
          <button class="btn btn-secondary" data-action="copyStruggles">${esc(t('copy_struggles'))}</button>` : ''}
      </div>
      <span class="note">${esc(t('study_more_note'))}</span>
    </div>`);

  setKeys((event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      actions.exitSession();
    }
  });
}

function onKey(event) {
  if (typingInInput(event)) return;
  const session = S.session;
  if (!session || !session.current) return;

  if (event.key === 'Escape') { event.preventDefault(); return actions.exitSession(); }
  if (event.key.toLowerCase() === 'z') { event.preventDefault(); return actions.undo(); }
  if (event.key.toLowerCase() === 'e') { event.preventDefault(); return actions.editCard(); }
  if (event.key.toLowerCase() === 'h' && !session.revealed && session.current.hint) {
    event.preventDefault();
    return actions.showHint();
  }
  if (!session.revealed) {
    if (event.key === ' ' || event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      actions.reveal();
    }
    return;
  }
  if (['1', '2', '3', '4'].includes(event.key)) {
    event.preventDefault();
    rate(Number(event.key));
  }
}

async function rate(rating) {
  const session = S.session;
  const card = session.current;
  if (!card || !session.revealed) return;

  session.revealed = false;  // guard against a double keypress
  const result = await api.answer_card(card.card_id, rating);
  if (result.error) {
    session.revealed = true;
    return showToast(result.error, 3200);
  }

  session.answers += 1;
  session.counts[rating] += 1;
  session.seen.add(card.card_id);
  if (rating <= 2) {
    session.struggles.set(card.card_id, {
      id: card.ext_id || null,
      deck: (S.decks.find((d) => d.deck_id === card.deck_id) || {}).path || '',
      front: card.front,
      back: card.back,
      hint: card.hint || '',
      lapses: card.lapses,
      rated: rating === 1 ? 'again' : 'hard',
    });
  }
  if (result.requeue && result.card) session.queue.push(result.card);

  nextCard();
  paint();
}

export const actions = {
  reveal: () => {
    if (!S.session || !S.session.current || S.session.revealed) return;
    S.session.revealed = true;
    setFlipped(true);   // turn the card in place; a re-render would skip the animation
    paintFoot();
    setKeys(onKey);
  },

  showHint: () => {
    if (!S.session) return;
    S.session.hintShown = true;
    paint();
  },

  rate: (el) => rate(Number(el.dataset.rating)),

  copyStruggles: () => {
    const session = S.session;
    if (!session || !session.struggles.size) return;
    const cards = [...session.struggles.values()];
    copyForAI(t('ai_struggles_intro', { n: cards.length }), {
      kc_export: 1,
      kind: 'struggles',
      deck: S.deck || '',
      cards,
    });
  },

  exitSession: () => {
    S.session = null;
    navigate('home');
  },

  studyMore: async () => {
    const queue = await api.get_queue(S.deck, true);
    if (queue.error) return showToast(queue.error, 3200);
    if (!queue.cards.length) return showToast(t('nothing_due'));
    S.session.queue = queue.cards;
    S.session.extra = true;
    nextCard();
    paint();
  },

  undo: async () => {
    const result = await api.undo_review();
    if (!result.ok) return showToast(t('undo_nothing'));
    const session = S.session;
    if (session.current) session.queue.unshift(session.current);
    session.current = result.card;
    session.revealed = false;
    session.hintShown = false;
    session.answers = Math.max(0, session.answers - 1);
    session.struggles.delete(result.card.card_id);
    showToast(t('undone'), 1400);
    paint();
  },

  editCard: () => {
    const card = S.session && S.session.current;
    if (!card) return;
    showModal(`
      <h2>${esc(t('edit_card'))}</h2>
      <div class="field">
        <label class="field-label">${esc(t('front'))}</label>
        <textarea class="textarea" id="edit-front" style="min-height:70px">${esc(card.front)}</textarea>
      </div>
      <div class="field">
        <label class="field-label">${esc(t('back'))}</label>
        <textarea class="textarea" id="edit-back">${esc(card.back)}</textarea>
      </div>
      <div class="field">
        <label class="field-label">${esc(t('hint_field'))}</label>
        <input class="input" id="edit-hint" value="${attr(card.hint || '')}">
      </div>
      <div class="field">
        <label class="field-label">${esc(t('tags'))}</label>
        <input class="input" id="edit-tags" value="${attr((card.tags || []).join(', '))}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
        <button class="btn btn-primary btn-sm" data-action="saveEditedCard">${esc(t('save'))}</button>
      </div>`, { wide: true });
  },

  saveEditedCard: async () => {
    const card = S.session && S.session.current;
    if (!card) return closeModal();
    const payload = {
      front: document.getElementById('edit-front').value,
      back: document.getElementById('edit-back').value,
      hint: document.getElementById('edit-hint').value,
      tags: document.getElementById('edit-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
    };
    if (!payload.front.trim() || !payload.back.trim()) {
      return showToast(t('front_back_required'), 3000);
    }
    const result = await api.update_card(card.card_id, payload);
    if (result.error) return showToast(result.error, 3200);
    Object.assign(card, {
      front: payload.front.trim(),
      back: payload.back.trim(),
      hint: payload.hint.trim(),
      tags: payload.tags,
    });
    closeModal();
    showToast(t('card_saved'), 1400);
    paint();
  },
};
