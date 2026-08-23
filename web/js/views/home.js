/* Home: what is due in the selected deck, the two ways in, and where it sits.

   Deliberately quiet: no streaks, no targets, no red. The count and the two
   buttons live together in the first card, so the thing the page is for is the
   thing your eye lands on, and nothing important hides in a corner. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';

const WEEK_ROWS = 7;

export async function renderHome() {
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

  const emptyMessage = !hasCards ? t('no_cards_yet')
    : (overview.new_done + overview.review_done > 0 ? t('caught_up') : t('nothing_due'));

  $content().innerHTML = `
    <div class="page">
      <div class="page-head">
        <div class="kicker">${esc(t('to_study'))}</div>
        <h1>${esc(title)}
          <span class="count">${overview.total_cards} ${
            esc(t(overview.total_cards === 1 ? 'card' : 'cards'))}</span></h1>
      </div>

      <div class="home-grid">
        <div class="card hero-card">
          ${total > 0 ? `
            <div class="hero-figures">
              <span class="hero-value">${total}</span>
              <span class="hero-lines">
                <span class="${newCount ? '' : 'zero'}">${newCount} ${esc(t('new_cards'))}</span>
                <span class="${reviewCount ? '' : 'zero'}">${reviewCount} ${esc(t('review_cards'))}</span>
              </span>
            </div>` : `
            <div class="hero-figures"><span class="hero-done">${esc(emptyMessage)}</span></div>`}

          <div class="hero-actions">
            <button class="btn btn-primary btn-lg" data-action="startSession" ${total ? '' : 'disabled'}>
              ${esc(t('study'))}
            </button>
            <button class="btn btn-secondary btn-lg" data-action="startBrowse" ${hasCards ? '' : 'disabled'}>
              ${esc(t('browse'))}
            </button>
          </div>
        </div>

        <div class="card card-pad activity-card">
          <div class="card-title">${esc(t('review_activity'))}
            <span class="meta">${esc(t('heat_total', { n: heat.total || 0 }))}</span></div>
          ${heatmapHtml(heat)}
          ${hasCards ? `<div class="rule-top">${
            statesHtml(overview.states, overview.total_cards)}</div>` : ''}
        </div>

        ${subjectCardsHtml()}
      </div>
    </div>`;
}

/* One card per subject, listing the chapters under it. The deck tree in the
   sidebar answers "where am I"; this answers "what is in there". */
function subjectCardsHtml() {
  const subjects = S.decks.filter((deck) => deck.depth === 0);
  if (!subjects.length) return '';

  const cards = subjects.map((subject) => {
    const children = S.decks.filter((deck) =>
      deck.depth === 1 && deck.path.startsWith(subject.path + '::'));
    const rows = (children.length ? children : [subject]).map((deck) => {
      const due = deck.due_count + deck.new_count;
      return `
        <div class="chapter-row" data-action="selectDeck" data-deck="${attr(deck.path)}">
          <span class="chapter-name">${esc(deck.name)}</span>
          ${due
            ? `<span class="chip chip-count">${due}</span>`
            : `<span class="chapter-total">${deck.total}</span>`}
        </div>`;
    }).join('');

    return `
      <div class="card subject-card">
        <div class="card-title">${esc(subject.name)}
          <span class="meta">${subject.total} ${
            esc(t(subject.total === 1 ? 'card' : 'cards'))}</span></div>
        ${rows}
      </div>`;
  }).join('');

  return `<div class="subject-grid">${cards}</div>`;
}

/* How the deck is distributed across the three FSRS states. One ramp, light to
   dark, so the three read as stages of the same thing rather than three
   colours competing for attention. */
function statesHtml(states, total) {
  const rows = [
    ['state_new', states.new, 'var(--ramp-2)'],
    ['state_learning', states.learning, 'var(--ramp-4)'],
    ['state_review', states.review, 'var(--ramp-5)'],
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
    </div>`;
}

/* ── Actions ────────────────────────────────────────────────────────────── */

export const actions = {
  startSession: () => navigate('review'),
  startBrowse: () => navigate('browse'),
};
