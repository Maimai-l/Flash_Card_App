/* The review session.

   One card at a time: front, then back, then a rating. The four buttons are the
   only judgement in the app — a flashcard has no machine-checkable answer, so
   you grade it. Quizzes, which do have answers, grade themselves elsewhere.

   Keyboard first: Space reveals, 1–4 rate, E edits the card in place, Z undoes
   the last rating, Esc leaves. Leaving mid-session loses nothing: every answer
   was already written when you pressed the key. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, setKeys, typingInInput, showModal, closeModal } from '../core/dom.js';
import { richBlock } from '../core/render.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';

const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

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

function shell(inner, { counter = '', foot = '' } = {}) {
  const deckLabel = S.deck ? S.deck.split('::').pop() : t('all_decks');
  return `
    <div class="study">
      <div class="study-top">
        <button class="icon-btn" data-action="exitSession"
                title="${attr(t('exit_session'))}">${CLOSE_ICON}</button>
        <span class="title">${esc(deckLabel)}</span>
        <span class="counter">${esc(counter)}</span>
      </div>
      <div class="study-body"><div class="study-inner">${inner}</div></div>
      ${foot ? `<div class="study-foot"><div class="study-foot-inner">${foot}</div></div>` : ''}
    </div>`;
}

function paint() {
  const session = S.session;
  if (!session.current) return paintSummary();

  const card = session.current;
  const { done, total } = progress();
  const counter = `${done} / ${total}`;

  const face = session.revealed
    ? `
      <div class="card-face">
        ${richBlock(card.front, 'card-front')}
        <div class="card-divider"></div>
        <div class="card-back-wrap">${richBlock(card.back, 'card-back')}</div>
        ${card.tags.length ? `<div class="card-tags">${
          card.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>` : ''}
      </div>`
    : `
      <div class="card-face">
        ${richBlock(card.front, 'card-front')}
        ${card.hint ? (session.hintShown
          ? `<div class="card-hint">${esc(card.hint)}</div>`
          : `<div class="mt24"><button class="btn-text" data-action="showHint">${esc(t('hint'))}</button></div>`
        ) : ''}
      </div>`;

  const foot = session.revealed
    ? `
      <div class="rating-row">
        ${RATINGS.map(({ value, key }) => `
          <button class="rating-btn" data-action="rate" data-rating="${value}" data-rating-key>
            <span class="label">${esc(t(key))}</span>
            <span class="interval">${esc((card.intervals || {})[value] || '')}</span>
          </button>`).join('')}
      </div>
      <div class="hint-line">
        <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> <kbd>4</kbd> ${esc(t('keys_rate'))}
        &nbsp;·&nbsp; <kbd>E</kbd> ${esc(t('key_edit'))}
        &nbsp;·&nbsp; <kbd>Z</kbd> ${esc(t('key_undo'))}
      </div>`
    : `
      <div class="reveal-row">
        <button class="btn btn-primary" data-action="reveal">${esc(t('show_answer'))}</button>
      </div>
      <div class="hint-line"><kbd>Space</kbd></div>`;

  $content().innerHTML = shell(face, { counter, foot });
  setKeys(onKey);
}

function paintSummary() {
  const session = S.session;
  const breakdown = RATINGS
    .filter(({ value }) => session.counts[value] > 0)
    .map(({ value, key }) => `
      <div class="bar-row">
        <span class="bar-label">${esc(t(key))}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${
          Math.round(100 * session.counts[value] / Math.max(1, session.answers))}%"></span></span>
        <span class="bar-value">${session.counts[value]}</span>
      </div>`).join('');

  $content().innerHTML = shell(`
    <div class="result-hero">
      <div class="result-score">${session.seen.size}</div>
      <div class="result-sub">${esc(t('session_summary', {
        cards: session.seen.size, answers: session.answers,
      }))}</div>
    </div>
    ${breakdown ? `<div class="card card-pad mb16">${breakdown}</div>` : ''}
    <div class="center sub small mb16">${esc(t('caught_up'))}</div>
    <div class="due-actions">
      <button class="btn btn-primary" data-action="exitSession">${esc(t('done'))}</button>
      <button class="btn btn-secondary" data-action="studyMore">${esc(t('study_more'))}</button>
    </div>
    <div class="center faint small mt16">${esc(t('study_more_note'))}</div>`,
  { counter: `${t('session_done')}` });

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
  if (result.requeue && result.card) session.queue.push(result.card);

  nextCard();
  paint();
}

export const actions = {
  reveal: () => {
    if (!S.session || !S.session.current) return;
    S.session.revealed = true;
    paint();
  },

  showHint: () => {
    if (!S.session) return;
    S.session.hintShown = true;
    paint();
  },

  rate: (el) => rate(Number(el.dataset.rating)),

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
