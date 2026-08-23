/* Settings: language, the daily caps, per-subject overrides, and the reset. */

import { S, savePrefs } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, confirmDialog } from '../core/dom.js';
import { t, LANGUAGES } from '../core/i18n.js';
import { render } from '../core/router.js';
import { railHead } from './sidebar.js';

const SECTIONS = [
  { id: 'language', key: 'language' },
  { id: 'limits', key: 'daily_limits' },
  { id: 'subjects', key: 'per_deck_limits' },
  { id: 'data', key: 'data' },
];

/** Left column on Settings: its own sections, not a deck tree. */
export function settingsSidebar() {
  return railHead(t('settings_title')) + `
    ${SECTIONS.map((section) => `
      <div class="deck-item" data-action="scrollToSection" data-section="${section.id}">
        <span class="deck-twisty leaf"></span>
        <span class="deck-name">${esc(t(section.key))}</span>
      </div>`).join('')}`;
}

export async function renderSettings() {
  const settings = await api.get_settings();
  S.settings = settings.error ? S.settings : settings;

  const subjects = S.decks.filter((deck) => deck.depth === 0);

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="kicker">${esc(t('nav_settings'))}</div>
        <h1>${esc(t('settings_title'))}</h1>
      </div>

      <div class="narrow">
        <div class="card settings-section" id="section-language">
          <div class="card-title">${esc(t('language'))}</div>
          <div class="row gap8">
            ${LANGUAGES.map((lang) => `
              <button class="btn ${lang.code === S.lang ? 'btn-primary' : 'btn-secondary'}"
                      data-action="setLanguage" data-lang="${attr(lang.code)}">${esc(lang.label)}</button>`).join('')}
          </div>
        </div>

        <div class="card settings-section" id="section-limits">
          <div class="card-title">${esc(t('daily_limits'))}</div>
          <div class="row gap24" style="flex-wrap:wrap">
            <div class="field" style="margin:0">
              <label class="field-label">${esc(t('default_new_limit'))}</label>
              <input class="input input-inline" type="number" min="-1" data-change="setDefaultLimit"
                     data-key="default_new_limit"
                     value="${attr(S.settings.default_new_limit || '10')}">
            </div>
            <div class="field" style="margin:0">
              <label class="field-label">${esc(t('default_review_limit'))}</label>
              <input class="input input-inline" type="number" min="-1" data-change="setDefaultLimit"
                     data-key="default_review_limit"
                     value="${attr(S.settings.default_review_limit || '60')}">
            </div>
          </div>
          <div class="setting-note">${esc(t('limits_desc'))}</div>
        </div>

        <div class="card settings-section" id="section-subjects">
          <div class="card-title">${esc(t('per_deck_limits'))}</div>
          <div class="setting-note">${esc(t('per_deck_desc'))}</div>
          ${subjects.length ? subjects.map((deck) => `
            <div class="setting-row">
              <div class="setting-main">
                <div class="setting-name">${esc(deck.name)}</div>
                <div class="setting-desc">${deck.total} ${esc(t(deck.total === 1 ? 'card' : 'cards'))}</div>
              </div>
              <div class="limit-inputs">
                <span class="cap">${esc(t('new_cards'))}</span>
                <input class="input input-inline" type="number" min="-1"
                       data-change="setDeckLimit" data-deck="${attr(deck.path)}" data-kind="new"
                       placeholder="${attr(S.settings.default_new_limit || '10')}"
                       value="${deck.new_limit === null ? '' : deck.new_limit}">
                <span class="cap">${esc(t('review_cards'))}</span>
                <input class="input input-inline" type="number" min="-1"
                       data-change="setDeckLimit" data-deck="${attr(deck.path)}" data-kind="review"
                       placeholder="${attr(S.settings.default_review_limit || '60')}"
                       value="${deck.review_limit === null ? '' : deck.review_limit}">
              </div>
            </div>`).join('') : `<div class="setting-note">${esc(t('no_cards_yet'))}</div>`}
        </div>

        <div class="card settings-section" id="section-data">
          <div class="card-title">${esc(t('data'))}</div>
          <div><button class="btn btn-danger" data-action="resetAll">${esc(t('reset_all'))}</button></div>
          <div class="setting-note">${esc(t('reset_desc'))}</div>
          <div class="version-line">${esc(t('version'))} ${esc(S.version)}</div>
        </div>
      </div>
    </div>`;
}

export const actions = {
  scrollToSection: (el) => {
    const target = document.getElementById(`section-${el.dataset.section}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  setLanguage: async (el) => {
    S.lang = el.dataset.lang;
    savePrefs();
    await api.update_settings({ language: S.lang });
    await render();
  },

  setDefaultLimit: async (el) => {
    const result = await api.update_settings({ [el.dataset.key]: el.value });
    if (result.error) return showToast(result.error, 3200);
    S.settings = result.settings;
    showToast(t('saved'), 1200);
  },

  setDeckLimit: async (el) => {
    const path = el.dataset.deck;
    const row = el.closest('.setting-row');
    const read = (kind) => {
      const input = row.querySelector(`[data-kind="${kind}"]`);
      return input && input.value.trim() !== '' ? Number(input.value) : null;
    };
    const result = await api.set_deck_limits(path, read('new'), read('review'));
    if (result.error) return showToast(result.error, 3200);
    S.decks = result.decks;
    showToast(t('saved'), 1200);
  },

  resetAll: async () => {
    const ok = await confirmDialog({
      title: t('reset_all'), body: t('reset_confirm'),
      confirmLabel: t('reset_all'), danger: true,
    });
    if (!ok) return;
    const result = await api.reset_all();
    if (result.error) return showToast(result.error, 3200);
    S.deck = '';
    savePrefs();
    showToast(t('reset_done'));
    await render();
  },
};
