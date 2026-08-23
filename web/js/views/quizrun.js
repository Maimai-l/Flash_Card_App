/* Taking a quiz, then the results.

   Questions have answer keys, so there is no self-rating here: you answer, the
   app marks it, and nothing is written to any card's schedule.

   Every graded question is saved to the server before the screen moves on, so
   leaving a quiz costs nothing and re-entering picks up where you stopped. This
   matches how card reviews behave, where each rating is a write. */

import { S } from '../core/state.js';
import { api } from '../core/api.js';
import { $content, esc, showToast, setKeys, typingInInput } from '../core/dom.js';
import { rich } from '../core/render.js';
import { t } from '../core/i18n.js';
import { navigate } from '../core/router.js';
import { questionType, questionLabel, questionPrompt } from '../questions/index.js';

export async function renderQuizRun() {
  if (S.quizStart) {
    startRun(S.quizStart);
    S.quizStart = null;
  }
  if (!S.quiz) return navigate('quiz');
  paint();
}

function startRun(quiz) {
  const blank = quiz.questions.map((question) => {
    const type = questionType(question.type);
    return {
      answered: false,
      correct: false,
      response: type ? type.initialResponse(question) : null,
    };
  });

  // A resumed run carries its answers back from the server; a fresh one starts
  // blank. Merge rather than trust, so a saved response for a question that has
  // since changed shape cannot break the render.
  const saved = quiz.resumed;
  const states = saved
    ? blank.map((state, index) => {
      const stored = saved.answers[index];
      if (!stored || !stored.answered) return state;
      return {
        answered: true,
        correct: Boolean(stored.correct),
        response: stored.response === undefined ? state.response : stored.response,
      };
    })
    : blank;

  S.quiz = {
    groupId: quiz.group_id,
    name: quiz.name,
    subject: quiz.subject,
    questions: quiz.questions,
    index: saved ? Math.min(saved.position, quiz.questions.length - 1) : 0,
    finished: false,
    states,
  };
}

/** Write the run to the server. Called after every grade and every advance. */
function saveProgress() {
  const quiz = S.quiz;
  if (!quiz || quiz.finished) return Promise.resolve();
  return api.save_quiz_progress(
    quiz.groupId,
    quiz.questions.map((question) => question.question_id),
    quiz.states.map((state) => ({
      answered: state.answered,
      correct: state.correct,
      response: state.response,
    })),
    quiz.index,
  );
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

  const promptText = questionPrompt(question);
  const answered = S.quiz.states.filter((state) => state.answered).length;
  const percent = Math.round(100 * answered / S.quiz.questions.length);

  $content().innerHTML = `
    <div class="study">
      <div class="study-top">
        <button class="btn btn-secondary btn-sm" data-action="exitQuiz">${esc(t('exit_session'))}</button>
        <span class="title">${esc(S.quiz.name)}</span>
        <span class="counter">${S.quiz.index + 1} / ${S.quiz.questions.length}</span>
      </div>
      <div class="quiz-progress"><span style="width:${percent}%"></span></div>
      <div class="q-scroll">
        <div class="q-column">
          ${promptText ? `<div class="q-card q-prompt">${rich(promptText)}</div>` : ''}
          <div id="q-root">${type.render(question, state)}</div>
          ${showCheck ? `
            <div class="q-actions">
              <button class="btn btn-primary" data-action="submitQuestion"
                      ${canSubmit ? '' : 'disabled'}>${esc(t('check'))}</button>
              <span class="kbd">Enter</span>
            </div>` : ''}
          ${state.answered ? `
            <div class="q-verdict ${state.correct ? '' : 'wrong'}">
              <span class="verdict-label">${esc(t(state.correct ? 'is_correct' : 'is_wrong'))}</span>
              ${state.correct ? '' : verdictLines(question, state)}
              ${question.explain ? `<div class="q-explain">${rich(question.explain)}</div>` : ''}
              <div class="q-actions">
                <button class="btn btn-primary" data-action="nextQuestion">
                  ${esc(isLast ? t('finish') : t('next_question'))}
                </button>
                <span class="kbd">Enter</span>
              </div>
            </div>` : ''}
        </div>
      </div>
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

/* What you gave and what was expected, stated plainly rather than colour-coded
   into a corner of the option list. */
function verdictLines(question, state) {
  const type = questionType(question.type);
  const summary = type ? type.summary(question, state.response) : { given: '', correct: '' };
  return `
    <span class="verdict-line">${esc(t('your_answer'))}: <b>${esc(summary.given || t('blank'))}</b></span>
    <span class="verdict-line">${esc(t('correct_answer'))}: <b>${esc(summary.correct)}</b></span>`;
}

function submitCurrent() {
  const { question, state } = current();
  const type = questionType(question.type);
  if (!type || state.answered || !type.canSubmit(question, state)) return;
  state.answered = true;
  state.correct = type.grade(question, state.response);
  paint();
  saveProgress();
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
    return `
      <div class="result-item ${state.correct ? '' : 'wrong'}">
        <span class="mark">${state.correct ? '\u2713' : '\u2717'}</span>
        <span class="label">${index + 1}. ${
          rich(questionLabel(question)).replace(/<\/?p>/g, '')}</span>
      </div>`;
  }).join('');

  $content().innerHTML = `
    <div class="study">
      <div class="study-top">
        <button class="btn btn-secondary btn-sm" data-action="exitQuiz">${esc(t('exit_session'))}</button>
        <span class="title">${esc(quiz.name)}</span>
      </div>
      <div class="q-scroll">
        <div class="result-card">
          <div class="result-score">${correct} / ${total}</div>
          <div class="result-sub">${esc(t('score_line', { correct, total }))}</div>
          <div class="result-list">${rows}</div>
          <div class="result-actions">
            <button class="btn btn-primary" data-action="exitQuiz">${esc(t('done'))}</button>
            ${wrongCount ? `
              <button class="btn btn-secondary" data-action="retryWrong">
                ${esc(t('retry_wrong', { n: wrongCount }))}
              </button>` : ''}
          </div>
        </div>
      </div>
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
    saveProgress();
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
    saveProgress();   // the retry is a run of its own and resumes like any other
  },

  exitQuiz: async () => {
    // Every graded answer is already on the server; this only catches an
    // advance that had not been flushed yet.
    const unfinished = S.quiz && !S.quiz.finished
      && S.quiz.states.some((state) => state.answered);
    if (unfinished) await saveProgress();
    S.quiz = null;
    if (unfinished) showToast(t('progress_saved'), 1800);
    navigate('quiz');
  },
};
