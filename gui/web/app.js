/* ════════════════════════════════════════════════════════════════════════
   FlashCard App — PyWebView SPA
   ════════════════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────────────────
const S = {
  history:  [],      // page stack for back navigation
  page:     'home',
  bookName: null,    // currently selected book
  calMonth: null,    // {year, month} for calendar display
  debug:    false,   // debug mode toggle
  // Game subsystem
  gameId:         null,  // selected game_id string
  gameSession:    null,  // {session_id, words, config, game_id, word_count}
  gameResultData: null,  // {score, accuracy, fsrs_updated, wordResults, game_id}
};

// Practice sub-state (reset each session)
let PS = null;

// ── Session persistence ────────────────────────────────────────────────────
const SESSION_STORE_KEY = 'flashcard_session_v1';

function saveSession() {
  if (!PS || !S.bookName) return;
  // Put the word currently being shown back at front so it's re-presented on continue
  const queueToSave = (PS.phase === 'practice' && PS.current)
    ? [PS.current, ...PS.queue]
    : [...PS.queue];
  try {
    localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({
      bookName:    S.bookName,
      words:       PS.words,
      queue:       queueToSave,
      phase:       PS.phase,
      fcIdx:       PS.fcIdx,
      stats:       PS.stats,
      wordResults: [...PS.wordResults.entries()],
      savedAt:     Date.now(),
    }));
  } catch (_) {}
}

function loadSession(bookName) {
  try {
    const raw = localStorage.getItem(SESSION_STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.bookName !== bookName) return null;
    // Expire sessions from previous calendar days
    if (new Date(data.savedAt).toLocaleDateString() !== new Date().toLocaleDateString()) {
      clearSession(); return null;
    }
    return data;
  } catch (_) { return null; }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_STORE_KEY); } catch (_) {}
}

function continueSession() {
  const saved = loadSession(S.bookName);
  if (!saved) { startSession(); return; }
  PS = {
    words:       saved.words,
    queue:       saved.queue,
    phase:       saved.phase,
    fcIdx:       saved.fcIdx || 0,
    flipped:     false,
    current:     null,
    mode:        'fig',
    locked:      false,
    startTime:   0,
    stats:       saved.stats || { answers: 0, correct: 0, again: 0, hard: 0, good: 0, easy: 0 },
    wordResults: new Map(saved.wordResults || []),
    mcqType:     null,
    mcqCorrect:  null,
  };
  navigate('session');
}

// ── API wrapper ───────────────────────────────────────────────────────────
const api = new Proxy({}, {
  get(_, method) {
    return (...args) => window.pywebview.api[method](...args);
  }
});

// Strip leading "[N]" citation markers from example sentences (e.g. "[1]He left" → "He left")
function stripCite(s) {
  return (s || '').replace(/^\[\d+\]\s*/, '');
}

// ── Utilities ─────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, duration = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function showConfirm(title, body, confirmLabel, onConfirm, dangerous = true) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent = body;
  const btn = document.getElementById('modal-confirm');
  btn.textContent = confirmLabel;
  btn.style.background = dangerous ? 'var(--danger)' : 'var(--text-main)';
  btn.onclick = () => { closeOverlay(); onConfirm(); };
  document.getElementById('overlay').style.display = 'flex';
}

function closeOverlay(e) {
  if (e && e.target !== document.getElementById('overlay')) return;
  document.getElementById('overlay').style.display = 'none';
}

function setTopBar(title, showBack, extraActions = '') {
  document.getElementById('topbar-title').textContent = title;
  document.getElementById('back-btn').style.display = showBack ? 'inline-flex' : 'none';
  document.getElementById('topbar-actions').innerHTML = extraActions;
}

function $content() { return document.getElementById('content'); }

function loading() {
  $content().innerHTML = '<div class="spinner"></div>';
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// ── Router ────────────────────────────────────────────────────────────────
function navigate(page, params = {}) {
  S.history.push(S.page);
  Object.assign(S, params);
  S.page = page;
  render();
}

function goBack() {
  if (!S.history.length) return;
  if (S.page === 'session' && PS) saveSession();  // persist progress before leaving
  // Clean up any running game timers/poll
  if (GS) {
    if (GS._pollTimer)   clearInterval(GS._pollTimer);
    if (GS.timerId)      clearInterval(GS.timerId);
    if (GS.roundTimerId) clearInterval(GS.roundTimerId);
    if (GS._msgHandler)  window.removeEventListener('message', GS._msgHandler);
    GS = null;
  }
  S.page = S.history.pop();
  PS = null;
  render();
}

function _debugBtnHtml() {
  return `<button class="icon-btn ${S.debug ? 'debug-active' : ''}"
    onclick="toggleDebug()" title="Toggle Debug Mode" style="font-size:13px;padding:4px 8px">
    🐛
  </button>`;
}

function toggleDebug() {
  S.debug = !S.debug;
  showToast(S.debug ? 'Debug mode ON' : 'Debug mode OFF', 1500);
  render();
}

async function render() {
  loading();
  switch (S.page) {
    case 'home':         await renderHome();        break;
    case 'session':      await renderSession();     break;
    case 'import':       await renderImport();      break;
    case 'settings':     await renderSettings();    break;
    case 'debug':        await renderDebug();       break;
    case 'games':        await renderGames();       break;
    case 'game_config':  await renderGameConfig();  break;
    case 'game_play':    await renderGamePlay();    break;
    case 'game_results': await renderGameResults(); break;
    default:             await renderHome();
  }
}

/* ════════════════════════════════════════════════════════════════════════
   HOME PAGE
   ════════════════════════════════════════════════════════════════════════ */
async function renderHome() {
  setTopBar('Flashcard App', false, _debugBtnHtml());

  const [books, calInfo] = await Promise.all([
    api.get_book_names(),
    api.get_calendar_info(),
  ]);

  if (!S.bookName && books.length) S.bookName = books[0];
  const today = new Date();
  if (!S.calMonth) S.calMonth = { year: today.getFullYear(), month: today.getMonth() + 1 };

  // Auto-check what FSRS has scheduled — no manual trigger needed
  const rawStats = S.bookName
    ? await api.get_today_stats(S.bookName)
    : { new_count: 0, review_count: 0, total_due: 0, today_done: false, daily_new_limit: 20 };
  const statsError = rawStats && rawStats.error ? rawStats.error : null;
  const stats = statsError ? { new_count: 0, review_count: 0, total_due: 0, today_done: false } : rawStats;

  const bookOpts = books.map(b =>
    `<option value="${escHtml(b)}" ${b === S.bookName ? 'selected' : ''}>${escHtml(b)}</option>`
  ).join('');

  const done     = stats.today_done;
  const total    = stats.total_due || 0;
  const newCnt   = stats.new_count || 0;
  const revCnt   = stats.review_count || 0;
  const disabled = total === 0;  // only block when nothing is due; done is informational only

  // Check for in-progress session saved to localStorage
  const savedSession = loadSession(S.bookName);
  const hasSaved = savedSession !== null && (
    savedSession.phase === 'flashcard' || savedSession.queue.length > 0
  );
  const savedLeft = hasSaved
    ? (savedSession.phase === 'flashcard'
        ? `flashcards (${savedSession.words.length} words)`
        : `${savedSession.queue.length} left`)
    : '';

  const sessionCard = `
    <div class="list-group">
      <div style="padding:16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="font-size:15px;font-weight:600">Today's Session</div>
          <div style="font-size:13px;font-weight:500;color:${done ? 'var(--success)' : (statsError ? 'var(--danger)' : '#007AFF')}">
            ${done ? 'Done ✓' : (statsError ? 'Error' : (total === 0 ? 'Nothing due' : `${total} word${total !== 1 ? 's' : ''}`))}
          </div>
        </div>
        ${statsError
          ? `<div style="font-size:12px;color:var(--danger);margin-bottom:14px">${escHtml(statsError)}</div>`
          : `<div style="font-size:12px;color:var(--text-sub);margin-bottom:14px">${newCnt} new &nbsp;·&nbsp; ${revCnt} due for review</div>`
        }
        ${hasSaved ? `
          <button class="btn-primary w100" onclick="continueSession()">
            Continue — ${savedLeft}
          </button>
          <button class="btn-secondary w100" style="margin-top:8px" onclick="startSession()" ${disabled && !S.debug ? 'disabled' : ''}>
            Start New Session
          </button>
        ` : `
          <button class="btn-primary w100" onclick="startSession()" ${disabled && !S.debug ? 'disabled' : ''}>
            ${S.debug ? '🐛 Debug Session' : 'Start Session'}
          </button>
        `}
        <button class="btn-secondary w100" style="margin-top:8px" onclick="openGamesFromHome()">
          Mini Games
        </button>
        ${S.debug ? `<button class="btn-secondary w100" style="margin-top:8px" onclick="navigate('debug')">DB Inspector</button>` : ''}
      </div>
    </div>`;

  $content().innerHTML = `
    <div class="home-layout">
      <div class="home-left">
        <!-- Word Book -->
        <div>
          <div class="section-label">
            Word Book
            <button class="section-label-action" onclick="navigate('import')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Import
            </button>
          </div>
          <div class="list-group" style="margin-bottom:20px">
            <div class="list-row" style="border:none;padding:0">
              <select class="styled-select" id="book-select" onchange="onBookChange(this.value)">
                ${books.length ? bookOpts : '<option value="">No books yet</option>'}
              </select>
            </div>
          </div>
        </div>

        <!-- Today's session card -->
        <div class="section-label">Today</div>
        ${sessionCard}

        <div class="home-spacer"></div>
      </div>

      <!-- Calendar -->
      <div class="home-right" id="cal-container">
        ${buildCalendarHTML(calInfo)}
      </div>
    </div>`;
}

function onBookChange(val) {
  S.bookName = val;
  renderHome();
}

async function startSession() {
  if (!S.bookName) return;
  clearSession();
  PS = null;
  navigate('session');
}

/* ════════════════════════════════════════════════════════════════════════
   CALENDAR
   ════════════════════════════════════════════════════════════════════════ */
function buildCalendarHTML(calInfo) {
  const { year, month } = S.calMonth;
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today = new Date();

  const firstDay = new Date(year, month - 1, 1);
  const startWd = (firstDay.getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month, 0).getDate();

  const weekdays = ['M','T','W','T','F','S','S'];
  const headerCells = weekdays.map(d => `<div class="cal-header-cell">${d}</div>`).join('');

  let date = 1 - startWd;
  let weeksHtml = '';
  for (let w = 0; w < 6; w++) {
    let rowHtml = '';
    for (let d = 0; d < 7; d++) {
      if (date > 0 && date <= daysInMonth) {
        const mm = String(month).padStart(2, '0');
        const dd = String(date).padStart(2, '0');
        const iso = `${year}-${mm}-${dd}`;
        const isToday = (year === today.getFullYear() && month === today.getMonth() + 1 && date === today.getDate());
        const val = calInfo[iso];
        let dotColor = null;
        if (val === 1) dotColor = '#34C759';
        else if (val === 2) dotColor = '#007AFF';
        else if (val === 3) dotColor = '#FF9500';
        const dotHtml = dotColor
          ? `<div class="cal-dot" style="background:${dotColor}"></div>`
          : `<div style="width:5px;height:5px"></div>`;
        rowHtml += `
          <div class="cal-cell">
            <div class="cal-num ${isToday ? 'today' : ''}">${date}</div>
            ${dotHtml}
          </div>`;
      } else {
        rowHtml += `<div class="cal-cell"><div class="cal-num dim"></div><div style="height:5px"></div></div>`;
      }
      date++;
    }
    weeksHtml += `<div class="cal-week">${rowHtml}</div>`;
  }

  return `
    <div class="cal-nav">
      <button class="icon-btn" onclick="calNav(-1)" style="flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="cal-month-label">${monthNames[month - 1]} ${year}</div>
      <button class="icon-btn" onclick="calNav(1)" style="flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
    <div class="cal-grid">
      <div class="cal-week">${headerCells.replace(/class="cal-header-cell"/g, 'class="cal-header-cell"')}</div>
      ${weeksHtml}
    </div>
    <div class="cal-legend">
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#34C759"></div>All done</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#007AFF"></div>Learned</div>
      <div class="cal-legend-item"><div class="cal-legend-dot" style="background:#FF9500"></div>Reviewed</div>
    </div>`;
}

async function calNav(dir) {
  let { year, month } = S.calMonth;
  month += dir;
  if (month > 12) { month = 1; year++; }
  if (month < 1)  { month = 12; year--; }
  S.calMonth = { year, month };
  const calInfo = await api.get_calendar_info();
  const cal = document.getElementById('cal-container');
  if (cal) cal.innerHTML = buildCalendarHTML(calInfo);
}

/* ════════════════════════════════════════════════════════════════════════
   SESSION PAGE — FSRS-driven: flashcard → FIG → MCQ fallback → Again requeue
   Dynamic queue: after each answer, newly-due words are auto-added.
   ════════════════════════════════════════════════════════════════════════ */

// PS shape:
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

async function renderSession() {
  if (!PS) {
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

    PS = {
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

  if (PS.phase === 'flashcard') {
    renderSessionFlashcard();
  } else {
    nextPracticeWord();
  }
}

// ─── Flashcard phase ───────────────────────────────────────────────────────
function renderSessionFlashcard() {
  const total = PS.words.length;
  const i = Math.min(PS.fcIdx, total - 1);
  const w = PS.words[i];
  const isLast = i >= total - 1;
  const debugTag = S.debug ? `<span style="font-size:11px;color:var(--warning);font-weight:600;margin-right:4px">🐛</span>` : '';
  setTopBar(`Today — Flashcards`, true,
    `${debugTag}<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${i + 1} / ${total}</span>`);

  $content().innerHTML = `
    <div class="question-page">
      <div class="q-progress-bar"><div class="q-progress-fill" style="width:${((i + 1) / total) * 100}%"></div></div>

      <div class="flashcard-wrap" onclick="flipCard()" id="fc-wrap">
        <div class="flashcard-inner ${PS.flipped ? 'flipped' : ''}" id="fc-inner">
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
        <button class="btn-secondary" onclick="fcNav(-1)" ${i === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn-primary" onclick="fcNav(1)">
          ${isLast ? 'Start Practice →' : 'Next →'}
        </button>
      </div>
    </div>`;
}

function flipCard() {
  PS.flipped = !PS.flipped;
  const inner = document.getElementById('fc-inner');
  if (inner) inner.classList.toggle('flipped', PS.flipped);
}

function fcNav(dir) {
  PS.flipped = false;
  if (dir === 1 && PS.fcIdx >= PS.words.length - 1) {
    PS.phase = 'practice';
    PS.queue = shuffle([...PS.words]);
    saveSession();
    nextPracticeWord();
    return;
  }
  PS.fcIdx = Math.max(0, Math.min(PS.words.length - 1, PS.fcIdx + dir));
  saveSession();
  renderSessionFlashcard();
}

// ─── Dynamic due refresh ────────────────────────────────────────────────────
// After every record_answer call, check if FSRS has made any words due again
// (e.g. Again → due in ~1 min, Hard in Learning → due in ~10 min).
// Words already in the queue or currently being answered are excluded.
async function refreshDueQueue() {
  const inQueue = new Set(PS.queue.map(w => w.word.toLowerCase()));
  if (PS.current) inQueue.add(PS.current.word.toLowerCase());

  const result = await api.get_due_words(S.bookName, [...inQueue]);
  if (!result || result.error || !result.length) return;

  for (const w of result) {
    const norm = { word: w.word, def: w.definition || '', ex: stripCite(w.example || ''), cn: w.chinese || '' };
    PS.queue.push(norm);
    if (!PS.words.find(x => x.word === w.word)) PS.words.push(norm);
  }
}

// ─── Practice phase ────────────────────────────────────────────────────────
async function nextPracticeWord() {
  if (!PS.queue.length) {
    // Final check: any words that became due while we processed the last word?
    await refreshDueQueue();
    if (!PS.queue.length) {
      showSessionComplete();
      return;
    }
  }
  PS.current   = PS.queue.shift();
  PS.mode      = 'fig';
  PS.locked    = false;
  PS.startTime = Date.now();
  renderFIG();
}

function _progressBar() {
  const answered  = PS.stats.answers;
  const remaining = PS.queue.length + 1;  // +1 for current word
  const total     = answered + remaining;
  return { answered, remaining, total, pct: total ? (answered / total) * 100 : 0 };
}

function renderFIG() {
  const w = PS.current;
  const { answered, total } = _progressBar();
  setTopBar(`Today — Practice`, true,
    `<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${answered} / ${total}</span>`);

  // Build blanked sentence — only use it if:
  //   • word is ≥3 chars (1-2 char words like "a"/"be" are too trivial / match everywhere)
  //   • word actually appears with a word boundary in the example
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  let sentence = null;
  if (w.ex && w.word.length >= 3) {
    const pattern = new RegExp('\\b' + escapeRe(w.word) + '\\b', 'gi');
    const blanked = w.ex.replace(pattern, '_'.repeat(w.word.length));
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
            <button class="btn-primary" onclick="submitFIG()">Check</button>
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

async function submitFIG() {
  if (PS.locked) return;
  const inp = document.getElementById('answer-input');
  if (!inp) return;
  PS.locked = true;

  const elapsed = (Date.now() - PS.startTime) / 1000;
  const w = PS.current;
  const isCorrect = inp.value.trim().toLowerCase() === w.word.toLowerCase();

  inp.disabled = true;
  inp.classList.add(isCorrect ? 'correct' : 'wrong');

  const fb = document.getElementById('feedback');
  if (isCorrect) {
    const rating = elapsed <= 5 ? 4 : 3;
    const label  = elapsed <= 5 ? 'Easy' : 'Good';
    if (fb) fb.innerHTML = `<span class="feedback-msg correct">${label}! ✓</span>`;
    PS.stats.answers++;
    PS.stats.correct++;
    PS.stats[label.toLowerCase()]++;
    PS.wordResults.set(w.word, { word: w.word, def: w.def, rating, label });
    await api.record_answer(w.word, rating);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    if (fb) fb.innerHTML = `<span class="feedback-msg wrong">Answer: ${escHtml(w.word)}</span>`;
    // Wrong on FIG → show MCQ (no record_answer yet — wait for MCQ outcome)
    setTimeout(() => { PS.locked = false; PS.mode = 'mcq'; PS.startTime = Date.now(); renderMCQ(); }, 1200);
  }
}

// MCQ has two subtypes, chosen randomly when entering MCQ:
//   'cn_en' — show definition (中), pick correct English word
//   'en_cn' — show English word, pick correct Chinese meaning (英)
// Falls back to cn_en when current word has no Chinese, or < 3 other words have Chinese.

function renderMCQ() {
  const w = PS.current;
  const { answered, total } = _progressBar();
  setTopBar(`Today — Practice`, true,
    `<span style="font-size:13px;color:var(--text-sub);padding:0 8px">${answered} / ${total}</span>`);

  // Words that have a Chinese definition — needed as distractors for en_cn options
  const defPool = PS.words.filter(x => x.word !== w.word && x.def);

  // cn_en requires w.def as prompt; en_cn requires w.def + ≥3 other defs for options
  const canCnEn = !!w.def;
  const canEnCn = !!w.def && defPool.length >= 3;

  // Pick type: prefer random 50/50 when both possible, fall back gracefully
  if (canCnEn && canEnCn) {
    PS.mcqType = Math.random() < 0.5 ? 'cn_en' : 'en_cn';
  } else if (canEnCn) {
    PS.mcqType = 'en_cn';
  } else {
    PS.mcqType = 'cn_en';  // always possible as long as there are other words
  }

  let promptHtml, optsHtml, correctKey;

  if (PS.mcqType === 'cn_en') {
    // Prompt: Chinese definition → Options: 4 English words (no Chinese anywhere)
    correctKey = w.word;
    const others = shuffle(PS.words.filter(x => x.word !== w.word)).slice(0, 3);
    const opts   = shuffle([w, ...others]);

    promptHtml = `
      <div class="q-type-badge">中文 → EN</div>
      <div style="font-size:20px;font-weight:600;line-height:1.6;margin-bottom:24px">${escHtml(w.def)}</div>`;
    optsHtml = opts.map(opt => `
      <div class="mcq-opt" data-val="${escHtml(opt.word)}" onclick="answerMCQ(this)">
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
      <div class="mcq-opt" data-val="${escHtml(opt.val)}" onclick="answerMCQ(this)"
           style="font-size:13px;text-align:left;padding:10px 14px;line-height:1.5">
        ${escHtml(opt.display.slice(0, 50))}${opt.display.length > 50 ? '…' : ''}
      </div>`).join('');
  }

  // Store correct key on PS so answerMCQ can read it without inline JS
  PS.mcqCorrect = correctKey;

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

async function answerMCQ(el) {
  if (PS.locked) return;
  PS.locked = true;
  const w = PS.current;
  const correctKey = PS.mcqCorrect;
  const isCorrect = el.dataset.val === correctKey;

  document.querySelectorAll('.mcq-opt').forEach(opt => {
    opt.classList.add('locked');
    if (opt.dataset.val === correctKey) opt.classList.add(isCorrect ? 'correct' : 'reveal');
  });
  if (!isCorrect) el.classList.add('wrong');

  PS.stats.answers++;
  if (isCorrect) {
    // MCQ correct after FIG wrong → Hard
    PS.stats.correct++;
    PS.stats.hard++;
    PS.wordResults.set(w.word, { word: w.word, def: w.def, rating: 2, label: 'Hard' });
    await api.record_answer(w.word, 2);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    // MCQ wrong → Again, requeue
    PS.stats.again++;
    PS.wordResults.set(w.word, { word: w.word, def: w.def, rating: 1, label: 'Again' });
    await api.record_answer(w.word, 1);
    PS.queue.push(w);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 1400);
  }
}

// ─── Session complete ───────────────────────────────────────────────────────
// Holds words from the just-finished session so the Card Match entry can use them.
let _sessionCompleteWords = [];

async function showSessionComplete() {
  setTopBar('Session Complete', true);  // back button → home
  clearSession();
  await api.complete_session();

  // Capture stats + words before clearing PS
  const st          = PS.stats;
  const wordResults = PS.wordResults;

  // Build a game-compatible word list from the session for Card Match
  _sessionCompleteWords = [...wordResults.values()].map(r => ({
    word:       r.word,
    definition: r.def || '',
    example:    '',
    chinese:    '',
    phone_us:   '',
    phone_uk:   '',
  }));

  PS = null;

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

  const canPlayCardMatch = _sessionCompleteWords.length >= 3;

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

        <!-- Card Match entry -->
        ${canPlayCardMatch ? `
          <div class="section-label">Practice</div>
          <div class="list-group" style="margin-bottom:16px;cursor:pointer"
               onclick="playCardMatchFromSession()">
            <div style="padding:16px;display:flex;align-items:center;gap:14px">
              <div style="font-size:32px">🎴</div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:15px;margin-bottom:3px">Card Match</div>
                <div style="font-size:13px;color:var(--text-sub)">
                  Flip cards to match today's ${_sessionCompleteWords.length} words with their definitions.
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" style="flex-shrink:0;color:var(--text-sub)">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </div>` : ''}

        <button class="btn-primary w100" onclick="finishSession()">Back to Main Page</button>
      </div>
    </div>`;
}

async function playCardMatchFromSession() {
  if (!_sessionCompleteWords.length) return;
  // Build a fake game session object using the session words directly (no API call)
  const count = Math.min(_sessionCompleteWords.length, 12);
  const words = shuffle([..._sessionCompleteWords]).slice(0, count);
  S.gameSession = {
    session_id: 'session-' + Date.now(),
    game_id:    'card_match',
    words,
    config:     { word_count: count, fsrs_update: false },  // FSRS was already updated in session
    word_count: count,
  };
  S.gameId = 'card_match';
  GS = null;
  navigate('game_play');
}

async function finishSession() {
  S.page = 'home';
  S.history = [];
  await renderHome();
}

/* ════════════════════════════════════════════════════════════════════════
   DEBUG PAGE
   ════════════════════════════════════════════════════════════════════════ */
async function renderDebug() {
  setTopBar('🐛 Debug Inspector', true);
  $content().innerHTML = '<div class="spinner"></div>';

  const [stats, games] = await Promise.all([api.get_db_stats(), api.get_game_list()]);
  if (stats.error) {
    $content().innerHTML = `<div class="result-msg err">Error: ${escHtml(stats.error)}</div>`;
    return;
  }

  const stateRows = Object.entries(stats.fsrs_states || {}).map(([label, cnt]) => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px;color:var(--text-sub)">${escHtml(label)}</span>
      <span style="font-size:13px;font-weight:600">${cnt}</span>
    </div>`).join('');

  const bookRows = (stats.books || []).map(b => `
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:13px">${escHtml(b.name)}</span>
      <span style="font-size:13px;font-weight:600;color:var(--text-sub)">${b.count} words</span>
    </div>`).join('');

  $content().innerHTML = `
    <div style="padding:0 0 40px">

      <!-- Schema & word counts -->
      <div class="section-label">Database Overview</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">
          ${[
            ['Schema Version', stats.schema_version],
            ['Total Words', stats.total_words],
            ['Words w/ Definition', stats.words_with_definition],
            ['Never Seen (new)', stats.never_seen],
            ['Due Now', stats.due_now],
          ].map(([label, val]) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:13px;color:var(--text-sub)">${label}</span>
              <span style="font-size:13px;font-weight:600">${val}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- FSRS state distribution -->
      <div class="section-label">FSRS State Distribution</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">${stateRows || '<div style="padding:8px 0;font-size:13px;color:var(--text-sub)">No data</div>'}</div>
      </div>

      <!-- Books -->
      <div class="section-label">Books</div>
      <div class="list-group" style="margin-bottom:20px">
        <div style="padding:0 16px">${bookRows || '<div style="padding:8px 0;font-size:13px;color:var(--text-sub)">No books</div>'}</div>
      </div>

      <!-- FSRS Scheduler Tester -->
      <div class="section-label">FSRS Scheduler Tester</div>
      <div class="list-group" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:120px">
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Word</div>
            <input class="form-input" id="dbg-word" type="text" placeholder="e.g. apple" style="margin:0">
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Rating</div>
            <select class="styled-select" id="dbg-rating" style="width:130px">
              <option value="1">1 — Again</option>
              <option value="2">2 — Hard</option>
              <option value="3" selected>3 — Good</option>
              <option value="4">4 — Easy</option>
            </select>
          </div>
          <button class="btn-primary" onclick="debugTestFSRS()" style="height:40px;padding:0 20px">Test</button>
        </div>
        <div id="dbg-fsrs-result" style="margin-top:12px;font-size:13px;font-family:monospace;color:var(--text-sub)"></div>
      </div>

      <!-- Force load session -->
      <div class="section-label">Force Load Session</div>
      <div class="list-group" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:10px;align-items:flex-end">
          <div style="flex:1">
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Word count</div>
            <input class="form-input" id="dbg-count" type="number" value="10" min="1" max="50" style="margin:0">
          </div>
          <button class="btn-primary" onclick="debugForceSession()" style="height:40px;padding:0 20px">Load Session</button>
        </div>
        <div style="font-size:11px;color:var(--text-sub);margin-top:8px">
          Loads N random words from "${escHtml(S.bookName || 'All')}" ignoring FSRS — great for testing GUI.
        </div>
      </div>

      <!-- Force Load Game (debug) -->
      <div class="section-label">Force Load Game</div>
      <div class="list-group" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:140px">
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Game</div>
            <select class="styled-select" id="dbg-game-select">
              ${(games || []).map(g => `<option value="${escHtml(g.id)}">${escHtml(g.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Words</div>
            <input class="form-input" id="dbg-game-count" type="number" value="6" min="3" max="20"
                   style="margin:0;width:70px">
          </div>
          <button class="btn-primary" onclick="debugForceGame()" style="height:40px;padding:0 20px">Load Game</button>
        </div>
        <div style="font-size:11px;color:var(--text-sub);margin-top:8px">
          Starts any game with random words and FSRS updates off — tests game UI without affecting progress.
        </div>
      </div>

      <button class="btn-ghost w100" onclick="goBack()">← Back to Home</button>
    </div>`;
}

async function debugTestFSRS() {
  const word = document.getElementById('dbg-word')?.value?.trim();
  const rating = parseInt(document.getElementById('dbg-rating')?.value || '3');
  const resultEl = document.getElementById('dbg-fsrs-result');
  if (!word) { if (resultEl) resultEl.textContent = 'Enter a word first.'; return; }
  if (resultEl) resultEl.textContent = 'Running…';
  const res = await api.record_answer(word, rating);
  if (resultEl) {
    if (res && res.error) {
      resultEl.innerHTML = `<span style="color:var(--danger)">Error: ${escHtml(res.error)}</span>`;
    } else if (res) {
      resultEl.innerHTML = [
        `due_date: <b>${res.due_date || '—'}</b>`,
        `stability: ${res.stability?.toFixed(4) ?? '—'}`,
        `difficulty: ${res.difficulty?.toFixed(4) ?? '—'}`,
        `state: ${res.state ?? '—'}`,
        `step: ${res.step ?? '—'}`,
      ].join('&nbsp;&nbsp;|&nbsp;&nbsp;');
    }
  }
}

async function debugForceSession() {
  const count = parseInt(document.getElementById('dbg-count')?.value || '10');
  const words = await api.get_debug_words(S.bookName, count);
  if (!words || words.error || !words.length) {
    showToast('No words found', 2000);
    return;
  }
  const normalised = words.map(w => ({
    word: w.word, def: w.definition || '', ex: stripCite(w.example || ''), cn: w.chinese || ''
  }));
  PS = {
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
    mcqType:     null,
    mcqCorrect:  null,
  };
  showToast(`🐛 Loaded ${normalised.length} words (FSRS bypassed)`, 2000);
  navigate('session');
}

function _dbgFsrsBoundaries() {
  try {
    const saved = JSON.parse(localStorage.getItem('dbg_fsrs_boundaries') || '{}');
    return { easy_s: saved.easy_s ?? 3, hard_s: saved.hard_s ?? 10 };
  } catch { return { easy_s: 3, hard_s: 10 }; }
}


async function debugForceGame() {
  const gameId = document.getElementById('dbg-game-select')?.value;
  const count  = parseInt(document.getElementById('dbg-game-count')?.value || '6');
  if (!gameId) return;
  const { easy_s, hard_s } = _dbgFsrsBoundaries();
  // fsrs_update=true in debug so you can test the boundary effect; use a debug book to avoid polluting progress
  const resp = await api.start_game_session(gameId, S.bookName, {
    word_count: count, fsrs_update: false, easy_s, hard_s,
  });
  if (resp.error) { showToast('Error: ' + resp.error, 3500); return; }
  S.gameSession = resp;
  S.gameId      = gameId;
  GS            = null;
  navigate('game_play');
}

/* ════════════════════════════════════════════════════════════════════════
   IMPORT PAGE
   ════════════════════════════════════════════════════════════════════════ */

// Stores lookup results for the words-only tab
let _lookupResults = [];

async function renderImport() {
  setTopBar('Import', true);
  const books = await api.get_book_names();
  const bookOpts = books.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');

  $content().innerHTML = `
    <div class="import-page">
      <div class="section-label" style="padding-left:0;padding-top:16px">Format</div>
      <div class="tab-bar">
        <button class="tab active" id="tab-words" onclick="switchTab('words')">Words Only</button>
        <button class="tab"        id="tab-clip"  onclick="switchTab('clip')">Clipboard</button>
        <button class="tab"        id="tab-txt"   onclick="switchTab('txt')">TXT</button>
        <button class="tab"        id="tab-excel" onclick="switchTab('excel')">Excel</button>
        <button class="tab"        id="tab-json"  onclick="switchTab('json')">JSON</button>
      </div>

      <!-- Target book -->
      <div class="section-label" style="padding-left:0">Target Book</div>
      <div class="list-group" style="margin-bottom:16px">
        <div class="list-row" style="border:none;padding:0">
          <select class="styled-select" id="import-book">
            ${bookOpts}
            <option value="__new__">＋ Create new book…</option>
          </select>
        </div>
      </div>
      <div id="new-book-row" style="display:none;margin-bottom:16px">
        <div class="form-row">
          <label class="form-label">New book name</label>
          <input class="form-input" id="new-book-name" type="text" placeholder="e.g. IELTS Vocabulary">
        </div>
      </div>

      <div id="tab-content">${tabWords()}</div>
      <div id="import-result"></div>
    </div>`;

  document.getElementById('import-book').addEventListener('change', e => {
    document.getElementById('new-book-row').style.display =
      e.target.value === '__new__' ? 'block' : 'none';
  });
}

function switchTab(tab) {
  ['words','clip','txt','excel','json'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.toggle('active', t === tab);
  });
  const content = { words: tabWords, clip: tabClipboard, txt: tabTxt, excel: tabExcel, json: tabJson }[tab];
  document.getElementById('tab-content').innerHTML = content();
  document.getElementById('import-result').innerHTML = '';
  _lookupResults = [];
}

// ── Words Only tab ─────────────────────────────────────────────────────────
function tabWords() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">Paste words — one per line</label>
        <textarea class="form-textarea" id="words-text" style="min-height:140px"
          placeholder="apple&#10;banana&#10;ephemeral&#10;ubiquitous&#10;..."></textarea>
      </div>
      <div style="margin-bottom:12px">
        <button class="btn-secondary" onclick="doLookup()" id="lookup-btn">Look Up in Database</button>
      </div>
      <div id="lookup-preview"></div>
      <div id="lookup-actions" style="display:none;margin-top:16px;display:none">
        <button class="btn-primary" onclick="importLookupResults()">Import Selected</button>
        <span id="lookup-count" style="font-size:13px;color:var(--text-sub);margin-left:12px"></span>
      </div>
    </div>`;
}

async function doLookup() {
  const text = document.getElementById('words-text')?.value || '';
  if (!text.trim()) { showToast('Paste some words first'); return; }

  const btn = document.getElementById('lookup-btn');
  btn.disabled = true; btn.textContent = 'Looking up…';

  const results = await api.lookup_words(text);
  _lookupResults = results;

  btn.disabled = false; btn.textContent = 'Look Up in Database';

  if (!results || !results.length) {
    document.getElementById('lookup-preview').innerHTML =
      '<div style="color:var(--text-sub);font-size:14px">No words found.</div>';
    return;
  }

  const foundCount = results.filter(r => r.found).length;
  const rows = results.map((r, i) => {
    const methodBadge = r.method === 'fuzzy'
      ? `<span class="badge badge-warning" style="margin-left:6px">fuzzy</span>` : '';
    const matchedLabel = r.found
      ? `<span style="font-weight:600">${escHtml(r.matched)}</span>${methodBadge}`
      : `<span style="color:var(--text-sub)">— not found</span>`;
    const def = r.definition ? escHtml(r.definition.slice(0, 80)) + (r.definition.length > 80 ? '…' : '') : '';
    const cn  = r.chinese    ? `<span style="color:var(--text-sub);margin-left:8px">${escHtml(r.chinese.slice(0,20))}</span>` : '';
    return `
      <div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);gap:10px;${!r.found ? 'opacity:.45' : ''}">
        <input type="checkbox" id="chk-${i}" ${r.found ? 'checked' : 'disabled'}
          onchange="updateLookupCount()" style="flex-shrink:0;width:16px;height:16px;cursor:pointer">
        <div style="width:130px;flex-shrink:0;font-size:13px;color:var(--text-sub)">${escHtml(r.input)}</div>
        <div style="width:140px;flex-shrink:0;font-size:14px">${matchedLabel}</div>
        <div style="flex:1;font-size:13px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${def}${cn}</div>
      </div>`;
  }).join('');

  document.getElementById('lookup-preview').innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:4px">
      <div style="display:flex;align-items:center;padding:8px 12px;background:var(--bg);font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;gap:10px">
        <div style="width:16px"></div>
        <div style="width:130px">Input</div>
        <div style="width:140px">Matched</div>
        <div style="flex:1">Definition preview · ${foundCount} found</div>
      </div>
      ${rows}
    </div>`;

  const actionsEl = document.getElementById('lookup-actions');
  actionsEl.style.display = 'flex';
  actionsEl.style.alignItems = 'center';
  updateLookupCount();
}

function updateLookupCount() {
  const checked = document.querySelectorAll('[id^="chk-"]:checked').length;
  const el = document.getElementById('lookup-count');
  if (el) el.textContent = `${checked} word${checked !== 1 ? 's' : ''} selected`;
}

async function importLookupResults() {
  const bookSel = document.getElementById('import-book').value;
  const newBook = bookSel === '__new__';
  const bookname = newBook ? (document.getElementById('new-book-name')?.value?.trim() || '') : bookSel;
  if (!bookname) { showToast('Choose or create a target book'); return; }

  const selected = _lookupResults.filter((r, i) => {
    const chk = document.getElementById(`chk-${i}`);
    return chk && chk.checked && r.found;
  });
  if (!selected.length) { showToast('Nothing selected'); return; }

  const result = await api.import_word_matches(selected, bookname, newBook);
  const ok = typeof result === 'string' && result.startsWith('Successfully');
  document.getElementById('import-result').innerHTML =
    `<div class="result-msg ${ok ? 'ok' : 'err'}">${escHtml(String(result))}</div>`;
}

// ── Other tabs ─────────────────────────────────────────────────────────────
function tabClipboard() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">Paste content (word = definition format)</label>
        <textarea class="form-textarea" id="clip-text" placeholder="apple = a round fruit&#10;banana = a long yellow fruit&#10;..."></textarea>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Field separator</label>
          <input class="form-input" id="clip-field-sep" type="text" value=" = ">
        </div>
        <div class="form-row" style="flex:1">
          <label class="form-label">Entry separator</label>
          <input class="form-input" id="clip-entry-sep" type="text" value="&#10;">
        </div>
      </div>
      <div style="margin-top:4px">
        <button class="btn-primary" onclick="doImport()">Import</button>
      </div>
    </div>`;
}

function tabTxt() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="txt-path" type="text" placeholder="/path/to/file.txt" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" onclick="pickFile('txt-path', ['Text files (*.txt)', 'All files (*.*)'])">Browse…</button>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Field separator</label>
          <input class="form-input" id="txt-field-sep" type="text" value=" = ">
        </div>
        <div class="form-row" style="flex:1">
          <label class="form-label">Entry separator</label>
          <input class="form-input" id="txt-entry-sep" type="text" value="&#10;">
        </div>
      </div>
    </div>`;
}

function tabExcel() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="xl-path" type="text" placeholder="/path/to/file.xlsx" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" onclick="pickFile('xl-path', ['Excel files (*.xlsx *.xls)', 'All files (*.*)'])">Browse…</button>
        </div>
      </div>
      <div style="display:flex;gap:16px">
        <div class="form-row" style="flex:1">
          <label class="form-label">Sheet name</label>
          <input class="form-input" id="xl-sheet" type="text" placeholder="Sheet1">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-row"><label class="form-label">Word column</label><input class="form-input" id="xl-word" type="text" value="word"></div>
        <div class="form-row"><label class="form-label">Definition column</label><input class="form-input" id="xl-def" type="text" value="definition"></div>
        <div class="form-row"><label class="form-label">Example column</label><input class="form-input" id="xl-ex" type="text" value="example"></div>
        <div class="form-row"><label class="form-label">Chinese column</label><input class="form-input" id="xl-cn" type="text" value="chinese"></div>
      </div>
    </div>`;
}

function tabJson() {
  return `
    <div>
      <div class="form-row">
        <label class="form-label">File path</label>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="json-path" type="text" placeholder="/path/to/file.json" style="flex:1">
          <button class="btn-secondary" style="padding:10px 16px;white-space:nowrap" onclick="pickFile('json-path', ['JSON files (*.json)', 'All files (*.*)'])">Browse…</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-row"><label class="form-label">Vocab key</label><input class="form-input" id="json-vocab" type="text" value="word"></div>
        <div class="form-row"><label class="form-label">Definition key</label><input class="form-input" id="json-def" type="text" value="definition"></div>
        <div class="form-row"><label class="form-label">Example key</label><input class="form-input" id="json-ex" type="text" value="example"></div>
        <div class="form-row"><label class="form-label">Chinese key</label><input class="form-input" id="json-cn" type="text" value="chinese"></div>
      </div>
    </div>`;
}

async function pickFile(inputId, fileTypes) {
  const path = await api.open_file_dialog(fileTypes);
  if (path) {
    const el = document.getElementById(inputId);
    if (el) el.value = path;
  }
}

async function doImport() {
  const bookSel = document.getElementById('import-book').value;
  const newBook = bookSel === '__new__';
  let bookname = newBook ? (document.getElementById('new-book-name')?.value?.trim() || '') : bookSel;
  if (!bookname) { showToast('Please enter a book name'); return; }

  const resultEl = document.getElementById('import-result');
  resultEl.innerHTML = '<div style="color:var(--text-sub);font-size:14px;margin-top:8px">Importing…</div>';

  let result;
  const activeTab = document.querySelector('.tab.active')?.id?.replace('tab-','') || 'clip';

  if (activeTab === 'clip') {
    const text = document.getElementById('clip-text')?.value || '';
    const fs = document.getElementById('clip-field-sep')?.value || ' = ';
    const es = document.getElementById('clip-entry-sep')?.value || '\n';
    result = await api.import_clipboard(text, bookname, fs, es, newBook);
  } else if (activeTab === 'txt') {
    const path = document.getElementById('txt-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const fs = document.getElementById('txt-field-sep')?.value || ' = ';
    const es = document.getElementById('txt-entry-sep')?.value || '\n';
    result = await api.import_txt(path, bookname, fs, es, newBook);
  } else if (activeTab === 'excel') {
    const path = document.getElementById('xl-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    result = await api.import_excel(
      path, bookname,
      document.getElementById('xl-sheet')?.value || 'Sheet1',
      document.getElementById('xl-word')?.value || 'word',
      document.getElementById('xl-def')?.value || 'definition',
      document.getElementById('xl-ex')?.value || 'example',
      document.getElementById('xl-cn')?.value || 'chinese',
      newBook
    );
  } else if (activeTab === 'json') {
    const path = document.getElementById('json-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    result = await api.import_json(
      path, bookname,
      document.getElementById('json-vocab')?.value || 'word',
      document.getElementById('json-def')?.value || 'definition',
      document.getElementById('json-ex')?.value || 'example',
      document.getElementById('json-cn')?.value || 'chinese',
      newBook
    );
  }

  const ok = typeof result === 'string' && result.startsWith('Successfully');
  resultEl.innerHTML = `<div class="result-msg ${ok ? 'ok' : 'err'}">${escHtml(String(result))}</div>`;
}

/* ════════════════════════════════════════════════════════════════════════
   SETTINGS PAGE
   ════════════════════════════════════════════════════════════════════════ */
async function renderSettings() {
  setTopBar('Settings', true);
  const appInfo = await api.get_app_info();
  const count = appInfo.daily_new_limit || 20;
  const { easy_s, hard_s } = _dbgFsrsBoundaries();

  $content().innerHTML = `
    <div class="settings-page">
      <!-- Daily Goals -->
      <div class="section-label" style="padding-left:0;padding-top:16px">Daily Goals</div>
      <div class="list-group">
        <div class="list-row">
          <span class="list-row-label">New Cards / Day</span>
          <span id="slider-val" style="font-size:15px;font-weight:500;color:var(--text-main)">${count}</span>
        </div>
        <div style="padding:8px 16px 12px;background:var(--card)">
          <input type="range" id="count-slider" min="10" max="50" step="5" value="${count}"
            oninput="document.getElementById('slider-val').textContent = this.value">
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-sub);padding:6px 16px 0">Drag the slider to adjust cards per session.</div>

      <!-- Data Management -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Data Management</div>
      <div class="list-group">
        <div class="list-row" style="border:none;cursor:pointer" onclick="confirmReset()">
          <span class="list-row-label" style="color:var(--danger);text-align:center">Reset Progress &amp; Imported Books</span>
        </div>
        ${S.debug ? `<div class="list-row" style="border:none;cursor:pointer;border-top:1px solid var(--border)" onclick="confirmFactoryReset()">
          <span class="list-row-label" style="color:var(--danger);text-align:center;opacity:.6">Factory Reset (Dev)</span>
        </div>` : ''}
      </div>
      <div style="font-size:12px;color:var(--text-sub);padding:6px 16px 0">Clears all FSRS progress and removes books you imported. Preset word lists (CET, TOEFL, GRE) are kept.</div>

      ${S.debug ? `
      <!-- FSRS Rating Boundaries (debug only) -->
      <div class="section-label" style="padding-left:0;padding-top:20px">
        Game FSRS Boundaries
        <span style="font-size:11px;color:var(--text-sub);font-weight:400;margin-left:6px">debug only</span>
      </div>
      <div class="list-group" style="padding:16px">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:12px;line-height:1.5">
          Response-time thresholds for mapping game answers to FSRS ratings.
          Only applied to sessions started from <b>Load Game</b> in DB Inspector.
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px">
          <div>
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Easy if under (s)</div>
            <input class="form-input" id="settings-easy-s" type="number" value="${easy_s}"
                   min="1" max="30" step="0.5" style="margin:0">
            <div style="font-size:11px;color:#34C759;margin-top:3px">elapsed &lt; this → Rating 4 (Easy)</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--text-sub);margin-bottom:4px;text-transform:uppercase;font-weight:600">Hard if over (s)</div>
            <input class="form-input" id="settings-hard-s" type="number" value="${hard_s}"
                   min="1" max="60" step="0.5" style="margin:0">
            <div style="font-size:11px;color:#FF9500;margin-top:3px">elapsed &gt; this → Rating 2 (Hard)</div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-sub)">
          Between thresholds → Good (3)&nbsp;&nbsp;·&nbsp;&nbsp;Wrong → Again (1)
        </div>
      </div>
      <div id="settings-boundary-status" style="font-size:12px;padding:4px 16px 0;text-align:center"></div>
      ` : ''}

      <!-- Diagnostics -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Diagnostics</div>
      <div class="list-group" style="margin-bottom:4px">
        <div class="list-row" style="border:none;cursor:pointer" onclick="exportLog()">
          <span class="list-row-label">Export Log File</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-sub);padding:4px 16px 0">Save the app log to diagnose issues.</div>

      <!-- Acknowledgements -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Acknowledgements</div>
      <div class="list-group">
        <div style="padding:16px;font-size:13px;color:var(--text-sub);line-height:1.7">
          <b>Resources &amp; Acknowledgements</b><br><br>
          · Mahavivo – English Wordlists<br>
          · Kaleofeng – Definition &amp; Example Generator (Bing Scraper)<br>
          · Dyeeee – English-Chinese Dictionary<br>
          · COCA bilingual examples and form lists<br>
          · Changhongzi – BNC_COCA_EN2CN Word Bank<br><br>
          We are grateful to all authors and contributors.
        </div>
      </div>

      <div style="margin-top:32px;text-align:center;padding-bottom:32px">
        <button class="btn-primary" onclick="saveSettings()">Save Changes</button>
      </div>
    </div>`;
}

async function saveSettings() {
  const count = parseInt(document.getElementById('count-slider').value);
  const appInfo = await api.get_app_info();
  appInfo.daily_new_limit = count;
  await api.update_app_info(appInfo);

  // Save FSRS boundaries if the debug inputs are present
  const easyEl = document.getElementById('settings-easy-s');
  const hardEl = document.getElementById('settings-hard-s');
  if (easyEl && hardEl) {
    const easy_s = parseFloat(easyEl.value || '3');
    const hard_s = parseFloat(hardEl.value || '10');
    const statusEl = document.getElementById('settings-boundary-status');
    if (easy_s >= hard_s) {
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--danger)">Easy threshold must be less than Hard threshold — not saved.</span>';
    } else {
      localStorage.setItem('dbg_fsrs_boundaries', JSON.stringify({ easy_s, hard_s }));
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--success)">Boundaries saved: Easy &lt;${easy_s}s · Hard &gt;${hard_s}s</span>`;
    }
  }

  showToast('Settings saved.');
}

async function exportLog() {
  const res = await api.export_log();
  if (!res || res.cancelled) return;
  if (res.error) { showToast('Error: ' + res.error, 3000); return; }
  showToast('Log saved to: ' + res.path, 4000);
}

function confirmReset() {
  showConfirm(
    'Reset Progress & Imported Books',
    'This will reset all FSRS learning progress to zero and remove any books you imported. ' +
    'Preset word lists (CET 4+6, TOEFL, GRE) and their words are kept. Cannot be undone.',
    'Reset',
    async () => {
      const res = await api.soft_reset();
      if (res && res.error) { showToast('Error: ' + res.error, 3000); return; }
      clearSession();
      PS = null;
      S.bookName = null;
      S.history = [];
      S.page = 'home';
      showToast('Progress reset. Preset books preserved.', 3000);
      renderHome();
    }
  );
}

function confirmFactoryReset() {
  showConfirm(
    'Factory Reset (Dev)',
    'Wipes the entire database and rebuilds from scratch. All words and progress deleted.',
    'Wipe Everything',
    async () => {
      await api.reset_data();
      clearSession();
      PS = null;
      S.bookName = null;
      S.history = [];
      S.page = 'home';
      showToast('Full factory reset complete.', 3000);
      renderHome();
    }
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MINI GAMES
   ════════════════════════════════════════════════════════════════════════ */

// GS shape (set per-game):
//   session_id, game_id, words, results, idx, locked, score, lives, streak,
//   startTime, mcqCorrect, phase, typed, scrambled, roundTimeLeft,
//   timerId, roundTimerId, _pollTimer

let GS = null;

// ── Shared: submit results → game_results page ─────────────────────────────
async function finishGame(wordResults) {
  if (GS && GS._pollTimer)   clearInterval(GS._pollTimer);
  if (GS && GS.timerId)      clearInterval(GS.timerId);
  if (GS && GS.roundTimerId) clearInterval(GS.roundTimerId);
  const session_id = GS ? GS.session_id : S.gameSession.session_id;
  const game_id    = GS ? GS.game_id    : S.gameSession.game_id;

  // Local sessions (e.g. from session-complete page) are not registered on the server.
  const isLocal = session_id && session_id.startsWith('session-');
  let resp;
  if (isLocal) {
    // Compute score client-side; skip FSRS update (session words were already rated)
    const correct = wordResults.filter(r => r.correct && !r.skipped).length;
    const total   = wordResults.filter(r => !r.skipped).length;
    resp = {
      score:        _matchScore ? _matchScore() : correct * 20,
      accuracy:     total > 0 ? correct / total : 0,
      fsrs_updated: 0,
    };
  } else {
    resp = await api.submit_game_results(session_id, wordResults);
  }

  S.gameResultData = {
    score:        resp.score        ?? 0,
    accuracy:     resp.accuracy     ?? 0,
    fsrs_updated: resp.fsrs_updated ?? 0,
    wordResults:  wordResults,
    game_id:      game_id,
    error:        resp.error || null,
  };
  GS = null;
  navigate('game_results');
}

// ── Games lobby ────────────────────────────────────────────────────────────
async function renderGames() {
  setTopBar('Mini Games', true);
  const games = await api.get_game_list();
  if (!games || games.error) {
    $content().innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-sub)">Game service unavailable.</div>`;
    return;
  }
  const iconMap = { flash_memory:'🃏', word_scramble:'🔤', speed_typing:'⌨️', battle_mcq:'⚔️', unity_slot:'🎮', card_match:'🎴' };
  const ENABLED_GAMES = ['card_match'];
  const cards = games.filter(g => ENABLED_GAMES.includes(g.id)).map(g => `
    <div class="list-group" style="margin-bottom:12px;cursor:pointer"
         onclick="navigate('game_config', {gameId:'${escHtml(g.id)}'})">
      <div style="padding:16px;display:flex;align-items:flex-start;gap:14px">
        <div style="font-size:32px;flex-shrink:0">${iconMap[g.id] || '🎯'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:15px;margin-bottom:4px">${escHtml(g.name)}</div>
          <div style="font-size:13px;color:var(--text-sub);line-height:1.5">${escHtml(g.description)}</div>
          <div style="font-size:12px;color:var(--text-sub);margin-top:6px;opacity:.7">
            ${g.min_words}–${g.max_words} words
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" style="flex-shrink:0;color:var(--text-sub);margin-top:4px">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div style="padding:0 32px 40px">
      <div class="section-label" style="padding-left:0">Choose a Game</div>
      <div style="font-size:13px;color:var(--text-sub);margin-bottom:16px">
        Using word book: <b>${escHtml(S.bookName || 'All')}</b>
      </div>
      ${cards}
    </div>`;
}

// ── Game config ────────────────────────────────────────────────────────────
async function renderGameConfig() {
  const games = await api.get_game_list();
  const game  = (games || []).find(g => g.id === S.gameId);
  if (!game) { navigate('games'); return; }
  setTopBar(game.name, true);

  const schema = game.config_schema || {};
  const fields = Object.entries(schema).map(([key, spec]) => {
    if (key === 'fsrs_update') return `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:12px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:14px;font-weight:500">FSRS Update</div>
          <div style="font-size:12px;color:var(--text-sub);margin-top:2px">Apply results to spaced repetition</div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="cfg-${key}" ${spec.default ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>`;
    if (key === 'unity_exe_path') return `
      <div style="padding:12px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:14px;font-weight:500;margin-bottom:8px">Unity Executable</div>
        <div style="display:flex;gap:8px">
          <input class="form-input" id="cfg-unity_exe_path" type="text"
                 style="flex:1;margin:0" placeholder="Click Browse to select .exe / .app">
          <button class="btn-secondary" onclick="browseUnityExe()">Browse</button>
        </div>
      </div>`;
    if (spec.type === 'int') {
      const labelMap = {
        word_count:'Word Count', preview_ms:'Preview Time (ms)',
        time_limit_s:'Time Limit (s, 0=off)', round_time_s:'Round Time (s)',
        lives:'Lives', time_per_q_s:'Time per Question (s)',
      };
      const label = labelMap[key] || key;
      return `
        <div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="font-size:14px;font-weight:500">${label}</div>
            <div style="display:flex;align-items:center;gap:8px">
              <input type="range" id="cfg-${key}-range"
                     min="${spec.min}" max="${spec.max}" value="${spec.default}"
                     oninput="document.getElementById('cfg-${key}-val').textContent=this.value"
                     style="width:100px">
              <span id="cfg-${key}-val"
                    style="font-size:14px;font-weight:600;min-width:28px;text-align:right">
                ${spec.default}
              </span>
            </div>
          </div>
        </div>`;
    }
    return '';
  }).join('');

  $content().innerHTML = `
    <div style="padding:0 32px 40px">
      <div class="section-label" style="padding-left:0">Settings</div>
      <div class="list-group" style="padding:0 16px;margin-bottom:20px">
        ${fields || '<div style="padding:12px 0;font-size:13px;color:var(--text-sub)">No settings for this game.</div>'}
      </div>
      <div class="section-label" style="padding-left:0">Book</div>
      <div class="list-group" style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px">
          <span style="font-size:14px">Word Book</span>
          <span style="font-size:14px;font-weight:600">${escHtml(S.bookName || 'All')}</span>
        </div>
      </div>
      <button class="btn-primary w100" onclick="startGameSession()">
        Start ${escHtml(game.name)}
      </button>
    </div>`;
}

async function browseUnityExe() {
  const path = await api.open_file_dialog(['All files (*.*)']);
  const el = document.getElementById('cfg-unity_exe_path');
  if (el && path) el.value = path;
}

function _readGameConfig(schema) {
  const cfg = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (spec.type === 'int') {
      const el = document.getElementById(`cfg-${key}-range`);
      cfg[key] = el ? parseInt(el.value) : spec.default;
    } else if (spec.type === 'bool') {
      const el = document.getElementById(`cfg-${key}`);
      cfg[key] = el ? el.checked : spec.default;
    } else {
      const el = document.getElementById(`cfg-${key}`);
      cfg[key] = el ? el.value : spec.default;
    }
  }
  return cfg;
}

function openGamesFromHome() {
  S.gameAllLearned = true;   // flag: pull from all learned words, not just today's
  navigate('games');
}

async function startGameSession() {
  const games = await api.get_game_list();
  const game  = (games || []).find(g => g.id === S.gameId);
  if (!game) return;
  const cfg = _readGameConfig(game.config_schema || {});
  // If entered from home page, use all-learned pool instead of today's FSRS queue
  if (S.gameAllLearned) cfg.all_learned = true;
  const btn = document.querySelector('.btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
  const resp = await api.start_game_session(S.gameId, S.bookName, cfg);
  if (resp.error) {
    if (btn) { btn.disabled = false; btn.textContent = `Start ${game.name}`; }
    showToast('Error: ' + resp.error, 3500);
    return;
  }
  S.gameSession = resp;
  GS = null;
  navigate('game_play');
}

// ── Game play dispatcher ───────────────────────────────────────────────────
async function renderGamePlay() {
  const sess = S.gameSession;
  if (!sess) { navigate('games'); return; }
  switch (sess.game_id) {
    case 'flash_memory':  renderFlashMemoryGame();  break;
    case 'word_scramble': renderWordScrambleGame(); break;
    case 'speed_typing':  renderSpeedTypingGame();  break;
    case 'battle_mcq':    renderBattleMCQGame();    break;
    case 'unity_slot':    renderUnitySlot();        break;
    case 'card_match':    renderCardMatchGame();    break;
    default:
      $content().innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger)">
        Unknown game: ${escHtml(sess.game_id)}</div>`;
  }
}

// ─── Flash Memory ──────────────────────────────────────────────────────────
function renderFlashMemoryGame() {
  const sess = S.gameSession;
  if (!GS) {
    GS = {
      session_id: sess.session_id,
      game_id:    sess.game_id,
      words:      sess.words,
      phase:      'preview',
      idx:        0,
      results:    [],
      locked:     false,
      mcqCorrect: null,
      startTime:  0,
    };
  }
  setTopBar('Flash Memory', true);
  if (GS.phase === 'preview') {
    _renderFlashPreview(sess.config.preview_ms || 3000);
  } else {
    _renderFlashQuestion();
  }
}

function _renderFlashPreview(previewMs) {
  const totalSec = Math.max(1, Math.ceil(previewMs / 1000));
  const cards = GS.words.map(w => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px">
      <div style="font-weight:700;font-size:14px;color:#007AFF;margin-bottom:4px">${escHtml(w.word)}</div>
      <div style="font-size:12px;color:var(--text-sub);line-height:1.4">
        ${escHtml((w.definition || '').slice(0, 80))}
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div style="padding:0 0 24px;overflow-y:auto;flex:1">
      <div style="text-align:center;padding:20px 0 16px">
        <div style="font-size:14px;color:var(--text-sub);margin-bottom:4px">Memorise these words!</div>
        <div style="font-size:36px;font-weight:700" id="flash-countdown">${totalSec}</div>
        <div style="font-size:12px;color:var(--text-sub)">seconds remaining</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${cards}
      </div>
    </div>`;

  let sec = totalSec;
  const tick = setInterval(() => {
    sec--;
    const el = document.getElementById('flash-countdown');
    if (el) el.textContent = Math.max(0, sec);
    if (sec <= 0) {
      clearInterval(tick);
      GS.phase = 'quiz';
      GS.idx   = 0;
      _renderFlashQuestion();
    }
  }, 1000);
}

function _renderFlashQuestion() {
  if (GS.idx >= GS.words.length) { finishGame(GS.results); return; }
  const w       = GS.words[GS.idx];
  GS.locked     = false;
  GS.startTime  = Date.now();
  const others  = GS.words.filter((_, i) => i !== GS.idx);
  const decoys  = shuffle([...others]).slice(0, 3).map(o => o.definition || '');
  GS.mcqCorrect = w.definition || '';
  const opts    = shuffle([GS.mcqCorrect, ...decoys]);
  const progress = `${GS.idx + 1} / ${GS.words.length}`;
  setTopBar(`Flash Memory — ${progress}`, true);

  const optsHtml = opts.map(o => `
    <button class="mcq-opt" data-val="${escHtml(o)}" onclick="answerFlash(this)"
            style="text-align:left;font-size:13px;line-height:1.5">
      ${escHtml((o || '').slice(0, 120))}${(o || '').length > 120 ? '…' : ''}
    </button>`).join('');

  $content().innerHTML = `
    <div class="question-page">
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:11px;text-transform:uppercase;font-weight:600;
                    color:var(--text-sub);letter-spacing:.08em;margin-bottom:10px">
          Which definition matches?
        </div>
        <div style="font-size:28px;font-weight:700">${escHtml(w.word)}</div>
        ${w.chinese ? `<div style="font-size:13px;color:var(--text-sub);margin-top:6px">${escHtml(w.chinese)}</div>` : ''}
      </div>
      <div class="mcq-grid">${optsHtml}</div>
    </div>`;
}

function answerFlash(el) {
  if (GS.locked) return;
  GS.locked = true;
  const elapsed_s = (Date.now() - GS.startTime) / 1000;
  const correct   = el.dataset.val === GS.mcqCorrect;
  document.querySelectorAll('.mcq-opt').forEach(opt => {
    opt.classList.add('locked');
    if (opt.dataset.val === GS.mcqCorrect) opt.classList.add(correct ? 'correct' : 'reveal');
  });
  if (!correct) el.classList.add('wrong');
  GS.results.push({ word: GS.words[GS.idx].word, correct, elapsed_s });
  GS.idx++;
  setTimeout(() => {
    if (GS.idx < GS.words.length) _renderFlashQuestion();
    else finishGame(GS.results);
  }, correct ? 700 : 1200);
}

// ─── Word Scramble ─────────────────────────────────────────────────────────
function renderWordScrambleGame() {
  const sess = S.gameSession;
  if (!GS) {
    GS = {
      session_id: sess.session_id,
      game_id:    sess.game_id,
      words:      shuffle([...sess.words]),
      idx:        0,
      results:    [],
      locked:     false,
      typed:      [],
      scrambled:  [],
      startTime:  0,
    };
  }
  _renderScrambleQuestion();
}

function _scrambleLetters(word) {
  const arr = word.split('').map((ch, i) => ({ ch, origIdx: i }));
  return shuffle([...arr]);
}

function _renderScrambleQuestion() {
  if (GS.idx >= GS.words.length) { finishGame(GS.results); return; }
  const w      = GS.words[GS.idx];
  GS.locked    = false;
  GS.typed     = [];
  GS.scrambled = _scrambleLetters(w.word);
  GS.startTime = Date.now();
  const progress = `${GS.idx + 1} / ${GS.words.length}`;
  setTopBar(`Word Scramble — ${progress}`, true);
  _renderScrambleUI();
}

function _renderScrambleUI() {
  const w    = GS.words[GS.idx];
  const sArr = GS.scrambled;
  const letterBtns = sArr.map((item, sIdx) => {
    const used = GS.typed.includes(sIdx);
    return `<button class="letter-chip ${used ? 'used' : ''}"
              data-sidx="${sIdx}" onclick="pickLetter(${sIdx})"
              ${used ? 'disabled' : ''}>${escHtml(item.ch)}</button>`;
  }).join('');
  const typedWord = GS.typed.map(i => sArr[i].ch).join('');
  const blanks = w.word.split('').map((_, i) => {
    const ch = typedWord[i];
    return `<span class="letter-blank">${ch ? escHtml(ch) : '&nbsp;'}</span>`;
  }).join('');

  $content().innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;padding:32px 16px;gap:20px">
      <div style="text-align:center">
        <div style="font-size:11px;text-transform:uppercase;font-weight:600;
                    color:var(--text-sub);letter-spacing:.08em;margin-bottom:8px">
          Spell the word
        </div>
        <div style="font-size:14px;color:var(--text-main);line-height:1.6;max-width:300px;text-align:center">
          ${escHtml((w.definition || '').slice(0, 100))}${(w.definition || '').length > 100 ? '…' : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap" id="scramble-blanks">
        ${blanks}
      </div>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
        ${letterBtns}
      </div>
      <div style="display:flex;gap:12px">
        <button class="btn-ghost" onclick="clearScramble()" style="font-size:13px">Clear</button>
        <button class="btn-ghost" onclick="skipScramble()"
                style="font-size:13px;color:var(--text-sub)">Skip</button>
      </div>
    </div>`;
}

function pickLetter(sIdx) {
  if (GS.locked || GS.typed.includes(sIdx)) return;
  GS.typed.push(sIdx);
  const w         = GS.words[GS.idx];
  const typedWord = GS.typed.map(i => GS.scrambled[i].ch).join('');
  const full      = GS.typed.length === w.word.length;
  _renderScrambleUI();
  if (full) {
    const correct   = typedWord.toLowerCase() === w.word.toLowerCase();
    const elapsed_s = (Date.now() - GS.startTime) / 1000;
    GS.locked = true;
    const blanks = document.getElementById('scramble-blanks');
    if (blanks) blanks.style.color = correct ? '#34C759' : '#FF3B30';
    GS.results.push({ word: w.word, correct, elapsed_s });
    GS.idx++;
    setTimeout(() => _renderScrambleQuestion(), correct ? 700 : 1400);
  }
}

function clearScramble() {
  GS.typed = [];
  _renderScrambleUI();
}

function skipScramble() {
  if (GS.locked) return;
  const w = GS.words[GS.idx];
  GS.results.push({ word: w.word, correct: false, elapsed_s: 0, skipped: true });
  GS.idx++;
  _renderScrambleQuestion();
}

// ─── Speed Typing ──────────────────────────────────────────────────────────
function renderSpeedTypingGame() {
  const sess = S.gameSession;
  if (!GS) {
    GS = {
      session_id:    sess.session_id,
      game_id:       sess.game_id,
      words:         shuffle([...sess.words]),
      idx:           0,
      results:       [],
      locked:        false,
      startTime:     0,
      roundTimeLeft: sess.config.round_time_s || 60,
      roundTimerId:  null,
    };
  }
  _startSpeedRound();
}

function _startSpeedRound() {
  if (GS.roundTimerId) clearInterval(GS.roundTimerId);
  GS.roundTimerId = setInterval(() => {
    GS.roundTimeLeft--;
    const el = document.getElementById('speed-timer');
    if (el) {
      el.textContent = GS.roundTimeLeft + 's';
      el.style.color = GS.roundTimeLeft <= 10 ? '#FF3B30' : 'var(--text-sub)';
    }
    if (GS.roundTimeLeft <= 0) {
      clearInterval(GS.roundTimerId);
      while (GS.idx < GS.words.length) {
        GS.results.push({ word: GS.words[GS.idx].word, correct: false, elapsed_s: 0, skipped: true });
        GS.idx++;
      }
      finishGame(GS.results);
    }
  }, 1000);
  _renderSpeedQuestion();
}

function _renderSpeedQuestion() {
  if (GS.idx >= GS.words.length) {
    clearInterval(GS.roundTimerId);
    finishGame(GS.results);
    return;
  }
  const w       = GS.words[GS.idx];
  GS.locked     = false;
  GS.startTime  = Date.now();
  const progress = `${GS.idx + 1} / ${GS.words.length}`;
  setTopBar(`Speed Typing — ${progress}`, true);

  $content().innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;padding:32px 16px;gap:20px">
      <div style="display:flex;justify-content:space-between;width:100%;max-width:400px">
        <div style="font-size:12px;color:var(--text-sub)">Round time</div>
        <div id="speed-timer" style="font-size:14px;font-weight:700">${GS.roundTimeLeft}s</div>
      </div>
      <div style="text-align:center;max-width:360px">
        <div style="font-size:11px;text-transform:uppercase;font-weight:600;
                    color:var(--text-sub);letter-spacing:.08em;margin-bottom:10px">
          Type this word
        </div>
        <div style="font-size:16px;color:var(--text-main);line-height:1.6">
          ${escHtml((w.definition || '').slice(0, 120))}${(w.definition || '').length > 120 ? '…' : ''}
        </div>
        ${w.example ? `<div style="font-size:12px;color:var(--text-sub);margin-top:8px;font-style:italic">
          "${escHtml(stripCite(w.example || '').slice(0, 80))}"</div>` : ''}
      </div>
      <div style="display:flex;gap:8px;width:100%;max-width:360px">
        <input class="form-input" id="speed-input" type="text" style="flex:1;margin:0"
               placeholder="Type the word…" autocomplete="off" autocorrect="off"
               autocapitalize="off" spellcheck="false"
               oninput="checkSpeedTyping(this.value)" autofocus>
      </div>
      <div id="speed-feedback" style="min-height:20px;font-size:13px"></div>
      <button class="btn-ghost" onclick="skipSpeedWord()"
              style="font-size:12px;color:var(--text-sub)">Skip</button>
    </div>`;
  setTimeout(() => { const inp = document.getElementById('speed-input'); if (inp) inp.focus(); }, 50);
}

function checkSpeedTyping(val) {
  if (GS.locked) return;
  const w = GS.words[GS.idx];
  if (val.trim().toLowerCase() !== w.word.toLowerCase()) return;
  GS.locked = true;
  const elapsed_s = (Date.now() - GS.startTime) / 1000;
  const fb  = document.getElementById('speed-feedback');
  const inp = document.getElementById('speed-input');
  if (fb)  { fb.textContent = `✓  ${w.word}`; fb.style.color = '#34C759'; }
  if (inp) inp.style.borderColor = '#34C759';
  GS.results.push({ word: w.word, correct: true, elapsed_s });
  GS.idx++;
  setTimeout(() => _renderSpeedQuestion(), 600);
}

function skipSpeedWord() {
  if (GS.locked) return;
  const w = GS.words[GS.idx];
  GS.results.push({ word: w.word, correct: false, elapsed_s: 0, skipped: true });
  GS.idx++;
  _renderSpeedQuestion();
}

// ─── Battle MCQ ────────────────────────────────────────────────────────────
function renderBattleMCQGame() {
  const sess = S.gameSession;
  if (!GS) {
    GS = {
      session_id: sess.session_id,
      game_id:    sess.game_id,
      words:      shuffle([...sess.words]),
      idx:        0,
      results:    [],
      locked:     false,
      lives:      sess.config.lives    || 3,
      maxLives:   sess.config.lives    || 3,
      streak:     0,
      score:      0,
      mcqCorrect: null,
      startTime:  0,
      timePerQ:   sess.config.time_per_q_s || 10,
      timerId:    null,
      timeLeft:   0,
    };
  }
  _renderBattleQuestion();
}

function _renderBattleQuestion() {
  if (GS.timerId) clearInterval(GS.timerId);
  if (GS.idx >= GS.words.length || GS.lives <= 0) { finishGame(GS.results); return; }
  const w      = GS.words[GS.idx];
  GS.locked    = false;
  GS.startTime = Date.now();
  GS.timeLeft  = GS.timePerQ;
  const others = GS.words.filter((_, i) => i !== GS.idx);
  const decoys = shuffle([...others]).slice(0, 3).map(o => o.word);
  GS.mcqCorrect = w.word;
  const opts   = shuffle([w.word, ...decoys]);
  const lives  = '❤️'.repeat(GS.lives) + '🖤'.repeat(Math.max(0, GS.maxLives - GS.lives));
  const progress = `${GS.idx + 1} / ${GS.words.length}`;
  setTopBar(`Battle MCQ — ${progress}`, true);

  const optsHtml = opts.map(o => `
    <button class="mcq-opt" data-val="${escHtml(o)}" onclick="answerBattle(this)">
      ${escHtml(o)}
    </button>`).join('');

  $content().innerHTML = `
    <div class="question-page">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:16px">${lives}</div>
        <div style="font-size:13px;font-weight:700;color:#007AFF" id="battle-score">
          Score: ${GS.score}
        </div>
        <div style="font-size:13px;font-weight:700;color:var(--warning)" id="battle-timer">
          ${GS.timeLeft}s
        </div>
      </div>
      ${GS.streak >= 2 ? `<div style="text-align:center;font-size:12px;font-weight:600;color:var(--warning)">
        Streak ×${Math.min(GS.streak, 3)}</div>` : ''}
      <div style="text-align:center;padding:16px 0">
        <div style="font-size:11px;text-transform:uppercase;font-weight:600;
                    color:var(--text-sub);letter-spacing:.08em;margin-bottom:10px">
          Which word matches this definition?
        </div>
        <div style="font-size:15px;color:var(--text-main);line-height:1.6;max-width:320px;margin:0 auto">
          ${escHtml((w.definition || '').slice(0, 150))}${(w.definition || '').length > 150 ? '…' : ''}
        </div>
      </div>
      <div class="mcq-grid">${optsHtml}</div>
    </div>`;

  GS.timerId = setInterval(() => {
    GS.timeLeft--;
    const el = document.getElementById('battle-timer');
    if (el) { el.textContent = GS.timeLeft + 's'; el.style.color = GS.timeLeft <= 3 ? '#FF3B30' : 'var(--warning)'; }
    if (GS.timeLeft <= 0) { clearInterval(GS.timerId); if (!GS.locked) _battleTimeout(); }
  }, 1000);
}

function _battleTimeout() {
  if (GS.locked) return;
  GS.locked = true;
  const w = GS.words[GS.idx];
  GS.lives--;
  GS.streak = 0;
  document.querySelectorAll('.mcq-opt').forEach(opt => {
    opt.classList.add('locked');
    if (opt.dataset.val === GS.mcqCorrect) opt.classList.add('reveal');
  });
  GS.results.push({ word: w.word, correct: false, elapsed_s: GS.timePerQ });
  GS.idx++;
  setTimeout(() => _renderBattleQuestion(), 1200);
}

function answerBattle(el) {
  if (GS.locked) return;
  GS.locked = true;
  if (GS.timerId) clearInterval(GS.timerId);
  const w         = GS.words[GS.idx];
  const correct   = el.dataset.val === GS.mcqCorrect;
  const elapsed_s = (Date.now() - GS.startTime) / 1000;
  document.querySelectorAll('.mcq-opt').forEach(opt => {
    opt.classList.add('locked');
    if (opt.dataset.val === GS.mcqCorrect) opt.classList.add(correct ? 'correct' : 'reveal');
  });
  if (!correct) el.classList.add('wrong');
  if (correct) {
    GS.streak++;
    GS.score += 10 * Math.min(GS.streak, 3);
    const scoreEl = document.getElementById('battle-score');
    if (scoreEl) scoreEl.textContent = `Score: ${GS.score}`;
  } else {
    GS.lives--;
    GS.streak = 0;
  }
  GS.results.push({ word: w.word, correct, elapsed_s });
  GS.idx++;
  if (GS.lives <= 0) {
    setTimeout(() => finishGame(GS.results), 1200);
  } else {
    setTimeout(() => _renderBattleQuestion(), correct ? 700 : 1200);
  }
}

// ─── Unity Slot ────────────────────────────────────────────────────────────
// ─── Unity WebGL (iframe, bundled) ────────────────────────────────────────
//
// Protocol (postMessage between parent page and Unity iframe):
//   Unity → parent:  { type:'unity_ready' }
//   parent → Unity:  { type:'session_init', session_id, words:[...], config:{} }
//   Unity → parent:  { type:'unity_result', results:[{word,correct,elapsed_s},...] }
//   Unity → parent:  { type:'unity_exit' }   (user quit without finishing)
//
// Unity jslib stub (put in Assets/Plugins/bridge.jslib):
//   SendToParent: function(msg) {
//     window.parent.postMessage(JSON.parse(UTF8ToString(msg)), '*');
//   }
// C#: [DllImport("__Internal")] static extern void SendToParent(string json);
// Listen: window.addEventListener('message', e => unityInstance.SendMessage('Bridge','Receive',JSON.stringify(e.data)));

async function renderUnitySlot() {
  const sess = S.gameSession;
  if (!GS) {
    GS = {
      session_id:  sess.session_id,
      game_id:     sess.game_id,
      words:       sess.words,
      _msgHandler: null,
    };
  }
  setTopBar('Unity WebGL Game', true);

  const games = await api.get_unity_games();

  if (!games || games.length === 0) {
    $content().innerHTML = `
      <div style="padding:0 32px 40px">
        <div class="section-label" style="padding-left:0;padding-top:20px">No WebGL Games Found</div>
        <div class="list-group" style="padding:20px">
          <div style="font-size:14px;font-weight:600;margin-bottom:12px">How to add a Unity WebGL game</div>
          <div style="font-size:13px;color:var(--text-sub);line-height:2">
            1. In Unity, go to <b>File → Build Settings → WebGL → Build</b><br>
            2. Copy the output folder into your app:<br>
            <code style="display:inline-block;background:var(--bg);padding:4px 10px;
                         border-radius:6px;margin:4px 0;font-size:12px">
              gui/web/unity_games/&lt;game-name&gt;/
            </code><br>
            3. Make sure the folder contains <b>index.html</b><br>
            4. Return here — the game will appear automatically
          </div>
        </div>
        <div class="list-group" style="padding:16px;margin-top:12px">
          <div style="font-size:13px;font-weight:600;margin-bottom:8px">Unity bridge snippet</div>
          <pre style="font-size:11px;color:var(--text-sub);line-height:1.7;white-space:pre-wrap;word-break:break-all">// bridge.jslib
SendToParent: function(msg) {
  window.parent.postMessage(
    JSON.parse(UTF8ToString(msg)), '*');
}

// C# — receive words
void Receive(string json) { /* parse session_init */ }

// C# — send results
SendToParent(JsonUtility.ToJson(new Result{
  type="unity_result", results=...}));</pre>
        </div>
      </div>`;
    return;
  }

  const gameCards = games.map(g => `
    <div class="list-group" style="margin-bottom:10px;cursor:pointer"
         onclick="launchUnityWebGL('${escHtml(g.url)}', '${escHtml(g.name)}')">
      <div style="padding:16px;display:flex;align-items:center;gap:14px">
        <div style="font-size:28px">🎮</div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:15px">${escHtml(g.name)}</div>
          <div style="font-size:12px;color:var(--text-sub);margin-top:2px">
            ${GS.words.length} words · WebGL
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div style="padding:0 32px 40px">
      <div class="section-label" style="padding-left:0">Select Game</div>
      ${gameCards}
    </div>`;
}

function launchUnityWebGL(url, name) {
  setTopBar(escHtml(name), true);

  // Attach postMessage bridge BEFORE iframe loads
  if (GS._msgHandler) window.removeEventListener('message', GS._msgHandler);
  GS._msgHandler = e => {
    if (e.origin !== 'http://127.0.0.1:18765') return;  // only trust our own server
    if (e.data && typeof e.data === 'object') _handleUnityMessage(e.data);
  };
  window.addEventListener('message', GS._msgHandler);

  // Iframe fills the entire content area
  $content().innerHTML = `
    <iframe id="unity-frame" src="${escHtml(url)}"
            style="flex:1;width:100%;border:none;display:block;background:#000"
            allow="autoplay; fullscreen; microphone">
    </iframe>`;
}

function _handleUnityMessage(msg) {
  if (msg.type === 'unity_ready') {
    // Push word list + session context into the iframe
    const frame = document.getElementById('unity-frame');
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({
        type:       'session_init',
        session_id: GS.session_id,
        words:      GS.words,
        config:     S.gameSession.config || {},
      }, 'http://127.0.0.1:18765');
    }
  } else if (msg.type === 'unity_result') {
    _cleanUnityListeners();
    finishGame(msg.results || []);
  } else if (msg.type === 'unity_exit') {
    _cleanUnityListeners();
    GS = null;
    navigate('games');
  }
}

function _cleanUnityListeners() {
  if (GS && GS._msgHandler) {
    window.removeEventListener('message', GS._msgHandler);
    GS._msgHandler = null;
  }
}

// ─── Card Match ────────────────────────────────────────────────────────────
function renderCardMatchGame() {
  const sess = S.gameSession;
  if (!GS) {
    const deck = [];
    sess.words.forEach((w, i) => {
      deck.push({ id: `w${i}`, type: 'word', word: w.word, text: w.word });
      deck.push({ id: `d${i}`, type: 'def',  word: w.word, text: w.definition || '' });
    });
    GS = {
      session_id: sess.session_id,
      game_id:    sess.game_id,
      cards:      shuffle(deck),
      flipped:    [],
      matched:    new Set(),
      results:    [],
      attempts:   {},
      wordStart:  {},
      locked:     false,
    };
  }
  _buildMatchGrid();
}

/* Build grid HTML once; subsequent state changes only touch classList. */
function _matchScore() {
  // 20pts per correct match, +10 bonus if elapsed < 5s, +5 if < 10s
  return GS.results.reduce((sum, r) => {
    if (!r.correct) return sum;
    return sum + 20 + (r.elapsed_s < 5 ? 10 : r.elapsed_s < 10 ? 5 : 0);
  }, 0);
}

function _buildMatchGrid() {
  const { cards, matched, flipped } = GS;
  const total = cards.length / 2;
  setTopBar('Card Match', true);

  const n    = cards.length;
  const cols = Math.min(Math.max(Math.round(Math.sqrt(n)), 3), 6);

  const cardsHtml = cards.map((c, idx) => {
    const isUp      = flipped.includes(idx) || matched.has(c.word);
    const isMatched = matched.has(c.word);
    const cls = ['match-card', isUp ? 'flipped' : '', isMatched ? 'matched' : ''].filter(Boolean).join(' ');
    // Front face (unflipped): show type badge as hint
    const frontBadge = c.type === 'word'
      ? `<span class="mc-badge word">Word</span>`
      : `<span class="mc-badge def">Definition</span>`;
    // Back face (flipped): show actual content only
    const content = c.type === 'word'
      ? `<span class="mc-text-word">${escHtml(c.text)}</span>`
      : `<span class="mc-text-def">${escHtml((c.text || '').slice(0, 80))}${(c.text||'').length > 80 ? '…' : ''}</span>`;
    return `
      <div class="${cls}" data-idx="${idx}" onclick="flipMatchCard(${idx})">
        <div class="match-card-inner">
          <div class="match-card-front">${frontBadge}</div>
          <div class="match-card-back">${content}</div>
        </div>
      </div>`;
  }).join('');

  $content().innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;padding:12px 24px 24px;gap:12px">
      <div style="display:flex;align-items:center;gap:24px;font-size:13px;color:var(--text-sub)">
        <span>Matched <b style="color:var(--text-main)">${matched.size}</b> / ${total}</span>
        <span id="match-score-display" style="font-size:15px;font-weight:700;color:var(--accent)">
          ${_matchScore()} pts
        </span>
      </div>
      <div id="match-grid" style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;width:100%;max-width:600px">
        ${cardsHtml}
      </div>
    </div>`;
}

/* Update only classList + score — preserves DOM so CSS transitions play. */
function _updateMatchGrid() {
  const { cards, matched, flipped } = GS;
  const grid = document.getElementById('match-grid');
  if (!grid) { _buildMatchGrid(); return; }
  cards.forEach((c, idx) => {
    const el = grid.querySelector(`[data-idx="${idx}"]`);
    if (!el) return;
    el.classList.toggle('flipped', flipped.includes(idx) || matched.has(c.word));
    el.classList.toggle('matched', matched.has(c.word));
  });
  const scoreEl = document.getElementById('match-score-display');
  if (scoreEl) scoreEl.textContent = `${_matchScore()} pts`;
  // update matched counter text node
  const counter = scoreEl && scoreEl.parentElement && scoreEl.parentElement.querySelector('span:first-child b');
  if (counter) counter.textContent = matched.size;
}

function flipMatchCard(idx) {
  if (GS.locked) return;
  const card = GS.cards[idx];
  if (GS.matched.has(card.word)) return;
  if (GS.flipped.includes(idx)) return;
  if (GS.flipped.length >= 2) return;

  if (!GS.wordStart[card.word]) GS.wordStart[card.word] = Date.now();
  GS.flipped.push(idx);
  _updateMatchGrid();

  if (GS.flipped.length < 2) return;

  const [iA, iB] = GS.flipped;
  const cA = GS.cards[iA], cB = GS.cards[iB];

  if (cA.word === cB.word && cA.type !== cB.type) {
    // Correct match — wait for flip animation, then mark matched
    GS.locked = true;
    setTimeout(() => {
      GS.matched.add(cA.word);
      GS.flipped = [];
      const elapsed_s = (Date.now() - (GS.wordStart[cA.word] || Date.now())) / 1000;
      GS.results.push({ word: cA.word, correct: true, elapsed_s,
                        attempts: (GS.attempts[cA.word] || 0) + 1 });
      GS.locked = false;
      if (GS.matched.size === GS.cards.length / 2) {
        _updateMatchGrid();
        setTimeout(() => finishGame(GS.results), 380);
      } else {
        _updateMatchGrid();
      }
    }, 460);
  } else {
    // Wrong pair — shake both, then flip back
    GS.attempts[cA.word] = (GS.attempts[cA.word] || 0) + 1;
    GS.attempts[cB.word] = (GS.attempts[cB.word] || 0) + 1;
    GS.locked = true;
    const grid = document.getElementById('match-grid');
    if (grid) {
      [iA, iB].forEach(i => {
        const el = grid.querySelector(`[data-idx="${i}"]`);
        if (el) { el.classList.remove('locked-wrong'); void el.offsetWidth; el.classList.add('locked-wrong'); }
      });
    }
    setTimeout(() => {
      GS.flipped = [];
      GS.locked  = false;
      _updateMatchGrid();
    }, 950);
  }
}

// ── Game Results ──────────────────────────────────────────────────────────
async function renderGameResults() {
  setTopBar('Game Over', true);
  const d = S.gameResultData;
  if (!d) { navigate('games'); return; }
  if (d.error) {
    $content().innerHTML = `<div style="padding:32px;text-align:center;color:var(--danger)">
      Error: ${escHtml(d.error)}</div>`;
    return;
  }
  const pct = typeof d.accuracy === 'number' ? Math.round(d.accuracy * 100) : 0;
  const iconMap = { flash_memory:'🃏', word_scramble:'🔤', speed_typing:'⌨️', battle_mcq:'⚔️', unity_slot:'🎮', card_match:'🎴' };
  const wordRows = (d.wordResults || []).filter(r => !r.skipped).map(r => `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(r.word || '')}</div>
        ${r.elapsed_s ? `<div style="font-size:11px;color:var(--text-sub)">${(+r.elapsed_s).toFixed(1)}s</div>` : ''}
      </div>
      <div style="font-size:12px;font-weight:600;border-radius:6px;padding:3px 9px;
                  flex-shrink:0;margin-left:12px;
                  color:${r.correct ? '#34C759' : '#FF3B30'};
                  background:${r.correct ? '#34C75922' : '#FF3B3022'}">
        ${r.correct ? 'Correct' : 'Wrong'}
      </div>
    </div>`).join('');

  $content().innerHTML = `
    <div style="flex:1;overflow-y:auto;min-height:0">
      <div style="padding:0 0 40px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;
                    padding:24px;margin-bottom:20px;text-align:center">
          <div style="font-size:48px;margin-bottom:8px">${iconMap[d.game_id] || '🏆'}</div>
          <div style="font-size:22px;font-weight:700;margin-bottom:4px">Game Over!</div>
          <div style="display:flex;justify-content:center;gap:24px;margin-top:20px">
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${d.score}</div>
              <div style="font-size:12px;color:var(--text-sub)">Score</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${pct}%</div>
              <div style="font-size:12px;color:var(--text-sub)">Accuracy</div>
            </div>
            ${d.fsrs_updated > 0 ? `
            <div style="text-align:center">
              <div style="font-size:28px;font-weight:700">${d.fsrs_updated}</div>
              <div style="font-size:12px;color:var(--text-sub)">FSRS Updated</div>
            </div>` : ''}
          </div>
        </div>
        ${wordRows ? `
          <div class="section-label">Results</div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
                      padding:0 16px;margin-bottom:20px">
            ${wordRows}
          </div>` : ''}
        <button class="btn-primary w100" onclick="navigate('games')" style="margin-bottom:8px">
          Play Again
        </button>
        <button class="btn-ghost w100" onclick="finishGameToHome()">Back to Main Page</button>
      </div>
    </div>`;
}

function finishGameToHome() {
  S.gameResultData = null;
  S.gameSession    = null;
  S.gameId         = null;
  S.gameAllLearned = false;
  S.page           = 'home';
  S.history        = [];
  renderHome();
}

/* ════════════════════════════════════════════════════════════════════════
   INIT
   ════════════════════════════════════════════════════════════════════════ */
window.addEventListener('pywebviewready', () => {
  render();
});

// Fallback for browser-based testing
if (typeof window.pywebview === 'undefined') {
  console.warn('PyWebView not detected — running in browser stub mode');
}
