/* Quiz list, grouped by subject.

   Quizzes are separate from cards on purpose: they are not scheduled, they do
   not consume the daily budget, and taking one changes nothing about what is
   due. The list states when you last took each one and leaves the decision
   to you. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, showModal, closeModal, confirmDialog, promptDialog } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { navigate, render } from '../core/router.js';
import { renderSidebar } from './sidebar.js';

const DOTS = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`;

function relativeDay(iso) {
  if (!iso) return '';
  const then = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z');
  if (Number.isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  const rtf = new Intl.RelativeTimeFormat(S.lang === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' });
  if (days < 1) return rtf.format(0, 'day');
  return rtf.format(-days, 'day');
}

/** Left column on the Quiz page: the subjects that actually have quizzes. */
export function quizSidebar() {
  const subjects = new Map();
  for (const group of S.quizSubjects || []) {
    subjects.set(group.subject || '', (subjects.get(group.subject || '') || 0) + 1);
  }
  const rows = [...subjects.entries()].map(([subject, count]) => `
    <div class="deck-item ${S.quizSubject === subject ? 'active' : ''}"
         data-action="selectQuizSubject" data-subject="${attr(subject)}">
      <span class="deck-twisty leaf"></span>
      <span class="deck-name">${esc(subject || t('quizzes'))}</span>
      <span class="deck-count">${count}</span>
    </div>`).join('');

  return `
    <div class="section-label" style="padding:0 10px">
      <span class="grow">${esc(t('nav_quiz'))}</span>
    </div>
    <div class="deck-item ${S.quizSubject === null ? 'active' : ''}"
         data-action="selectQuizSubject" data-subject="">
      <span class="deck-twisty leaf"></span>
      <span class="deck-name">${esc(t('all_quizzes'))}</span>
      <span class="deck-count">${(S.quizSubjects || []).length}</span>
    </div>
    ${rows}`;
}

export async function renderQuizList() {
  const groups = await api.list_quizzes();
  S.quizSubjects = Array.isArray(groups) ? groups : [];
  renderSidebar();
  if (groups.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(groups.error)}</div></div>`;
    return;
  }

  if (!groups.length) {
    $content().innerHTML = `
      <div class="page">
        <div class="page-head"><h1>${esc(t('quizzes'))}</h1></div>
        <div class="card"><div class="empty">${esc(t('no_quizzes'))}</div></div>
      </div>`;
    return;
  }

  const visible = S.quizSubject === null || S.quizSubject === undefined
    ? groups
    : groups.filter((group) => (group.subject || '') === S.quizSubject);

  const bySubject = new Map();
  for (const group of visible) {
    const key = group.subject || '';
    if (!bySubject.has(key)) bySubject.set(key, []);
    bySubject.get(key).push(group);
  }

  const sections = [...bySubject.entries()].map(([subject, items]) => `
    <div class="quiz-group">
      ${subject ? `<div class="section-label">${esc(subject)}</div>` : ''}
      <div class="list">
        ${items.map((group) => `
          <div class="list-row">
            <div class="quiz-row-main">
              <div class="quiz-row-name">${esc(group.name)}</div>
              <div class="quiz-row-meta">
                ${group.question_count} ${esc(t('questions'))}
                &nbsp;·&nbsp;
                ${group.in_progress
                  ? `<span class="badge badge-blue">${esc(t('in_progress', {
                      done: group.progress_answered, total: group.progress_total,
                    }))}</span>`
                  : (group.attempts
                    ? esc(t('last_result', {
                        correct: group.last_correct, total: group.last_total,
                        when: relativeDay(group.last_taken),
                      }))
                    : esc(t('never_taken')))}
              </div>
            </div>
            ${group.in_progress ? `
              <button class="btn-text" data-action="startQuiz" data-group="${group.group_id}"
                      data-fresh="1">${esc(t('start_over'))}</button>` : ''}
            <button class="btn btn-secondary btn-sm" data-action="startQuiz"
                    data-group="${group.group_id}"
                    ${group.in_progress ? 'data-resume="1"' : ''}>
              ${esc(group.in_progress ? t('resume') : t('start'))}
            </button>
            <button class="icon-btn" data-action="quizMenu"
                    data-group="${group.group_id}"
                    data-name="${attr(group.name)}"
                    data-subject="${attr(group.subject || '')}">${DOTS}</button>
          </div>`).join('')}
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div class="page">
      <div class="page-head"><h1>${esc(t('quizzes'))}</h1></div>
      <div class="narrow">${sections}</div>
    </div>`;
}

export const actions = {
  selectQuizSubject: async (el) => {
    S.quizSubject = el.dataset.subject === '' ? null : el.dataset.subject;
    await render();
  },

  startQuiz: async (el) => {
    const groupId = Number(el.dataset.group);
    if (el.dataset.fresh) {
      const ok = await confirmDialog({
        title: t('start_over'), body: t('start_over_confirm'),
        confirmLabel: t('start_over'), danger: true,
      });
      if (!ok) return;
    }
    const quiz = await api.start_quiz(groupId, null, Boolean(el.dataset.resume));
    if (quiz.error) return showToast(quiz.error, 3200);
    if (!quiz.questions.length) return showToast(t('no_quizzes'));
    S.quiz = null;
    await navigate('quizrun', { quizStart: quiz });
  },

  quizMenu: (el) => {
    const { group, name, subject } = el.dataset;
    showModal(`
      <h2>${esc(name)}</h2>
      ${subject ? `<p class="sub small">${esc(subject)}</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('cancel'))}</button>
        <button class="btn btn-secondary btn-sm" data-action="exportQuiz"
                data-group="${attr(group)}">${esc(t('export_title'))}</button>
        <button class="btn btn-secondary btn-sm" data-action="renameQuiz"
                data-group="${attr(group)}" data-name="${attr(name)}"
                data-subject="${attr(subject)}">${esc(t('rename'))}</button>
        <button class="btn btn-danger btn-sm" data-action="deleteQuiz"
                data-group="${attr(group)}">${esc(t('delete'))}</button>
      </div>`);
  },

  renameQuiz: async (el) => {
    const { group, name, subject } = el.dataset;
    closeModal();
    const next = await promptDialog({ title: t('rename'), value: name });
    if (!next) return;
    const result = await api.rename_quiz(Number(group), next, subject);
    if (result.error) return showToast(result.error, 3200);
    await render();
  },

  deleteQuiz: async (el) => {
    const groupId = Number(el.dataset.group);
    closeModal();
    const ok = await confirmDialog({
      title: t('quiz_delete_confirm'), confirmLabel: t('delete'), danger: true,
    });
    if (!ok) return;
    await api.delete_quiz(groupId);
    await render();
  },

  exportQuiz: async (el) => {
    const groupId = Number(el.dataset.group);
    closeModal();
    const payload = await api.export_quiz(groupId);
    if (payload.error) return showToast(payload.error, 3200);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('export_copied'));
    } catch (err) {
      showModal(`<h2>${esc(t('export_title'))}</h2>
        <textarea class="textarea code" style="min-height:320px">${esc(text)}</textarea>
        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm" data-action="closeModal">${esc(t('close'))}</button>
        </div>`, { wide: true });
    }
  },
};
