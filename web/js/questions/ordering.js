/* Ordering: put shuffled steps back into the order given in the JSON.
   Moved with the arrow buttons or the keyboard, so it works without dragging. */

import { esc } from '../core/dom.js';
import { rich } from '../core/render.js';
import { t } from '../core/i18n.js';

const UP = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round"><polyline points="18 15 12 9 6 15"/></svg>`;
const DOWN = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;

function shuffledIndices(count) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // A shuffle that returns the original order gives the answer away.
  if (count > 1 && order.every((value, index) => value === index)) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

const ordering = {
  type: 'ordering',

  autoSubmit() { return false; },

  initialResponse(question) {
    return shuffledIndices((question.items || []).length);
  },

  render(question, state) {
    const items = question.items || [];
    const order = state.response || [];
    const rows = order.map((itemIndex, position) => {
      const correct = state.answered && itemIndex === position;
      const classes = ['order-item'];
      if (state.answered) classes.push(correct ? 'correct' : 'wrong');
      return `
        <div class="${classes.join(' ')}">
          <span class="order-index">${position + 1}</span>
          <span class="order-body">${rich(items[itemIndex])}</span>
          ${state.answered ? '' : `
            <span class="order-move">
              <button data-move="up" data-pos="${position}"
                      ${position === 0 ? 'disabled' : ''}>${UP}</button>
              <button data-move="down" data-pos="${position}"
                      ${position === order.length - 1 ? 'disabled' : ''}>${DOWN}</button>
            </span>`}
        </div>`;
    }).join('');

    const answerList = state.answered && !ordering.grade(question, order)
      ? `<div class="mt16 sub small">${esc(t('correct_answer'))}:
           <ol style="margin-top:6px;padding-left:1.3em">${
             items.map((item) => `<li>${rich(item)}</li>`).join('')}</ol></div>`
      : '';

    return `
      <div class="q-prompt">${rich(question.prompt)}</div>
      <div class="sub small mb16">${esc(t('reorder_hint'))}</div>
      <div class="order-list">${rows}</div>
      ${answerList}`;
  },

  mount(root, question, state, ctx) {
    if (state.answered) return;
    root.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const position = Number(button.dataset.pos);
        const target = button.dataset.move === 'up' ? position - 1 : position + 1;
        const order = [...(state.response || [])];
        if (target < 0 || target >= order.length) return;
        [order[position], order[target]] = [order[target], order[position]];
        ctx.setResponse(order);
      });
    });
  },

  canSubmit() { return true; },

  grade(question, response) {
    return (response || []).every((itemIndex, position) => itemIndex === position);
  },

  summary(question, response) {
    const items = question.items || [];
    return {
      given: (response || []).map((i) => items[i]).join(' → '),
      correct: items.join(' → '),
    };
  },
};

export default ordering;
