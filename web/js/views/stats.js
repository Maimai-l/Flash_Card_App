/* Stats: a description of what happened, not a scoreboard. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, clip } from '../core/dom.js';
import { plain } from '../core/render.js';
import { t } from '../core/i18n.js';
import { copyForAI } from '../core/aicopy.js';

/* Darkest for the answers you struggled with, lightest for the ones you did
   not. One ramp, so the chart reads as a gradient rather than a verdict. */
const RATINGS = [
  [1, 'again', 'var(--ramp-5)'],
  [2, 'hard', 'var(--ramp-4)'],
  [3, 'good', 'var(--ramp-3)'],
  [4, 'easy', 'var(--ramp-1)'],
];

const STATES = [
  ['state_new', 'new', 'var(--ramp-2)'],
  ['state_learning', 'learning', 'var(--ramp-4)'],
  ['state_review', 'review', 'var(--ramp-5)'],
];

function bar(label, value, max, colour) {
  return `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <span class="bar-track">
        <span class="bar-fill" style="width:${
          Math.round(100 * value / Math.max(1, max))}%;background:${colour}"></span>
      </span>
      <span class="bar-value">${value}</span>
    </div>`;
}

export async function renderStats() {
  const summary = await api.get_stats(S.deck);
  if (summary.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(summary.error)}</div></div>`;
    return;
  }

  const states = summary.states || { new: 0, learning: 0, review: 0 };
  const ratings = summary.ratings_30d || {};
  const ratingMax = Math.max(1, ...Object.values(ratings).map(Number));

  const hardest = (summary.hardest || []).map((card) => `
    <div class="hard-row">
      <span class="hard-front">${esc(clip(plain(card.front), 80))}</span>
      <span class="hard-n">${card.lapses} ${esc(t('lapses'))}</span>
    </div>`).join('');

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="kicker">${esc(t('nav_stats'))}</div>
        <h1>${esc(S.deck ? S.deck.split('::').pop() : t('all_decks'))}</h1>
      </div>

      <div class="mb16">
        <button class="btn btn-secondary btn-sm" data-action="exportReport">${esc(t('export_report'))}</button>
      </div>

      <div class="stat-grid">
        <div class="card stat-card">
          <div class="stat-head">
            <span class="stat-name">${esc(t('total_cards'))}</span>
            <span class="stat-value">${summary.total_cards}</span>
          </div>
          <div>${STATES.map(([key, field, colour]) =>
            bar(t(key), states[field], summary.total_cards, colour)).join('')}</div>
        </div>

        <div class="card stat-card">
          <div class="stat-head">
            <span class="stat-name">${esc(t('answers_30d'))}</span>
            <span class="stat-value">${summary.answers_30d}</span>
          </div>
          ${summary.answers_30d
            ? `<div>${RATINGS.map(([rating, key, colour]) =>
                bar(t(key), ratings[rating] || 0, ratingMax, colour)).join('')}</div>
               <div class="rule-top stat-head">
                 <span class="stat-name">${esc(t('retention_30d'))}</span>
                 <span class="stat-value">${summary.retention_30d ?? 0}%</span>
               </div>`
            : `<div class="setting-note">${esc(t('no_reviews_yet'))}</div>`}
        </div>

        <div class="card stat-card">
          <div class="stat-head"><span class="stat-name">${esc(t('hardest_cards'))}</span></div>
          ${hardest || `<div class="setting-note">${esc(t('no_reviews_yet'))}</div>`}
        </div>
      </div>
    </div>`;
}

export const actions = {
  /* The whole library's state as one block, whatever deck the page is scoped
     to: a planner needs the full picture or none. */
  exportReport: async () => {
    const report = await api.get_ai_report();
    if (report.error) return;
    await copyForAI(t('ai_report_intro'), report);
  },
};
