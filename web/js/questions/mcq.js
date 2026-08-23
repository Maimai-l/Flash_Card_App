/* Multiple choice. Options and the answer key come from the imported JSON;
   the app never invents distractors. A single-answer question submits on click;
   a multi-answer one toggles and waits for Check. */

import { esc } from '../core/dom.js';
import { rich } from '../core/render.js';
import { OPTION_KEYS } from './util.js';

function answerIndices(question) {
  const answer = question.answer;
  return (Array.isArray(answer) ? answer : [answer]).map(Number).filter((n) => !Number.isNaN(n));
}

const mcq = {
  type: 'mcq',

  isMulti(question) {
    return Array.isArray(question.answer) && question.answer.length > 1;
  },

  autoSubmit(question) {
    return !mcq.isMulti(question);
  },

  initialResponse() {
    return [];
  },

  render(question, state) {
    const correct = answerIndices(question);
    const chosen = state.response || [];
    const options = (question.options || []).map((option, index) => {
      const isChosen = chosen.includes(index);
      const classes = ['opt'];
      let mark = '';
      if (state.answered) {
        classes.push('locked');
        if (correct.includes(index)) { classes.push('correct'); mark = '✓'; }
        else if (isChosen) { classes.push('wrong'); mark = '✗'; }
        else classes.push('dim');
      } else if (isChosen) {
        classes.push('selected');
      }
      return `
        <button class="${classes.join(' ')}" data-option="${index}"
                ${state.answered ? 'disabled' : ''}>
          <span class="opt-key">${esc(OPTION_KEYS[index] || '')}</span>
          <span class="opt-body">${rich(option)}</span>
          <span class="opt-mark">${mark}</span>
        </button>`;
    }).join('');

    return `<div class="opt-list">${options}</div>`;
  },

  mount(root, question, state, ctx) {
    if (state.answered) return;
    root.querySelectorAll('[data-option]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.option);
        if (mcq.isMulti(question)) {
          const chosen = new Set(state.response || []);
          if (chosen.has(index)) chosen.delete(index); else chosen.add(index);
          ctx.setResponse([...chosen].sort((a, b) => a - b));
        } else {
          ctx.setResponse([index]);
          ctx.submit();
        }
      });
    });
  },

  onKey(event, question, state, ctx) {
    if (state.answered) return false;
    const index = OPTION_KEYS.indexOf(event.key);
    if (index === -1 || index >= (question.options || []).length) return false;
    if (mcq.isMulti(question)) {
      const chosen = new Set(state.response || []);
      if (chosen.has(index)) chosen.delete(index); else chosen.add(index);
      ctx.setResponse([...chosen].sort((a, b) => a - b));
    } else {
      ctx.setResponse([index]);
      ctx.submit();
    }
    return true;
  },

  canSubmit(question, state) {
    return (state.response || []).length > 0;
  },

  grade(question, response) {
    const correct = answerIndices(question).sort((a, b) => a - b);
    const given = [...(response || [])].sort((a, b) => a - b);
    return correct.length === given.length && correct.every((v, i) => v === given[i]);
  },

  summary(question, response) {
    const label = (index) => (question.options || [])[index];
    return {
      given: (response || []).map(label).filter(Boolean).join(' · '),
      correct: answerIndices(question).map(label).filter(Boolean).join(' · '),
    };
  },
};

export default mcq;
