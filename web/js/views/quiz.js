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

export async function renderQuizList() {
  const groups = await api.list_quizzes();
  if (groups.error) {
    $content().innerHTML = `<div class="page"><div class="empty">${esc(groups.error)}</div></div>`;
    return;
  }

  if (!groups.length) {
    $content().innerHTML = `
      <div class="page">
        <div class="home-head"><h1>${esc(t('quizzes'))}</h1></div>
        <div class="card"><div class="empty">${esc(t('no_quizzes'))}</div></div>
      </div>`;
    return;
  }

  const bySubject = new Map();
  for (const group of groups) {
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
                ${group.attempts
                  ? esc(t('last_result', {
                      correct: group.last_correct, total: group.last_total,
                      when: relativeDay(group.last_taken),
                    }))
                  : esc(t('never_taken'))}
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" data-action="startQuiz"
                    data-group="${group.group_id}">${esc(t('start'))}</button>
            <button class="icon-btn" data-action="quizMenu"
                    data-group="${group.group_id}"
                    data-name="${attr(group.name)}"
                    data-subject="${attr(group.subject || '')}">${DOTS}</button>
          </div>`).join('')}
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div class="page">
      <div class="home-head"><h1>${esc(t('quizzes'))}</h1></div>
      ${sections}
    </div>`;
}

export const actions = {
  startQuiz: async (el) => {
    const groupId = Number(el.dataset.group);
    const quiz = await api.start_quiz(groupId);
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
