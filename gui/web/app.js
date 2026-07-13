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
// Primary transport is pywebview's injected bridge. When pywebview is absent
// (browser-based dev / Playwright e2e), fall back to the HTTP JSON bridge
// served by gui/dev_bridge.py at POST /api.
const api = new Proxy({}, {
  get(_, method) {
    return (...args) => {
      if (window.pywebview && window.pywebview.api) {
        return window.pywebview.api[method](...args);
      }
      return fetch('/api', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ method, args }),
      }).then(r => r.json());
    };
  }
});

// Strip leading "[N]" citation markers from example sentences (e.g. "[1]He left" → "He left")
function stripCite(s) {
  return (s || '').replace(/^\[\d+\]\s*/, '');
}

// ── Sound effects ─────────────────────────────────────────────────────────
// Central stub for all UI sound events. Replace the body of each case with
// an Audio() play call (e.g. new Audio('sfx/flip.mp3').play()) when assets
// are ready. All interaction sounds route through here so nothing is missed.
const SFX = {
  _sounds: {},  // cache: { name: HTMLAudioElement }
  _load(name) {
    if (!this._sounds[name]) {
      // Uncomment and set correct path once audio files are bundled:
      // this._sounds[name] = new Audio(`sfx/${name}.mp3`);
    }
    return this._sounds[name];
  },
  play(name) {
    const audio = this._load(name);
    if (!audio) return;  // no-op until files are added
    audio.currentTime = 0;
    audio.play().catch(() => {});
  },
};

function sfx(event) {
  switch (event) {
    case 'flip':        SFX.play('flip');        break;  // flashcard flip
    case 'nav':         SFX.play('nav');         break;  // prev/next navigation
    case 'correct':     SFX.play('correct');     break;  // correct answer / Easy/Good
    case 'wrong':       SFX.play('wrong');       break;  // wrong answer / Again
    case 'hard':        SFX.play('hard');        break;  // Hard rating
    case 'tap':         SFX.play('tap');         break;  // generic button tap
    case 'success':     SFX.play('success');     break;  // session complete / import ok
  }
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
  if (S.page === 'session' && PS) { saveSession(); _detachFcKeyboard(); }
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
        <!-- Word Spire card-battle game entry point returns here in a later phase -->
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
    _attachFcKeyboard();
    renderSessionFlashcard();
  } else {
    _detachFcKeyboard();
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
      <div style="font-size:12px;color:var(--border);margin-top:10px">
        ← → Arrow keys to navigate · Space to flip
      </div>
    </div>`;
}

function flipCard() {
  sfx('flip');
  PS.flipped = !PS.flipped;
  const inner = document.getElementById('fc-inner');
  if (inner) inner.classList.toggle('flipped', PS.flipped);
}

function fcNav(dir) {
  sfx('nav');
  PS.flipped = false;
  if (dir === 1 && PS.fcIdx >= PS.words.length - 1) {
    _detachFcKeyboard();
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

// ── Keyboard handler for flashcard phase ───────────────────────────────────
// Attached once per renderSession() call, cleaned up when leaving the session page.
let _fcKeyHandler = null;

function _attachFcKeyboard() {
  _detachFcKeyboard();
  _fcKeyHandler = (e) => {
    if (!PS || PS.phase !== 'flashcard') return;
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

function _detachFcKeyboard() {
  if (_fcKeyHandler) { window.removeEventListener('keydown', _fcKeyHandler); _fcKeyHandler = null; }
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
    PS.stats.answers++;
    PS.stats.correct++;
    PS.stats[label.toLowerCase()]++;
    PS.wordResults.set(w.word, { word: w.word, def: w.def, rating, label });
    await api.record_answer(w.word, rating);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    sfx('wrong');
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
    sfx('hard');
    // MCQ correct after FIG wrong → Hard
    PS.stats.correct++;
    PS.stats.hard++;
    PS.wordResults.set(w.word, { word: w.word, def: w.def, rating: 2, label: 'Hard' });
    await api.record_answer(w.word, 2);
    await refreshDueQueue();
    saveSession();
    setTimeout(() => nextPracticeWord(), 800);
  } else {
    sfx('wrong');
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

async function showSessionComplete() {
  sfx('success');
  setTopBar('Session Complete', true);  // back button → home
  clearSession();
  await api.complete_session();

  // Capture stats + words before clearing PS
  const st          = PS.stats;
  const wordResults = PS.wordResults;

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

        <button class="btn-primary w100" onclick="finishSession()">Back to Main Page</button>
      </div>
    </div>`;
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

  const stats = await api.get_db_stats();
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
        <button class="tab active" id="tab-words"  onclick="switchTab('words')">Words Only</button>
        <button class="tab"        id="tab-clip"   onclick="switchTab('clip')">Clipboard</button>
        <button class="tab"        id="tab-txt"    onclick="switchTab('txt')">TXT</button>
        <button class="tab"        id="tab-excel"  onclick="switchTab('excel')">Excel</button>
        <button class="tab"        id="tab-json"   onclick="switchTab('json')">JSON</button>
        <button class="tab"        id="tab-manage" onclick="switchTab('manage')">Manage</button>
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
  ['words','clip','txt','excel','json','manage'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.toggle('active', t === tab);
  });
  if (tab === 'manage') {
    // Manage tab renders asynchronously — show book selector + empty list first, then load
    document.getElementById('tab-content').innerHTML = tabManageSkeleton();
    document.getElementById('import-result').innerHTML = '';
    _lookupResults = [];
    // Auto-load words for currently selected book
    loadManageWords();
    return;
  }
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
        <label class="form-label">Paste words</label>
        <textarea class="form-textarea" id="words-text" style="min-height:140px"
          placeholder="apple&#10;banana&#10;ephemeral&#10;ubiquitous&#10;..."></textarea>
      </div>
      <div class="form-row" style="margin-bottom:12px">
        <label class="form-label">Word separator <span style="color:var(--text-sub);font-weight:400">(default: newline)</span></label>
        <input class="form-input" id="words-sep" type="text" value="&#10;"
               style="width:120px;font-family:monospace" placeholder="\\n">
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

  // Use custom separator (support \n, \t escape sequences)
  const sepRaw = document.getElementById('words-sep')?.value ?? '\n';
  const sep = sepRaw === '\\n' ? '\n' : sepRaw === '\\t' ? '\t' : sepRaw || '\n';
  // Replace separator with newlines so the API can split on newlines
  const normalised = sep === '\n' ? text : text.split(sep).join('\n');

  const results = await api.lookup_words(normalised);
  // Stash original DB values so importLookupResults can detect user edits
  results.forEach(r => {
    if (r.found) { r._origDef = r.definition; r._origEx = r.example; r._origCn = r.chinese; }
  });
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
    const missingEx = r.found && !r.example;
    const exWarning = missingEx
      ? `<span style="color:var(--warning);font-size:11px;margin-left:6px" title="No example sentence — FIG practice may fall back to definition prompt">⚠ no example</span>`
      : '';
    const def = r.definition ? escHtml(r.definition.slice(0, 60)) + (r.definition.length > 60 ? '…' : '') : '';
    return `
      <div class="lookup-row" id="lrow-${i}" style="${!r.found ? 'opacity:.45' : ''}">
        <div style="display:flex;align-items:center;padding:8px 12px;gap:10px">
          <input type="checkbox" id="chk-${i}" ${r.found ? 'checked' : 'disabled'}
            onchange="updateLookupCount()" style="flex-shrink:0;width:16px;height:16px;cursor:pointer">
          <div style="width:110px;flex-shrink:0;font-size:13px;color:var(--text-sub)">${escHtml(r.input)}</div>
          <div style="width:130px;flex-shrink:0;font-size:14px">${matchedLabel}${exWarning}</div>
          <div style="flex:1;font-size:13px;color:var(--text-sub);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${def}</div>
          ${r.found ? `<button class="btn-ghost" style="font-size:12px;padding:2px 8px;flex-shrink:0" onclick="toggleLookupEdit(${i})">Edit</button>` : ''}
        </div>
        <div id="ledit-${i}" style="display:none;padding:0 12px 10px 38px;display:none">
          <div style="display:flex;flex-direction:column;gap:6px">
            <textarea class="form-textarea" id="ledit-def-${i}" style="min-height:48px;font-size:13px"
              placeholder="Definition (Chinese) *">${escHtml(r.definition || '')}</textarea>
            <input class="form-input" id="ledit-ex-${i}" type="text" style="font-size:13px"
              placeholder="Example sentence (English) — required for Fill-in-Gap"
              value="${escHtml(r.example || '')}">
            <input class="form-input" id="ledit-cn-${i}" type="text" style="font-size:13px"
              placeholder="Example sentence (Chinese translation)"
              value="${escHtml(r.chinese || '')}">
          </div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('lookup-preview').innerHTML = `
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:4px">
      <div style="display:flex;align-items:center;padding:8px 12px;background:var(--bg);font-size:11px;font-weight:600;color:var(--text-sub);text-transform:uppercase;gap:10px">
        <div style="width:16px"></div>
        <div style="width:110px">Input</div>
        <div style="width:130px">Matched · ${foundCount} found</div>
        <div style="flex:1">Definition preview</div>
        <div style="width:40px"></div>
      </div>
      ${rows}
    </div>`;

  const actionsEl = document.getElementById('lookup-actions');
  actionsEl.style.display = 'flex';
  actionsEl.style.alignItems = 'center';
  updateLookupCount();

  // Auto-expand rows that are missing an example sentence so the user notices
  results.forEach((r, i) => {
    if (r.found && !r.example) toggleLookupEdit(i, true);
  });
}

function toggleLookupEdit(idx, forceOpen) {
  const el = document.getElementById(`ledit-${idx}`);
  if (!el) return;
  const isOpen = el.style.display !== 'none';
  el.style.display = (forceOpen || !isOpen) ? 'block' : 'none';
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

  // Merge any inline edits back into _lookupResults before sending
  _lookupResults.forEach((r, i) => {
    if (!r.found) return;
    const defEl = document.getElementById(`ledit-def-${i}`);
    const exEl  = document.getElementById(`ledit-ex-${i}`);
    const cnEl  = document.getElementById(`ledit-cn-${i}`);
    if (defEl) r.definition = defEl.value.trim() || r.definition;
    if (exEl)  r.example    = exEl.value.trim();
    if (cnEl)  r.chinese    = cnEl.value.trim();
  });

  const selected = _lookupResults.filter((r, i) => {
    const chk = document.getElementById(`chk-${i}`);
    return chk && chk.checked && r.found;
  });
  if (!selected.length) { showToast('Nothing selected'); return; }

  const result = await api.import_word_matches(selected, bookname, newBook);
  const ok = typeof result === 'string' && result.startsWith('Successfully');
  if (ok) {
    sfx('success');
    // Write any user-edited fields to Word_Overrides (non-destructive — never modifies Words table)
    const overrides = {};
    selected.forEach(r => {
      const orig = _lookupResults.find(x => x.matched === r.matched);
      if (!orig) return;
      // Only store as override if the user actually changed something vs DB value
      const defChanged = r.definition !== (orig._origDef ?? r.definition);
      const exChanged  = r.example    !== (orig._origEx  ?? r.example);
      const cnChanged  = r.chinese    !== (orig._origCn  ?? r.chinese);
      if (defChanged || exChanged || cnChanged) {
        overrides[r.matched] = { definition: r.definition, example: r.example, chinese: r.chinese };
      }
    });
    if (Object.keys(overrides).length) await api.apply_word_overrides(overrides);
  }
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
      <div style="margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:6px">Optional fields (leave unchecked to omit from each entry)</div>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="clip-inc-ex" checked> English example (field 3)
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="clip-inc-cn" checked> Chinese example (field 4)
        </label>
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
      <div style="margin-bottom:10px">
        <div style="font-size:13px;color:var(--text-sub);margin-bottom:6px">Optional fields (leave unchecked to omit from each entry)</div>
        <label style="display:inline-flex;align-items:center;gap:6px;margin-right:16px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="txt-inc-ex" checked> English example (field 3)
        </label>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="checkbox" id="txt-inc-cn" checked> Chinese example (field 4)
        </label>
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
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="xl-inc-ex" checked> English example column
          </label>
          <input class="form-input" id="xl-ex" type="text" value="example">
        </div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="xl-inc-cn" checked> Chinese example column
          </label>
          <input class="form-input" id="xl-cn" type="text" value="chinese">
        </div>
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
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="json-inc-ex" checked> English example key
          </label>
          <input class="form-input" id="json-ex" type="text" value="example">
        </div>
        <div class="form-row">
          <label class="form-label" style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="json-inc-cn" checked> Chinese example key
          </label>
          <input class="form-input" id="json-cn" type="text" value="chinese">
        </div>
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

  // Helper: compute positional field indices for text-based imports ("a,b\n" mode)
  function _textFieldIndices(incEx, incCn) {
    let next = 2; // word=0, def=1
    const exIdx = incEx ? next++ : 9999;
    const cnIdx = incCn ? next++ : 9999;
    return { exIdx, cnIdx };
  }

  if (activeTab === 'clip') {
    const text = document.getElementById('clip-text')?.value || '';
    const fs = document.getElementById('clip-field-sep')?.value || ' = ';
    const es = document.getElementById('clip-entry-sep')?.value || '\n';
    const incEx = document.getElementById('clip-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('clip-inc-cn')?.checked ?? true;
    const { exIdx, cnIdx } = _textFieldIndices(incEx, incCn);
    result = await api.import_clipboard(text, bookname, fs, es, newBook, exIdx, cnIdx);
  } else if (activeTab === 'txt') {
    const path = document.getElementById('txt-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const fs = document.getElementById('txt-field-sep')?.value || ' = ';
    const es = document.getElementById('txt-entry-sep')?.value || '\n';
    const incEx = document.getElementById('txt-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('txt-inc-cn')?.checked ?? true;
    const { exIdx, cnIdx } = _textFieldIndices(incEx, incCn);
    result = await api.import_txt(path, bookname, fs, es, newBook, exIdx, cnIdx);
  } else if (activeTab === 'excel') {
    const path = document.getElementById('xl-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const incEx = document.getElementById('xl-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('xl-inc-cn')?.checked ?? true;
    result = await api.import_excel(
      path, bookname,
      document.getElementById('xl-sheet')?.value || 'Sheet1',
      document.getElementById('xl-word')?.value || 'word',
      document.getElementById('xl-def')?.value || 'definition',
      incEx ? (document.getElementById('xl-ex')?.value || 'example') : '',
      incCn ? (document.getElementById('xl-cn')?.value || 'chinese') : '',
      newBook
    );
  } else if (activeTab === 'json') {
    const path = document.getElementById('json-path')?.value?.trim() || '';
    if (!path) { resultEl.innerHTML = '<div class="result-msg err">Please select a file.</div>'; return; }
    const incEx = document.getElementById('json-inc-ex')?.checked ?? true;
    const incCn = document.getElementById('json-inc-cn')?.checked ?? true;
    result = await api.import_json(
      path, bookname,
      document.getElementById('json-vocab')?.value || 'word',
      document.getElementById('json-def')?.value || 'definition',
      incEx ? (document.getElementById('json-ex')?.value || 'example') : '',
      incCn ? (document.getElementById('json-cn')?.value || 'chinese') : '',
      newBook
    );
  }

  const ok = typeof result === 'string' && result.startsWith('Successfully');
  resultEl.innerHTML = `<div class="result-msg ${ok ? 'ok' : 'err'}">${escHtml(String(result))}</div>`;
}

// ── Manage tab ─────────────────────────────────────────────────────────────
// Lets the user browse, edit (definition/example/chinese), and remove words
// from a book. Uses the import page's book selector so no extra UI is needed.

let _manageState = { offset: 0, limit: 50, total: 0, search: '' };

function tabManageSkeleton() {
  return `
    <div id="manage-container">
      <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center">
        <input class="form-input" id="manage-search" type="text" placeholder="Search words…"
               style="flex:1" oninput="onManageSearch()" />
        <button class="btn-secondary" onclick="loadManageWords()">Refresh</button>
      </div>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-sub);margin-bottom:10px;cursor:pointer">
        <input type="checkbox" id="manage-missing-only" onchange="loadManageWords(0)">
        Show only words missing example sentence (⚠)
      </label>
      <div id="manage-list"><div class="spinner"></div></div>
      <div id="manage-pager" style="display:flex;gap:8px;justify-content:center;margin-top:10px"></div>
    </div>`;
}

async function loadManageWords(offset = 0) {
  const bookSel = document.getElementById('import-book')?.value;
  if (!bookSel || bookSel === '__new__') {
    document.getElementById('manage-list').innerHTML =
      '<div style="color:var(--text-sub);font-size:14px;padding:12px 0">Select a book above.</div>';
    return;
  }
  _manageState.offset = offset;
  _manageState.search = document.getElementById('manage-search')?.value?.trim() || '';
  const listEl  = document.getElementById('manage-list');
  const pagerEl = document.getElementById('manage-pager');
  if (!listEl) return;
  listEl.innerHTML = '<div class="spinner"></div>';

  const missingOnly = document.getElementById('manage-missing-only')?.checked || false;
  const data = await api.get_book_words(bookSel, offset, _manageState.limit, _manageState.search, missingOnly);
  if (data.error) {
    listEl.innerHTML = `<div style="color:var(--danger);font-size:14px">${escHtml(data.error)}</div>`;
    return;
  }
  _manageState.total = data.total;

  if (!data.words.length) {
    listEl.innerHTML = '<div style="color:var(--text-sub);font-size:14px;padding:12px 0">No words found.</div>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }

  // Store word data on window so openWordEditor can pre-fill without extra API call
  window._manageWordData = {};
  data.words.forEach(w => { window._manageWordData[w.id] = w; });

  const rows = data.words.map(w => {
    const missingEx = !w.example;
    const warn = missingEx
      ? `<span title="Missing example sentence — Fill-in-Gap will fall back to definition prompt"
               style="color:var(--warning);font-size:13px;flex-shrink:0">⚠</span>` : '';
    return `
    <div class="manage-word-row" id="mwr-${w.id}">
      <div class="manage-word-vocab">${escHtml(w.vocab)}</div>
      <div class="manage-word-def" id="mwd-${w.id}">${escHtml(w.definition)}</div>
      ${warn}
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn-ghost manage-edit-btn" onclick="openWordEditor(${w.id},'${escHtml(w.vocab).replace(/'/g,"\\'")}')">Edit</button>
        <button class="btn-ghost manage-del-btn"  onclick="removeWordFromBook(${w.id},'${escHtml(bookSel).replace(/'/g,"\\'")}','${escHtml(w.vocab).replace(/'/g,"\\'")}')">✕</button>
      </div>
    </div>`;
  }).join('');

  listEl.innerHTML = `
    <div style="font-size:12px;color:var(--text-sub);margin-bottom:6px">
      ${data.total} word${data.total !== 1 ? 's' : ''}${_manageState.search ? ' matching "' + escHtml(_manageState.search) + '"' : ''}
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      ${rows}
    </div>`;

  // Pagination
  const pages = Math.ceil(data.total / _manageState.limit);
  const cur   = Math.floor(offset / _manageState.limit);
  if (pagerEl) {
    pagerEl.innerHTML = pages <= 1 ? '' : `
      <button class="btn-ghost" ${cur === 0 ? 'disabled' : ''} onclick="loadManageWords(${(cur-1)*_manageState.limit})">‹ Prev</button>
      <span style="font-size:13px;color:var(--text-sub);align-self:center">Page ${cur+1} / ${pages}</span>
      <button class="btn-ghost" ${cur >= pages-1 ? 'disabled' : ''} onclick="loadManageWords(${(cur+1)*_manageState.limit})">Next ›</button>`;
  }
}

let _manageSearchTimer;
function onManageSearch() {
  clearTimeout(_manageSearchTimer);
  _manageSearchTimer = setTimeout(() => loadManageWords(0), 350);
}

// Inline word editor — replaces the row with an edit form
function openWordEditor(wordId, vocab) {
  const row = document.getElementById(`mwr-${wordId}`);
  if (!row) return;
  const w = (window._manageWordData || {})[wordId] || {};
  const missingEx = !w.example;
  row.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;gap:6px">
      <div style="font-weight:600;font-size:14px">${escHtml(vocab)}</div>
      <textarea class="form-textarea" id="edit-def-${wordId}" style="min-height:56px;font-size:13px"
                placeholder="Definition (Chinese)">${escHtml(w.definition || '')}</textarea>
      <div>
        <input class="form-input" id="edit-ex-${wordId}" type="text" style="font-size:13px"
          placeholder="Example sentence (English) — required for Fill-in-Gap ✱"
          value="${escHtml(w.example || '')}">
        ${missingEx ? `<div style="font-size:11px;color:var(--warning);margin-top:3px">⚠ No example — Fill-in-Gap practice will show the definition as a fallback instead of a sentence.</div>` : ''}
      </div>
      <input class="form-input" id="edit-cn-${wordId}" type="text" style="font-size:13px"
        placeholder="Chinese translation of example"
        value="${escHtml(w.chinese || '')}">
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
      <button class="btn-primary" style="font-size:13px" onclick="saveWordEdit(${wordId})">Save</button>
      <button class="btn-ghost"   style="font-size:13px" onclick="loadManageWords(${_manageState.offset})">Cancel</button>
    </div>`;
}

async function saveWordEdit(wordId) {
  const def = document.getElementById(`edit-def-${wordId}`)?.value?.trim() || '';
  const ex  = document.getElementById(`edit-ex-${wordId}`)?.value?.trim()  || '';
  const cn  = document.getElementById(`edit-cn-${wordId}`)?.value?.trim()  || '';
  const res = await api.update_word(wordId, def, ex, cn);
  if (res.error) { showToast('Error: ' + res.error); return; }
  sfx('tap');
  showToast('Saved');
  loadManageWords(_manageState.offset);
}

async function removeWordFromBook(wordId, bookName, vocab) {
  showConfirm(
    `Remove "${vocab}"?`,
    `This removes "${vocab}" from the book "${bookName}". The word data itself is kept.`,
    'Remove',
    async () => {
      const res = await api.remove_word_from_book(wordId, bookName);
      if (res.error) { showToast('Error: ' + res.error); return; }
      sfx('tap');
      showToast(`Removed "${vocab}"`);
      loadManageWords(_manageState.offset);
    },
    true
  );
}

/* ════════════════════════════════════════════════════════════════════════
   SETTINGS PAGE
   ════════════════════════════════════════════════════════════════════════ */
async function renderSettings() {
  setTopBar('Settings', true);
  const appInfo = await api.get_app_info();
  const count = appInfo.daily_new_limit || 20;

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
        <div class="list-row" style="cursor:pointer" onclick="exportData()">
          <span class="list-row-label">Export Data Backup</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </div>
        <div class="list-row" style="cursor:pointer" onclick="importData()">
          <span class="list-row-label">Import Data Backup</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               style="color:var(--text-sub)">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <div class="list-row" style="border:none;cursor:pointer;border-top:1px solid var(--border)" onclick="confirmReset()">
          <span class="list-row-label" style="color:var(--danger);text-align:center">Reset Progress &amp; Imported Books</span>
        </div>
        ${S.debug ? `<div class="list-row" style="border:none;cursor:pointer;border-top:1px solid var(--border)" onclick="confirmFactoryReset()">
          <span class="list-row-label" style="color:var(--danger);text-align:center;opacity:.6">Factory Reset (Dev)</span>
        </div>` : ''}
      </div>
      <div id="data-backup-result" style="font-size:12px;padding:4px 16px 0;min-height:18px"></div>
      <div style="font-size:12px;color:var(--text-sub);padding:4px 16px 0">Export saves all your books, progress, and edits to a file. Import restores from a backup — <b>existing data will be overwritten</b>.</div>

      <!-- Updates -->
      <div class="section-label" style="padding-left:0;padding-top:20px">Updates</div>
      <div class="list-group" style="margin-bottom:4px">
        <div class="list-row" style="cursor:pointer" onclick="checkForUpdates()">
          <span class="list-row-label">Check for Updates</span>
          <span id="update-badge" style="font-size:12px;color:var(--text-sub)">v${appInfo.app_version || '—'}</span>
        </div>
      </div>
      <div id="update-result" style="margin:0 0 4px"></div>

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
        <div style="margin-top:14px;font-size:12px;color:var(--border)">
          FlashCard App v${appInfo.app_version || '—'}
        </div>
      </div>
    </div>`;
}

async function saveSettings() {
  const count = parseInt(document.getElementById('count-slider').value);
  const appInfo = await api.get_app_info();
  appInfo.daily_new_limit = count;
  await api.update_app_info(appInfo);

  showToast('Settings saved.');
}

async function checkForUpdates() {
  const badge  = document.getElementById('update-badge');
  const result = document.getElementById('update-result');
  if (!result) return;

  if (badge) badge.textContent = 'Checking…';
  result.innerHTML = '';

  const res = await api.check_for_updates();

  if (res.error) {
    if (badge) badge.textContent = '';
    result.innerHTML = `
      <div style="margin:6px 16px;padding:10px 14px;border-radius:8px;background:rgba(255,59,48,.08);
                  font-size:13px;color:var(--danger)">
        Unable to check for updates. Please verify your internet connection.<br>
        <span style="font-size:11px;color:var(--text-sub)">${escHtml(res.error)}</span>
      </div>`;
    return;
  }

  if (badge) badge.textContent = `v${res.current}`;

  if (res.up_to_date) {
    result.innerHTML = `
      <div style="margin:6px 16px;padding:10px 14px;border-radius:8px;background:rgba(52,199,89,.08);
                  font-size:13px;color:var(--success);display:flex;align-items:center;gap:8px">
        <span style="font-size:16px">✓</span>
        You're up to date — v${escHtml(res.current)} is the latest version.
      </div>`;
  } else {
    const notes = res.release_notes
      ? `<div style="margin-top:8px;font-size:12px;color:var(--text-sub);white-space:pre-wrap;line-height:1.5">${escHtml(res.release_notes)}</div>`
      : '';
    const hasAsset = !!res.asset_url;
    const installBtn = hasAsset
      ? `<button class="btn-primary" id="install-update-btn" style="font-size:13px;flex-shrink:0"
                 onclick="startAutoUpdate('${escHtml(res.asset_url)}')">
           Install &amp; Restart
         </button>`
      : `<button class="btn-primary" style="font-size:13px;flex-shrink:0"
                 onclick="api.open_url('${res.download_url}')">
           Download →
         </button>`;
    result.innerHTML = `
      <div style="margin:6px 16px;padding:12px 14px;border-radius:8px;background:rgba(0,122,255,.08);
                  font-size:13px;border:1px solid rgba(0,122,255,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div>
            <span style="color:var(--accent);font-weight:600">New version available: v${escHtml(res.latest)}</span>
            <span style="color:var(--text-sub);margin-left:8px">(current: v${escHtml(res.current)})</span>
          </div>
          ${installBtn}
        </div>
        ${notes}
        <div id="update-progress-wrap" style="display:none;margin-top:12px">
          <div style="background:var(--border);border-radius:4px;height:6px;overflow:hidden">
            <div id="update-progress-bar" style="height:100%;width:0%;background:var(--accent);transition:width .3s"></div>
          </div>
          <div id="update-progress-label" style="margin-top:6px;font-size:12px;color:var(--text-sub)"></div>
        </div>
      </div>`;
  }
}

let _updatePollTimer = null;
async function startAutoUpdate(assetUrl) {
  const btn = document.getElementById('install-update-btn');
  if (btn) btn.disabled = true;

  const wrap  = document.getElementById('update-progress-wrap');
  const bar   = document.getElementById('update-progress-bar');
  const label = document.getElementById('update-progress-label');
  if (wrap) wrap.style.display = 'block';

  await api.download_and_install_update(assetUrl);

  // Poll progress every 400ms
  _updatePollTimer = setInterval(async () => {
    const p = await api.get_update_progress();
    if (!p) return;

    if (bar)   bar.style.width = (p.pct || 0) + '%';

    const msgs = {
      downloading: `Downloading… ${p.pct || 0}%`,
      extracting:  'Verifying…',
      launching:   'Launching updater…',
      done:        'Restarting…',
      error:       `Error: ${p.error || 'unknown'}`,
    };
    if (label) label.textContent = msgs[p.state] || '';

    if (p.state === 'done' || p.state === 'error') {
      clearInterval(_updatePollTimer);
      if (p.state === 'error' && btn) btn.disabled = false;
    }
  }, 400);
}

async function exportLog() {
  const res = await api.export_log();
  if (!res || res.cancelled) return;
  if (res.error) { showToast('Error: ' + res.error, 3000); return; }
  showToast('Log saved to: ' + res.path, 4000);
}

async function exportData() {
  const statusEl = document.getElementById('data-backup-result');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-sub)">Saving…</span>';
  const res = await api.export_data();
  if (!res || res.cancelled) { if (statusEl) statusEl.innerHTML = ''; return; }
  if (res.error) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error)}</span>`;
    return;
  }
  if (statusEl) statusEl.innerHTML = `<span style="color:#34C759">Backup saved.</span>`;
  showToast('Backup saved to: ' + res.path, 4000);
}

async function importData() {
  showConfirm(
    'Import Data Backup',
    'This will OVERWRITE all your current books, progress, and word edits with the backup file. This cannot be undone. The app will need to restart after import.',
    'Choose File & Overwrite',
    async () => {
      const path = await api.open_file_dialog(['Database files (*.db)', 'All files (*.*)']);
      if (!path) return;
      const statusEl = document.getElementById('data-backup-result');
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--text-sub)">Importing…</span>';
      const res = await api.import_data(path);
      if (res && res.error) {
        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escHtml(res.error)}</span>`;
        return;
      }
      if (statusEl) statusEl.innerHTML = '<span style="color:#34C759">Import complete. Please restart the app.</span>';
      showToast('Data imported. Please restart the app to apply changes.', 6000);
    }
  );
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
   INIT
   ════════════════════════════════════════════════════════════════════════ */
let _booted = false;
function _boot() {
  if (_booted) return;
  _booted = true;
  render();
}
window.addEventListener('pywebviewready', _boot);

// Fallback for browser-based dev / e2e: pywebview is never injected there, so
// boot once we're confident it isn't coming and drive the HTTP bridge instead.
if (typeof window.pywebview !== 'undefined') {
  _boot();
} else {
  setTimeout(() => {
    if (typeof window.pywebview === 'undefined') {
      console.warn('PyWebView not detected — booting via HTTP bridge (dev/e2e mode)');
      _boot();
    }
  }, 500);
}
