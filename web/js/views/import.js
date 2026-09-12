/* Import: paste JSON or pick a JSON file, see exactly what would happen, then
   commit.

   The same parser runs for the preview and the write, so what the preview
   promises is what you get. One bad entry is reported and skipped rather than
   sinking the whole paste. Input and result stack top to bottom: the result of
   validating appears under the box you typed into, full width, not off to the
   side. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, showModal } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { render } from '../core/router.js';

/* A quiz you have already imported and not edited is left alone, so the preview
   has a third thing to say beyond create and replace. */
const QUIZ_CHIP = { create: 'chip-new', replace: 'chip-learning', unchanged: 'chip-suspended' };
const QUIZ_LABEL = { create: 'will_create', replace: 'will_replace', unchanged: 'will_keep' };

/* Past this many decks the per-deck rows stop informing and start scrolling. */
const DECK_ROWS_SHOWN = 8;

function state() {
  if (!S.importView) S.importView = { text: '', deck: '', preview: null, duplicates: false };
  return S.importView;
}

export async function renderImport() {
  const view = state();
  const decks = S.decks.map((d) => d.path);

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="kicker">${esc(t('nav_import'))}</div>
        <h1>${esc(t('import_title'))}</h1>
      </div>

      <div class="card card-pad">
        <div class="import-deck-line">
          <label class="field-label">${esc(t('target_deck'))}</label>
          <select class="select" id="import-deck" data-change="importDeck">
            <option value="">${esc(t('from_json'))}</option>
            ${decks.map((path) => `<option value="${attr(path)}" ${
              path === view.deck ? 'selected' : ''}>${esc(path)}</option>`).join('')}
          </select>
        </div>
        <textarea class="paste-box mt16" id="import-text" data-input="importText" spellcheck="false"
                  placeholder='{ "deck": "Mathematics", "cards": [ ... ] }'>${esc(view.text)}</textarea>
        <div class="import-actions">
          <button class="btn btn-secondary" data-action="previewImport">${esc(t('validate'))}</button>
          <button class="btn btn-secondary" data-action="pickImportFile">${esc(t('import_file'))}</button>
          <span class="grow"></span>
          <button class="btn btn-quiet btn-sm" data-action="copyDecks">${esc(t('copy_decks'))}</button>
          <input type="file" id="import-file" accept=".json,application/json"
                 data-change="importFile" hidden>
        </div>
      </div>

      <div id="import-result">
        ${view.preview ? previewHtml(view.preview) : emptyPreviewHtml()}
      </div>
    </div>`;
}

/* Before you validate, the result slot explains what the box expects. The
   format itself belongs to the authoring skill, not to a button here; the one
   thing the skill cannot know, your deck names, is on the copy button above. */
function emptyPreviewHtml() {
  return `
    <div class="card card-pad import-expects">
      <div>
        <div class="card-title">${esc(t('what_goes_here'))}</div>
        <div class="setting-note mt8">${esc(t('import_hint_body'))}</div>
        <div class="setting-note mt8">${esc(t('import_hint_quiz'))}</div>
      </div>
      <pre class="import-shape">{
  "deck": "Computer Science::Networks",
  "cards": [
    { "id": "net.arp",
      "front": "What does ARP resolve?",
      "back": "An IP address to a MAC address." }
  ]
}</pre>
    </div>`;
}

function previewHtml(preview) {
  const cards = preview.cards || { new: 0, updated: 0, duplicates: 0, decks: [] };
  const importable = cards.new + cards.updated + (preview.quizzes || []).length > 0;
  const deckRows = cards.decks || [];
  const shown = deckRows.slice(0, DECK_ROWS_SHOWN);
  const hidden = deckRows.length - shown.length;

  return `
    <div class="card card-pad">
      <div class="preview-head">
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
        <div class="preview-commit">
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
      </div>

      ${shown.length ? `
        <div class="preview-decks">
          ${shown.map((d) => `
            <div class="preview-deck-row">
              <span class="preview-deck-name">${esc(d.deck)}</span>
              <span class="preview-deck-count">${d.count}</span>
            </div>`).join('')}
          ${hidden > 0 ? `
            <div class="preview-deck-row more">${esc(t('more_decks', { n: hidden }))}</div>` : ''}
        </div>` : ''}

      ${(preview.quizzes || []).map((quiz) => `
        <div class="mt8 sub small">${esc(quiz.name)} · ${quiz.questions} ${esc(t('questions'))}
          <span class="chip ${QUIZ_CHIP[quiz.action] || ''}">${
            esc(t(QUIZ_LABEL[quiz.action] || 'will_create'))}</span></div>`).join('')}

      ${(preview.issues || []).length ? `
        <div class="issue-list">
          ${preview.issues.map((issue) => `
            <div class="issue ${esc(issue.level)}">
              <span class="where">${esc(issue.where)}</span>
              <span>${esc(issue.message)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

export const actions = {
  importText: (el) => { state().text = el.value; },
  importDeck: (el) => { state().deck = el.value; },
  toggleDuplicates: (el) => { state().duplicates = el.checked; },

  pickImportFile: () => document.getElementById('import-file').click(),

  /* A picked file lands in the same box the paste would, then validates
     itself: the file dialog already was the confirmation that this is the
     right JSON. */
  importFile: async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    const text = await file.text();
    el.value = '';
    const view = state();
    view.text = text;
    view.preview = null;
    await render();
    await actions.previewImport();
  },

  /* Every deck path that exists, one per line, so a model writing cards puts
     them where they belong instead of inventing a deck next to the real one. */
  copyDecks: async () => {
    const paths = S.decks.map((deck) => deck.path);
    if (!paths.length) return showToast(t('no_decks_to_copy'), 2400);
    const text = paths.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('decks_copied', { n: paths.length }), 2400);
    } catch (err) {
      showModal(`<h2>${esc(t('copy_decks'))}</h2>
        <textarea class="textarea code" style="min-height:220px">${esc(text)}</textarea>
        <div class="modal-actions">
          <span class="grow"></span>
          <button class="btn btn-quiet btn-sm" data-action="closeModal">${esc(t('close'))}</button>
        </div>`);
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
