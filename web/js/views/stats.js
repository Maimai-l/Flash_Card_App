/* Stats: a description of what happened, not a scoreboard. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, clip } from '../core/dom.js';
import { plain } from '../core/render.js';
import { t } from '../core/i18n.js';

const RATING_KEYS = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };

export async function renderStats() {
  const summary = await api.get_stats(S.deck);
  if (summary.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(summary.error)}</div></div>`;
    return;
  }

  const states = summary.states || { new: 0, learning: 0, review: 0 };
  const ratings = summary.ratings_30d || {};
  const ratingMax = Math.max(1, ...Object.values(ratings).map(Number));

  const ratingRows = [1, 2, 3, 4].map((rating) => `
    <div class="bar-row">
      <span class="bar-label">${esc(t(RATING_KEYS[rating]))}</span>
      <span class="bar-track">
        <span class="bar-fill" style="width:${Math.round(100 * (ratings[rating] || 0) / ratingMax)}%"></span>
      </span>
      <span class="bar-value">${ratings[rating] || 0}</span>
    </div>`).join('');

  const hardest = (summary.hardest || []).map((card) => `
    <div class="list-row">
      <span class="grow">${esc(clip(plain(card.front), 80))}</span>
      <span class="sub small nowrap">${card.lapses} ${esc(t('lapses'))}</span>
    </div>`).join('');

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1>${esc(t('stats_title'))}</h1>
        <span class="sub small">${esc(S.deck || t('all_decks'))}</span>
      </div>

      <div class="stat-grid mb24">
        <div class="card stat-tile">
          <div class="value">${summary.total_cards}</div>
          <div class="label">${esc(t('total_cards'))}</div>
        </div>
        <div class="card stat-tile">
          <div class="value">${summary.answers_30d}</div>
          <div class="label">${esc(t('answers_30d'))}</div>
        </div>
        <div class="card stat-tile">
          <div class="value">${summary.retention_30d === null ? '—' : summary.retention_30d + '%'}</div>
          <div class="label">${esc(t('retention_30d'))}</div>
        </div>
      </div>

      <div class="section-label">${esc(t('total_cards'))}</div>
      <div class="card card-pad mb24">
        ${[['state_new', states.new], ['state_learning', states.learning], ['state_review', states.review]]
          .map(([key, value]) => `
            <div class="bar-row">
              <span class="bar-label">${esc(t(key))}</span>
              <span class="bar-track">
                <span class="bar-fill" style="width:${
                  Math.round(100 * value / Math.max(1, summary.total_cards))}%"></span>
              </span>
              <span class="bar-value">${value}</span>
            </div>`).join('')}
      </div>

      <div class="section-label">${esc(t('rating_split'))}</div>
      <div class="card card-pad mb24">
        ${summary.answers_30d ? ratingRows : `<div class="sub small">${esc(t('no_reviews_yet'))}</div>`}
      </div>

      ${hardest ? `
        <div class="section-label">${esc(t('hardest_cards'))}</div>
        <div class="list">${hardest}</div>` : ''}
    </div>`;
}

export const actions = {};
