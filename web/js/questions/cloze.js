/* Cloze deletion. The author decides what is hidden by wrapping it in {{…}};
   the app never picks blanks itself. Alternatives are separated by | and the
   first one is what gets shown as the answer. */

import { esc } from '../core/dom.js';
import { rich } from '../core/render.js';
import { matchesAny, parseCloze } from './util.js';

const cloze = {
  type: 'cloze',

  autoSubmit() { return false; },
  initialResponse() { return []; },

  render(question, state) {
    const parts = parseCloze(String(question.text || ''));
    const response = state.response || [];

    const body = parts.map((part) => {
      if (part.literal !== undefined) return rich(part.literal).replace(/^<p>|<\/p>$/g, '');
      const given = response[part.blank] || '';
      if (!state.answered) {
        const width = Math.max(90, Math.min(280, part.answers[0].length * 13));
        return `<input class="cloze-blank" data-blank="${part.blank}" autocomplete="off"
                       autocapitalize="off" spellcheck="false"
                       style="width:${width}px" value="${esc(given)}">`;
      }
      const ok = matchesAny(given, part.answers, question.match || 'loose');
      return `<span class="cloze-blank ${ok ? 'correct' : 'wrong'}"
                    style="min-width:0;display:inline">${esc(given || '—')}</span>${
        ok ? '' : `<span class="cloze-answer">${esc(part.answers[0])}</span>`}`;
    }).join('');

    return `
      ${question.prompt ? `<div class="q-prompt">${rich(question.prompt)}</div>` : ''}
      <div class="cloze-text">${body}</div>`;
  },

  mount(root, question, state, ctx) {
    if (state.answered) return;
    const inputs = [...root.querySelectorAll('[data-blank]')];
    inputs.forEach((input, position) => {
      input.addEventListener('input', () => {
        const response = [...(state.response || [])];
        response[Number(input.dataset.blank)] = input.value;
        ctx.setResponse(response, { silent: true });
      });
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        // Stop the event here: if it reached the window handler it would submit
        // and then immediately advance on the same keypress.
        event.preventDefault();
        event.stopPropagation();
        const next = inputs[position + 1];
        if (next && !next.value.trim()) next.focus(); else ctx.submit();
      });
    });
    if (inputs.length) inputs[0].focus();
  },

  canSubmit(question, state) {
    return (state.response || []).some((value) => String(value || '').trim());
  },

  grade(question, response) {
    const parts = parseCloze(String(question.text || '')).filter((p) => p.blank !== undefined);
    return parts.every((part) =>
      matchesAny((response || [])[part.blank] || '', part.answers, question.match || 'loose'));
  },

  summary(question, response) {
    const parts = parseCloze(String(question.text || '')).filter((p) => p.blank !== undefined);
    return {
      given: parts.map((p) => (response || [])[p.blank] || '—').join(' · '),
      correct: parts.map((p) => p.answers[0]).join(' · '),
    };
  },

  label(question) {
    return String(question.text || '').replace(/\{\{(.+?)\}\}/gs, '[…]');
  },
};

export default cloze;
