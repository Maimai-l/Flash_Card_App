/* Home: what is due in the selected deck, the two ways in, and the backlog.

   Deliberately quiet — no streaks, no targets, no red. The overdue line states
   a number and offers a way to flatten it; it never nags. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showModal, closeModal, showToast } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { navigate, render } from '../core/router.js';
import { renderSidebar, refreshDecks } from './sidebar.js';

const WEEK_ROWS = 7;

export async function renderHome() {
  await refreshDecks();
  renderSidebar();

  const [overview, heat] = await Promise.all([
    api.get_overview(S.deck),
    api.get_heatmap(S.deck, 182),
  ]);

  if (overview.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(overview.error)}</div></div>`;
    return;
  }

  const title = S.deck ? S.deck.split('::').pop() : t('all_decks');
  const newCount = overview.new_available;
  const reviewCount = overview.review_available;
  const total = newCount + reviewCount;
  const hasCards = overview.total_cards > 0;

  // With several subjects in view the limits are per subject, not a shared
  // pool, so stating one summed number would be a lie.
  const limitLine = overview.subjects > 1
    ? t('limit_per_subject')
    : t('limit_line', {
      new: overview.unlimited_new ? t('limit_unlimited') : overview.new_limit,
      review: overview.unlimited_review ? t('limit_unlimited') : overview.review_limit,
    });

  const emptyMessage = !hasCards ? t('no_cards_yet')
    : (overview.new_done + overview.review_done > 0 ? t('caught_up') : t('nothing_due'));

  $content().innerHTML = `
    <div class="page-wide">
      <div class="home-head">
        <h1>${esc(title)}</h1>
        <span class="sub small">${overview.total_cards} ${esc(t(overview.total_cards === 1 ? 'card' : 'cards'))}</span>
      </div>

      <div class="home-grid">
      <div class="card due-card">
        ${total > 0 ? `
          <div class="due-figures">
            <div class="due-figure ${newCount ? '' : 'zero'}">
              <span class="value">${newCount}</span>
              <span class="label">${esc(t('new_cards'))}</span>
            </div>
            <div class="due-figure ${reviewCount ? '' : 'zero'}">
              <span class="value">${reviewCount}</span>
              <span class="label">${esc(t('review_cards'))}</span>
            </div>
          </div>` : `
          <div class="due-figures">
            <div class="due-figure zero">
              <span class="value" style="font-size:17px;font-weight:500">${esc(emptyMessage)}</span>
            </div>
          </div>`}

        <div class="due-actions">
          <button class="btn btn-primary" data-action="startSession" ${total ? '' : 'disabled'}>
            ${esc(t('study'))}
          </button>
          <button class="btn btn-secondary" data-action="startBrowse" ${hasCards ? '' : 'disabled'}>
            ${esc(t('browse'))}
          </button>
        </div>

        <div class="limit-line">${esc(limitLine)}</div>

        ${overview.overdue ? `
          <div class="backlog-note">
            <span>${esc(t('overdue_note', { n: overview.overdue }))}</span>
            <button class="btn-text" data-action="openSpread"
                    data-n="${overview.overdue}">${esc(t('reschedule'))}</button>
          </div>` : ''}
      </div>

        <div class="card card-pad heat-card">
          <div class="section-label">${esc(t('review_activity'))}</div>
          ${heatmapHtml(heat)}
        </div>

        ${hasCards ? `
          <div class="card card-pad states-card">
            <div class="section-label">${esc(t('total_cards'))}</div>
            ${statesHtml(overview.states, overview.total_cards)}
          </div>` : ''}
      </div>
    </div>`;
}

/* How the deck is distributed across the three FSRS states. */
function statesHtml(states, total) {
  const rows = [
    ['state_new', states.new, 'var(--heat-3)'],
    ['state_learning', states.learning, 'var(--orange)'],
    ['state_review', states.review, 'var(--green)'],
  ];
  return rows.map(([key, value, colour]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(t(key))}</span>
      <span class="bar-track">
        <span class="bar-fill" style="width:${
          Math.round(100 * value / Math.max(1, total))}%;background:${colour}"></span>
      </span>
      <span class="bar-value">${value}</span>
    </div>`).join('');
}

/* ── Heatmap ────────────────────────────────────────────────────────────── */

function levelThresholds(counts) {
  const nonzero = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!nonzero.length) return [1, 2, 3, 4];
  const at = (q) => nonzero[Math.min(nonzero.length - 1, Math.floor(nonzero.length * q))];
  return [at(0.2), at(0.45), at(0.7), at(0.9)];
}

function levelFor(count, thresholds) {
  if (count <= 0) return 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (count <= thresholds[i]) return i + 1;
  }
  return 5;
}

function heatmapHtml(heat) {
  if (!heat || !heat.days) return `<div class="sub small">${esc(t('no_reviews_yet'))}</div>`;

  const thresholds = levelThresholds(heat.days.map((d) => d.count));
  const first = new Date(heat.days[0].day + 'T00:00:00');
  const leading = (first.getDay() + 6) % 7;  // weeks start on Monday

  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...heat.days,
  ];

  const columns = [];
  for (let i = 0; i < cells.length; i += WEEK_ROWS) {
    columns.push(cells.slice(i, i + WEEK_ROWS));
  }

  const monthLabels = columns.map((column, index) => {
    const day = column.find(Boolean);
    if (!day) return '<span class="heat-month"></span>';
    const date = new Date(day.day + 'T00:00:00');
    const previous = index > 0 ? columns[index - 1].find(Boolean) : null;
    const changed = !previous || new Date(previous.day + 'T00:00:00').getMonth() !== date.getMonth();
    const label = changed && date.getDate() <= 14
      ? date.toLocaleDateString(S.lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short' })
      : '';
    return `<span class="heat-month">${esc(label)}</span>`;
  }).join('');

  const grid = columns.map((column) => `
    <div class="heat-col">
      ${column.map((day) => {
        if (!day) return '<span class="heat-cell blank"></span>';
        const key = day.count === 0 ? 'no_reviews_on' : (day.count === 1 ? 'review_on' : 'reviews_on');
        return `<span class="heat-cell" data-level="${levelFor(day.count, thresholds)}"
                      data-tip="${attr(t(key, { n: day.count, date: day.day }))}"></span>`;
      }).join('')}
    </div>`).join('');

  return `
    <div class="heatmap-wrap">
      <div class="heat-months">${monthLabels}</div>
      <div class="heatmap">${grid}</div>
    </div>
    <div class="heat-legend">
      <span>${esc(t('heat_less'))}</span>
      ${[0, 1, 2, 3, 4, 5].map((l) => `<span class="heat-cell" data-level="${l}"></span>`).join('')}
      <span>${esc(t('heat_more'))}</span>
      <span class="grow"></span>
      <span>${esc(t('heat_total', { n: heat.total }))}</span>
    </div>`;
}

/* ── Actions ────────────────────────────────────────────────────────────── */

export const actions = {
  startSession: () => navigate('review'),
  startBrowse: () => navigate('browse'),

  openSpread: (el) => {
    const n = Number(el.dataset.n) || 0;
    showModal(`
      <h2>${esc(t('reschedule_title'))}</h2>
      <p class="sub" style="font-size:13.5px;line-height:1.6">${esc(t('reschedule_body', { n }))}</p>
      <div class="field mt16">
        <label class="field-label">${esc(t('reschedule_days'))}</label>
        <input class="input input-inline" id="spread-days" type="number" min="1" max="60" value="7">
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
        <button class="btn btn-primary btn-sm" data-action="confirmSpread">${esc(t('reschedule'))}</button>
      </div>`);
  },

  confirmSpread: async () => {
    const days = Number(document.getElementById('spread-days').value) || 7;
    closeModal();
    const result = await api.spread_overdue(S.deck, days);
    if (result.error) return showToast(result.error, 3200);
    showToast(t('reschedule_done', { n: result.moved, days: result.days }));
    await render();
  },
};
