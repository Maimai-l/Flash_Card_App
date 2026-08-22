/* Settings: language, the daily caps, per-subject overrides, and the reset. */

import { S, savePrefs } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, confirmDialog } from '../core/dom.js';
import { t, LANGUAGES } from '../core/i18n.js';
import { render } from '../core/router.js';

export async function renderSettings() {
  const settings = await api.get_settings();
  S.settings = settings.error ? S.settings : settings;

  const subjects = S.decks.filter((deck) => deck.depth === 0);

  $content().innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('settings_title'))}</h1></div>

      <div class="narrow">
      <div class="section-label">${esc(t('language'))}</div>
      <div class="list mb24">
        <div class="setting-row">
          <div class="setting-main"><div class="setting-name">${esc(t('language'))}</div></div>
          <select class="select" style="width:150px" data-change="setLanguage">
            ${LANGUAGES.map((lang) => `<option value="${lang.code}" ${
              lang.code === S.lang ? 'selected' : ''}>${esc(lang.label)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="section-label">${esc(t('daily_limits'))}</div>
      <div class="list">
        <div class="setting-row">
          <div class="setting-main">
            <div class="setting-name">${esc(t('default_new_limit'))}</div>
            <div class="setting-desc">${esc(t('limits_desc'))}</div>
          </div>
          <input class="input input-inline" type="number" min="-1" data-change="setDefaultLimit"
                 data-key="default_new_limit"
                 value="${attr(S.settings.default_new_limit || '10')}">
        </div>
        <div class="setting-row">
          <div class="setting-main">
            <div class="setting-name">${esc(t('default_review_limit'))}</div>
          </div>
          <input class="input input-inline" type="number" min="-1" data-change="setDefaultLimit"
                 data-key="default_review_limit"
                 value="${attr(S.settings.default_review_limit || '60')}">
        </div>
      </div>

      ${subjects.length ? `
        <div class="section-label mt24">${esc(t('per_deck_limits'))}</div>
        <div class="list">
          ${subjects.map((deck) => `
            <div class="setting-row">
              <div class="setting-main">
                <div class="setting-name">${esc(deck.name)}</div>
                <div class="setting-desc">${deck.total} ${esc(t(deck.total === 1 ? 'card' : 'cards'))}</div>
              </div>
              <div class="limit-inputs">
                <input class="input input-inline" type="number" min="-1"
                       data-change="setDeckLimit" data-deck="${attr(deck.path)}" data-kind="new"
                       placeholder="${attr(S.settings.default_new_limit || '10')}"
                       value="${deck.new_limit === null ? '' : deck.new_limit}">
                <span>${esc(t('new_cards'))}</span>
                <input class="input input-inline" type="number" min="-1"
                       data-change="setDeckLimit" data-deck="${attr(deck.path)}" data-kind="review"
                       placeholder="${attr(S.settings.default_review_limit || '60')}"
                       value="${deck.review_limit === null ? '' : deck.review_limit}">
                <span>${esc(t('review_cards'))}</span>
              </div>
            </div>`).join('')}
        </div>
        <div class="sub small mt8">${esc(t('per_deck_desc'))}</div>` : ''}

      <div class="section-label mt24">${esc(t('data'))}</div>
      <div class="list mb24">
        <div class="setting-row">
          <div class="setting-main">
            <div class="setting-name">${esc(t('reset_all'))}</div>
            <div class="setting-desc">${esc(t('reset_desc'))}</div>
          </div>
          <button class="btn btn-danger btn-sm" data-action="resetAll">${esc(t('reset_all'))}</button>
        </div>
      </div>

      <div class="sub small">${esc(t('version'))} ${esc(S.version)}</div>
      </div>
    </div>`;
}

export const actions = {
  setLanguage: async (el) => {
    S.lang = el.value;
    savePrefs();
    await api.update_settings({ language: el.value });
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
