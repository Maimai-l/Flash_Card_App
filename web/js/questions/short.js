/* Short answer, graded against the list of accepted answers in the JSON. */

import { esc } from '../core/dom.js';
import { rich } from '../core/render.js';
import { t } from '../core/i18n.js';
import { matchesAny } from './util.js';

const short = {
  type: 'short',

  autoSubmit() { return false; },
  initialResponse() { return ''; },

  render(question, state) {
    const given = state.response || '';
    const accepted = (question.answers || []).filter(Boolean);
    const ok = state.answered && matchesAny(given, accepted, question.match || 'loose');

    return `
      <div class="q-prompt">${rich(question.prompt)}</div>
      ${state.answered ? `
        <div class="opt ${ok ? 'correct' : 'wrong'} locked">
          <span class="opt-body">${esc(given || '—')}</span>
          <span class="opt-mark">${ok ? '✓' : '✗'}</span>
        </div>
        ${ok ? '' : `<div class="mt8 sub small">${esc(t('correct_answer'))}: <b
          style="color:var(--text);font-weight:500">${esc(accepted[0] || '')}</b></div>`}
      ` : `
        <input class="input" id="short-input" autocomplete="off" spellcheck="false"
               placeholder="${esc(t('type_answer'))}" value="${esc(given)}">`}`;
  },

  mount(root, question, state, ctx) {
    if (state.answered) return;
    const input = root.querySelector('#short-input');
    if (!input) return;
    input.focus();
    input.addEventListener('input', () => ctx.setResponse(input.value, { silent: true }));
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      // Stop the event here: if it reached the window handler it would submit
      // and then immediately advance on the same keypress.
      event.preventDefault();
      event.stopPropagation();
      ctx.submit();
    });
  },

  canSubmit(question, state) {
    return String(state.response || '').trim().length > 0;
  },

  grade(question, response) {
    return matchesAny(response, (question.answers || []).filter(Boolean), question.match || 'loose');
  },

  summary(question, response) {
    return {
      given: String(response || '—'),
      correct: (question.answers || [])[0] || '',
    };
  },
};

export default short;
