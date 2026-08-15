/* Taking a quiz, then the results.

   Questions have answer keys, so there is no self-rating here — you answer, the
   app marks it, and nothing is written to any card's schedule. The only record
   kept is the final score. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, attr, showToast, setKeys, typingInInput } from '../core/dom.js';
import { rich } from '../core/render.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';
import { questionType, questionLabel } from '../questions/index.js';

const CLOSE_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export async function renderQuizRun() {
  if (S.quizStart) {
    startRun(S.quizStart);
    S.quizStart = null;
  }
  if (!S.quiz) return navigate('quiz');
  paint();
}

function startRun(quiz) {
  S.quiz = {
    groupId: quiz.group_id,
    name: quiz.name,
    subject: quiz.subject,
    questions: quiz.questions,
    index: 0,
    finished: false,
    states: quiz.questions.map((question) => {
      const type = questionType(question.type);
      return {
        answered: false,
        correct: false,
        response: type ? type.initialResponse(question) : null,
      };
    }),
  };
}

function current() {
  return {
    question: S.quiz.questions[S.quiz.index],
    state: S.quiz.states[S.quiz.index],
  };
}

function paint() {
  if (S.quiz.finished) return paintResults();

  const { question, state } = current();
  const type = questionType(question.type);
  if (!type) {  // defensive: unknown types are dropped at import
    S.quiz.index += 1;
    return S.quiz.index >= S.quiz.questions.length ? finish() : paint();
  }

  const isLast = S.quiz.index === S.quiz.questions.length - 1;
  const showCheck = !state.answered && !type.autoSubmit(question);
  const canSubmit = type.canSubmit(question, state);

  $content().innerHTML = `
    <div class="study">
      <div class="study-top">
        <button class="icon-btn" data-action="exitQuiz"
                title="${attr(t('exit_session'))}">${CLOSE_ICON}</button>
        <span class="title">${esc(S.quiz.name)}</span>
        <span class="counter">${S.quiz.index + 1} / ${S.quiz.questions.length}</span>
      </div>
      <div class="study-body"><div class="study-inner">
        <div id="q-root">${type.render(question, state)}</div>
        ${state.answered && question.explain
          ? `<div class="q-explain">${rich(question.explain)}</div>` : ''}
      </div></div>
      <div class="study-foot"><div class="study-foot-inner">
        <div class="reveal-row">
          ${showCheck ? `
            <button class="btn btn-primary" data-action="submitQuestion"
                    ${canSubmit ? '' : 'disabled'}>${esc(t('check'))}</button>` : ''}
          ${state.answered ? `
            <button class="btn btn-primary" data-action="nextQuestion">
              ${esc(isLast ? t('finish') : t('next_question'))}
            </button>` : ''}
        </div>
        <div class="hint-line">${
          state.answered ? '<kbd>Enter</kbd>' : (showCheck ? '<kbd>Enter</kbd>' : '<kbd>1</kbd>…')
        }</div>
      </div></div>
    </div>`;

  const root = document.getElementById('q-root');
  type.mount(root, question, state, {
    setResponse: (response, options = {}) => {
      state.response = response;
      if (!options.silent) paint();
    },
    submit: () => submitCurrent(),
  });

  setKeys((event) => {
    if (event.key === 'Escape') { event.preventDefault(); return actions.exitQuiz(); }
    if (state.answered) {
      if (event.key === 'Enter') { event.preventDefault(); actions.nextQuestion(); }
      return;
    }
    if (typingInInput(event)) return;
    if (type.onKey && type.onKey(event, question, state, {
      setResponse: (response) => { state.response = response; paint(); },
      submit: () => submitCurrent(),
    })) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && canSubmit) { event.preventDefault(); submitCurrent(); }
  });
}

function submitCurrent() {
  const { question, state } = current();
  const type = questionType(question.type);
  if (!type || state.answered || !type.canSubmit(question, state)) return;
  state.answered = true;
  state.correct = type.grade(question, state.response);
  paint();
}

async function finish() {
  const quiz = S.quiz;
  quiz.finished = true;
  const correct = quiz.states.filter((s) => s.correct).length;
  const wrongIds = quiz.questions
    .filter((question, index) => !quiz.states[index].correct)
    .map((question) => question.question_id)
    .filter((id) => id !== undefined);
  const result = await api.finish_quiz(quiz.groupId, correct, quiz.questions.length, wrongIds);
  if (result.error) showToast(result.error, 3200);
  paint();
}

function paintResults() {
  const quiz = S.quiz;
  const correct = quiz.states.filter((s) => s.correct).length;
  const total = quiz.questions.length;
  const wrongCount = total - correct;

  const rows = quiz.questions.map((question, index) => {
    const state = quiz.states[index];
    const type = questionType(question.type);
    const summary = type ? type.summary(question, state.response) : { given: '', correct: '' };
    return `
      <div class="result-item">
        <div class="result-q">
          <span style="color:${state.correct ? 'var(--green)' : 'var(--red)'}">${
            state.correct ? '✓' : '✗'}</span>
          <span>${index + 1}. ${rich(questionLabel(question)).replace(/<\/?p>/g, '')}</span>
        </div>
        ${state.correct ? '' : `
          <div class="result-line">${esc(t('your_answer'))}: <b>${esc(summary.given || '—')}</b></div>
          <div class="result-line">${esc(t('correct_answer'))}: <b>${esc(summary.correct)}</b></div>`}
        ${question.explain ? `<div class="result-line">${esc(question.explain)}</div>` : ''}
      </div>`;
  }).join('');

  $content().innerHTML = `
    <div class="study">
      <div class="study-top">
        <button class="icon-btn" data-action="exitQuiz">${CLOSE_ICON}</button>
        <span class="title">${esc(quiz.name)}</span>
      </div>
      <div class="study-body" style="align-items:flex-start"><div class="study-inner">
        <div class="result-hero">
          <div class="result-score">${correct} / ${total}</div>
          <div class="result-sub">${esc(t('score_line', { correct, total }))}</div>
        </div>
        <div class="card mb16">${rows}</div>
        <div class="due-actions mb24">
          ${wrongCount ? `
            <button class="btn btn-secondary" data-action="retryWrong">
              ${esc(t('retry_wrong', { n: wrongCount }))}
            </button>` : ''}
          <button class="btn btn-primary" data-action="exitQuiz">${esc(t('done'))}</button>
        </div>
      </div></div>
    </div>`;

  setKeys((event) => {
    if (event.key === 'Escape' || event.key === 'Enter') {
      event.preventDefault();
      actions.exitQuiz();
    }
  });
}

export const actions = {
  submitQuestion: () => submitCurrent(),

  nextQuestion: () => {
    if (S.quiz.index >= S.quiz.questions.length - 1) return finish();
    S.quiz.index += 1;
    paint();
  },

  retryWrong: async () => {
    const quiz = S.quiz;
    const wrongIds = quiz.questions
      .filter((question, index) => !quiz.states[index].correct)
      .map((question) => question.question_id);
    const fresh = await api.start_quiz(quiz.groupId, wrongIds);
    if (fresh.error) return showToast(fresh.error, 3200);
    startRun(fresh);
    paint();
  },

  exitQuiz: () => {
    S.quiz = null;
    navigate('quiz');
  },
};
