/* Import: paste JSON, see exactly what would happen, then commit.

   The same parser runs for the preview and the write, so what the preview
   promises is what you get. One bad entry is reported and skipped rather than
   sinking the whole paste. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { render } from '../core/router.js';

const SCHEMA_FOR_LLM = `Produce JSON for my flashcard app. Two independent shapes:

CARDS — persistent, scheduled by FSRS. Every card is front + back.
{
  "deck": "Mathematics::Linear Algebra",
  "cards": [
    {
      "front": "Define an eigenvector of A",
      "back": "A nonzero vector $v$ with $Av = \\\\lambda v$.",
      "hint": "think about direction",      // optional
      "tags": ["definition"],               // optional
      "id": "la.eigenvector.def",           // optional, stable: re-import updates
      "deck": "Mathematics::Other"          // optional, overrides the top-level deck
    }
  ]
}

QUIZ — a fixed set of questions, taken on demand, never scheduled.
{
  "quiz": {
    "name": "Linear Algebra — Ch.3",
    "subject": "Mathematics",
    "id": "la.ch3",                          // optional; re-import replaces this quiz
    "questions": [
      { "type": "mcq", "prompt": "Which is NOT a vector space axiom?",
        "options": ["Closure under addition", "A multiplicative inverse for every vector",
                    "Associativity", "Existence of a zero vector"],
        "answer": 1,                         // option index; use [0,2] for multi-answer
        "explain": "Vector spaces need additive inverses, not multiplicative." },

      { "type": "cloze", "text": "rank(A) + {{nullity(A)}} = {{n|dim V}}",
        "explain": "Rank-nullity theorem." },

      { "type": "short", "prompt": "Symbol for the eigenvalue?",
        "answers": ["lambda", "\\u03bb"], "match": "loose" },

      { "type": "ordering", "prompt": "Order the steps of Gaussian elimination",
        "items": ["Forward elimination", "Back substitution", "Read off the solution"] }
    ]
  }
}

Rules:
- Both shapes may appear in one object; "quizzes": [...] imports several quizzes.
- Cards and quizzes are unrelated. A quiz question never attaches to a card.
- Question types: mcq, cloze, short, ordering. Anything else is skipped.
- cloze marks its own blanks with {{...}}; alternatives are separated by |.
- Maths goes in $...$ (inline) or $$...$$ (display), TeX syntax.
- Markdown allowed in card text: **bold**, *italic*, \`code\`, - lists, 1. lists.`;

function state() {
  if (!S.importView) S.importView = { text: '', deck: '', preview: null, duplicates: false };
  return S.importView;
}

export async function renderImport() {
  const view = state();
  const decks = S.decks.map((d) => d.path);

  $content().innerHTML = `
    <div class="page">
      <div class="home-head">
        <h1>${esc(t('import_title'))}</h1>
        <span class="grow"></span>
        <button class="btn btn-secondary btn-sm" data-action="copySchema">${esc(t('copy_schema'))}</button>
      </div>

      <div class="field">
        <label class="field-label">${esc(t('paste_json'))}</label>
        <textarea class="textarea code" id="import-text" data-input="importText"
                  style="min-height:280px" spellcheck="false"
                  placeholder='{ "deck": "Mathematics", "cards": [ … ] }'>${esc(view.text)}</textarea>
      </div>

      <div class="row gap12 mb16" style="flex-wrap:wrap">
        <div class="field" style="margin:0;min-width:240px">
          <label class="field-label">${esc(t('target_deck'))}</label>
          <select class="select" id="import-deck" data-change="importDeck">
            <option value="">${esc(t('from_json'))}</option>
            ${decks.map((path) => `<option value="${attr(path)}" ${
              path === view.deck ? 'selected' : ''}>${esc(path)}</option>`).join('')}
          </select>
        </div>
        <span class="grow"></span>
        <button class="btn btn-secondary" data-action="previewImport">${esc(t('validate'))}</button>
      </div>

      <div id="import-result">${view.preview ? previewHtml(view.preview) : ''}</div>
    </div>`;
}

function previewHtml(preview) {
  const cards = preview.cards || { new: 0, updated: 0, duplicates: 0, decks: [] };
  const hasErrors = (preview.issues || []).some((issue) => issue.level === 'error');
  const importable = cards.new + cards.updated + (preview.quizzes || []).length > 0;

  return `
    <div class="card card-pad">
      <div class="preview-figures">
        <div class="preview-figure">
          <div class="value">${cards.new}</div>
          <div class="label">${esc(t('import_new'))}</div>
        </div>
        <div class="preview-figure">
          <div class="value">${cards.updated}</div>
          <div class="label">${esc(t('import_updated'))}</div>
        </div>
        ${cards.duplicates ? `
          <div class="preview-figure">
            <div class="value">${cards.duplicates}</div>
            <div class="label">${esc(t('import_duplicates'))}</div>
          </div>` : ''}
        ${(preview.quizzes || []).length ? `
          <div class="preview-figure">
            <div class="value">${preview.quizzes.length}</div>
            <div class="label">${esc(t('quizzes'))}</div>
          </div>` : ''}
      </div>

      ${(cards.decks || []).length ? `
        <div class="mt16 sub small">${cards.decks.map((d) =>
          `${esc(d.deck)} · ${d.count}`).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}</div>` : ''}

      ${(preview.quizzes || []).map((quiz) => `
        <div class="mt8 sub small">${esc(quiz.name)} — ${quiz.questions} ${esc(t('questions'))}
          <span class="badge ${quiz.action === 'replace' ? 'badge-orange' : 'badge-blue'}">${
            esc(quiz.action === 'replace' ? t('will_replace') : t('will_create'))}</span></div>`).join('')}

      ${(preview.issues || []).length ? `
        <div class="issue-list">
          ${preview.issues.map((issue) => `
            <div class="issue ${esc(issue.level)}">
              <span class="where">${esc(issue.where)}</span>
              <span>${esc(issue.message)}</span>
            </div>`).join('')}
        </div>` : ''}

      <div class="row gap12 mt24" style="justify-content:flex-end">
        ${cards.duplicates ? `
          <label class="row gap8 sub small" style="cursor:pointer">
            <input type="checkbox" data-change="toggleDuplicates" ${
              state().duplicates ? 'checked' : ''}>
            ${esc(t('allow_duplicates'))}
          </label>` : ''}
        <button class="btn btn-primary" data-action="commitImport"
                ${importable || (cards.duplicates && state().duplicates) ? '' : 'disabled'}>
          ${esc(t('import_now'))}
        </button>
      </div>
      ${hasErrors ? '' : ''}
    </div>`;
}

export const actions = {
  importText: (el) => { state().text = el.value; },
  importDeck: (el) => { state().deck = el.value; },
  toggleDuplicates: (el) => { state().duplicates = el.checked; },

  copySchema: async () => {
    try {
      await navigator.clipboard.writeText(SCHEMA_FOR_LLM);
      showToast(t('schema_copied'), 2400);
    } catch (err) {
      const box = document.getElementById('import-text');
      box.value = SCHEMA_FOR_LLM;
      state().text = SCHEMA_FOR_LLM;
      box.select();
      showToast(t('schema_copied'), 2400);
    }
  },

  previewImport: async () => {
    const view = state();
    if (!view.text.trim()) return showToast(t('import_empty'));
    const preview = await api.import_preview(view.text, view.deck);
    if (preview.error) return showToast(preview.error, 3600);
    view.preview = preview;
    document.getElementById('import-result').innerHTML = previewHtml(preview);
  },

  commitImport: async () => {
    const view = state();
    const result = await api.import_commit(view.text, view.deck, view.duplicates);
    if (result.error) return showToast(result.error, 3600);
    showToast(t('import_done', { new: result.cards.new, updated: result.cards.updated }), 3000);
    view.text = '';
    view.preview = null;
    view.duplicates = false;
    await render();
  },
};
