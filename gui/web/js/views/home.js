/* ════════════════════════════════════════════════════════════════════════
   HOME PAGE + CALENDAR
   ════════════════════════════════════════════════════════════════════════ */
import { S, store } from '../core/state.js';
import { api } from '../core/api.js';
import { setTopBar, $content, escHtml } from '../core/dom.js';
import { navigate, _debugBtnHtml } from '../core/router.js';
import { loadSession, clearSession, continueSession } from '../core/session_store.js';

export async function renderHome() {
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
          <button class="btn-primary w100" data-action="continueSession">
            Continue — ${savedLeft}
          </button>
          <button class="btn-secondary w100" style="margin-top:8px" data-action="startSession" ${disabled && !S.debug ? 'disabled' : ''}>
            Start New Session
          </button>
        ` : `
          <button class="btn-primary w100" data-action="startSession" ${disabled && !S.debug ? 'disabled' : ''}>
            ${S.debug ? '🐛 Debug Session' : 'Start Session'}
          </button>
        `}
        <!-- Word Spire card-battle game entry point returns here in a later phase -->
        ${S.debug ? `<button class="btn-secondary w100" style="margin-top:8px" data-action="navigate" data-page="debug">DB Inspector</button>` : ''}
      </div>
    </div>`;

  $content().innerHTML = `
    <div class="home-layout">
      <div class="home-left">
        <!-- Word Book -->
        <div>
          <div class="section-label">
            Word Book
            <button class="section-label-action" data-action="navigate" data-page="import">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Import
            </button>
          </div>
          <div class="list-group" style="margin-bottom:20px">
            <div class="list-row" style="border:none;padding:0">
              <select class="styled-select" id="book-select" data-change="onBookChange">
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

export function onBookChange(val) {
  S.bookName = val;
  renderHome();
}

export async function startSession() {
  if (!S.bookName) return;
  clearSession();
  store.PS = null;
  navigate('session');
}

/* ── Calendar ─────────────────────────────────────────────────────────── */
export function buildCalendarHTML(calInfo) {
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
      <button class="icon-btn" data-action="calNav" data-dir="-1" style="flex-shrink:0">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="cal-month-label">${monthNames[month - 1]} ${year}</div>
      <button class="icon-btn" data-action="calNav" data-dir="1" style="flex-shrink:0">
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

export async function calNav(dir) {
  let { year, month } = S.calMonth;
  month += dir;
  if (month > 12) { month = 1; year++; }
  if (month < 1)  { month = 12; year--; }
  S.calMonth = { year, month };
  const calInfo = await api.get_calendar_info();
  const cal = document.getElementById('cal-container');
  if (cal) cal.innerHTML = buildCalendarHTML(calInfo);
}

// ── Delegation adapters ───────────────────────────────────────────────────
export const actions = {
  continueSession: () => continueSession(),
  startSession: () => startSession(),
  onBookChange: (el) => onBookChange(el.value),
  calNav: (el) => calNav(Number(el.dataset.dir)),
};
