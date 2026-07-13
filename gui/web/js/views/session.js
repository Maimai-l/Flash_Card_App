/* ════════════════════════════════════════════════════════════════════════
   SESSION PAGE — FSRS-driven: flashcard → FIG → MCQ fallback → Again requeue
   Dynamic queue: after each answer, newly-due words are auto-added.
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from '../core/state.js';
import { api } from '../core/api.js';
import { setTopBar, $content, escHtml, shuffle, stripCite, sfx } from '../core/dom.js';
import { showToast } from '../core/ui.js';
import { saveSession, clearSession } from '../core/session_store.js';
import { renderHome } from './home.js';

// store.PS shape:
//   words       [{word, def, ex, cn}]   — all words seen (flashcard + MCQ pool)
//   queue       [{word, def, ex, cn}]   — live practice queue
//   phase       'flashcard'|'practice'
//   fcIdx       number
//   flipped     bool
//   current     word object
//   mode        'fig'|'mcq'
//   locked      bool
//   startTime   number
//   stats       {answers, correct, again, hard, good, easy}
//   wordResults Map<word→{word,def,rating,label}>  — last rating per word

export async function renderSession() {
  if (!store.PS) {
    const limit = (await api.get_app_info()).daily_new_limit || 20;
    let words = await api.get_session_words(S.bookName, limit);
    const fsrsEmpty = !words || words.error || !words.length;

    if (fsrsEmpty) {
      if (S.debug) {
        // Debug fallback: load random words ignoring FSRS
        words = await api.get_debug_words(S.bookName, limit);
        if (!words || words.error || !words.length) {
          setTopBar('Debug Session', true);
          $content().innerHTML = `<div style="text-align:center;color:var(--text-sub);margin-top:80px;font-size:15px">
            No words in database for book "${escHtml(S.bookName || 'All')}".</div>`;
          return;
        }
        showToast('🐛 Debug: loaded random words (FSRS bypassed)', 2500);
      } else {
        setTopBar('Today\'s Session', true);
        $content().innerHTML = `<div style="text-align:center;color:var(--text-sub);margin-top:80px;font-size:15px">
          Nothing due today. Come back later!</div>`;
        return;
      }
    }

    const normalised = words.map(w => ({
      word: w.word, def: w.definition || '',
      ex: stripCite(w.example || ''), cn: w.chinese || ''
    }));

    store.PS = {
      words:       normalised,
      queue:       shuffle([...normalised]),
      phase:       'flashcard',
      fcIdx:       0,
      flipped:     false,
      current:     null,
      mode:        'fig',
      locked:      false,
      startTime:   0,
      stats:       { answers: 0, correct: 0, again: 0, hard: 0, good: 0, easy: 0 },
      wordResults: new Map(),
      mcqType:     null,   // 'cn_en' | 'en_cn', set in renderMCQ
      mcqCorrect:  null,   // correct option value for current MCQ
    };
  }

  if (store.PS.phase === 'flashcard') {
    _attachFcKeyboard();
    renderSessionFlashcard();
  } else {
    _detachFcKeyboard();
    nextPracticeWord();
  }
}

// ─── Flashcard phase ───────────────────────────────────────────────────────
export function renderSessionFlashcard() {
  const total = store.PS.words.length;
  const i = Math.min(store.PS.fcIdx, total - 1);
  const w = store.PS.words[i];
  const isLast = i >= total - 1;
  const debugTag = S.debug ? `<span style="font-size:11px;color:var(--warning);font-weight:600;margin-right:4px">🐛</span>` : '';
  setTopBar(`Today — Flashcards`, true,
    `${debugTag}<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${i + 1} / ${total}</span>`);

  $content().innerHTML = `
    <div class="question-page">
      <div class="q-progress-bar"><div class="q-progress-fill" style="width:${((i + 1) / total) * 100}%"></div></div>

      <div class="flashcard-wrap" data-action="flipCard" id="fc-wrap">
        <div class="flashcard-inner ${store.PS.flipped ? 'flipped' : ''}" id="fc-inner">
          <div class="flashcard-face">
            <div class="flashcard-hint">Word</div>
            <div style="font-size:42px;font-weight:700;letter-spacing:-.5px">${escHtml(w.word)}</div>
            ${w.cn ? `<div style="font-size:20px;color:var(--text-sub);margin-top:14px">${escHtml(w.cn)}</div>` : ''}
            <div style="font-size:13px;color:var(--border);margin-top:28px">Tap to reveal</div>
          </div>
          <div class="flashcard-face flashcard-back">
            <div class="flashcard-hint">Definition</div>
            <div style="font-size:22px;line-height:1.6;font-weight:500">${escHtml(w.def)}</div>
            ${w.ex ? `<div style="font-size:16px;color:var(--text-sub);margin-top:20px;font-style:italic;line-height:1.6">"${escHtml(w.ex)}"</div>` : ''}
          </div>
        </div>
      </div>

      <div style="display:flex;gap:12px;align-items:center">
        <button class="btn-secondary" data-action="fcNav" data-dir="-1" ${i === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn-primary" data-action="fcNav" data-dir="1">
          ${isLast ? 'Start Practice →' : 'Next →'}
        </button>
      </div>
      <div style="font-size:12px;color:var(--border);margin-top:10px">
        ← → Arrow keys to navigate · Space to flip
      </div>
    </div>`;
}

export function flipCard() {
  sfx('flip');
  store.PS.flipped = !store.PS.flipped;
  const inner = document.getElementById('fc-inner');
  if (inner) inner.classList.toggle('flipped', store.PS.flipped);
}

export function fcNav(dir) {
  sfx('nav');
  store.PS.flipped = false;
  if (dir === 1 && store.PS.fcIdx >= store.PS.words.length - 1) {
    _detachFcKeyboard();
    store.PS.phase = 'practice';
    store.PS.queue = shuffle([...store.PS.words]);
    saveSession();
    nextPracticeWord();
    return;
  }
  store.PS.fcIdx = Math.max(0, Math.min(store.PS.words.length - 1, store.PS.fcIdx + dir));
  saveSession();
  renderSessionFlashcard();
}

// ── Keyboard handler for flashcard phase ───────────────────────────────────
// Attached once per renderSession() call, cleaned up when leaving the session page.
let _fcKeyHandler = null;

export function _attachFcKeyboard() {
  _detachFcKeyboard();
  _fcKeyHandler = (e) => {
    if (!store.PS || store.PS.phase !== 'flashcard') return;
    // Don't hijack keys when an input/textarea has focus
    if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); fcNav(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); fcNav(1); }
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); flipCard();
    }
  };
  window.addEventListener('keydown', _fcKeyHandler);
}

export function _detachFcKeyboard() {
  if (_fcKeyHandler) { window.removeEventListener('keydown', _fcKeyHandler); _fcKeyHandler = null; }
}

// ─── Dynamic due refresh ────────────────────────────────────────────────────
// After every record_answer call, check if FSRS has made any words due again
// (e.g. Again → due in ~1 min, Hard in Learning → due in ~10 min).
// Words already in the queue or currently being answered are excluded.
export async function refreshDueQueue() {
  const inQueue = new Set(store.PS.queue.map(w => w.word.toLowerCase()));
  if (store.PS.current) inQueue.add(store.PS.current.word.toLowerCase());

  const result = await api.get_due_words(S.bookName, [...inQueue]);
  if (!result || result.error || !result.length) return;

  for (const w of result) {
    const norm = { word: w.word, def: w.definition || '', ex: stripCite(w.example || ''), cn: w.chinese || '' };
    store.PS.queue.push(norm);
    if (!store.PS.words.find(x => x.word === w.word)) store.PS.words.push(norm);
  }
}

// ─── Practice phase ────────────────────────────────────────────────────────
export async function nextPracticeWord() {
  if (!store.PS.queue.length) {
    // Final check: any words that became due while we processed the last word?
    await refreshDueQueue();
    if (!store.PS.queue.length) {
      showSessionComplete();
      return;
    }
  }
  store.PS.current   = store.PS.queue.shift();
  store.PS.mode      = 'fig';
  store.PS.locked    = false;
  store.PS.startTime = Date.now();
  renderFIG();
}

function _progressBar() {
  const answered  = store.PS.stats.answers;
  const remaining = store.PS.queue.length + 1;  // +1 for current word
  const total     = answered + remaining;
  return { answered, remaining, total, pct: total ? (answered / total) * 100 : 0 };
}

export function renderFIG() {
  const w = store.PS.current;
  const { answered, total } = _progressBar();
  setTopBar(`Today — Practice`, true,
    `<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${answered} / ${total}</span>`);

  // Build blanked sentence — only use it if:
  //   • word is ≥3 chars (1-2 char words like "a"/"be" are too trivial / match everywhere)
  //   • word actually appears with a word boundary in the example
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  let sentence = null;
  if (w.ex && w.word.length >= 3) {
    const pattern = new RegExp('\\b' + escapeRe(w.word) + '\\w*\\b', 'gi');
    const blanked = w.ex.replace(pattern, m => '_'.repeat(m.length));
    if (blanked !== w.ex) sentence = blanked;   // replace changed something → word was found
  }

  $content().innerHTML = `
    <div class="question-page">
      <div class="q-progress-bar"><div class="q-progress-fill" style="width:${_progressBar().pct}%"></div></div>
      <div id="q-body">
        <div class="question-card">
          <div class="q-type-badge">Fill in the Gap</div>
          ${w.cn ? `<div style="font-size:13px;color:var(--text-sub);margin-bottom:8px">${escHtml(w.cn)}</div>` : ''}
          <div style="font-size:17px;line-height:1.7;margin-bottom:24px">
            ${sentence ? escHtml(sentence) : `<span style="color:var(--text-sub);font-style:italic">Definition: ${escHtml(w.def)}</span>`}
          </div>
          <input class="answer-input" id="answer-input" type="text"
            placeholder="Type the missing word…" autocomplete="off" autocorrect="off" autocapitalize="off">
          <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
            <button class="btn-primary" data-action="submitFIG">Check</button>
          </div>
          <div id="feedback" style="margin-top:12px;text-align:center"></div>
        </div>
      </div>
    </div>`;

  const inp = document.getElementById('answer-input');
  if (inp) {
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') submitFIG(); });
  }
}

export async function submitFIG() {
  if (store.PS.locked) return;
  const inp = document.getElementById('answer-input');
  if (!inp) return;
  store.PS.locked = true;

  const elapsed = (Date.now() - store.PS.startTime) / 1000;
  const w = store.PS.current;
  const _ans = inp.value.trim().toLowerCase();
  const _word = w.word.toLowerCase();
  const isCorrect = _ans === _word || _ans.startsWith(_word);

  inp.disabled = true;
  inp.classList.add(isCorrect ? 'correct' : 'wrong');

  const fb = document.getElementById('feedback');
  if (isCorrect) {
    const rating = elapsed <= 5 ? 4 : 3;
    const label  = elapsed <= 5 ? 'Easy' : 'Good';
    sfx('correct');
    if (fb) fb.innerHTML = `<span class="feedback-msg correct">${label}! ✓</span>`;
    store.PS.stats.answers++;
    store.PS.stats.correct++;
    store.PS.stats[label.toLowerCase()]++;
    store.PS.wordResults.set(w.word, { word: w.word, def: w.def, rating, label });
    await api.record_answer(w.word, rating);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    sfx('wrong');
    if (fb) fb.innerHTML = `<span class="feedback-msg wrong">Answer: ${escHtml(w.word)}</span>`;
    // Wrong on FIG → show MCQ (no record_answer yet — wait for MCQ outcome)
    setTimeout(() => { store.PS.locked = false; store.PS.mode = 'mcq'; store.PS.startTime = Date.now(); renderMCQ(); }, 1200);
  }
}

// MCQ has two subtypes, chosen randomly when entering MCQ:
//   'cn_en' — show definition (中), pick correct English word
//   'en_cn' — show English word, pick correct Chinese meaning (英)
// Falls back to cn_en when current word has no Chinese, or < 3 other words have Chinese.

export function renderMCQ() {
  const w = store.PS.current;
  const { answered, total } = _progressBar();
  setTopBar(`Today — Practice`, true,
    `<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${answered} / ${total}</span>`);

  // Words that have a Chinese definition — needed as distractors for en_cn options
  const defPool = store.PS.words.filter(x => x.word !== w.word && x.def);

  // cn_en requires w.def as prompt; en_cn requires w.def + ≥3 other defs for options
  const canCnEn = !!w.def;
  const canEnCn = !!w.def && defPool.length >= 3;

  // Pick type: prefer random 50/50 when both possible, fall back gracefully
  if (canCnEn && canEnCn) {
    store.PS.mcqType = Math.random() < 0.5 ? 'cn_en' : 'en_cn';
  } else if (canEnCn) {
    store.PS.mcqType = 'en_cn';
  } else {
    store.PS.mcqType = 'cn_en';  // always possible as long as there are other words
  }

  let promptHtml, optsHtml, correctKey;

  if (store.PS.mcqType === 'cn_en') {
    // Prompt: Chinese definition → Options: 4 English words (no Chinese anywhere)
    correctKey = w.word;
    const others = shuffle(store.PS.words.filter(x => x.word !== w.word)).slice(0, 3);
    const opts   = shuffle([w, ...others]);

    promptHtml = `
      <div class="q-type-badge">中文 → EN</div>
      <div style="font-size:20px;font-weight:600;line-height:1.6;margin-bottom:24px">${escHtml(w.def)}</div>`;
    optsHtml = opts.map(opt => `
      <div class="mcq-opt" data-val="${escHtml(opt.word)}" data-action="answerMCQ">
        ${escHtml(opt.word)}
      </div>`).join('');

  } else {
    // Prompt: English word → Options: 4 Chinese definitions (no English in options)
    correctKey = w.def;
    const distractors = shuffle([...defPool]).slice(0, 3);
    const opts = shuffle([
      { val: w.def,    display: w.def },
      ...distractors.map(x => ({ val: x.def, display: x.def })),
    ]);

    promptHtml = `
      <div class="q-type-badge">EN → 中文</div>
      <div style="font-size:30px;font-weight:700;letter-spacing:-.5px;margin-bottom:24px">${escHtml(w.word)}</div>`;
    optsHtml = opts.map(opt => `
      <div class="mcq-opt" data-val="${escHtml(opt.val)}" data-action="answerMCQ"
           style="font-size:13px;text-align:left;padding:10px 14px;line-height:1.5">
        ${escHtml(opt.display.slice(0, 50))}${opt.display.length > 50 ? '…' : ''}
      </div>`).join('');
  }

  // Store correct key on PS so answerMCQ can read it without inline JS
  store.PS.mcqCorrect = correctKey;

  $content().innerHTML = `
    <div class="question-page">
      <div class="q-progress-bar"><div class="q-progress-fill" style="width:${_progressBar().pct}%"></div></div>
      <div id="q-body">
        <div class="question-card">
          ${promptHtml}
          <div class="mcq-grid" id="mcq-opts">${optsHtml}</div>
        </div>
      </div>
    </div>`;
}

export async function answerMCQ(el) {
  if (store.PS.locked) return;
  store.PS.locked = true;
  const w = store.PS.current;
  const correctKey = store.PS.mcqCorrect;
  const isCorrect = el.dataset.val === correctKey;

  document.querySelectorAll('.mcq-opt').forEach(opt => {
    opt.classList.add('locked');
    if (opt.dataset.val === correctKey) opt.classList.add(isCorrect ? 'correct' : 'reveal');
  });
  if (!isCorrect) el.classList.add('wrong');

  store.PS.stats.answers++;
  if (isCorrect) {
    sfx('hard');
    // MCQ correct after FIG wrong → Hard
    store.PS.stats.correct++;
    store.PS.stats.hard++;
    store.PS.wordResults.set(w.word, { word: w.word, def: w.def, rating: 2, label: 'Hard' });
    await api.record_answer(w.word, 2);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    sfx('wrong');
    // MCQ wrong → Again, requeue
    store.PS.stats.again++;
    store.PS.wordResults.set(w.word, { word: w.word, def: w.def, rating: 1, label: 'Again' });
    await api.record_answer(w.word, 1);
    store.PS.queue.push(w);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 1400);
  }
}

// ─── Session complete ───────────────────────────────────────────────────────

export async function showSessionComplete() {
  sfx('success');
  setTopBar('Session Complete', true);  // back button → home
  clearSession();
  await api.complete_session();

  // Capture stats + words before clearing PS
  const st          = store.PS.stats;
  const wordResults = store.PS.wordResults;

  store.PS = null;

  const pct        = st.answers ? Math.round((st.correct / st.answers) * 100) : 0;
  const uniqueWords = wordResults.size;

  const ratingColor = { Easy: '#34C759', Good: '#007AFF', Hard: '#FF9500', Again: '#FF3B30' };

  const wordRows = [...wordResults.values()].map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(r.word)}</div>
        <div style="font-size:12px;color:var(--text-sub);margin-top:2px">${escHtml(r.def.slice(0, 60))}${r.def.length > 60 ? '…' : ''}</div>
      </div>
      <div style="font-size:12px;font-weight:600;color:${ratingColor[r.label] || '#888'};
                  background:${ratingColor[r.label]}22;border-radius:6px;padding:3px 9px;flex-shrink:0;margin-left:12px">
        ${r.label}
      </div>
    </div>`).join('');

  // Scrollable wrapper — overrides #content's overflow:hidden for this page only
  $content().innerHTML = `
    <div style="flex:1;overflow-y:auto;min-height:0">
      <div style="padding:0 0 40px">

        <!-- Hero stat card -->
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;
                    padding:24px;margin-bottom:20px;text-align:center">
          <div style="font-size:48px;margin-bottom:8px">🎉</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:4px">Session Complete!</div>
          <div style="font-size:14px;color:var(--text-sub)">FSRS has scheduled your next reviews.</div>

          <div style="display:flex;justify-content:center;gap:24px;margin-top:20px">
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${uniqueWords}</div>
              <div style="font-size:12px;color:var(--text-sub)">Words</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${pct}%</div>
              <div style="font-size:12px;color:var(--text-sub)">Accuracy</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${st.answers}</div>
              <div style="font-size:12px;color:var(--text-sub)">Answers</div>
            </div>
          </div>

          <div style="display:flex;justify-content:center;gap:10px;margin-top:16px;flex-wrap:wrap">
            ${[['Easy','#34C759',st.easy],['Good','#007AFF',st.good],['Hard','#FF9500',st.hard],['Again','#FF3B30',st.again]]
              .filter(([,, n]) => n > 0)
              .map(([label, color, n]) => `
                <div style="background:${color}22;color:${color};border-radius:8px;
                            padding:4px 12px;font-size:12px;font-weight:600">
                  ${label} × ${n}
                </div>`).join('')}
          </div>
        </div>

        <!-- Words reviewed -->
        ${uniqueWords > 0 ? `
          <div class="section-label">Words Reviewed</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
                      padding:0 16px;margin-bottom:20px">
            ${wordRows}
          </div>` : ''}

        <button class="btn-primary w100" data-action="finishSession">Back to Main Page</button>
      </div>
    </div>`;
}

export async function finishSession() {
  S.page = 'home';
  S.history = [];
  await renderHome();
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  flipCard: () => flipCard(),
  fcNav: (el) => fcNav(Number(el.dataset.dir)),
  submitFIG: () => submitFIG(),
  answerMCQ: (el) => answerMCQ(el),
  finishSession: () => finishSession(),
};
